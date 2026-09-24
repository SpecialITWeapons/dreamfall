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
  type Cell,
  type Library,
  type Placement,
  type PropKit,
  type Prop,
  type SceneryKit,
  type SitePlan,
  type Species,
} from '../../../library/contract';
import { CELL_TREES, resolvePopulate } from '../../../library/standard/index.js';
import { countryOf, standingOf } from '../terrain/Country';
import { createFields } from '../terrain/Fields';
import type { Heightfield } from '../terrain/Heightfield';
import { sstep } from '../terrain/noise';
import { hash2, mulberry32 } from '../terrain/noise';
import { SLOTS, type WorldSampler } from '../terrain/WorldSampler';
import { createClaims, type ClaimShapes, type Claims } from './Claims';
import type { Obstacles } from './Obstacles';
import { ROUTE_WIDTH, stretchOf, type RoadRoute } from './Roads';
import { cellKey, type Overrides } from './Overrides';
import type { Site, Sites } from './Sites';

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
/** A biome with less than this share of a cell does not get to populate it (spec 7). */
export const POPULATE_FLOOR = 0.05;
/** Ground above this is land, in the only sense the scenery cares about. */
const LAND = 3;
/**
 * What share of a settlement's windows are lit after dark, at the two ends.
 * Never 0 and never 1: a place with nothing lit is a ruin and a place with
 * everything lit is an office block, and neither is a village at night.
 */
const WAKE: [number, number] = [0.22, 0.6];
const TAU = Math.PI * 2;

export interface TreeInstance {
  species: string;
  x: number;
  /** Ground height under it, m. */
  y: number;
  z: number;
  scale: number;
  /** Vertical scale; a tree is never quite as tall as it is wide. */
  tall: number;
  yaw: number;
  /** Scratch: the sink must copy it, because the next tree overwrites it. */
  tint: Color;
}
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

/** A hash of the whole id, so two entries collide only by being the same entry. */
const idHash = (id: string) => {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return h >>> 0;
};

export function createRing(deps: RingDeps): Ring {
  const { seed, library, sampler, heightfield, obstacles, overrides, metrics, sites, sink, propKit } = deps;
  const size = deps.cell ?? TREE_CELL;
  const radius = deps.radius ?? TREE_RADIUS;
  const maxTrees = deps.maxTrees ?? MAX_RING_TREES;

  const biomes = library.biomes;
  const sown = biomes.map((biome) => (biome.populate ? resolvePopulate(biome.populate) : null));
  // What each biome wants of each prop, and the colours its params name: both
  // are read once per cell through the Cell, so resolve them once here.
  const wants = sown.map((entry) => entry?.scatter?.props ?? {});
  const palette = biomes.map((biome) => {
    const colors = new Map<string, Color>();
    for (const [key, value] of Object.entries(biome.params ?? {}))
      if (typeof value === 'string') colors.set(key, new Color(swatchColor(value)));
    return colors;
  });
  const propEntries: Prop[] = library.props ?? [];
  const byId = new Map(propEntries.map((entry) => [entry.id, entry]));
  const speciesById = new Map((library.species ?? []).map((entry) => [entry.id, entry]));
  const tints = new Map(
    (library.species ?? []).map((entry) => [
      entry.id,
      {
        cold: new Color(swatchColor(entry.tint.cold)),
        warm: new Color(swatchColor(entry.tint.warm)),
        dry: new Color(swatchColor(entry.tint.dry)),
      },
    ]),
  );
  // One stream per cell per entry, from the whole id: adding a prop must not
  // reshuffle the trees, and adding a biome must not reshuffle the props.
  const biomeSalt = biomes.map((biome) => (seed ^ idHash(`biome:${biome.id}`)) >>> 0);
  const propSalt = propEntries.map((entry) => (seed ^ idHash(`prop:${entry.id}`)) >>> 0);
  const overrideSalt = (seed ^ idHash('override')) >>> 0;

  const fields = createFields(sampler);
  const slotIds = new Uint8Array(4);
  const slotWeights = new Float32Array(4);
  // The country under the cell. A settlement's slot is its presence and its
  // plateau, not a planting: its share goes to the biomes beside it, and what
  // they sow is thinned by `clearing` (terrain/Country.ts).
  const standing = standingOf(biomes);
  const countryIds = new Uint8Array(4);
  const countryWeights = new Float32Array(4);
  let clearing = 1;
  const blended = new Color();
  const scratch = new Color();

  let gx = 0,
    gz = 0,
    centerX = 0,
    centerZ = 0,
    share = 0,
    cellTrees = 0,
    read = false;
  let here = fields.at(0, 0);
  let roll: () => number = () => 0;

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

  const cell: Cell = {
    size,
    corner: { x: 0, z: 0 },
    center: { x: 0, z: 0 },
    get share() {
      return share;
    },
    // Lazily: a cell that turns out to be sea, or that nobody claims, never
    // pays for a field sample, and a field sample is the expensive part.
    get fields() {
      if (!read) {
        here = fields.at(centerX, centerZ);
        read = true;
      }
      return here;
    },
    weight(id) {
      for (let s = 0; s < SLOTS; s++) if (biomes[countryIds[s]!]?.id === id) return countryWeights[s]!;
      return 0;
    },
    mix(id) {
      // A prop is thinned in a settlement exactly as a tree is: the country's
      // boulders, a clearing's share of them.
      let sum = 0;
      for (let s = 0; s < SLOTS; s++) {
        const weight = countryWeights[s]!;
        if (weight > 0) sum += weight * (wants[countryIds[s]!]?.[id] ?? 0);
      }
      return sum * clearing;
    },
    blend(param) {
      blended.setRGB(0, 0, 0);
      for (let s = 0; s < SLOTS; s++) {
        const weight = countryWeights[s]!,
          color = palette[countryIds[s]!]?.get(param);
        if (weight > 0 && color) {
          blended.r += weight * color.r;
          blended.g += weight * color.g;
          blended.b += weight * color.b;
        }
      }
      return blended;
    },
    height: (x, z) => heightfield.heightAt(x, z),
    slope: (x, z) => heightfield.slopeAt(x, z),
    land: (x, z) => heightfield.heightAt(x, z) > LAND,
    roll: () => roll(),
    occupied,
  };

  let trees = 0,
    props = 0,
    buildings = 0,
    buildingsRefused = 0,
    cells = 0,
    ms = 0;
  const full = new Set<string>();

  /** The climate tint of one tree, in the scratch colour the sink copies. */
  const climateTint = (species: Species) => {
    const tint = tints.get(species.id)!;
    const climate = cell.fields;
    return scratch
      .copy(tint.cold)
      .lerp(tint.warm, sstep(0.3, 0.7, climate.temp))
      .lerp(tint.dry, sstep(0.45, 0.25, climate.moist));
  };

  const plantTree = (
    speciesId: string,
    x: number,
    z: number,
    opts?: { scale?: number; yaw?: number; tint?: unknown },
  ) => {
    if (cellTrees >= CELL_TREES || trees >= maxTrees || full.has(speciesId)) return;
    const species = speciesById.get(speciesId),
      shape = metrics.species(speciesId);
    if (!species || !shape) return;
    const [min, max] = species.scale;
    const scale = opts?.scale ?? min + roll() * (max - min);
    const tall = scale * (0.9 + roll() * 0.4);
    const yaw = opts?.yaw ?? roll() * TAU;
    const y = heightfield.heightAt(x, z);
    const tint =
      opts?.tint === undefined
        ? climateTint(species)
        : scratch.set(swatchColor(opts.tint as string | number));
    if (!sink.tree({ species: speciesId, x, y, z, scale, tall, yaw, tint })) {
      full.add(speciesId);
      return;
    }
    // Clearance comes from the baked shape, so no generator can understate itself.
    obstacles.add({ x, z, ground: y, top: y + shape.top * tall, radius: scale * shape.radius });
    cellTrees++;
    trees++;
  };

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
    }
  };

  const kit: SceneryKit = {
    tree: (speciesId, x, z, opts) => plantTree(speciesId, x, z, opts),
    prop: (propId, x, z, opts) => standProp(propId, { x, z, ...opts }),
    structure: () => {
      // Not unfinished work: a scatter says what grows on a cell, and a
      // building is not something that grows. Buildings stand on site plans,
      // which are placed whole by `raise`.
      throw new Error(
        'scenery library: a biome scatters, it does not build; a building belongs to a site plan',
      );
    },
    color: (value) => new Color(swatchColor(value)),
  };

  const stream = (salt: number) => mulberry32(hash2(gx, gz, salt));

  const rebuild = (x: number, z: number, cx: number, cz: number) => {
    const started = performance.now();
    sink.begin(x, z);
    obstacles.clear();
    indexPlans(x, z);
    trees = props = buildings = buildingsRefused = cells = 0;
    full.clear();
    const span = Math.ceil(radius / size);
    for (let iz = cz - span; iz <= cz + span && trees < maxTrees; iz++)
      for (let ix = cx - span; ix <= cx + span && trees < maxTrees; ix++) {
        const ccx = (ix + 0.5) * size,
          ccz = (iz + 0.5) * size;
        if (Math.hypot(ccx - x, ccz - z) > radius) continue;
        if (heightfield.heightAt(ccx, ccz) < LAND) continue;
        cells++;
        gx = ix;
        gz = iz;
        cell.corner.x = ix * size;
        cell.corner.z = iz * size;
        cell.center.x = centerX = ccx;
        cell.center.z = centerZ = ccz;
        read = false;
        cellTrees = 0;
        heightfield.weightsAt(ccx, ccz, slotIds, slotWeights);
        clearing = countryOf(slotIds, slotWeights, standing, countryIds, countryWeights);
        // The layer is asked before any hook runs, and while it is empty it does
        // not even cost the key.
        const override = overrides.size === 0 ? null : overrides.for(cellKey(ix, iz));
        if (override?.skip) continue;
        if (override?.placements) {
          roll = stream(overrideSalt);
          for (const put of override.placements) {
            // an override names a tree's scale as one number, like the hooks do
            if (put.species)
              plantTree(put.species, put.x, put.z, {
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
          roll = stream(propSalt[p]!);
          // A scattered prop keeps off a plan as a tree does. A prop the plan
          // asked for is the plan's own and is stood by `raise`, not here.
          for (const put of entry.place(cell, propKit) ?? [])
            if (!occupied(put.x, put.z)) standProp(entry.id, put);
        }
        for (let s = 0; s < SLOTS; s++) {
          // The floor is the country's own share: which biomes get a say in a
          // cell is not changed by a village standing on it, only how much of
          // what they sow comes up.
          const weight = countryWeights[s]!;
          if (weight < POPULATE_FLOOR) continue;
          const entry = sown[countryIds[s]!];
          if (!entry) continue;
          share = weight * clearing;
          roll = stream(biomeSalt[countryIds[s]!]!);
          entry.hook(cell, kit);
        }
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
