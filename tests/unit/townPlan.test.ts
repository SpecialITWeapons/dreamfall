import { describe, expect, it } from 'vitest';
import type { SceneryColor } from '../../library/contract';
import type { LineSpec, LotSpec, RoadSpec, Reservation, Site, SiteKit } from '../../library/contract';
import { createLibrary } from '../../library/index.js';
import { TOWN } from '../../library/settlements/town.js';
import { planTown } from '../../library/settlements/plan-town.js';

/** A world, as far as a plan can tell: the two questions it may ask the ground. */
type World = { height(x: number, z: number): number; slope(x: number, z: number): number };

/** Ground a town has already flattened, which is what its own plateau is for. */
const flat: World = { height: () => 200, slope: () => 0 };

/** A steady tilt a town may still build on: under `roads.maxSlope` everywhere. */
const tilted: World = {
  height: (x, z) => 200 + x * 0.1 + z * 0.05,
  slope: () => Math.hypot(0.1, 0.05),
};

/** East of here the ground stands up steeper than any street may climb. */
const EDGE = 200;
/**
 * A hillside with a line in it rather than a gradient, so what the slope rule
 * refuses is a number the test can name. The outskirts of a wide town reach
 * past the plateau's feather and meet exactly this.
 */
const cliff: World = {
  height: (x) => 200 + (x > EDGE ? (x - EDGE) * 0.5 : 0),
  slope: (x) => (x > EDGE ? 0.5 : 0),
};

/** How wide the ridge stands: wider than a street's own step, or it steps over it. */
const BAND = 120;
/**
 * The same hillside with flat ground behind it. A half-plane can only show a
 * street stopping; a band is what shows it starting again, which is the half of
 * the rule that matters.
 */
const ridge: World = { height: () => 200, slope: (x) => (x > EDGE && x < EDGE + BAND ? 0.5 : 0) };

/** A site of seed 42's kind, without a world: the plan only ever asks the kit. */
const site = (over: Partial<Site> = {}): Site => {
  let n = 0;
  return {
    id: 'town:1,2',
    x: 0,
    z: 0,
    radius: 650,
    yaw: 0.4,
    fields: { baseHeight: 200, temp: 0.5, moist: 0.5 } as Site['fields'],
    random: () => {
      // a fixed, spread sequence: a plan must not depend on the shape of its noise
      n = (n * 1664525 + 1013904223) % 4294967296;
      return n / 4294967296;
    },
    ...over,
  };
};

const collect = (world: World = flat) => {
  const roads: RoadSpec[] = [],
    lots: LotSpec[] = [],
    lines: LineSpec[] = [],
    reservations: Reservation[] = [];
  const kit = {
    height: world.height,
    slope: world.slope,
    road: (points: Array<[number, number]>, width: number, opts?: { color?: string }) =>
      roads.push({ points, width, color: opts?.color }),
    structure: (
      structure: string,
      x: number,
      z: number,
      opts?: { yaw?: number; floors?: number; tint?: SceneryColor },
    ) =>
      lots.push({
        structure,
        x,
        z,
        yaw: opts?.yaw ?? 0,
        floors: opts?.floors ?? 1,
        ...(opts?.tint === undefined ? {} : { tint: opts.tint }),
      }),
    reserve: (x: number, z: number, radius: number) => reservations.push({ x, z, radius }),
    line: (points: Array<[number, number]>, kind: string, opts?: { height?: number }) =>
      lines.push({ points, kind, ...(opts?.height === undefined ? {} : { height: opts.height }) }),
    tree: () => {},
    prop: () => {},
    color: () => ({}) as never,
  } as unknown as SiteKit;
  return { kit, roads, lots, lines, reservations };
};

const plan = (over: Partial<Site> = {}, world: World = flat) => {
  const out = collect(world);
  planTown(site(over), TOWN, out.kit);
  return out;
};

/** The shortest distance from a point to a polyline, m. */
const toRoad = (road: RoadSpec, x: number, z: number) => {
  let best = Infinity;
  for (let i = 1; i < road.points.length; i++) {
    const [ax, az] = road.points[i - 1]!,
      [bx, bz] = road.points[i]!;
    const dx = bx - ax,
      dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
};

const isClosed = (road: RoadSpec) => {
  const head = road.points[0]!,
    tail = road.points[road.points.length - 1]!;
  return road.points.length > 2 && head[0] === tail[0] && head[1] === tail[1];
};

describe('planTown', () => {
  it('lays a town the same way twice', () => {
    // The order of the draws is the town's repeatability, and a player who
    // flies back to one is what makes it matter.
    const a = plan(),
      b = plan();
    expect(b.roads).toEqual(a.roads);
    expect(b.lots).toEqual(a.lots);
    expect(b.reservations).toEqual(a.reservations);
  });

  it('builds a town of the size the spec asks for, at every width it has', () => {
    // 500..2000 is the specification's, and the plan hits it by construction:
    // it offers every lot the grid has room for and then accepts a share of
    // them chosen so the count comes out here. Nothing is capped, so nothing is
    // truncated -- a cap would build a town with one side missing.
    // The narrowest a town may be is `TOWN.radius[0]`, and it is 450 rather than
    // the specification's 400 because the buildings grew by a third: at 400 the
    // grid offers 498 lots, two short of the floor, and a town is widened
    // rather than crammed.
    const narrow = plan({ radius: TOWN.radius[0] }).lots.length,
      middling = plan({ radius: 650 }).lots.length,
      wide = plan({ radius: TOWN.radius[1] }).lots.length;
    for (const count of [narrow, middling, wide]) {
      expect(count).toBeGreaterThanOrEqual(500);
      expect(count).toBeLessThanOrEqual(2000);
    }
    expect(narrow).toBeLessThan(wide);
  });

  it('never stands two buildings in one place', () => {
    // Streets cross, and a crossing would otherwise get a building from each of
    // the two streets that made it. Every pair is walked -- the plan may ask a
    // hash grid, the test may not -- but the assertion is made once, because a
    // million of them is a minute of Vitest building assertion objects.
    const { lots } = plan();
    expect(lots.length).toBeGreaterThan(500);
    let closest = Infinity;
    for (let i = 0; i < lots.length; i++)
      for (let j = i + 1; j < lots.length; j++) {
        const a = lots[i]!,
          b = lots[j]!;
        closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
      }
    expect(closest).toBeGreaterThanOrEqual(TOWN.lots.depth * 0.9);
  });

  it('stands every building out of the road, the landmark included', () => {
    // Measured against each road's own half width, and against every road there
    // is -- which is also what says the hash grid the plan asks instead has the
    // same answer as the exhaustive walk.
    const { lots, roads } = plan();
    let tightest = Infinity;
    for (const lot of lots)
      for (const road of roads) tightest = Math.min(tightest, toRoad(road, lot.x, lot.z) - road.width / 2);
    expect(tightest).toBeGreaterThan(0);
  });

  it('speaks for the ground it built on: the plaza and every building', () => {
    const { lots, reservations } = plan();
    const covered = (x: number, z: number) =>
      reservations.some((r) => Math.hypot(r.x - x, r.z - z) <= r.radius);
    expect(covered(0, 0)).toBe(true); // the plaza itself
    for (const lot of lots) expect(covered(lot.x, lot.z)).toBe(true);
  });

  it('rings the town with one closed road', () => {
    const { roads } = plan();
    const closed = roads.filter(isClosed);
    expect(closed).toHaveLength(1);
    const ring = closed[0]!;
    expect(ring.width).toBe(TOWN.roads.ring.width);
    expect(ring.points).toHaveLength(TOWN.roads.ring.steps + 1);
    const at = TOWN.roads.ring.at * 650;
    // Every point is nudged off the circle by one draw, and by no more than the
    // wander a street is allowed: a ring laid by eye, not struck with a compass.
    for (const [x, z] of ring.points)
      expect(Math.abs(Math.hypot(x, z) - at)).toBeLessThanOrEqual(TOWN.roads.jitter);
    expect(new Set(ring.points.map(([x]) => x)).size).toBeGreaterThan(1);
  });

  it('is tall in the middle and low at the edge', () => {
    const { lots } = plan({ radius: 900 });
    const mean = (of: LotSpec[]) => of.reduce((sum, l) => sum + l.floors, 0) / of.length;
    const inner = lots.filter((l) => Math.hypot(l.x, l.z) < 900 / 3),
      outer = lots.filter((l) => Math.hypot(l.x, l.z) > (900 * 2) / 3);
    expect(inner.length).toBeGreaterThan(20);
    expect(outer.length).toBeGreaterThan(20);
    expect(mean(inner)).toBeGreaterThan(mean(outer));
  });

  it('asks only for buildings the registry baked, at floors they have', () => {
    // Against the recipes' own declared ranges and not against `TOWN.storeys`:
    // the storeys are what the town is willing to ask for, the recipe's range is
    // what is actually baked, and asking for a storey nobody baked throws inside
    // the site queue rather than shrugging.
    const byId = new Map((createLibrary().structures ?? []).map((s) => [s.id, s]));
    const named = new Set([...Object.keys(TOWN.buildings), TOWN.landmark]);
    const { lots } = plan();
    const kinds = new Set(lots.map((l) => l.structure));
    expect(kinds.has(TOWN.landmark)).toBe(true);
    expect(lots.filter((l) => l.structure === TOWN.landmark)).toHaveLength(1);
    for (const lot of lots) {
      expect(named.has(lot.structure)).toBe(true);
      const spec = byId.get(lot.structure);
      expect(spec).toBeTruthy();
      expect(lot.floors).toBeGreaterThanOrEqual(spec!.floors[0]);
      expect(lot.floors).toBeLessThanOrEqual(spec!.floors[1]);
    }
  });

  it('tints its buildings out of the town palette, and nothing else', () => {
    const { lots } = plan();
    const used = new Set(lots.map((l) => l.tint));
    for (const tint of used) expect(TOWN.palette).toContain(tint);
    expect(used.size).toBeGreaterThan(1);
    // three whites in six: half of a town is exactly what its recipe painted
    const plain = lots.filter((l) => l.tint === 'white').length;
    expect(plain / lots.length).toBeGreaterThan(0.35);
  });

  it('builds the same town on a tilt as on the flat', () => {
    // Nothing in the plan reads the height except through the slope rule, so a
    // tilt the rule accepts must not move a single street.
    expect(plan({}, tilted).roads).toEqual(plan().roads);
    expect(plan({}, tilted).lots).toEqual(plan().lots);
  });

  it('keeps its streets off the hillside', () => {
    // The plateau is a share of the fragment and not a promise, so a wide town
    // reaches past its own feather. There this rule is all there is.
    const open = plan({ radius: 900 });
    expect(open.roads.some((road) => road.points.some(([x]) => x > EDGE))).toBe(true);

    const cut = plan({ radius: 900 }, cliff);
    expect(Math.max(...cut.roads.flatMap((road) => road.points.map(([x]) => x)))).toBeLessThanOrEqual(EDGE);
    // and what the hillside did not take is still a town rather than a stub
    expect(cut.roads.length).toBeGreaterThan(10);
    expect(cut.lots.length).toBeGreaterThan(500);
  });

  it('splits a street at a ridge instead of giving up past it', () => {
    // The far side of a band of steep ground is still the town: a street that
    // stopped dead at the first steep step would end halfway across one.
    const open = plan({ radius: 900 });
    const split = plan({ radius: 900 }, ridge);
    const x = split.roads.flatMap((road) => road.points.map(([at]) => at));
    expect(x.some((at) => at > EDGE + BAND)).toBe(true); // it carried on past
    expect(x.filter((at) => at > EDGE && at < EDGE + BAND)).toHaveLength(0); // but not through
    // one street across the band is two roads, so the cut town has more of them
    expect(split.roads.length).toBeGreaterThan(open.roads.length);
  });
});
