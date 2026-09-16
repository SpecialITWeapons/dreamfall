// The scenery, as one object: the painted textures, the baked species, props
// and buildings, the pools they are instanced through, the lattice of
// settlements, the ring that decides where everything stands, the sheet of
// shade under them and the window of grass. The world holds one of these and
// calls update once a frame.
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
import { createSites, type Site } from './Sites';

/** What a frame gives the plan queue, ms. A village costs about one of these. */
const SITE_BUDGET_MS = 4;
/**
 * How far siteNear looks for a settlement, m. It asks the same question the
 * ring asks, so it seats cells and may drop a plan the flight has left behind;
 * both are deterministic and cost a rebuild at worst. Ask it about where you
 * are, not about the other side of the world.
 */
const SITE_REACH = 2000;

export interface SceneryStats {
  trees: number;
  props: number;
  /** Houses the last rebuild raised out of the site plans it covered. */
  buildings: number;
  /**
   * Houses it was asked for and could not raise: a pool at its ceiling, or a
   * shape nobody baked. A plan is placed whole, so any of these is a hole in a
   * settlement, and the ring's own answer to both is a silent `continue`. The
   * browser test demands a zero here over a town of two thousand buildings,
   * which is the only way a raised ceiling stays raised.
   */
  buildingsRefused: number;
  grass: number;
  /** Sites whose plan is built and cached. */
  sites: number;
  /** Sites found but not yet planned; the queue works them off a frame at a time. */
  sitesQueued: number;
  sitesMs: number;
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
  /** The nearest settlement to a world point, or null; the browser test finds a village through this. */
  siteNear(x: number, z: number): { id: string; x: number; z: number; radius: number; lots: number } | null;
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
  const pools = createPools({ library, textures, materials, uniforms: deps.uniforms, origin, heightfield });
  const grass = createGrass({ seed, library, heightfield, materials, shade, uniforms: deps.uniforms });
  const bakeMs = Math.round(performance.now() - bakeStarted);
  for (const mesh of pools.meshes) scene.add(mesh);
  scene.add(pools.roads);
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
    site: (plan) => pools.sink.site(plan),
    end() {
      pools.sink.end();
      shadeRecords.length = shadeCount;
    },
  };

  const overrides = createOverrides();
  const sites = createSites({ library, sampler, heightfield, overrides });
  const ring = createRing({
    seed,
    library,
    sampler,
    heightfield,
    obstacles,
    overrides,
    metrics: pools.metrics,
    propKit: pools.propKit,
    sites,
    sink,
  });

  let rebuilds = 0;
  let sitesMs = 0;
  const nearby: Site[] = [];
  return {
    update(x, z, cameraY, moved) {
      // The queue runs before the ring so a plan finished in this frame is
      // standing in this frame's rebuild. A plan that was only just finished
      // also forces one: the ring finds its sites while rebuilding, so without
      // this a village discovered over a standing flight would wait for the
      // next cell crossing, and a village discovered at the last crossing would
      // arrive a whole cell late.
      const planned = sites.built;
      const started = performance.now();
      sites.work(SITE_BUDGET_MS);
      sitesMs = performance.now() - started;
      if (ring.update(x, z, moved || sites.built > planned)) {
        rebuilds++;
        shade.update(shadeRecords, ring.anchorX, ring.anchorZ);
      }
      grass.update(x, z, cameraY, origin, moved);
    },
    siteNear(x, z) {
      const site = sites.near(x, z, SITE_REACH, nearby)[0];
      if (!site) return null;
      return {
        id: site.id,
        x: site.x,
        z: site.z,
        radius: site.radius,
        lots: sites.planFor(site)?.lots.length ?? 0,
      };
    },
    get stats() {
      return {
        trees: ring.trees,
        props: ring.props,
        buildings: ring.buildings,
        buildingsRefused: ring.buildingsRefused,
        sites: sites.built,
        sitesQueued: sites.queued,
        // what is drawn, not what is buffered: above 250 m the window is off
        // and the blades from the last low pass are still in its arrays
        grass: grass.mesh.visible ? grass.count : 0,
        cells: ring.cells,
        rebuilds,
        ringMs: Math.round(ring.ms * 10) / 10,
        grassMs: Math.round(grass.ms * 10) / 10,
        sitesMs: Math.round(sitesMs * 100) / 100,
        bakeMs,
      };
    },
    sample: (i) => samples[i] ?? null,
    dispose() {
      for (const mesh of pools.meshes) scene.remove(mesh);
      scene.remove(pools.roads);
      scene.remove(grass.mesh);
      pools.dispose();
      grass.dispose();
      textures.dispose();
    },
  };
}
