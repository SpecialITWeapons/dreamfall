// The streamed ring: 96 m cells out to 1.9 km, rebuilt whole whenever the
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
import { createFields } from '../terrain/Fields';
import type { Heightfield } from '../terrain/Heightfield';
import { sstep } from '../terrain/noise';
import { hash2, mulberry32 } from '../terrain/noise';
import { SLOTS, type WorldSampler } from '../terrain/WorldSampler';
import { OBSTACLE_CELL, type Obstacles } from './Obstacles';
import { cellKey, type Overrides } from './Overrides';
import type { Site, Sites } from './Sites';

/** The side of one streaming cell, m. */
export const TREE_CELL = 96;
/** How far the ring reaches, m. */
export const TREE_RADIUS = 1900;
/** Trees the whole ring may hold; the pools are allocated for it. */
export const MAX_TREES = 4000;
/** A biome with less than this share of a cell does not get to populate it (spec 7). */
export const POPULATE_FLOOR = 0.05;
/** Ground above this is land, in the only sense the scenery cares about. */
const LAND = 3;
/** The claim index's cell, m: the obstacles' own, because the question has the same shape. */
const CLAIM_CELL = OBSTACLE_CELL;
const TAU = Math.PI * 2;

/**
 * One piece of ground a site plan speaks for: a road's segment with its half
 * width, or a reservation, which is the same thing with no length. One shape
 * answers both, so the index holds one kind of record.
 */
interface Claim {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Squared, because that is the only way the query ever asks. */
  r2: number;
}

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
  /** How awake this house is after dark, 0..1; the window band is multiplied by it. */
  lit: number;
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
  const maxTrees = deps.maxTrees ?? MAX_TREES;

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

  // The ground the site plans in reach speak for, in a hash grid of 64 m cells
  // -- the obstacles' cell, for the obstacles' reason. occupied() is asked once
  // per tree, three times a cell and seventeen hundred cells a rebuild, so it
  // may not walk the plans: each claim is written into every cell it touches,
  // once per rebuild, and the query reads the single cell it lands in.
  const claims = new Map<string, Claim[]>();
  const nearby: Site[] = [];

  const claim = (x0: number, z0: number, x1: number, z1: number, r: number) => {
    const record: Claim = { x0, z0, x1, z1, r2: r * r };
    const cx0 = Math.floor((Math.min(x0, x1) - r) / CLAIM_CELL),
      cx1 = Math.floor((Math.max(x0, x1) + r) / CLAIM_CELL),
      cz0 = Math.floor((Math.min(z0, z1) - r) / CLAIM_CELL),
      cz1 = Math.floor((Math.max(z0, z1) + r) / CLAIM_CELL);
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = `${cx},${cz}`,
          bucket = claims.get(key);
        if (bucket) bucket.push(record);
        else claims.set(key, [record]);
      }
  };

  /** Reads the plans in reach into the index, from nothing, at every rebuild. */
  const indexPlans = (x: number, z: number) => {
    claims.clear();
    if (!sites) return;
    for (const site of sites.near(x, z, radius, nearby)) {
      // A site still in the queue has no plan yet, so it speaks for no ground:
      // the same frame has nothing of it to build either.
      const plan = sites.planFor(site);
      if (!plan) continue;
      for (const spot of plan.reservations) claim(spot.x, spot.z, spot.x, spot.z, spot.radius);
      for (const road of plan.roads) {
        const half = road.width / 2;
        for (let i = 1; i < road.points.length; i++) {
          const a = road.points[i - 1]!,
            b = road.points[i]!;
          claim(a[0], a[1], b[0], b[1], half);
        }
      }
    }
  };

  const occupied = (x: number, z: number) => {
    // A world with no settlements pays one comparison per tree for the question.
    if (claims.size === 0) return false;
    const bucket = claims.get(`${Math.floor(x / CLAIM_CELL)},${Math.floor(z / CLAIM_CELL)}`);
    if (!bucket) return false;
    for (const c of bucket) {
      const dx = c.x1 - c.x0,
        dz = c.z1 - c.z0,
        len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - c.x0) * dx + (z - c.z0) * dz) / len2)) : 0;
      const ox = x - (c.x0 + t * dx),
        oz = z - (c.z0 + t * dz);
      if (ox * ox + oz * oz <= c.r2) return true;
    }
    return false;
  };

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
      for (let s = 0; s < SLOTS; s++) if (biomes[slotIds[s]!]?.id === id) return slotWeights[s]!;
      return 0;
    },
    mix(id) {
      let sum = 0;
      for (let s = 0; s < SLOTS; s++) {
        const weight = slotWeights[s]!;
        if (weight > 0) sum += weight * (wants[slotIds[s]!]?.[id] ?? 0);
      }
      return sum;
    },
    blend(param) {
      blended.setRGB(0, 0, 0);
      for (let s = 0; s < SLOTS; s++) {
        const weight = slotWeights[s]!,
          color = palette[slotIds[s]!]?.get(param);
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

  const standProp = (propId: string, put: Placement) => {
    const entry = byId.get(propId);
    if (!entry) return;
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
      return;
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
  };

  /**
   * The lots of every plan whose ground the ring covers. A plan is placed whole
   * or not at all -- a village with half its houses is worse than a village a
   * frame late -- and the ring never asks a site for anything: it reads a plan
   * that was built in the queue, or it reads nothing.
   */
  const raise = (x: number, z: number) => {
    if (!sites) return;
    for (const site of sites.near(x, z, radius, nearby)) {
      const plan = sites.planFor(site);
      if (!plan) continue;
      sink.site(plan);
      for (const lot of plan.lots) {
        if (Math.hypot(lot.x - x, lot.z - z) > radius) continue;
        const y = heightfield.heightAt(lot.x, lot.z);
        // A lot with no floors is a prop the plan asked for: a well, a trough.
        if (lot.floors <= 0) {
          standProp(lot.structure, { x: lot.x, z: lot.z, yaw: lot.yaw, tint: lot.tint });
          continue;
        }
        const shape = metrics.structure(lot.structure, lot.floors);
        if (!shape) continue;
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
            tint,
          })
        )
          continue;
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
      throw new Error('scenery: structures land in M4');
    },
    color: (value) => new Color(swatchColor(value)),
  };

  const stream = (salt: number) => mulberry32(hash2(gx, gz, salt));

  const rebuild = (x: number, z: number, cx: number, cz: number) => {
    const started = performance.now();
    sink.begin(x, z);
    obstacles.clear();
    indexPlans(x, z);
    trees = props = buildings = cells = 0;
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
          for (const put of entry.place(cell, propKit) ?? []) standProp(entry.id, put);
        }
        for (let s = 0; s < SLOTS; s++) {
          const weight = slotWeights[s]!;
          if (weight < POPULATE_FLOOR) continue;
          const entry = sown[slotIds[s]!];
          if (!entry) continue;
          share = weight;
          roll = stream(biomeSalt[slotIds[s]!]!);
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
