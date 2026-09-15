// The terrain: one indexed grid displaced on the GPU by the heights the CPU
// wrote into the heightfield texture, with a normal from central differences
// and a built-in ground color. Biome-owned colors arrive with the library in
// M3; snow and the alpine rock in M5. The grid is anchored at a world position
// that is a whole number of cells, and moves under the flyer in whole cells.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  FloatType,
  Mesh,
  NearestFilter,
  RGBAFormat,
  Vector2,
} from 'three';
import type { Node } from 'three/webgpu';
import {
  Fn,
  float,
  ivec2,
  mix,
  mx_noise_float,
  normalize,
  positionLocal,
  positionWorld,
  smoothstep,
  textureLoad,
  transformNormalToView,
  uniform,
  varying,
  vec3,
} from 'three/tsl';
import type { Look } from '../render/ColorGrade';
import type { LitMaterial } from '../render/SoftLighting';
import type { SkyUniforms } from '../sky/SkyUniforms';
import type { Heightfield } from './Heightfield';
import { CELL } from './WorldSampler';

/** Rendered terrain, cells per side (±4.2 km). */
export const TERRAIN_CELLS = 528;
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

// Built-in ground colors until the library owns them (fly-with-me swatches: meadow, steppe, rock).
const MEADOW = new Color(0x7caa48),
  STEPPE = new Color(0x9aa658),
  ROCK = new Color(0x8a9179);
const K = (c: Color) => vec3(c.r, c.g, c.b);

export function createTerrain(deps: {
  heightfield: Heightfield;
  uniforms: SkyUniforms;
  litMaterial: LitMaterial;
  palette: TerrainPalette;
}) {
  const { heightfield: hf, uniforms: u, litMaterial, palette } = deps;
  const size = hf.size;
  const texture = new DataTexture(hf.data, size, size, RGBAFormat, FloatType);
  texture.magFilter = texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  let uploaded = hf.version;
  /** World anchor of the grid's center, a whole number of cells. */
  const uAnchor = uniform(new Vector2(0, 0));
  const loadCell: LoadCell = (ix, iz) =>
    textureLoad(texture, ivec2(ix.mod(size).toInt(), iz.mod(size).toInt()));
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
  const colorNode = Fn(() => {
    const macro = smoothstep(0.18, 0.48, mx_noise_float(worldXZ.mul(0.012)));
    const ground = mix(K(MEADOW), K(STEPPE), macro).toVar();
    const rockAmt = smoothstep(0.32, 0.55, slope);
    ground.assign(mix(ground, K(ROCK), rockAmt));
    ground.assign(mix(palette.seaFloor, ground, smoothstep(-10.0, 0.5, h)));
    return ground;
  })();
  const brush = mx_noise_float(worldXZ.mul(0.018))
    .mul(0.04)
    .add(mx_noise_float(worldXZ.mul(0.13)).mul(0.015))
    .add(1);
  // Shore masks use the actual fragment height, never interpolated corner colors.
  const material = litMaterial(mix(palette.sand, colorNode, smoothstep(1.5, 7.5, h)).mul(brush));
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
        uploaded = hf.version;
      }
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
export type Terrain = ReturnType<typeof createTerrain>;
