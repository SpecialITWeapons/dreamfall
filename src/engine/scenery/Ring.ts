// The streamed ring: 96 m cells out to 2.6 km, rebuilt whole whenever the
// flight crosses a cell. It is the half of the scenery that decides *what
// stands where*; the half that decides how it looks is behind ScenerySink, so
// everything here runs in Node and is tested there.
//
// Coordinates are the world's, in double precision, because the obstacle
// records feed the flight and the flight lives in the world. Turning them into
// the scene's local frame is the sink's job -- and the reason a jump of the
// floating origin must force a rebuild: the instances it wrote are relative to
// an origin that no longer exists.
import { Color } from 'three';
import {
  swatchColor,
  type Library,
  type Placement,
  type PropKit,
  type Prop,
  type SitePlan,
} from '../../../library/contract';
import type { Heightfield } from '../terrain/Heightfield';
import { hash2, mulberry32 } from '../terrain/noise';
import type { WorldSampler } from '../terrain/WorldSampler';
import { createClaims, type ClaimShapes, type Claims } from './Claims';
import type { Obstacles } from './Obstacles';
import { ROUTE_WIDTH, stretchOf, type RoadRoute } from './Roads';
import { cellKey, type Overrides } from './Overrides';
import type { Site, Sites } from './Sites';
import { createSowing, saltOf, type TreeInstance } from './Sowing';

export { POPULATE_FLOOR, type TreeInstance } from './Sowing';

/** The side of one streaming cell, m. */
export const TREE_CELL = 96;
/**
 * How far the ring reaches, m. The edge is where a tree fades out, so this is
 * also how far a tree may be seen: at 1900 m, where the original left it, the
 * fog covers a quarter of what stands there and the fade is plain to watch.
 */
export const TREE_RADIUS = 2600;
/**
 * Trees of one species a pool may hold; the pools are allocated for it, nine
 * species times three meshes, so it is the one that costs memory.
 */
export const MAX_TREES = 4000;
/**
 * Trees the whole ring may place. Not the same number as the pool's: the ring
 * fills cell by cell in row order and stops dead when it hits this, so a ring
 * that hits it is a forest with one side missing. Measured over fourteen places
 * of seed 42, the densest ring at this radius holds 3335 -- so this is the
 * headroom over that, and the pools never see it because no one species takes
 * more than about half of a ring.
 */
export const MAX_RING_TREES = 6000;
/**
 * What share of a settlement's windows are lit after dark, at the two ends.
 * Never 0 and never 1: a place with nothing lit is a ruin and a place with
 * everything lit is an office block, and neither is a village at night.
 */
const WAKE: [number, number] = [0.22, 0.6];

export interface PropInstance {
  prop: string;
  x: number;
  y: number;
  z: number;
  scale: [number, number, number];
  yaw: number;
  sink: number;
  /** Scratch, as above. */
  tint: Color;
}

/** Where the placements go: an array in a test, instanced pools in the browser. */
export interface StructureInstance {
  structure: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  floors: number;
  /** This house's own roll, 0..1: which of its windows are the lit ones after dark. */
  lit: number;
  /** What share of this settlement's windows are awake at all, 0..1. */
  wake: number;
  /** Scratch, as above. */
  tint: Color;
}

export interface ScenerySink {
  /** (x, z) is where the rebuild is centred, in the world: the crowns are handed out by distance from it. */
  begin(x: number, z: number): void;
  /** False when that pool is full; the ring stops offering to it until the next rebuild. */
  tree(tree: TreeInstance): boolean;
  prop(prop: PropInstance): boolean;
  structure(building: StructureInstance): boolean;
  /**
   * A plan whose ground this rebuild covers, offered whole before its lots are.
   * Its roads are not instances -- one site, one ribbon -- so the sink keeps a
   * mesh per plan and drops the ones a rebuild stopped offering.
   */
  site(plan: SitePlan): void;
  /**
   * A road between settlements, as much of it as is drawn: offered whole every
   * rebuild that covers it, after the plans, and dropped by the pools the
   * rebuild it is not offered. Optional: a sink that draws no roads needs none.
   */
  route?(id: string, points: Array<[number, number]>): void;
  end(): void;
}

/** What the baked geometry knows about itself. The obstacle records are built from it. */
export interface SceneryMetrics {
  species(id: string): { top: number; radius: number } | null;
  prop(id: string): { radius: number; height: number } | null;
  /** A building is baked per floor count, so its size is asked for per floor count. */
  structure(id: string, floors: number): { top: number; radius: number } | null;
}

export interface Ring {
  /** Rebuilds when the cell changed or when forced (an origin jump); true when it did. */
  update(x: number, z: number, forced: boolean): boolean;
  readonly cells: number;
  readonly trees: number;
  readonly props: number;
  readonly buildings: number;
  /**
   * Buildings the last rebuild was asked for and could not raise: a pool at its
   * ceiling, or a plan naming a shape nobody baked. A plan is placed whole, so
   * every one of these is a hole in a settlement that nothing else reports --
   * the ring's own `continue`, silently. Counting it is what lets a test demand
   * a zero rather than trust one.
   */
  readonly buildingsRefused: number;
  /** Trees a plan stood that did not stand: a species nobody baked, a pool full, the ring's ceiling. */
  readonly treesRefused: number;
  /** Milliseconds the last rebuild took. */
  readonly ms: number;
  /** Where the ring is centred, m in the world: the shade sheet is anchored here. */
  readonly anchorX: number;
  readonly anchorZ: number;
}

export interface RingDeps {
  seed: number;
  library: Library;
  sampler: WorldSampler;
  heightfield: Heightfield;
  obstacles: Obstacles;
  overrides: Overrides;
  metrics: SceneryMetrics;
  /** The settlements. Without them nothing is spoken for and the ring sows as it always did. */
  sites?: Sites;
  /** The ground the plans speak for; shared with the grass. The ring fills it. */
  claims?: Claims;
  /** The roads between settlements. Without them the settlements stand alone. */
  roads?: { near(x: number, z: number, reach: number, out: RoadRoute[]): RoadRoute[] };
  sink: ScenerySink;
  /** What a prop's place() is handed; the baking half of it is never called here. */
  propKit: PropKit;
  cell?: number;
  radius?: number;
  maxTrees?: number;
}

export function createRing(deps: RingDeps): Ring {
  const { seed, library, sampler, heightfield, obstacles, overrides, metrics, sites, sink, propKit } = deps;
  const size = deps.cell ?? TREE_CELL;
  const radius = deps.radius ?? TREE_RADIUS;
  const maxTrees = deps.maxTrees ?? MAX_RING_TREES;

  const scratch = new Color();

  // The ground the site plans in reach speak for (scenery/Claims.ts), refilled
  // from nothing at every rebuild. A house claims its ground by its baked
  // shape, as its obstacle does, never by what its plan says.
  const claims = deps.claims ?? createClaims();
  const nearby: Site[] = [];
  const routesNear: RoadRoute[] = [];
  /** What of each road in reach is drawn this rebuild, by route. */
  const drawn = new Map<string, Array<[number, number]>>();
  const footprints = new Map((library.structures ?? []).map((entry) => [entry.id, entry.footprint] as const));
  const shapes: ClaimShapes = {
    building(id, floors) {
      const shape = metrics.structure(id, floors);
      if (!shape) return null;
      const footprint = footprints.get(id);
      return footprint ? { radius: shape.radius, footprint } : { radius: shape.radius };
    },
  };

  /** Reads the plans in reach into the index, from nothing, at every rebuild. */
  const indexPlans = (x: number, z: number) => {
    claims.clear();
    drawn.clear();
    if (sites)
      for (const site of sites.near(x, z, radius, nearby)) {
        // A site still in the queue has no plan yet, so it speaks for no ground:
        // the same frame has nothing of it to build either.
        const plan = sites.planFor(site);
        if (plan) claims.add(plan, shapes);
      }
    // The roads between them, as far as each is drawn: into a street where the
    // settlement's plan is built, to its edge where it is not. The claim is
    // named by how much is drawn, so the grass rewrites its tiles when a plan
    // arriving moves an end.
    if (!deps.roads) return;
    for (const route of deps.roads.near(x, z, radius, routesNear)) {
      const points = stretchOf(route, sites?.planFor(route.a) ?? null, sites?.planFor(route.b) ?? null);
      if (points.length < 2) continue;
      drawn.set(route.id, points);
      claims.addRoute(`${route.id}#${points.length}`, points, ROUTE_WIDTH);
    }
  };

  const occupied = (x: number, z: number) => claims.trees(x, z);

  let trees = 0,
    props = 0,
    buildings = 0,
    buildingsRefused = 0,
    treesRefused = 0,
    cells = 0,
    ms = 0;
  const full = new Set<string>();

  const propEntries: Prop[] = library.props ?? [];
  const byId = new Map(propEntries.map((entry) => [entry.id, entry]));
  // One stream per cell per entry, from the whole id: adding a prop must not
  // reshuffle the trees, and adding a biome must not reshuffle the props.
  const propSalt = propEntries.map((entry) => saltOf(seed, `prop:${entry.id}`));
  const overrideSalt = saltOf(seed, 'override');

  /** A tree into the pools and the obstacles; false when its pool is full, which closes the species. */
  const standTree = (tree: TreeInstance) => {
    if (!sink.tree(tree)) {
      full.add(tree.species);
      return false;
    }
    // Clearance comes from the baked shape, so no generator can understate itself.
    const shape = metrics.species(tree.species)!;
    obstacles.add({
      x: tree.x,
      z: tree.z,
      ground: tree.y,
      top: tree.y + shape.top * tree.tall,
      radius: tree.scale * shape.radius,
    });
    trees++;
    return true;
  };
  /** Where a plan's tree draws its size from: its own place, so it is the same tree every rebuild. */
  const planTreeSalt = saltOf(seed, 'plan-tree');

  // A cell's trees are sown where the far trees sow theirs (Sowing.ts): what
  // the ring adds is its ceilings, the pools and the obstacles.
  const sowing = createSowing({
    seed,
    library,
    sampler,
    ground: heightfield,
    size,
    occupied,
    admit: (speciesId) => trees < maxTrees && !full.has(speciesId),
    baked: (speciesId) => metrics.species(speciesId) !== null,
    emit: standTree,
    prop: (propId, x, z, opts) => {
      standProp(propId, { x, z, ...opts });
    },
  });
  const cell = sowing.cell;

  /** @returns true when the prop actually stood: a pool at its ceiling refuses one. */
  const standProp = (propId: string, put: Placement) => {
    const entry = byId.get(propId);
    if (!entry) return false;
    const asked = put.scale ?? 1;
    const scale: [number, number, number] = Array.isArray(asked)
      ? [asked[0], asked[1], asked[2]]
      : [asked, asked, asked];
    const y = heightfield.heightAt(put.x, put.z);
    const sunk = put.sink ?? 0;
    const tint =
      put.tint === undefined
        ? scratch.setRGB(1, 1, 1)
        : put.tint instanceof Color
          ? scratch.copy(put.tint)
          : scratch.set(swatchColor(put.tint));
    if (!sink.prop({ prop: propId, x: put.x, y, z: put.z, scale, yaw: put.yaw ?? 0, sink: sunk, tint }))
      return false;
    const obstacle = entry.obstacle;
    if (obstacle)
      obstacles.add({
        x: put.x,
        z: put.z,
        ground: y,
        top: y - sunk + obstacle.height * scale[1],
        radius: obstacle.radius * Math.max(scale[0], scale[2]),
      });
    props++;
    return true;
  };

  /**
   * The lots of every plan whose ground the ring covers. A plan is placed whole
   * or not at all -- a village with half its houses is worse than a village a
   * frame late -- and the ring never asks a site for anything: it reads a plan
   * that was built in the queue, or it reads nothing.
   */
  const raise = (x: number, z: number) => {
    for (const [id, points] of drawn) sink.route?.(id, points);
    if (!sites) return;
    for (const site of sites.near(x, z, radius, nearby)) {
      const plan = sites.planFor(site);
      if (!plan) continue;
      sink.site(plan);
      // How much of this place is still up: the settlement's own number, not
      // the lot's, so one village turns in early and the next is half awake,
      // and neither changes its mind between two nights.
      const wake =
        WAKE[0] +
        (hash2(Math.round(site.x), Math.round(site.z), seed ^ 0x77a1) / 4294967296) * (WAKE[1] - WAKE[0]);
      for (const lot of plan.lots) {
        // No distance test here on purpose. The site is what the reach decided;
        // once it is in, its lots come with it, however far the far side of the
        // street is. Culling lot by lot would put a whole road ribbon in the
        // scene -- the ribbon is built from the plan, not from the ring's own
        // reach -- with eight houses standing on it, which is the half a village
        // this is written to avoid. A plan is at most SITE_RADIUS across, so the
        // overhang past the ring is bounded and small.
        const y = heightfield.heightAt(lot.x, lot.z);
        // A lot with no floors is a prop the plan asked for: a well, a trough.
        if (lot.floors <= 0) {
          if (!standProp(lot.structure, { x: lot.x, z: lot.z, yaw: lot.yaw, tint: lot.tint }))
            buildingsRefused++;
          continue;
        }
        const shape = metrics.structure(lot.structure, lot.floors);
        if (!shape) {
          buildingsRefused++;
          continue;
        }
        // Which windows are awake is the lot's own business, fixed by where it
        // stands, so a village looks the same on two nights and different from
        // house to house.
        const lit = hash2(Math.round(lot.x), Math.round(lot.z), seed ^ 0x11a7) / 4294967296;
        const tint = lot.tint === undefined ? scratch.setRGB(1, 1, 1) : scratch.set(swatchColor(lot.tint));
        if (
          !sink.structure({
            structure: lot.structure,
            x: lot.x,
            y,
            z: lot.z,
            yaw: lot.yaw,
            floors: lot.floors,
            lit,
            wake,
            tint,
          })
        ) {
          buildingsRefused++;
          continue;
        }
        obstacles.add({
          x: lot.x,
          z: lot.z,
          ground: y,
          top: y + shape.top,
          radius: shape.radius,
        });
        buildings++;
      }
      // The trees the plan stood, with its houses and on the same terms: whole
      // or not at all, and counted when refused rather than dropped.
      for (const spec of plan.trees ?? []) {
        // The plan knows its own streets and not the roads that come in to
        // them from the next settlement, which cross its gardens to get there.
        if (trees >= maxTrees || full.has(spec.species) || claims.road(spec.x, spec.z)) {
          treesRefused++;
          continue;
        }
        const draw = mulberry32(hash2(Math.round(spec.x * 8), Math.round(spec.z * 8), planTreeSalt));
        const tree = sowing.stand(spec.species, spec.x, spec.z, spec.yaw, draw);
        if (!tree || !standTree(tree)) treesRefused++;
      }
    }
  };

  const rebuild = (x: number, z: number, cx: number, cz: number) => {
    const started = performance.now();
    sink.begin(x, z);
    obstacles.clear();
    indexPlans(x, z);
    trees = props = buildings = buildingsRefused = treesRefused = cells = 0;
    full.clear();
    const span = Math.ceil(radius / size);
    for (let iz = cz - span; iz <= cz + span && trees < maxTrees; iz++)
      for (let ix = cx - span; ix <= cx + span && trees < maxTrees; ix++) {
        const ccx = (ix + 0.5) * size,
          ccz = (iz + 0.5) * size;
        if (Math.hypot(ccx - x, ccz - z) > radius) continue;
        if (!sowing.enter(ix, iz)) continue;
        cells++;
        // The layer is asked before any hook runs, and while it is empty it does
        // not even cost the key.
        const override = overrides.size === 0 ? null : overrides.for(cellKey(ix, iz));
        if (override?.skip) continue;
        if (override?.placements) {
          sowing.stream(overrideSalt);
          for (const put of override.placements) {
            // an override names a tree's scale as one number, like the hooks do
            if (put.species)
              sowing.plant(put.species, put.x, put.z, {
                scale: typeof put.scale === 'number' ? put.scale : undefined,
                yaw: put.yaw,
                tint: put.tint,
              });
            else if (put.prop) standProp(put.prop, put);
          }
          continue;
        }
        for (let p = 0; p < propEntries.length; p++) {
          const entry = propEntries[p]!;
          sowing.stream(propSalt[p]!);
          // A scattered prop keeps off a plan as a tree does. A prop the plan
          // asked for is the plan's own and is stood by `raise`, not here.
          for (const put of entry.place(cell, propKit) ?? [])
            if (!occupied(put.x, put.z)) standProp(entry.id, put);
        }
        sowing.sowTrees();
      }
    raise(x, z);
    sink.end();
    ms = performance.now() - started;
  };

  let atX = NaN,
    atZ = NaN;
  return {
    update(x, z, forced) {
      const cx = Math.floor(x / size),
        cz = Math.floor(z / size);
      if (!forced && cx === atX && cz === atZ) return false;
      atX = cx;
      atZ = cz;
      rebuild(x, z, cx, cz);
      return true;
    },
    get cells() {
      return cells;
    },
    get trees() {
      return trees;
    },
    get props() {
      return props;
    },
    get buildings() {
      return buildings;
    },
    get buildingsRefused() {
      return buildingsRefused;
    },
    get treesRefused() {
      return treesRefused;
    },
    get ms() {
      return ms;
    },
    get anchorX() {
      return atX * size;
    },
    get anchorZ() {
      return atZ * size;
    },
  };
}
