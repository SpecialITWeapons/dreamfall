// The terrain: one indexed grid displaced on the GPU by the heights the CPU
// wrote into the heightfield texture, with a normal from central differences
// and a ground each biome paints for itself. The grid is anchored at a world
// position that is a whole number of cells, and moves under the flyer in whole
// cells.
//
// The colour is composed once, at start-up, out of the registry: every biome
// gets a branch, gated on how much of this fragment is its own, so at three
// slots per cell at most three of ten branches run anywhere. The weights come
// from the window as the CPU wrote them -- the GPU never recomputes a climate.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  FloatType,
  Mesh,
  NearestFilter,
  RGBAFormat,
  UnsignedByteType,
  Vector2,
} from 'three';
import type { Node } from 'three/webgpu';
import {
  Fn,
  If,
  float,
  ivec2,
  mix,
  mx_noise_float,
  normalize,
  positionLocal,
  positionWorld,
  smoothstep,
  step,
  textureLoad,
  transformNormalToView,
  uniform,
  varying,
  vec2,
  vec3,
} from 'three/tsl';
import { swatchColor, type Biome, type GroundCtx, type SceneryColor } from '../../../library/contract';
import { SNOW_LINE, resolveGround } from '../../../library/standard/index.js';
import type { Look } from '../render/ColorGrade';
import type { LitMaterial } from '../render/SoftLighting';
import type { GroundShade } from '../scenery/GroundShade';
import { createCloudShadow } from '../sky/CloudShadow';
import type { SkyUniforms } from '../sky/SkyUniforms';
import type { Heightfield } from './Heightfield';
import { BASE_TEMP_RANGE, CELL } from './WorldSampler';

/** Rendered terrain, cells per side (±4.2 km). */
export const TERRAIN_CELLS = 528;
/** A biome under this share of a fragment does not run its hook at all (spec 6.3). */
const BRANCH_FLOOR = 0.01;
export const WATER_CELLS = 132;
export const WATER_CELL = CELL * 4;

/** An indexed grid centered on the origin; the diagonal matches Heightfield.heightAt. */
export function buildGrid(cells: number, cell: number): BufferGeometry {
  const side = cells + 1,
    count = side * side;
  const positions = new Float32Array(count * 3),
    normals = new Float32Array(count * 3);
  const indices = count > 65535 ? new Uint32Array(cells * cells * 6) : new Uint16Array(cells * cells * 6);
  let index = 0;
  for (let z = 0; z <= cells; z++)
    for (let x = 0; x <= cells; x++) {
      const vertex = z * side + x;
      positions[vertex * 3] = (x - cells / 2) * cell;
      positions[vertex * 3 + 2] = (z - cells / 2) * cell;
      normals[vertex * 3 + 1] = 1;
      if (x < cells && z < cells) {
        // Same diagonal as heightAt, including at negative world coordinates.
        indices.set([vertex, vertex + side, vertex + 1, vertex + side + 1, vertex + 1, vertex + side], index);
        index += 6;
      }
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}

/** The graded terrain colors as uniforms shared by the ground and the water. */
export function createTerrainPalette(look: Look) {
  const c = (key: string) => uniform(new Color(look.terrain[key]!));
  return {
    sand: c('sand'),
    snow: c('snow'),
    seaFloor: c('seaFloor'),
    waterDeep: c('waterDeep'),
    waterShallow: c('waterShallow'),
  };
}
export type TerrainPalette = ReturnType<typeof createTerrainPalette>;

/** Reads one heightfield texel by world cell index; shared with the water for its shore depth. */
export type LoadCell = (ix: Node<'float'>, iz: Node<'float'>) => Node<'vec4'>;

// The world with no library at all: the swatches the ground was painted with
// before the biomes owned it. Nothing in the page takes this path, but the
// sampler has the same fallback, and a terrain that renders black without a
// registry would be a poor way to find that out.
const MEADOW = new Color(0x7caa48),
  STEPPE = new Color(0x9aa658),
  ROCK = new Color(0x8a9179);
const K = (c: Color) => vec3(c.r, c.g, c.b);
/**
 * The world's snow, in the numbers the original drew it with. The line itself
 * is the library's `SNOW_LINE` -- what is here is only how it wanders and what
 * lies under it.
 *
 * `hold` is the slope up to which snow lies fully, as one minus the normal's
 * y: 0.09 is about twenty-five degrees, which is roughly where it stops lying
 * on a mountain and is why a summit pyramid is rock with snow in its gullies
 * rather than a white cone.
 */
const SNOW = {
  /** Metres the line rises on the sunny side. */
  aspect: 50,
  /** Metres of slow wander, so the line is not a contour drawn on the map. */
  wander: 45,
  /** Slope up to which snow lies fully. */
  hold: 0.09,
  /** Metres the cover takes to come in either side of the line. */
  band: 26,
  /** Metres of bare alpine rock under the line. */
  rockBand: 320,
} as const;
/** Shaded snow is blue, and only shaded snow: lit snow is the day palette's own. */
const SNOW_SHADE = K(new Color(0xb4c8ea));
/** The rock the snow sits on, which is nobody's biome: it is what a mountain is made of. */
const ALPINE_ROCK = K(new Color(0x565963));
/** The sun's horizontal bearing at noon: which faces melt out first. */
const NOON_XZ = vec2(-0.45, 0.55).normalize();
const swatchNode = (value: SceneryColor) => {
  const c = new Color(swatchColor(value));
  return vec3(c.r, c.g, c.b);
};

export function createTerrain(deps: {
  heightfield: Heightfield;
  uniforms: SkyUniforms;
  litMaterial: LitMaterial;
  palette: TerrainPalette;
  /** The registry, in order: a biome's index here is the index in the window's slots. */
  biomes?: Biome[];
  /** The scenery's shade sheet; without it the ground lights exactly as it did before there was one. */
  shade?: GroundShade;
}) {
  const { heightfield: hf, uniforms: u, litMaterial, palette } = deps;
  const biomes = deps.biomes ?? [];
  const size = hf.size;
  const texture = new DataTexture(hf.data, size, size, RGBAFormat, FloatType);
  texture.magFilter = texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  // Who the weights belong to, one byte each; nearest filtering because an
  // index halfway between two biomes is not a biome.
  const slotTexture = new DataTexture(hf.slots, size, size, RGBAFormat, UnsignedByteType);
  slotTexture.magFilter = slotTexture.minFilter = NearestFilter;
  slotTexture.generateMipmaps = false;
  slotTexture.needsUpdate = true;
  let uploaded = hf.version;
  /** World anchor of the grid's center, a whole number of cells. */
  const uAnchor = uniform(new Vector2(0, 0));
  const loadCell: LoadCell = (ix, iz) =>
    textureLoad(texture, ivec2(ix.mod(size).toInt(), iz.mod(size).toInt()));
  const loadSlots: LoadCell = (ix, iz) =>
    textureLoad(slotTexture, ivec2(ix.mod(size).toInt(), iz.mod(size).toInt()));
  const wx = positionLocal.x.add(uAnchor.x),
    wz = positionLocal.z.add(uAnchor.y);
  const ix = wx.div(CELL).add(0.5).floor(),
    iz = wz.div(CELL).add(0.5).floor();
  const hv = loadCell(ix, iz).x;
  const surfaceNormal = normalize(
    vec3(
      loadCell(ix.sub(1), iz).x.sub(loadCell(ix.add(1), iz).x),
      CELL * 2,
      loadCell(ix, iz.sub(1)).x.sub(loadCell(ix, iz.add(1)).x),
    ),
  );
  const normalV = varying(surfaceNormal).normalize();
  const slope = float(1).sub(normalV.y);
  const worldXZ = positionWorld.xz.add(u.uWorldOrigin);
  const h = positionWorld.y;
  // What a ground hook is handed. Everything here is shared by every biome
  // except the weight and the params, which are set per branch below.
  const context = {
    worldXZ,
    height: h,
    slope,
    normal: normalV,
    sunDir: u.uSunDir,
    noise: (scale: number, salt: number) => mx_noise_float(worldXZ.mul(scale).add(salt * 17.3)),
    hash: (salt: number) =>
      mx_noise_float(worldXZ.mul(0.5).add(salt * 91.7))
        .mul(0.5)
        .add(0.5),
    color: swatchNode,
    mix: (a: Node<'vec3'>, b: Node<'vec3'>, t: Node<'float'> | number) => mix(a, b, t),
    ramp: (v: Node<'float'>, from: number, to: number) => smoothstep(from, to, v),
  };
  // The biomes' own parameters as uniforms, so an editor can move them later
  // without recompiling the material; the hooks of today read their own lists.
  const biomeParams = biomes.map((biome) =>
    Object.fromEntries(
      Object.entries(biome.params ?? {}).map(([key, value]) => [
        key,
        typeof value === 'number' ? uniform(value) : uniform(new Color(swatchColor(value))),
      ]),
    ),
  );
  // An entry that stands in a country has no ground of its own and no branch:
  // its share of a fragment is handed to the country beside it below.
  const hooks = biomes.map((biome) => (biome.ground ? resolveGround(biome.ground) : null));
  const inherits = biomes.map((biome) => biome.inherit !== undefined);
  const colorNode = Fn(() => {
    const ground = vec3(0).toVar();
    // How much of this fragment belongs to biomes that want the world's snow.
    // `snow: false` is the contract's way for a biome to say the line is not
    // its business -- a salt flat at altitude, a volcano -- and it has been in
    // `contract.ts` unread since M3a.
    const snowShare = float(0).toVar();
    if (biomes.length === 0) {
      // no registry: the built-in swatches, so the world still reads as ground
      const macro = smoothstep(0.18, 0.48, mx_noise_float(worldXZ.mul(0.012)));
      ground.assign(mix(K(MEADOW), K(STEPPE), macro));
      ground.assign(mix(ground, K(ROCK), smoothstep(0.32, 0.55, slope)));
      snowShare.assign(1);
    } else {
      const weights = loadCell(ix, iz);
      const slots = loadSlots(ix, iz);
      // a byte texture reads back normalised, so the index comes home times 255
      const id = [slots.x, slots.y, slots.z].map((c) => c.mul(255).round());
      const share = [weights.y, weights.z, weights.w];
      // How much of this fragment is a country at all. A slot naming an entry
      // that stands in one -- a settlement -- is counted out, and the rest is
      // spread back over one, which is `countryOf` (terrain/Country.ts) in
      // nodes: the ring sows by that function, and a ground that disagreed
      // with it would paint a meadow under a wood.
      const countryIn = (slot: number) =>
        inherits.reduce(
          (acc: Node<'float'>, inherit, k) => (inherit ? acc.sub(step(id[slot]!.sub(k).abs(), 0.5)) : acc),
          float(1),
        );
      const country = share
        .map((w, slot) => w.mul(countryIn(slot)))
        .reduce((a, b) => a.add(b))
        .toVar();
      // Nobody here is a country: the first biome takes it, the sampler's own
      // rule for ground no presence claims.
      const unclaimed = float(1).sub(step(0.0001, country));
      const total = float(0).toVar();
      biomes.forEach((_biome, k) => {
        const hook = hooks[k];
        if (!hook) return;
        // this fragment's share of this biome: the slots that name it, added
        // up, as a share of the country rather than of the whole fragment
        const mask = share
          .map((w, slot) => w.mul(step(id[slot]!.sub(k).abs(), 0.5)))
          .reduce((a, b) => a.add(b))
          .div(country.max(0.0001))
          .toVar();
        if (k === 0) mask.addAssign(unclaimed);
        If(mask.greaterThan(BRANCH_FLOOR), () => {
          const out = hook({ ...context, weight: mask, params: biomeParams[k]! } as GroundCtx);
          ground.addAssign(out.albedo.mul(mask));
          total.addAssign(mask);
          if (biomes[k]!.snow !== false) snowShare.addAssign(mask);
        });
      });
      ground.divAssign(total.max(0.0001));
      snowShare.divAssign(total.max(0.0001));
    }
    ground.assign(mix(palette.seaFloor, ground, smoothstep(-10.0, 0.5, h)));
    // The world's snow, above the same line the tree line is drawn sixty metres
    // over. `snowLineAt` is the library's and lives there because `library/`
    // never imports from `src/`; what crosses over is its two numbers, so there
    // is one line and not two -- the fault that rule was written against is a
    // forest that stops where no snow starts.
    //
    // The line is not a contour. Faces toward the noon sun melt out higher, and
    // a slow wander keeps it off the map. Snow holds where the ground is gentle
    // enough to hold it; a steeper face is the rock underneath, which is also
    // what makes a summit read as a summit rather than as an iced bun.
    const baseTemp = loadSlots(ix, iz).w.mul(BASE_TEMP_RANGE);
    const wander = mx_noise_float(worldXZ.mul(1 / 260))
      .mul(SNOW.wander)
      .add(mx_noise_float(worldXZ.mul(1 / 70)).mul(SNOW.wander * 0.3));
    const aspect = normalize(normalV.xz.add(vec2(0.0001, 0)))
      .dot(NOON_XZ)
      .mul(smoothstep(0.04, 0.35, slope));
    const line = baseTemp.mul(SNOW_LINE.slope).add(SNOW_LINE.base).add(aspect.mul(SNOW.aspect)).add(wander);
    const hold = smoothstep(SNOW.hold + 0.2, SNOW.hold - 0.05, slope);
    const cover = smoothstep(line.sub(SNOW.band), line.add(SNOW.band), h).mul(hold).mul(snowShare).toVar();
    // Bare alpine rock in a band under the line: without it the meadow runs
    // straight into the snow and the mountain has no mountain in it.
    const alpine = smoothstep(line.sub(SNOW.rockBand), line.sub(30), h).mul(
      smoothstep(SNOW.hold - 0.02, SNOW.hold + 0.16, slope),
    );
    ground.assign(mix(ground, ALPINE_ROCK, alpine.mul(float(1).sub(cover))));
    // Shaded snow goes blue, and only shaded snow: lit snow is the palette's.
    const lit = smoothstep(-0.05, 0.4, normalV.dot(u.uSunDir));
    ground.assign(mix(ground, mix(SNOW_SHADE, palette.snow, lit), cover));
    return ground;
  })();
  const brush = mx_noise_float(worldXZ.mul(0.018))
    .mul(0.04)
    .add(mx_noise_float(worldXZ.mul(0.13)).mul(0.015))
    .add(1);
  const cloudShadow = createCloudShadow(u);
  // Shore masks use the actual fragment height, never interpolated corner colors.
  const material = litMaterial(
    mix(palette.sand, colorNode, smoothstep(1.5, 7.5, h))
      .mul(brush)
      .mul(cloudShadow(worldXZ)),
  );
  // The shade under the trees reads the same worldXZ as the ground hooks, so
  // its sheet stays where the trees are when the origin jumps under the scene.
  if (deps.shade) material.aoNode = deps.shade.aoNode(worldXZ);
  material.positionNode = vec3(positionLocal.x, hv, positionLocal.z);
  material.normalNode = transformNormalToView(normalV);
  const mesh = new Mesh(buildGrid(TERRAIN_CELLS, CELL), material);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return {
    mesh,
    loadCell,
    uAnchor,
    update(anchorWorldX: number, anchorWorldZ: number, originX: number, originZ: number) {
      uAnchor.value.set(anchorWorldX, anchorWorldZ);
      mesh.position.set(anchorWorldX - originX, 0, anchorWorldZ - originZ);
    },
    upload() {
      if (hf.version !== uploaded) {
        texture.needsUpdate = true;
        slotTexture.needsUpdate = true;
        uploaded = hf.version;
      }
    },
    biomeParams,
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
      slotTexture.dispose();
    },
  };
}
export type Terrain = ReturnType<typeof createTerrain>;
