// The scenery, as one object: the painted textures, the baked species, props
// and buildings, the pools they are instanced through, the lattice of
// settlements, the ring that decides where everything stands, the sheet of
// shade under them and the window of grass. The world holds one of these and
// calls update once a frame.
//
// Baking happens in the constructor and costs the better part of a second, so
// the world can defer it and give it its own stage of the veil.
import type { Scene, Vector2 } from 'three';
import type { UniformNode } from 'three/webgpu';
import type { Library } from '../../../library/contract';
import type { Hideable } from '../render/Layers';
import type { LitMaterial } from '../render/SoftLighting';
import type { Origin } from '../sim/Origin';
import type { SkyUniforms } from '../sky/SkyUniforms';
import type { Heightfield } from '../terrain/Heightfield';
import { createSampledGround } from '../terrain/SampledGround';
import type { LoadCell } from '../terrain/TerrainMesh';
import type { WorldSampler } from '../terrain/WorldSampler';
import type { CardTree } from './cardPack';
import { createCards } from './Cards';
import { createClaims } from './Claims';
import { FAR_TREES_BUDGET_MS, createFarTrees } from './FarTrees';
import { createGrass } from './Grass';
import { photograph } from './Impostors';
import { TREE_LIMIT, treeBandAt, type TreeLimitForm } from './TreeLimit';
import type { GroundShade } from './GroundShade';
import type { Obstacles } from './Obstacles';
import { createOverrides } from './Overrides';
import { createPaintedTextures, createSceneryMaterials } from './Painted';
import { createPools } from './Pools';
import { createRing, type ScenerySink, type TreeInstance } from './Ring';
import { createRoads } from './Roads';
import { SITE_BUDGET_MS, createSites, type Site } from './Sites';

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
  /** Trees the plans stood that did not stand: counted, as a house is, because a `continue` is silent. */
  treesRefused: number;
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
  /** Roads between settlements built, waiting for the worker, and refused for having no land way. */
  routes: number;
  routesQueued: number;
  routesRefused: number;
  /** Kilometre pieces of those roads standing in the ring. */
  routeChunks: number;
  /** Trees past the ring, sown and held; the cells they stand in, and the cells still to sow. */
  farTrees: number;
  farCells: number;
  farQueued: number;
  /** Milliseconds the far sowing took this frame. */
  farMs: number;
  /** Trees standing as cards, the ring's and the far ones; and those the pool had no room for. */
  cards: number;
  cardsRefused: number;
  /** The band a full tree hands over to its card in this frame, m, and whether the full trees are drawn at all. */
  treeBand: [number, number];
  fullTrees: boolean;
}

/** How high over the land the trees become cards: the dev panel's sliders, as ranges and defaults. */
export interface TreeLimitControl {
  readonly ranges: { readonly [K in keyof TreeLimitForm]: readonly [number, number, number] };
  readonly form: Readonly<TreeLimitForm>;
  set(change: Partial<TreeLimitForm>): void;
}

export interface Scenery {
  update(x: number, z: number, cameraY: number, moved: boolean): void;
  /**
   * Everything at once from where the flight stands: the ring, every far cell
   * and the cards. The first fill is paid here, behind the veil; a test that
   * jumps the flight calls it to see the far land without flying frames.
   */
  settle(x: number, z: number): void;
  readonly stats: SceneryStats;
  readonly treeLimit: TreeLimitControl;
  /** What the layer switches hold, by switch name: the pools by their own, the ribbons and the grass whole. */
  readonly groups: Record<string, Hideable[]>;
  /** The nearest settlement to a world point, or null; the browser test finds a village through this. */
  /** The nearest settlement to a world point, and where its landmark stands, or null; the browser tests find a place through this. */
  siteNear(
    x: number,
    z: number,
  ): {
    id: string;
    x: number;
    z: number;
    radius: number;
    lots: number;
    landmark: { x: number; z: number } | null;
  } | null;
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
  /** The far window's loader and the anchor the grids stand on: a card past the near grid stands on the far surface. */
  farLoad: LoadCell;
  anchor: UniformNode<'vec2', Vector2>;
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
  // The ground the plans speak for: the ring fills it at every rebuild, and the
  // grass, updated after the ring in the same frame, reads the same one.
  const claims = createClaims();
  const grass = createGrass({
    seed,
    library,
    heightfield,
    materials,
    shade,
    uniforms: deps.uniforms,
    claims,
  });
  // Every species photographed for its card, and the one mesh the cards are.
  const impostors = photograph(pools.species, textures.bark);
  const cards = createCards({
    atlas: impostors.atlas,
    species: impostors.species,
    litMaterial: deps.litMaterial,
    uniforms: deps.uniforms,
    farLoad: deps.farLoad,
    anchor: deps.anchor,
    treeLimit: pools.treeLimit,
  });
  const bakeMs = Math.round(performance.now() - bakeStarted);
  for (const mesh of pools.meshes) scene.add(mesh);
  scene.add(cards.mesh);
  scene.add(pools.roads);
  scene.add(grass.mesh);

  // The shade sheet is painted from the trees the ring just placed, so the
  // records are collected on their way into the pools rather than walked out of
  // the obstacle registry afterwards. The array is reused; only its length moves.
  const shadeRecords: { x: number; z: number; radius: number }[] = [];
  let shadeCount = 0;
  const samples: Array<{ world: [number, number]; local: [number, number] }> = [];
  const SAMPLES = 4;
  // The ring's trees, kept for the cards: every tree has its card, so the full
  // tree and its card can trade places in one band, and high up, where every
  // tree is a card, the ring's are among them.
  const mirror: Array<CardTree & { species: string }> = [];

  const sink: ScenerySink = {
    begin(x, z) {
      shadeCount = 0;
      samples.length = 0;
      mirror.length = 0;
      pools.sink.begin(x, z);
    },
    tree(tree: TreeInstance) {
      if (!pools.sink.tree(tree)) return false;
      const record = (shadeRecords[shadeCount] ??= { x: 0, z: 0, radius: 0 });
      record.x = tree.x;
      record.z = tree.z;
      record.radius = (pools.metrics.species(tree.species)?.radius ?? 0) * tree.scale;
      shadeCount++;
      mirror.push({
        species: tree.species,
        x: tree.x,
        y: tree.y,
        z: tree.z,
        scale: tree.scale,
        tall: tree.tall,
        yaw: tree.yaw,
        tint: [tree.tint.r, tree.tint.g, tree.tint.b],
      });
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
    route: (id, points) => pools.sink.route?.(id, points),
    end() {
      pools.sink.end();
      shadeRecords.length = shadeCount;
    },
  };

  const overrides = createOverrides();
  const sites = createSites({ library, sampler, heightfield, overrides });
  // The roads between the settlements, searched in a worker as the flight
  // comes near them; the ring draws what of each is in its reach.
  const roads = createRoads({ seed, sites });
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
    claims,
    roads,
    sink,
  });

  // The land past the ring, sown over the ground the near window would have
  // answered with, and kept off the ground the ring's plans speak for.
  const farTrees = createFarTrees({
    seed,
    library,
    sampler,
    ground: createSampledGround(sampler, heightfield),
    claims,
    baked: (id) => pools.metrics.species(id) !== null,
  });
  /** How long the cards may lag the far sowing while its queue runs, ms: a rewrite is the whole pool. */
  const CARD_LAG = 250;
  let cardsDirty = true,
    cardsVersion = -1,
    cardsWritten = -Infinity;

  // How high over the land the trees become cards, and what that makes of the band now.
  const limitForm: TreeLimitForm = { ...TREE_LIMIT };
  let band = treeBandAt(0, limitForm);
  const treeMeshes = pools.meshes.filter((mesh) => mesh.name === 'trees');
  /** The band from the eye's height over the land; the full trees go altogether when it is gone. */
  const hand = (x: number, z: number, cameraY: number) => {
    band = treeBandAt(cameraY - heightfield.heightAt(x, z), limitForm);
    pools.treeLimit.value.set(band[0], band[1]);
    // The engine's own reason; a layer switched off is hidden again after this (layers.apply).
    const full = band[1] > 1;
    for (const mesh of treeMeshes) mesh.visible = full;
  };

  let rebuilds = 0,
    seenRoutes = 0;
  let sitesMs = 0;
  const nearby: Site[] = [];
  /** The ring rebuilt at (x, z): the far cells are the ones past its reach from where it stood. */
  const rebuilt = (x: number, z: number) => {
    rebuilds++;
    shade.update(shadeRecords, ring.anchorX, ring.anchorZ);
    // Together the two hold every cell once.
    farTrees.update(x, z);
    cardsDirty = true;
  };
  /** The far sowing's share of a frame, and the cards written when they have fallen behind it. */
  const sowFar = (budget: number) => {
    farTrees.work(budget);
    const now = performance.now();
    if (farTrees.version !== cardsVersion && (farTrees.queued === 0 || now - cardsWritten >= CARD_LAG))
      cardsDirty = true;
    if (cardsDirty) {
      cards.write(mirror, farTrees, origin);
      cardsDirty = false;
      cardsVersion = farTrees.version;
      cardsWritten = now;
    }
  };
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
      // The network is looked at every kilometre and its routes arrive from the
      // worker; one arriving is a rebuild, as a plan arriving is.
      roads.update(x, z);
      const routed = roads.version !== seenRoutes;
      seenRoutes = roads.version;
      if (ring.update(x, z, moved || sites.built > planned || routed)) rebuilt(x, z);
      grass.update(x, z, cameraY, origin, moved);
      sowFar(FAR_TREES_BUDGET_MS);
      hand(x, z, cameraY);
    },
    settle(x, z) {
      // The ring where it would be anyway -- built now if it never was -- and
      // then every far cell at once. The plans and the grass are the frame's.
      if (ring.update(x, z, false)) rebuilt(x, z);
      sowFar(Infinity);
    },
    siteNear(x, z) {
      const site = sites.near(x, z, SITE_REACH, nearby)[0];
      if (!site) return null;
      const plan = sites.planFor(site);
      // The landmark is the one structure a settlement names with a weight of
      // zero: placed by name, never drawn (library/settlements/settlement.js).
      const named = Object.entries(
        library.biomes.find((b) => b.id === site.biome)?.sites?.structures ?? {},
      ).find(([, weight]) => weight === 0)?.[0];
      const landmark = named ? plan?.lots.find((lot) => lot.structure === named) : undefined;
      return {
        id: site.id,
        x: site.x,
        z: site.z,
        radius: site.radius,
        lots: plan?.lots.length ?? 0,
        landmark: landmark ? { x: landmark.x, z: landmark.z } : null,
      };
    },
    get stats(): SceneryStats {
      return {
        trees: ring.trees,
        props: ring.props,
        buildings: ring.buildings,
        buildingsRefused: ring.buildingsRefused,
        treesRefused: ring.treesRefused,
        sites: sites.built,
        sitesQueued: sites.queued,
        // what is drawn, not what is buffered: above the window's ceiling it is
        // off and the blades from the last low pass are still in its arrays
        grass: grass.mesh.visible ? grass.count : 0,
        cells: ring.cells,
        rebuilds,
        ringMs: Math.round(ring.ms * 10) / 10,
        grassMs: Math.round(grass.ms * 10) / 10,
        sitesMs: Math.round(sitesMs * 100) / 100,
        bakeMs,
        routes: roads.built,
        routesQueued: roads.queued,
        routesRefused: roads.refused,
        routeChunks: pools.routePieces,
        farTrees: farTrees.trees,
        farCells: farTrees.cells,
        farQueued: farTrees.queued,
        farMs: Math.round(farTrees.ms * 10) / 10,
        cards: cards.count,
        cardsRefused: cards.refused,
        treeBand: [band[0], band[1]],
        fullTrees: band[1] > 1,
      };
    },
    groups: {
      trees: pools.meshes.filter((mesh) => mesh.name === 'trees'),
      'far trees': [cards.mesh],
      props: pools.meshes.filter((mesh) => mesh.name === 'props'),
      buildings: pools.meshes.filter((mesh) => mesh.name === 'buildings'),
      roads: [pools.roads],
      grass: [grass.mesh],
    },
    treeLimit: {
      ranges: { from: [0, 2000, TREE_LIMIT.from], to: [0, 2000, TREE_LIMIT.to] },
      get form() {
        return { ...limitForm };
      },
      set(change) {
        for (const key of ['from', 'to'] as const) {
          const v = change[key];
          if (typeof v === 'number' && Number.isFinite(v)) limitForm[key] = Math.max(0, Math.min(2000, v));
        }
      },
    },
    sample: (i) => samples[i] ?? null,
    dispose() {
      roads.dispose();
      for (const mesh of pools.meshes) scene.remove(mesh);
      scene.remove(pools.roads);
      scene.remove(cards.mesh);
      cards.dispose();
      scene.remove(grass.mesh);
      pools.dispose();
      grass.dispose();
      textures.dispose();
    },
  };
}
