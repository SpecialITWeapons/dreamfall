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
  vec3,
} from 'three/tsl';
import { swatchColor, type Biome, type GroundCtx, type SceneryColor } from '../../../library/contract';
import { resolveGround } from '../../../library/standard/index.js';
import type { Look } from '../render/ColorGrade';
import type { LitMaterial } from '../render/SoftLighting';
import { createCloudShadow } from '../sky/CloudShadow';
import type { SkyUniforms } from '../sky/SkyUniforms';
import type { Heightfield } from './Heightfield';
import { CELL } from './WorldSampler';

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
  const hooks = biomes.map((biome) => resolveGround(biome.ground));
  const colorNode = Fn(() => {
    const ground = vec3(0).toVar();
    if (biomes.length === 0) {
      // no registry: the built-in swatches, so the world still reads as ground
      const macro = smoothstep(0.18, 0.48, mx_noise_float(worldXZ.mul(0.012)));
      ground.assign(mix(K(MEADOW), K(STEPPE), macro));
      ground.assign(mix(ground, K(ROCK), smoothstep(0.32, 0.55, slope)));
    } else {
      const weights = loadCell(ix, iz);
      const slots = loadSlots(ix, iz);
      // a byte texture reads back normalised, so the index comes home times 255
      const id = [slots.x, slots.y, slots.z].map((c) => c.mul(255).round());
      const share = [weights.y, weights.z, weights.w];
      const total = float(0).toVar();
      biomes.forEach((_biome, k) => {
        // this fragment's share of this biome: the slots that name it, added up
        const mask = share
          .map((w, slot) => w.mul(step(id[slot]!.sub(k).abs(), 0.5)))
          .reduce((a, b) => a.add(b))
          .toVar();
        If(mask.greaterThan(BRANCH_FLOOR), () => {
          const out = hooks[k]!({ ...context, weight: mask, params: biomeParams[k]! } as GroundCtx);
          ground.addAssign(out.albedo.mul(mask));
          total.addAssign(mask);
        });
      });
      ground.divAssign(total.max(0.0001));
    }
    ground.assign(mix(palette.seaFloor, ground, smoothstep(-10.0, 0.5, h)));
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
