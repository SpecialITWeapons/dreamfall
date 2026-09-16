import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import {
  defineBiome,
  defineProp,
  defineSpecies,
  type Biome,
  type Fields,
  type GroundHook,
  type Library,
  type LotSpec,
  type Prop,
  type Reservation,
  type RoadSpec,
  type SitePlan,
} from '../../library/contract';
import { createHeightfield } from '../../src/engine/terrain/Heightfield';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';
import { createObstacles } from '../../src/engine/scenery/Obstacles';
import { createOverrides, type Override } from '../../src/engine/scenery/Overrides';
import {
  MAX_RING_TREES,
  MAX_TREES,
  TREE_CELL,
  TREE_RADIUS,
  createRing,
  type PropInstance,
  type SceneryMetrics,
  type ScenerySink,
  type StructureInstance,
  type TreeInstance,
} from '../../src/engine/scenery/Ring';
import type { Site, Sites } from '../../src/engine/scenery/Sites';

const ground = (() => ({ albedo: null })) as unknown as GroundHook;
const oak = defineSpecies({
  id: 'oak',
  name: 'oak',
  trunk: { height: 6, radius: 0.8, lean: 0.5, tint: 'white' },
  crown: { shape: 'dome', cards: 20 },
  leaf: 'broad',
  tint: { cold: 'canopyCold', warm: 'white', dry: 'canopyDry' },
  scale: [1, 2],
});
const pine = defineSpecies({ ...oak, id: 'pine', name: 'pine' });
/** A prop that stands in half the cells and asks the biome how welcome it is. */
const stones = defineProp({
  id: 'stones',
  name: 'stones',
  obstacle: { radius: 2, height: 3 },
  bake: () => ({}) as never,
  place: (cell) => {
    if (cell.roll() > cell.mix('stones')) return [];
    const x = cell.corner.x + cell.roll() * cell.size,
      z = cell.corner.z + cell.roll() * cell.size;
    return cell.land(x, z) ? [{ x, z, scale: 2, sink: 0.5, tint: cell.blend('rock').clone() }] : [];
  },
});

const everywhere = (id: string, density: number, props?: Record<string, number>): Biome =>
  defineBiome({
    id,
    name: id,
    params: { rock: 'rockCold' },
    presence: () => 1,
    ground,
    populate: { type: 'scatter', species: { oak: 1 }, density, ...(props ? { props } : {}) },
  });

const library = (biomes: Biome[], props: Prop[] = []): Library => ({
  biomes,
  species: [oak, pine],
  props,
});

const metrics: SceneryMetrics = {
  species: () => ({ top: 8, radius: 3 }),
  prop: (id) => (id === 'stones' ? { radius: 2, height: 3 } : null),
  // a house is taller the more floors it has, which is all the ring needs of it
  structure: (id, floors) => (id === 'cottage' ? { top: 3 + floors * 2.8, radius: 6 } : null),
};

/** A sink that keeps what the ring offered it, and may be told to fill up. */
const collector = (capacity = Infinity) => {
  const trees: TreeInstance[] = [],
    props: PropInstance[] = [],
    buildings: StructureInstance[] = [],
    plans: SitePlan[] = [];
  let begun = 0,
    ended = 0;
  const sink: ScenerySink = {
    begin() {
      begun++;
      trees.length = 0;
      props.length = 0;
      buildings.length = 0;
      plans.length = 0;
    },
    tree(t) {
      if (trees.length >= capacity) return false;
      trees.push({ ...t, tint: t.tint.clone() });
      return true;
    },
    prop(p) {
      props.push({ ...p, tint: p.tint.clone() });
      return true;
    },
    structure(b) {
      buildings.push({ ...b, tint: b.tint.clone() });
      return true;
    },
    site(plan) {
      plans.push(plan);
    },
    end() {
      ended++;
    },
  };
  return { sink, trees, props, buildings, plans, counts: () => ({ begun, ended }) };
};

/** A biome that asks instead of planting: what does the ground say about these points? */
const asker = (points: Array<[number, number]>, answers: boolean[]): Biome =>
  defineBiome({
    id: 'asker',
    name: 'asker',
    params: {},
    presence: () => 1,
    ground,
    populate: (cell) => {
      // Every cell asks the same questions; the answer is the ground's, not the cell's.
      points.forEach(([x, z], i) => (answers[i] = cell.occupied(x, z)));
    },
  });

/** A plan carrying nothing but the ground it speaks for. */
const planOf = (parts: {
  x: number;
  z: number;
  roads?: RoadSpec[];
  reservations?: Reservation[];
  lots?: LotSpec[];
}): SitePlan => ({
  id: 'village:0,0',
  x: parts.x,
  z: parts.z,
  radius: 250,
  roads: parts.roads ?? [],
  lots: parts.lots ?? [],
  reservations: parts.reservations ?? [],
});

/** A house on the plan, at the spot and with the storeys the test cares about. */
const lotAt = (x: number, z: number, floors = 2, structure = 'cottage'): LotSpec => ({
  x,
  z,
  yaw: 0.25,
  structure,
  floors,
});

/** A Sites stub: one site, already planned, reaching exactly as the real one does. */
const oneSite = (plan: SitePlan): Sites => {
  const site: Site = {
    id: plan.id,
    biome: 'village',
    x: plan.x,
    z: plan.z,
    radius: plan.radius,
    yaw: 0,
    fields: {} as Fields,
    random: () => 0.5,
  };
  return {
    near(x, z, reach, out) {
      out.length = 0;
      if (Math.hypot(site.x - x, site.z - z) <= reach + site.radius) out.push(site);
      return out;
    },
    planFor: (asked) => (asked.id === site.id ? plan : null),
    work: () => {},
    built: 1,
    queued: 0,
  };
};

/** How far a point lies from a road's axis, worked out the long way. */
const toRoad = (road: RoadSpec, x: number, z: number) => {
  let best = Infinity;
  for (let i = 1; i < road.points.length; i++) {
    const [ax, az] = road.points[i - 1]!,
      [bx, bz] = road.points[i]!;
    const dx = bx - ax,
      dz = bz - az,
      len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
};

/** A ring over the real seed-42 ground, small enough for a test window. */
const ring = (
  lib: Library,
  opts: { overrides?: Override[]; maxTrees?: number; radius?: number; sites?: Sites } = {},
) => {
  const sampler = createWorldSampler(42, { biomes: lib.biomes });
  const heightfield = createHeightfield(sampler, { size: 128 });
  heightfield.fillAll(0, 0);
  const obstacles = createObstacles();
  const sink = collector();
  return {
    ...sink,
    obstacles,
    heightfield,
    ring: createRing({
      seed: 42,
      library: lib,
      sampler,
      heightfield,
      obstacles,
      overrides: createOverrides(opts.overrides),
      metrics,
      sites: opts.sites,
      sink: sink.sink,
      propKit: {
        sstep: (a: number, b: number, x: number) => Math.max(0, Math.min(1, (x - a) / (b - a || 1))),
      } as never,
      radius: opts.radius ?? 300,
      maxTrees: opts.maxTrees ?? 4000,
    }),
  };
};

const cellOf = (t: { x: number; z: number }) =>
  `${Math.floor(t.x / TREE_CELL)},${Math.floor(t.z / TREE_CELL)}`;
const at = (t: { x: number; z: number }) => `${t.x.toFixed(3)},${t.z.toFixed(3)}`;

describe('the streamed ring', () => {
  it('plants what the biomes ask for, and counts what it planted', () => {
    const r = ring(library([everywhere('woods', 1)]));
    expect(r.ring.update(0, 0, false)).toBe(true);
    expect(r.trees.length).toBeGreaterThan(10);
    expect(r.ring.trees).toBe(r.trees.length);
    expect(r.ring.cells).toBeGreaterThan(20);
    expect(r.ring.ms).toBeGreaterThanOrEqual(0);
    expect(r.counts()).toEqual({ begun: 1, ended: 1 });
    // a biome that wants nothing gets nothing, over the same ground
    const bare = ring(library([everywhere('bare', 0)]));
    bare.ring.update(0, 0, false);
    expect(bare.trees).toEqual([]);
  });
  it('holds the cap of three per cell however many biomes claim the cell', () => {
    const r = ring(library([everywhere('a', 10), everywhere('b', 10), everywhere('c', 10)]));
    r.ring.update(0, 0, false);
    const perCell = new Map<string, number>();
    for (const tree of r.trees) perCell.set(cellOf(tree), (perCell.get(cellOf(tree)) ?? 0) + 1);
    expect(Math.max(...perCell.values())).toBe(3);
    expect(r.trees.length).toBeGreaterThan(20);
  });
  it('stops at its ceiling instead of growing the pools', () => {
    const r = ring(library([everywhere('woods', 10)]), { maxTrees: 5 });
    r.ring.update(0, 0, false);
    expect(r.trees).toHaveLength(5);
    expect(r.ring.trees).toBe(5);
  });
  it("keeps its own ceiling above a pool's, because hitting it costs a side of the forest", () => {
    // The sweep runs cell by cell in row order and stops dead on the ceiling,
    // so a ring that reaches it is a wood with one edge missing rather than a
    // thinner wood. The pools are allocated per species and per mesh, which is
    // what makes their number the expensive one; the ring's is a loop guard and
    // costs nothing, so it is the one with the headroom.
    expect(MAX_RING_TREES).toBeGreaterThan(MAX_TREES);
    // and the reach is wide enough that the fade at its edge is not watched:
    // at the original 1900 m the fog covers about a quarter of what stands there
    expect(TREE_RADIUS).toBeGreaterThanOrEqual(2600);
  });
  it('is the same ring twice: rebuilt in place, and after a walk there and back', () => {
    const a = ring(library([everywhere('woods', 1)])),
      b = ring(library([everywhere('woods', 1)]));
    a.ring.update(0, 0, false);
    const first = a.trees.map(
      (t) => `${t.species}@${t.x.toFixed(3)},${t.z.toFixed(3)},${t.scale.toFixed(3)}`,
    );
    b.ring.update(0, 0, false);
    expect(
      b.trees.map((t) => `${t.species}@${t.x.toFixed(3)},${t.z.toFixed(3)},${t.scale.toFixed(3)}`),
    ).toEqual(first);
    a.ring.update(500, 500, false);
    a.ring.update(0, 0, false);
    expect(
      a.trees.map((t) => `${t.species}@${t.x.toFixed(3)},${t.z.toFixed(3)},${t.scale.toFixed(3)}`),
    ).toEqual(first);
  });
  it('rebuilds on a cell crossing, on demand, and never for nothing', () => {
    const r = ring(library([everywhere('woods', 1)]));
    expect(r.ring.update(0, 0, false)).toBe(true);
    expect(r.ring.update(TREE_CELL * 0.4, 0, false)).toBe(false);
    expect(r.counts().begun).toBe(1);
    // the origin jumped under us: nothing moved in the world, everything moved in the scene
    expect(r.ring.update(TREE_CELL * 0.4, 0, true)).toBe(true);
    expect(r.counts().begun).toBe(2);
    expect(r.ring.update(TREE_CELL * 1.4, 0, false)).toBe(true);
  });
  it('tells the flight about everything that stands, and forgets it on the next rebuild', () => {
    const r = ring(library([everywhere('woods', 1, { stones: 1 })], [stones]));
    r.ring.update(0, 0, false);
    expect(r.props.length).toBeGreaterThan(0);
    expect(r.obstacles.size).toBe(r.trees.length + r.props.length);
    const tree = r.trees[0]!;
    expect(r.obstacles.floorAt(tree.x, tree.z, 0)).toBeCloseTo(tree.y + 8 * tree.tall, 6);
    const prop = r.props[0]!;
    expect(r.obstacles.floorAt(prop.x, prop.z, 0)).toBeCloseTo(prop.y - prop.sink + 3 * prop.scale[1], 6);
    // ten kilometres away the ring holds its own size, not the sum of two rings
    const grown = r.obstacles.size;
    r.ring.update(10_000, 10_000, false);
    expect(r.obstacles.size).toBeLessThan(grown * 2);
    expect(r.obstacles.size).toBe(r.trees.length + r.props.length);
  });
  it('asks the override layer first: a skipped cell stays empty, a written one stands as written', () => {
    const plain = ring(library([everywhere('woods', 1)]));
    plain.ring.update(0, 0, false);
    const busy = plain.trees.find((t) => t.x >= 0 && t.z >= 0)!;
    const [gx, gz] = cellOf(busy).split(',').map(Number) as [number, number];
    const skipped = ring(library([everywhere('woods', 1)]), {
      overrides: [{ key: `cell:${gx},${gz}`, skip: true }],
    });
    skipped.ring.update(0, 0, false);
    expect(skipped.trees.filter((t) => cellOf(t) === `${gx},${gz}`)).toEqual([]);
    expect(skipped.trees.length).toBeLessThan(plain.trees.length);
    const written = ring(library([everywhere('woods', 1)]), {
      overrides: [
        {
          key: `cell:${gx},${gz}`,
          placements: [{ species: 'pine', x: gx * TREE_CELL + 5, z: gz * TREE_CELL + 5, yaw: 1 }],
        },
      ],
    });
    written.ring.update(0, 0, false);
    const stood = written.trees.filter((t) => cellOf(t) === `${gx},${gz}`);
    expect(stood).toHaveLength(1);
    expect(stood[0]!.species).toBe('pine');
    expect(stood[0]!.yaw).toBe(1);
  });
  it('gives every entry its own stream, so adding a prop does not move a single tree', () => {
    const without = ring(library([everywhere('woods', 1, { stones: 1 })]));
    without.ring.update(0, 0, false);
    const with_ = ring(library([everywhere('woods', 1, { stones: 1 })], [stones]));
    with_.ring.update(0, 0, false);
    expect(with_.props.length).toBeGreaterThan(0);
    expect(with_.trees.map((t) => `${t.x},${t.z}`)).toEqual(without.trees.map((t) => `${t.x},${t.z}`));
  });
  it('keeps the scatter off a plan: nothing in a reservation, nothing on a road', () => {
    const plain = ring(library([everywhere('woods', 10)]));
    plain.ring.update(0, 0, false);
    // The square and the lane are laid where trees already stand, so what moves
    // them is the plan and not chance.
    const stump = plain.trees.find((t) => Math.hypot(t.x, t.z) < 150)!;
    const along = plain.trees.find((t) => Math.hypot(t.x - stump.x, t.z - stump.z) > 150)!;
    const square: Reservation = { x: stump.x, z: stump.z, radius: 45 };
    const road: RoadSpec = {
      points: [
        [along.x - 120, along.z],
        [along.x + 120, along.z],
      ],
      width: 16,
    };
    const inSquare = (t: { x: number; z: number }) =>
      Math.hypot(t.x - square.x, t.z - square.z) <= square.radius;
    const onRoad = (t: { x: number; z: number }) => toRoad(road, t.x, t.z) <= road.width / 2;
    expect(plain.trees.some(inSquare)).toBe(true);
    expect(plain.trees.some(onRoad)).toBe(true);

    const settled = ring(library([everywhere('woods', 10)]), {
      sites: oneSite(planOf({ x: 0, z: 0, reservations: [square], roads: [road] })),
    });
    settled.ring.update(0, 0, false);
    expect(settled.trees.filter((t) => inSquare(t) || onRoad(t))).toEqual([]);
    expect(settled.trees.length).toBeGreaterThan(10);
    // and the cells the plan does not reach into are untouched, tree for tree.
    // Only the cells it does reach into move: a refused tree hands back the two
    // numbers it would have drawn, so the trees after it in that cell differ.
    const spared = (t: { x: number; z: number }) =>
      !plain.trees.some((o) => cellOf(o) === cellOf(t) && (inSquare(o) || onRoad(o)));
    expect(settled.trees.filter(spared).map(at)).toEqual(plain.trees.filter(spared).map(at));
  });
  it('draws the edge where the reservation and the road draw it', () => {
    const square: Reservation = { x: 40, z: 40, radius: 30 };
    const road: RoadSpec = {
      points: [
        [-200, -100],
        [200, -100],
      ],
      width: 12,
    };
    const answers: boolean[] = [];
    const probes: Array<[number, number]> = [
      [square.x + square.radius - 0.5, square.z],
      [square.x + square.radius + 0.5, square.z],
      [0, road.points[0]![1] + road.width / 2 - 0.5],
      [0, road.points[0]![1] + road.width / 2 + 0.5],
      // a road ends where its last point does: the ribbon is not an endless line
      [260, road.points[0]![1]],
    ];
    const r = ring(library([asker(probes, answers)]), {
      sites: oneSite(planOf({ x: 0, z: 0, reservations: [square], roads: [road] })),
    });
    r.ring.update(0, 0, false);
    expect(answers).toEqual([true, false, true, false, false]);
  });
  it('reads the plans once a rebuild, so a village left behind does not come along', () => {
    const square: Reservation = { x: 40, z: 40, radius: 60 };
    const answers: boolean[] = [];
    const r = ring(library([asker([[square.x, square.z]], answers)]), {
      sites: oneSite(planOf({ x: square.x, z: square.z, reservations: [square] })),
      radius: 150,
    });
    r.ring.update(0, 0, false);
    expect(answers).toEqual([true]);
    // out of reach of the only site there is: the index is empty, not stale
    r.ring.update(800, 800, false);
    expect(r.ring.cells).toBeGreaterThan(0);
    expect(answers).toEqual([false]);
  });
  it('leaves the ground free while a site is still queued: no plan, no claim', () => {
    const square: Reservation = { x: 40, z: 40, radius: 60 };
    const answers: boolean[] = [];
    const planned = oneSite(planOf({ x: square.x, z: square.z, reservations: [square] }));
    // the village arrives a frame later, whole; it never arrives in halves
    const queued: Sites = { ...planned, planFor: () => null };
    const r = ring(library([asker([[square.x, square.z]], answers)]), { sites: queued, radius: 150 });
    r.ring.update(0, 0, false);
    expect(answers).toEqual([false]);
  });
  it("stands the plan's houses on the ground, and hands the flight their tops", () => {
    const here = lotAt(40, -20),
      far = lotAt(500, 500);
    const r = ring(library([everywhere('woods', 0)]), {
      sites: oneSite(planOf({ x: 0, z: 0, lots: [here, far] })),
      radius: 300,
    });
    r.ring.update(0, 0, false);
    // A village in reach comes whole, the far side of its street included: its
    // road ribbon is built from the plan and not from the ring's reach, so a
    // ring that kept the street and dropped the houses on it would be showing
    // exactly the half a village this is written to avoid.
    expect(r.buildings.map((b) => at(b)).sort()).toEqual([at(here), at(far)].sort());
    expect(r.ring.buildings).toBe(2);
    const raised = r.buildings.find((b) => at(b) === at(here))!;
    expect(raised.floors).toBe(here.floors);
    expect(raised.yaw).toBe(here.yaw);
    expect(raised.y).toBe(r.heightfield.heightAt(here.x, here.z));
    // the flight is told about a house the way it is told about a tree: by its top
    const shape = metrics.structure('cottage', here.floors)!;
    expect(r.obstacles.floorAt(here.x, here.z, 0)).toBeCloseTo(raised.y + shape.top, 6);
  });
  it('raises nothing at all for a site the ring has left behind', () => {
    const plan = planOf({ x: 0, z: 0, lots: [lotAt(40, -20), lotAt(-30, 50)] });
    const r = ring(library([everywhere('woods', 0)]), { sites: oneSite(plan), radius: 300 });
    r.ring.update(0, 0, false);
    expect(r.ring.buildings).toBe(2);
    // out of the site's own reach: whole or not at all, and here it is not at all
    r.ring.update(4000, 4000, false);
    expect(r.ring.buildings).toBe(0);
    expect(r.buildings).toEqual([]);
  });
  it('offers a plan whole, once a rebuild, before any of its lots', () => {
    // The roads of a site are one ribbon built out of the plan, not instances,
    // so the sink needs the plan itself and needs it exactly as often as the
    // ring covers it.
    const plan = planOf({ x: 0, z: 0, lots: [lotAt(40, -20)] });
    const r = ring(library([everywhere('woods', 0)]), { sites: oneSite(plan), radius: 300 });
    r.ring.update(0, 0, false);
    expect(r.plans).toEqual([plan]);
    // left behind, the plan is not offered and the ribbon is free to go
    r.ring.update(4000, 4000, false);
    expect(r.plans).toEqual([]);
  });
  it('leaves a house it has no geometry for on the plan, unbuilt and unblocking', () => {
    const r = ring(library([everywhere('woods', 0)]), {
      sites: oneSite(planOf({ x: 0, z: 0, lots: [lotAt(40, -20, 2, 'palace')] })),
      radius: 300,
    });
    r.ring.update(0, 0, false);
    expect(r.buildings).toEqual([]);
    expect(r.ring.buildings).toBe(0);
    expect(r.obstacles.floorAt(40, -20, 0)).toBe(-Infinity);
  });
  it('reads a lot with no floors as the prop the plan asked for', () => {
    const r = ring(library([everywhere('woods', 0)], [stones]), {
      sites: oneSite(planOf({ x: 0, z: 0, lots: [lotAt(40, -20, 0, 'stones')] })),
      radius: 300,
    });
    r.ring.update(0, 0, false);
    expect(r.buildings).toEqual([]);
    expect(r.props.map(at)).toEqual([at({ x: 40, z: -20 })]);
    expect(r.ring.props).toBe(1);
  });
  it('lights the windows by where a house stands, so two nights agree and two houses do not', () => {
    const lots = [lotAt(40, -20), lotAt(-60, 30), lotAt(10, 90), lotAt(-30, -70)];
    const r = ring(library([everywhere('woods', 0)]), {
      sites: oneSite(planOf({ x: 0, z: 0, lots })),
      radius: 300,
    });
    r.ring.update(0, 0, false);
    const first = r.buildings.map((b) => b.lit);
    expect(first).toHaveLength(lots.length);
    for (const lit of first) {
      expect(lit).toBeGreaterThanOrEqual(0);
      expect(lit).toBeLessThan(1);
    }
    expect(new Set(first).size).toBe(lots.length);
    // the same ground, a rebuild later: the village does not blink
    r.ring.update(0, 0, true);
    expect(r.buildings.map((b) => b.lit)).toEqual(first);
  });
  it('tints a tree by the climate it stands in and a prop by the biome it stands on', () => {
    const r = ring(library([everywhere('woods', 1, { stones: 1 })], [stones]));
    r.ring.update(0, 0, false);
    for (const tree of r.trees) expect(tree.tint).toBeInstanceOf(Color);
    const rock = new Color(0x7b8a88); // rockCold
    for (const prop of r.props) expect(prop.tint.getHexString()).toBe(rock.getHexString());
  });
});
