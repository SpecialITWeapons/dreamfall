// The cards: every tree the flight can see past the full trees, drawn as one
// quad from the photographs ImpostorBake takes of its species. One mesh of
// instances for every species, so the far land costs one draw.
//
// A card stands on the ground the flight sees. Its height comes from the CPU
// -- the near surface, which is what the ring stands a tree on -- and over the
// near grid's last `MORPH` metres it goes over into the far surface the way the
// near grid itself does, read from the far window in the shader: past 4.2 km
// the land drawn is the far grid, and nothing on the CPU reads that.
//
// It turns about the vertical to face the eye, and as the eye rises over it it
// tips back to face the eye outright while the side picture gives way to the
// one taken from above, so from high up a wood is crowns and not walls. It is
// lit by the same lighting model as the tree it stands in for, through the
// directions baked beside the colour, and tinted per tree as the tree is.
//
// A full tree and its card trade places over one band of distance
// (`treeLimit`), read by both, so the swap is one dissolve of the same tree.
import {
  BufferAttribute,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoColorSpace,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Vector2,
} from 'three';
import type { Node, UniformNode } from 'three/webgpu';
import {
  abs,
  attribute,
  cameraPosition,
  cross,
  float,
  length,
  max,
  mix,
  normalize,
  smoothstep,
  step,
  texture,
  transformNormalToView,
  varying,
  vec2,
  vec3,
} from 'three/tsl';
import type { LitMaterial } from '../render/SoftLighting';
import type { Origin } from '../sim/Origin';
import type { SkyUniforms } from '../sky/SkyUniforms';
import { FAR_CELL, MORPH, NEAR_REACH } from '../terrain/Lod';
import { surfaceHeight, type LoadCell } from '../terrain/TerrainMesh';
import { CARD_ATTRIBUTES, packCard, type CardTree } from './cardPack';
import { ATLAS_COLUMNS, ATLAS_ROWS, TILE, type Atlas, type ImpostorShape } from './ImpostorBake';

/** Cards the pool holds: the densest far land measured is under nineteen thousand trees. */
export const MAX_CARDS = 32000;
/** Where a card thins out at the far terrain's edge, m, under the far cover that hides that edge anyway. */
const FAR_FADE = [7900, 8150] as const;
/**
 * The sine of the eye's elevation over a card over which its side picture gives
 * way to the one from above: level to about twenty degrees is the side, past
 * about sixty the crown.
 */
const VIEW_TOP = [0.35, 0.85] as const;
/** The leaf cards' cutout and glow (Painted.ts), which a card mostly is. */
const ALPHA_TEST = 0.04,
  EMISSIVE = 0.025,
  TRANSLUCENCY = 1.1;

/** The quad and the instance attributes, with nothing drawn yet: six vertex buffers, under WebGPU's eight. */
export function cardGeometry(capacity: number): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  // x across the card from -0.5 to 0.5, y up it from its foot at 0 to its top at 1
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3),
  );
  geometry.setAttribute(
    'normal',
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
  );
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  for (const [name, width] of Object.entries(CARD_ATTRIBUTES)) {
    const attr = new InstancedBufferAttribute(new Float32Array(capacity * width), width);
    attr.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, attr);
  }
  geometry.instanceCount = 0;
  return geometry;
}

/** One of the atlas's two pictures as a texture with every level the bake made. */
function atlasTexture(atlas: Atlas, levels: Uint8Array[], color: boolean): DataTexture {
  const map = new DataTexture(levels[0]!, atlas.width, atlas.height, RGBAFormat, UnsignedByteType);
  map.mipmaps = levels.map((data, i) => ({
    data,
    width: Math.max(1, atlas.width >> i),
    height: Math.max(1, atlas.height >> i),
  }));
  map.generateMipmaps = false;
  map.minFilter = LinearMipmapLinearFilter;
  map.magFilter = LinearFilter;
  map.colorSpace = color ? SRGBColorSpace : NoColorSpace;
  map.needsUpdate = true;
  return map;
}

export interface Cards {
  readonly mesh: Mesh;
  /** Trees standing as cards after the last write. */
  readonly count: number;
  /** Trees the last write had no room for; the browser test demands none. */
  readonly refused: number;
  /** Rewrites every card, in the scene's frame: the ring's trees, then the far ones. */
  write(
    near: Iterable<CardTree & { species: string }>,
    far: { forEach(fn: (tree: CardTree & { species: string }) => void): void },
    origin: Origin,
  ): void;
  dispose(): void;
}

export function createCards(deps: {
  atlas: Atlas;
  /** Each species' tile in the atlas and its frame at scale one. */
  species: Map<string, { tile: number; shape: ImpostorShape }>;
  litMaterial: LitMaterial;
  uniforms: SkyUniforms;
  /** The far window's loader and the anchor both grids stand on: where the near surface goes over into the far one. */
  farLoad: LoadCell;
  anchor: UniformNode<'vec2', Vector2>;
  /** The band a full tree hands over to its card in, m. */
  treeLimit: UniformNode<'vec2', Vector2>;
  capacity?: number;
}): Cards {
  const capacity = deps.capacity ?? MAX_CARDS;
  const geometry = cardGeometry(capacity);
  const colorMap = atlasTexture(deps.atlas, deps.atlas.color, true);
  const normalMap = atlasTexture(deps.atlas, deps.atlas.normal, false);

  const corner = attribute<'vec3'>('position', 'vec3');
  const cardA = attribute<'vec4'>('cardA', 'vec4');
  const cardB = attribute<'vec4'>('cardB', 'vec4');
  const tint = attribute<'vec3'>('cardC', 'vec3');

  // Where it stands: the CPU's height on the near surface, the far surface's past it.
  const worldXZ = vec2(cardA.x, cardA.z).add(deps.uniforms.uWorldOrigin);
  const rim = smoothstep(
    NEAR_REACH - MORPH,
    NEAR_REACH,
    max(abs(worldXZ.x.sub(deps.anchor.x)), abs(worldXZ.y.sub(deps.anchor.y))),
  );
  const ground = mix(cardA.y, surfaceHeight(deps.farLoad, FAR_CELL)(worldXZ), rim);
  const foot = vec3(cardA.x, ground, cardA.z);
  const centre = foot.add(vec3(0, cardB.w.add(cardB.y.mul(0.5)), 0));
  // Which way it faces: about the vertical toward the eye, tipped back as the eye rises.
  const toEye = cameraPosition.sub(centre);
  const eye = normalize(toEye);
  // a hair of x keeps the level direction defined with the eye straight overhead
  const level = normalize(vec3(toEye.x.add(0.0001), 0, toEye.z));
  const right = vec3(level.z, 0, level.x.negate());
  const top = smoothstep(VIEW_TOP[0], VIEW_TOP[1], eye.y);
  const facing = normalize(mix(level, eye, top));
  const upward = cross(facing, right);
  const height = mix(cardB.y, cardB.z, top);
  const position = centre
    .add(right.mul(corner.x.mul(cardB.x)))
    .add(upward.mul(corner.y.sub(0.5).mul(height)));
  const distance = length(foot.sub(cameraPosition));
  // Whole before its tree starts to go (`cardBand`): the band's width before it.
  const width = deps.treeLimit.y.sub(deps.treeLimit.x);
  const fade = smoothstep(deps.treeLimit.x.sub(width), deps.treeLimit.x, distance).mul(
    float(1).sub(smoothstep(FAR_FADE[0], FAR_FADE[1], distance)),
  );

  // Which picture, and where in it: a column per species, mirrored for half of them.
  // Rounded rather than floored (`decodeCard`): read here in the fragment stage,
  // interpolated, a hair under an even number would be the neighbour's picture.
  const tile = cardA.w.mul(0.5).add(0.25).floor();
  const mirror = step(0.5, cardA.w.sub(tile.mul(2)));
  const inset = 0.5 / TILE;
  const across = corner.x.add(0.5);
  const u = mix(across, float(1).sub(across), mirror)
    .mul(1 - 2 * inset)
    .add(inset);
  const v = corner.y.mul(1 - 2 * inset).add(inset);
  const sideUv = vec2(tile.add(u).div(ATLAS_COLUMNS), v.div(ATLAS_ROWS));
  const topUv = vec2(tile.add(u).div(ATLAS_COLUMNS), v.add(1).div(ATLAS_ROWS));

  const vTop = varying(top);
  const vRight = varying(right);
  const vUp = varying(upward);
  const vFacing = varying(facing);
  const vFade = varying(fade);
  const picture = mix(texture(colorMap, sideUv), texture(colorMap, topUv), vTop);
  const baked = mix(texture(normalMap, sideUv).xyz, texture(normalMap, topUv).xyz, vTop).mul(2).sub(1);
  const across3 = baked.x.mul(float(1).sub(mirror.mul(2)));
  const normal = normalize(vRight.mul(across3).add(vUp.mul(baked.y)).add(vFacing.mul(baked.z)));

  const material = deps.litMaterial(picture.rgb.mul(tint) as Node<'vec3'>, {
    basic: { side: DoubleSide, alphaTest: ALPHA_TEST, alphaToCoverage: true },
    translucency: TRANSLUCENCY,
  });
  material.positionNode = position;
  material.normalNode = transformNormalToView(normal);
  material.emissiveNode = picture.rgb.mul(EMISSIVE);
  material.opacityNode = picture.a.mul(vFade);

  const mesh = new Mesh(geometry, material);
  mesh.name = 'far trees';
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;

  const out = {
    a: geometry.getAttribute('cardA').array as Float32Array,
    b: geometry.getAttribute('cardB').array as Float32Array,
    c: geometry.getAttribute('cardC').array as Float32Array,
  };
  let count = 0,
    refused = 0;
  return {
    mesh,
    get count() {
      return count;
    },
    get refused() {
      return refused;
    },
    write(near, far, origin) {
      count = 0;
      refused = 0;
      const local = { x: (v: number) => origin.localX(v), z: (v: number) => origin.localZ(v) };
      const put = (tree: CardTree & { species: string }) => {
        const entry = deps.species.get(tree.species);
        if (!entry) return;
        if (count >= capacity) {
          refused++;
          return;
        }
        packCard(out, count++, tree, local, entry.tile, entry.shape);
      };
      for (const tree of near) put(tree);
      far.forEach(put);
      for (const name of Object.keys(CARD_ATTRIBUTES)) geometry.getAttribute(name).needsUpdate = true;
      geometry.instanceCount = count;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      colorMap.dispose();
      normalMap.dispose();
    },
  };
}
