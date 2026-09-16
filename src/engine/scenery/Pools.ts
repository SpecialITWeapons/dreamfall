// The pools: the other side of ScenerySink, where a placement becomes an
// instance. One InstancedMesh per baked geometry at a fixed capacity, filled
// from zero on every ring rebuild, so nothing is ever allocated in flight.
//
// Three things happen here that the ring knows nothing about:
//   - world to scene. The ring works in world coordinates; the matrices written
//     here are in the local frame of the floating origin, which is why an
//     origin jump has to force a rebuild.
//   - the shrink at the edge of the ring. A tree folds into its own base over
//     the last 170 m rather than vanishing, because the fog is still thin there.
//   - the crown morph. Each species has a full crown and a thinned one; over a
//     band of distance the kept cards grow and the rest shrink away, so that at
//     the end of the band the two are the same mass of colour and the swap
//     between them cannot be seen.
import * as THREE from 'three';
import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedInterleavedBuffer,
  InstancedMesh,
  InterleavedBufferAttribute,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import type { Node } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  float,
  length,
  mix,
  positionLocal,
  smoothstep,
  step,
  vec3,
} from 'three/tsl';
import {
  BUDGET,
  swatchColor,
  validateBaked,
  type Library,
  type Prop,
  type PropKit,
} from '../../../library/contract';
import type { Origin } from '../sim/Origin';
import { hash2, mulberry32, sstep } from '../terrain/noise';
import type { SkyUniforms } from '../sky/SkyUniforms';
import type { SceneryMaterials, PaintedTextures } from './Painted';
import {
  MAX_TREES,
  type PropInstance,
  type SceneryMetrics,
  type ScenerySink,
  type StructureInstance,
  type TreeInstance,
} from './Ring';
import { bakeStructure, createStructureKit } from './StructureKit';
import {
  bakeSpecies,
  crownThinning,
  matrix as composeMatrix,
  mergeParts,
  type BakedSpecies,
} from './TreeKit';

/** Where the full crown gives way to the thinned one, m. */
const CROWN_FADE = [540, 680] as const;
/** Where a tree folds into its own base, m. */
const RING_FADE = [1680, 1850] as const;
/**
 * Which crown a tree is given at a rebuild. The margins are the original's,
 * and they are generous on purpose: a rebuild happens at most one cell after
 * the flight crosses one, and the camera orbits up to CAMERA.maxDist behind it,
 * so a tree must hold the crown it was given for longer than its distance says.
 */
const NEAR_CROWN = 830,
  FAR_CROWN = 400;
/** A prop kind with no budget of its own. */
const PROP_INSTANCES = 500;

const AXIS_Y = new Vector3(0, 1, 0);
const WHITE = new Color(1, 1, 1);

// Every vertex of a tree reads its own instance base, so the whole tree shares
// one distance and one shrink; a per-vertex distance would tear the crown off
// the trunk at the edge of the ring.
const treeBase = attribute<'vec3'>('base', 'vec3');
const baseDistance = length(treeBase.sub(cameraPosition));
const crownBand = smoothstep(CROWN_FADE[0], CROWN_FADE[1], baseDistance);
const distantCrown = step(CROWN_FADE[1], baseDistance);
const ringScale = float(1).sub(smoothstep(RING_FADE[0], RING_FADE[1], baseDistance));
const grown = (position: Node<'vec3'>) => treeBase.add(position.sub(treeBase).mul(ringScale));
// Instancing has already moved the vertex, so the card's centre is rebuilt in
// the scene from its tree-local one: cos, sin, the horizontal scale and the
// vertical one, all four packed beside the base in one interleaved buffer
// because WebGPU allows a material only eight vertex buffers.
const spin = attribute<'vec4'>('spin', 'vec4');
const card = attribute<'vec4'>('card', 'vec4');
const cardCenter = card.xyz;
const cardScaled = vec3(cardCenter.x.mul(spin.z), cardCenter.y.mul(spin.w), cardCenter.z.mul(spin.z));
const cardWorld = treeBase.add(
  vec3(
    cardScaled.x.mul(spin.x).add(cardScaled.z.mul(spin.y)),
    cardScaled.y,
    cardScaled.z.mul(spin.x).sub(cardScaled.x.mul(spin.y)),
  ),
);

interface SpeciesPool {
  baked: BakedSpecies;
  wood: InstancedMesh;
  crown: InstancedMesh | null;
  distant: InstancedMesh | null;
  spin: InterleavedBufferAttribute | null;
  count: number;
  near: number;
  far: number;
}
interface PropPool {
  entry: Prop;
  mesh: InstancedMesh;
  capacity: number;
  count: number;
}
interface StructurePool {
  mesh: InstancedMesh;
  /** The instance attribute the night reads: how awake each house is. */
  lit: InstancedBufferAttribute;
  top: number;
  radius: number;
  capacity: number;
  count: number;
}

export interface Pools {
  readonly sink: ScenerySink;
  readonly metrics: SceneryMetrics;
  /** What a prop's bake() and place() are handed; the ring passes it on. */
  readonly propKit: PropKit;
  readonly meshes: InstancedMesh[];
  dispose(): void;
}

export function createPools(deps: {
  library: Library;
  textures: PaintedTextures;
  materials: SceneryMaterials;
  uniforms: SkyUniforms;
  origin: Origin;
}): Pools {
  const { library, textures, materials, uniforms, origin } = deps;
  const meshes: InstancedMesh[] = [];
  const materialsMade: Material[] = [];

  const pool = (geometry: BufferGeometry, material: Material, capacity: number) => {
    const mesh = new InstancedMesh(geometry, material, capacity);
    const base = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    base.setUsage(DynamicDrawUsage);
    mesh.geometry.setAttribute('base', base);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.count = 0;
    // The instance colour buffer has to exist before the material is compiled:
    // a node material only reads instanceColor when the object already has one,
    // and a flight that starts over the sea would otherwise compile a pool that
    // never learns its tints.
    mesh.setColorAt(0, WHITE);
    meshes.push(mesh);
    materialsMade.push(material);
    return mesh;
  };

  // The species, baked once each.
  const species = new Map<string, SpeciesPool>();
  for (const entry of library.species ?? []) {
    const baked = bakeSpecies(entry, { leafTexture: (form) => textures.leaf(form) });
    const trunkTint = new Color(swatchColor(entry.trunk?.tint ?? 'white'));
    const bark = materials.wood(trunkTint);
    bark.positionNode = grown(positionLocal);
    const wood = pool(baked.wood, bark, MAX_TREES);
    wood.castShadow = true;
    const record: SpeciesPool = {
      baked,
      wood,
      crown: null,
      distant: null,
      spin: null,
      count: 0,
      near: 0,
      far: 0,
    };
    if (baked.crown && baked.distant && baked.leaf) {
      const { distantScale } = crownThinning(baked.cards);
      // A kept card grows to distantScale across the band while the rest shrink
      // to nothing; at the end of it the full crown *is* the thinned one.
      const cardScale = mix(float(1).sub(crownBand), mix(float(1), float(distantScale), crownBand), card.w);
      const map = baked.leaf as THREE.CanvasTexture;
      record.crown = pool(
        baked.crown,
        materials.leaf(
          map,
          float(1).sub(distantCrown),
          grown(cardWorld.add(positionLocal.sub(cardWorld).mul(cardScale))),
        ),
        MAX_TREES,
      );
      record.distant = pool(
        baked.distant,
        materials.leaf(map, distantCrown, grown(positionLocal)),
        MAX_TREES,
      );
      record.crown.castShadow = true;
      // base and spin share one interleaved buffer; the plain base attribute
      // the pool helper made for this mesh is replaced by the interleaved one.
      const interleaved = new InstancedInterleavedBuffer(new Float32Array(MAX_TREES * 7), 7, 1);
      interleaved.setUsage(DynamicDrawUsage);
      record.crown.geometry.setAttribute('base', new InterleavedBufferAttribute(interleaved, 3, 0));
      record.spin = new InterleavedBufferAttribute(interleaved, 4, 3);
      record.crown.geometry.setAttribute('spin', record.spin);
    }
    species.set(entry.id, record);
  }

  // The props: one kit, one material, one pool each.
  const propKit: PropKit = {
    THREE,
    random: (name) => {
      let h = 5;
      for (const ch of String(name)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
      return mulberry32(hash2(0x9e37, 0, h >>> 0));
    },
    merge: mergeParts,
    matrix: composeMatrix,
    sstep,
    color: (value) => new Color(swatchColor(value)),
  };
  const propMaterial = materials.prop();
  propMaterial.positionNode = grown(positionLocal);
  const props = new Map<string, PropPool>();
  for (const entry of library.props ?? []) {
    const geometry = entry.bake(propKit);
    const problems = validateBaked(entry, geometry);
    if (problems.length > 0) throw new Error(`scenery library:\n${problems.join('\n')}`);
    const capacity = Math.min(BUDGET.propInstances, entry.budget?.instances ?? PROP_INSTANCES);
    const mesh = pool(geometry, propMaterial, capacity);
    mesh.castShadow = true;
    props.set(entry.id, { entry, mesh, capacity, count: 0 });
  }

  // The buildings. One bake per kind and floor count, because a recipe's own
  // range is its own: a mill starts at three storeys and a pool that assumed one
  // and two would flatten it into a shed.
  const structureKit = createStructureKit();
  const buildingMaterial = materials.prop();
  buildingMaterial.positionNode = grown(positionLocal);
  // What lights a village after dark: the window colour the bake painted, only
  // where the bake said `glow`, only as awake as this instance is, and only as
  // far as the sky is night. No light leaves the window -- one lighting model,
  // one sun -- so this is a bright pane, not a lamp on the street.
  buildingMaterial.emissiveNode = attribute<'vec3'>('color', 'vec3')
    .mul(attribute<'float'>('glow', 'float'))
    .mul(attribute<'float'>('lit', 'float'))
    .mul(uniforms.uNight);
  const structures = new Map<string, StructurePool>();
  for (const entry of library.structures ?? []) {
    for (const floors of new Set(entry.floors)) {
      const baked = bakeStructure(entry, floors, structureKit);
      const capacity = BUDGET.propInstances;
      const mesh = pool(baked.geometry, buildingMaterial, capacity);
      mesh.castShadow = true;
      const lit = new InstancedBufferAttribute(new Float32Array(capacity), 1);
      lit.setUsage(DynamicDrawUsage);
      mesh.geometry.setAttribute('lit', lit);
      structures.set(`${entry.id}:${floors}`, {
        mesh,
        lit,
        top: baked.top,
        radius: baked.radius,
        capacity,
        count: 0,
      });
    }
  }

  const m4 = new Matrix4(),
    q = new Quaternion(),
    at = new Vector3(),
    size = new Vector3();
  let flyerX = 0,
    flyerZ = 0;

  const write = (
    mesh: InstancedMesh,
    index: number,
    lx: number,
    y: number,
    lz: number,
    yaw: number,
    sx: number,
    sy: number,
    sz: number,
    tint: Color,
  ) => {
    q.setFromAxisAngle(AXIS_Y, yaw);
    m4.compose(at.set(lx, y, lz), q, size.set(sx, sy, sz));
    mesh.setMatrixAt(index, m4);
    mesh.geometry.getAttribute('base').setXYZ(index, lx, y, lz);
    mesh.setColorAt(index, tint);
  };
  const commit = (mesh: InstancedMesh, count: number) => {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.getAttribute('base').needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  const sink: ScenerySink = {
    begin(x, z) {
      flyerX = x;
      flyerZ = z;
      for (const record of species.values()) record.count = record.near = record.far = 0;
      for (const record of props.values()) record.count = 0;
      for (const record of structures.values()) record.count = 0;
    },
    tree(tree: TreeInstance) {
      const record = species.get(tree.species);
      if (!record) return false;
      if (record.count >= MAX_TREES) return false;
      const lx = origin.localX(tree.x),
        lz = origin.localZ(tree.z);
      write(
        record.wood,
        record.count++,
        lx,
        tree.y,
        lz,
        tree.yaw,
        tree.scale,
        tree.tall,
        tree.scale,
        tree.tint,
      );
      // Both crowns exist through the whole band, so a rebuild never changes
      // which of them a tree at a given distance is drawing.
      if (record.crown && record.distant && record.spin) {
        const distance = Math.hypot(tree.x - flyerX, tree.z - flyerZ);
        if (distance < NEAR_CROWN) {
          write(
            record.crown,
            record.near,
            lx,
            tree.y,
            lz,
            tree.yaw,
            tree.scale,
            tree.tall,
            tree.scale,
            tree.tint,
          );
          record.spin.setXYZW(record.near++, Math.cos(tree.yaw), Math.sin(tree.yaw), tree.scale, tree.tall);
        }
        if (distance > FAR_CROWN)
          write(
            record.distant,
            record.far++,
            lx,
            tree.y,
            lz,
            tree.yaw,
            tree.scale,
            tree.tall,
            tree.scale,
            tree.tint,
          );
      }
      return true;
    },
    prop(put: PropInstance) {
      const record = props.get(put.prop);
      if (!record || record.count >= record.capacity) return false;
      const lx = origin.localX(put.x),
        lz = origin.localZ(put.z);
      // A prop sits in the ground by its own sink; its base stays on the surface,
      // because that is what the shrink at the ring's edge folds it into.
      q.setFromAxisAngle(AXIS_Y, put.yaw);
      m4.compose(at.set(lx, put.y - put.sink, lz), q, size.set(put.scale[0], put.scale[1], put.scale[2]));
      record.mesh.setMatrixAt(record.count, m4);
      record.mesh.geometry.getAttribute('base').setXYZ(record.count, lx, put.y, lz);
      record.mesh.setColorAt(record.count++, put.tint);
      return true;
    },
    structure(building: StructureInstance) {
      const record = structures.get(`${building.structure}:${building.floors}`);
      if (!record || record.count >= record.capacity) return false;
      const lx = origin.localX(building.x),
        lz = origin.localZ(building.z);
      write(record.mesh, record.count, lx, building.y, lz, building.yaw, 1, 1, 1, building.tint);
      record.lit.setX(record.count++, building.lit);
      return true;
    },
    end() {
      for (const record of structures.values()) {
        commit(record.mesh, record.count);
        record.lit.needsUpdate = true;
      }
      for (const record of species.values()) {
        commit(record.wood, record.count);
        if (record.crown) commit(record.crown, record.near);
        if (record.distant) commit(record.distant, record.far);
      }
      for (const record of props.values()) commit(record.mesh, record.count);
    },
  };

  const metrics: SceneryMetrics = {
    species: (id) => {
      const record = species.get(id);
      return record ? { top: record.baked.top, radius: record.baked.radius } : null;
    },
    prop: (id) => props.get(id)?.entry.obstacle ?? null,
    structure: (id, floors) => {
      const record = structures.get(`${id}:${floors}`);
      return record ? { top: record.top, radius: record.radius } : null;
    },
  };

  return {
    sink,
    metrics,
    propKit,
    meshes,
    dispose() {
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        mesh.dispose();
      }
      for (const material of new Set(materialsMade)) material.dispose();
      meshes.length = 0;
    },
  };
}
