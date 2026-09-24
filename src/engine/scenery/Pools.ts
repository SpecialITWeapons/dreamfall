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
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import {
  attribute,
  cameraPosition,
  float,
  fract,
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
  type SceneryColor,
  type SitePlan,
} from '../../../library/contract';
import type { Origin } from '../sim/Origin';
import { countryOf, standingOf } from '../terrain/Country';
import type { Heightfield } from '../terrain/Heightfield';
import { hash2, mulberry32, sstep } from '../terrain/noise';
import { buildLines } from './LineKit';
import { buildRoads } from './RoadKit';
import { ROUTE_WIDTH, chunksOf } from './Roads';
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
/**
 * Where a thing standing on the ground fades out, m. It ends just inside
 * TREE_RADIUS: past that the ring has nothing to show anyway. The original
 * folded a tree into its own base across this band, which is cheap and reads
 * as a tree sprouting out of the ground in front of the flight -- two and a
 * half to four seconds of it, at the speeds this world flies. A tree stands at
 * its own height here and dissolves instead.
 */
export const RING_FADE = [2300, 2560] as const;
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
/**
 * How much of a thing is there at all, by the distance to its own foot rather
 * than to the vertex: a tree must thin out whole, not from the top down.
 */
const ringFade = float(1).sub(smoothstep(RING_FADE[0], RING_FADE[1], baseDistance));
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
  /** The instance attribute the night reads: the lot's `lit` roll and the settlement's `wake` share. */
  lamp: InstancedBufferAttribute;
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
  /** The road ribbons of the sites the ring is covering, one child per plan, and the roads between them. */
  readonly roads: Group;
  /** Kilometre pieces of roads between settlements standing in the ring. */
  readonly routePieces: number;
  dispose(): void;
}

export function createPools(deps: {
  library: Library;
  textures: PaintedTextures;
  materials: SceneryMaterials;
  uniforms: SkyUniforms;
  origin: Origin;
  /** The ground a road ribbon is laid on; the CPU field, as everywhere else. */
  heightfield: Heightfield;
}): Pools {
  const { library, textures, materials, uniforms, origin, heightfield } = deps;
  const meshes: InstancedMesh[] = [];
  const materialsMade: Material[] = [];

  // `layer` is the dev panel's switch this pool answers to, and the only thing
  // a mesh's name is used for here.
  const pool = (geometry: BufferGeometry, material: Material, capacity: number, layer: string) => {
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.name = layer;
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
    const bark = materials.wood(trunkTint, ringFade);
    const wood = pool(baked.wood, bark, MAX_TREES, 'trees');
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
          float(1).sub(distantCrown).mul(ringFade),
          cardWorld.add(positionLocal.sub(cardWorld).mul(cardScale)),
        ),
        MAX_TREES,
        'trees',
      );
      record.distant = pool(
        baked.distant,
        materials.leaf(map, distantCrown.mul(ringFade), positionLocal),
        MAX_TREES,
        'trees',
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
  const propMaterial = materials.prop(ringFade);
  const props = new Map<string, PropPool>();
  for (const entry of library.props ?? []) {
    const geometry = entry.bake(propKit);
    const problems = validateBaked(entry, geometry);
    if (problems.length > 0) throw new Error(`scenery library:\n${problems.join('\n')}`);
    const capacity = Math.min(BUDGET.propInstances, entry.budget?.instances ?? PROP_INSTANCES);
    const mesh = pool(geometry, propMaterial, capacity, 'props');
    mesh.castShadow = true;
    props.set(entry.id, { entry, mesh, capacity, count: 0 });
  }

  // The buildings. One bake per kind and floor count, because a recipe's own
  // range is its own: a mill starts at three storeys and a pool that assumed one
  // and two would flatten it into a shed.
  const structureKit = createStructureKit();
  const buildingMaterial = materials.prop(ringFade);
  // What lights a village after dark, window by window: the colour the bake
  // painted, only where it said `glow`, and only in the panes this house has
  // switched on. No light leaves the window -- one lighting model, one sun --
  // so this is a bright pane, not a lamp on the street.
  //
  // Three numbers decide a pane, and they come from three places on purpose,
  // because the geometry of a house is baked once and stood up hundreds of
  // times: `pane` is the window's own, baked; `lit` is the lot's, so the house
  // next door switches a different set; `wake` is the settlement's share, so a
  // town at midnight is livelier than a hamlet. `fract` of the first two is a
  // fresh roll per window per house, and a pane is lit when that roll lands
  // under the share. The whole thing used to be one multiply by `lit`, which
  // dimmed every window of a house together and lit every one of them.
  //
  // The five numbers travel in two attributes, not five: `window` carries the
  // bake's `glow` and `pane`, `lamp` the instance's `lit` and `wake`. WebGPU
  // binds at most eight vertex buffers to a pipeline unless the device asks
  // for more, and a building's pool already has the instance matrix, the
  // instance colour and `base` on top of the geometry's own; as five separate
  // attributes they made eleven, the pipeline failed validation, and no house
  // drew on WebGPU while WebGL2 drew them all (see `bakeStructure`).
  const window = attribute<'vec2'>('window', 'vec2'),
    lamp = attribute<'vec2'>('lamp', 'vec2');
  const glow = window.x,
    pane = window.y,
    phase = lamp.x,
    wake = lamp.y;
  const roll = fract(pane.add(phase));
  buildingMaterial.emissiveNode = attribute<'vec3'>('color', 'vec3')
    .mul(glow)
    .mul(step(roll, wake))
    // A lit room is not a lamp of a fixed brightness: a kitchen is not a hall.
    .mul(float(0.7).add(fract(pane.mul(7.13).add(phase.mul(3.1))).mul(0.6)))
    .mul(uniforms.uNight);
  const structures = new Map<string, StructurePool>();
  for (const entry of library.structures ?? []) {
    // Every count in the range, not just its ends: a plan is free to ask for a
    // two-storey house out of a [1, 3] recipe, and a bake it never got is a
    // house that quietly does not appear. The validator caps the span.
    for (let floors = entry.floors[0]; floors <= entry.floors[1]; floors++) {
      const baked = bakeStructure(entry, floors, structureKit);
      const capacity = BUDGET.propInstances;
      const mesh = pool(baked.geometry, buildingMaterial, capacity, 'buildings');
      mesh.castShadow = true;
      const lamp = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
      lamp.setUsage(DynamicDrawUsage);
      mesh.geometry.setAttribute('lamp', lamp);
      structures.set(`${entry.id}:${floors}`, {
        mesh,
        lamp,
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

  // The roads of the sites the ring is covering. A road is not instanced -- one
  // site, one ribbon, built once out of its plan -- so it is a mesh of its own,
  // hung in the local frame at its site's centre. The rebuild that stops
  // offering a plan is the one that drops its ribbon.
  const roads = new Group();
  roads.name = 'roads';
  const roadMaterial = materials.prop();
  materialsMade.push(roadMaterial);
  // What one site put in the scene: its road ribbon, its lines, or neither.
  // Keyed by plan, so an empty answer is an answer and is not asked again.
  const ribbons = new Map<string, Mesh[]>();
  const offered = new Set<string>();

  // The roads between settlements, a kilometre a mesh: a route is ten of them,
  // and only the ones inside the ring are built. Keyed by route, piece and the
  // piece's own two ends, so a route whose end moves -- its village's plan
  // arrived and it now runs into the street -- rebuilds that piece and no other.
  const routeMaterial = materials.road(RING_FADE);
  materialsMade.push(routeMaterial);
  const pieces = new Map<string, Mesh>();
  const offeredPieces = new Set<string>();
  // The country's own road colour, the way the ground under it is the country's.
  const roadColor = library.biomes.map(
    (biome) => new Color(swatchColor((biome.params?.road as SceneryColor | undefined) ?? 'clay')),
  );
  const stands = standingOf(library.biomes);
  const slotIds = new Uint8Array(4),
    slotWeights = new Float32Array(4),
    countryIds = new Uint8Array(4),
    countryWeights = new Float32Array(4);
  const colorAt = (x: number, z: number, out: Color) => {
    heightfield.weightsAt(x, z, slotIds, slotWeights);
    countryOf(slotIds, slotWeights, stands, countryIds, countryWeights);
    let r = 0,
      g = 0,
      b = 0;
    for (let s = 0; s < 3; s++) {
      const w = countryWeights[s]!,
        c = roadColor[countryIds[s]!];
      if (w > 0 && c) {
        r += c.r * w;
        g += c.g * w;
        b += c.b * w;
      }
    }
    return out.setRGB(r, g, b);
  };
  /** A piece further than this from the flight is not built, m: the ring's reach and a margin. */
  const PIECE_REACH = RING_FADE[1] + 240;

  const sink: ScenerySink = {
    begin(x, z) {
      flyerX = x;
      flyerZ = z;
      offered.clear();
      offeredPieces.clear();
      for (const record of species.values()) record.count = record.near = record.far = 0;
      for (const record of props.values()) record.count = 0;
      for (const record of structures.values()) record.count = 0;
    },
    site(plan: SitePlan) {
      offered.add(plan.id);
      let built = ribbons.get(plan.id);
      if (!built) {
        const deps = {
          heightAt: (x: number, z: number) => heightfield.heightAt(x, z),
          site: plan.id,
          at: [plan.x, plan.z] as [number, number],
        };
        // The answer is remembered even when it is "nothing to build". A site
        // whose roads are all too short to sample would otherwise walk its
        // polylines again on every single rebuild, for ever, to be told the same
        // thing -- and a settlement made only of fences is exactly that site.
        built = [buildRoads(plan.roads, deps), buildLines(plan.lines, deps)].flatMap((geometry) => {
          if (!geometry) return [];
          const mesh = new Mesh(geometry, roadMaterial);
          mesh.receiveShadow = true;
          roads.add(mesh);
          return [mesh];
        });
        ribbons.set(plan.id, built);
      }
      // Written every rebuild rather than once: a rebuild is what an origin
      // jump forces, and the jump is the only thing that moves this.
      for (const mesh of built) mesh.position.set(origin.localX(plan.x), 0, origin.localZ(plan.z));
    },
    route(id, points) {
      chunksOf(points).forEach((piece, k) => {
        let near = Infinity;
        for (const [x, z] of piece) near = Math.min(near, Math.hypot(x - flyerX, z - flyerZ));
        if (near > PIECE_REACH) return;
        const first = piece[0]!,
          last = piece.at(-1)!;
        const key = `${id}#${k}:${first[0].toFixed(1)},${first[1].toFixed(1)}:${last[0].toFixed(1)},${last[1].toFixed(1)}`;
        offeredPieces.add(key);
        let mesh = pieces.get(key);
        if (!mesh) {
          const geometry = buildRoads([{ points: piece, width: ROUTE_WIDTH }], {
            heightAt: (x: number, z: number) => heightfield.heightAt(x, z),
            site: id,
            at: [first[0], first[1]],
            colorAt,
            spread: true,
          });
          if (!geometry) return;
          mesh = new Mesh(geometry, routeMaterial);
          mesh.receiveShadow = true;
          roads.add(mesh);
          pieces.set(key, mesh);
        }
        // Written every rebuild, as a site's ribbon is: an origin jump moves it.
        mesh.position.set(origin.localX(first[0]), 0, origin.localZ(first[1]));
      });
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
      record.lamp.setXY(record.count++, building.lit, building.wake);
      return true;
    },
    end() {
      for (const record of structures.values()) {
        commit(record.mesh, record.count);
        record.lamp.needsUpdate = true;
      }
      for (const record of species.values()) {
        commit(record.wood, record.count);
        if (record.crown) commit(record.crown, record.near);
        if (record.distant) commit(record.distant, record.far);
      }
      for (const record of props.values()) commit(record.mesh, record.count);
      for (const [id, meshes] of ribbons)
        if (!offered.has(id)) {
          for (const mesh of meshes) {
            roads.remove(mesh);
            mesh.geometry.dispose();
          }
          ribbons.delete(id);
        }
      for (const [key, mesh] of pieces)
        if (!offeredPieces.has(key)) {
          roads.remove(mesh);
          mesh.geometry.dispose();
          pieces.delete(key);
        }
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
    roads,
    get routePieces() {
      return pieces.size;
    },
    dispose() {
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        mesh.dispose();
      }
      for (const meshes of ribbons.values()) for (const mesh of meshes) mesh.geometry.dispose();
      ribbons.clear();
      for (const mesh of pieces.values()) mesh.geometry.dispose();
      pieces.clear();
      roads.clear();
      for (const material of new Set(materialsMade)) material.dispose();
      meshes.length = 0;
    },
  };
}
