// The scenery, as one object: the painted textures, the baked species and
// props, the pools they are instanced through, the ring that decides where
// they stand, the sheet of shade under them and the window of grass. The world
// holds one of these and calls update once a frame.
//
// Baking happens in the constructor and costs the better part of a second, so
// the world can defer it and give it its own stage of the veil.
import type { Scene } from 'three';
import type { Library } from '../../../library/contract';
import type { LitMaterial } from '../render/SoftLighting';
import type { Origin } from '../sim/Origin';
import type { SkyUniforms } from '../sky/SkyUniforms';
import type { Heightfield } from '../terrain/Heightfield';
import type { WorldSampler } from '../terrain/WorldSampler';
import { createGrass } from './Grass';
import type { GroundShade } from './GroundShade';
import type { Obstacles } from './Obstacles';
import { createOverrides } from './Overrides';
import { createPaintedTextures, createSceneryMaterials } from './Painted';
import { createPools } from './Pools';
import { createRing, type ScenerySink, type TreeInstance } from './Ring';

export interface SceneryStats {
  trees: number;
  props: number;
  grass: number;
  /** Cells the last rebuild visited. */
  cells: number;
  rebuilds: number;
  ringMs: number;
  grassMs: number;
  /** What the species, the props and their textures cost to bake, once. */
  bakeMs: number;
}

export interface Scenery {
  update(x: number, z: number, cameraY: number, moved: boolean): void;
  readonly stats: SceneryStats;
  /** The i-th tree of the last rebuild in both frames; the browser test checks the conversion. */
  sample(i: number): { world: [number, number]; local: [number, number] } | null;
  dispose(): void;
}

export function createScenery(deps: {
  seed: number;
  library: Library;
  sampler: WorldSampler;
  heightfield: Heightfield;
  obstacles: Obstacles;
  origin: Origin;
  scene: Scene;
  shade: GroundShade;
  litMaterial: LitMaterial;
  uniforms: SkyUniforms;
}): Scenery {
  const { seed, library, sampler, heightfield, obstacles, origin, scene, shade } = deps;
  const bakeStarted = performance.now();
  const textures = createPaintedTextures();
  const materials = createSceneryMaterials({
    litMaterial: deps.litMaterial,
    uniforms: deps.uniforms,
    textures,
  });
  const pools = createPools({ library, textures, materials, uniforms: deps.uniforms, origin });
  const grass = createGrass({ seed, library, heightfield, materials, shade, uniforms: deps.uniforms });
  const bakeMs = Math.round(performance.now() - bakeStarted);
  for (const mesh of pools.meshes) scene.add(mesh);
  scene.add(grass.mesh);

  // The shade sheet is painted from the trees the ring just placed, so the
  // records are collected on their way into the pools rather than walked out of
  // the obstacle registry afterwards. The array is reused; only its length moves.
  const shadeRecords: { x: number; z: number; radius: number }[] = [];
  let shadeCount = 0;
  const samples: Array<{ world: [number, number]; local: [number, number] }> = [];
  const SAMPLES = 4;

  const sink: ScenerySink = {
    begin(x, z) {
      shadeCount = 0;
      samples.length = 0;
      pools.sink.begin(x, z);
    },
    tree(tree: TreeInstance) {
      if (!pools.sink.tree(tree)) return false;
      const record = (shadeRecords[shadeCount] ??= { x: 0, z: 0, radius: 0 });
      record.x = tree.x;
      record.z = tree.z;
      record.radius = (pools.metrics.species(tree.species)?.radius ?? 0) * tree.scale;
      shadeCount++;
      if (samples.length < SAMPLES)
        samples.push({
          world: [tree.x, tree.z],
          local: [origin.localX(tree.x), origin.localZ(tree.z)],
        });
      return true;
    },
    prop: (prop) => pools.sink.prop(prop),
    structure: (building) => pools.sink.structure(building),
    end() {
      pools.sink.end();
      shadeRecords.length = shadeCount;
    },
  };

  const ring = createRing({
    seed,
    library,
    sampler,
    heightfield,
    obstacles,
    overrides: createOverrides(),
    metrics: pools.metrics,
    propKit: pools.propKit,
    sink,
  });

  let rebuilds = 0;
  return {
    update(x, z, cameraY, moved) {
      if (ring.update(x, z, moved)) {
        rebuilds++;
        shade.update(shadeRecords, ring.anchorX, ring.anchorZ);
      }
      grass.update(x, z, cameraY, origin, moved);
    },
    get stats() {
      return {
        trees: ring.trees,
        props: ring.props,
        // what is drawn, not what is buffered: above 250 m the window is off
        // and the blades from the last low pass are still in its arrays
        grass: grass.mesh.visible ? grass.count : 0,
        cells: ring.cells,
        rebuilds,
        ringMs: Math.round(ring.ms * 10) / 10,
        grassMs: Math.round(grass.ms * 10) / 10,
        bakeMs,
      };
    },
    sample: (i) => samples[i] ?? null,
    dispose() {
      for (const mesh of pools.meshes) scene.remove(mesh);
      scene.remove(grass.mesh);
      pools.dispose();
      grass.dispose();
      textures.dispose();
    },
  };
}
