import { describe, expect, it } from 'vitest';
import type { SceneryColor } from '../../library/contract';
import type { LineSpec, LotSpec, RoadSpec, Reservation, Site, SiteKit } from '../../library/contract';
import { createLibrary } from '../../library/index.js';
import { VILLAGE } from '../../library/settlements/village.js';
import { planVillage } from '../../library/settlements/plan.js';

/** A hillside with a steady fall to the east, so a contour has a direction to follow. */
const hillside = (x: number, z: number) => 200 - x * 0.04 + Math.sin(z / 300) * 6;

/** A site of seed 42's kind, without a world: the plan only ever asks the kit. */
const site = (over: Partial<Site> = {}): Site => {
  let n = 0;
  return {
    id: 'village:1,2',
    x: 0,
    z: 0,
    radius: 200,
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

const collect = (ground = hillside) => {
  const roads: RoadSpec[] = [],
    lots: LotSpec[] = [],
    lines: LineSpec[] = [],
    reservations: Reservation[] = [];
  const kit = {
    height: ground,
    slope: (x: number, z: number) => Math.abs(ground(x + 1, z) - ground(x - 1, z)) / 2,
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

const plan = (over: Partial<Site> = {}, ground = hillside, params = VILLAGE) => {
  const out = collect(ground);
  planVillage(site(over), params, out.kit);
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

describe('planVillage', () => {
  it('lays a village the same way twice', () => {
    const a = plan(),
      b = plan();
    expect(b.lots).toEqual(a.lots);
    expect(b.roads).toEqual(a.roads);
    expect(b.reservations).toEqual(a.reservations);
  });
  it('builds a village of the size the spec asks for', () => {
    const { lots, roads } = plan();
    expect(lots.length).toBeGreaterThanOrEqual(30);
    expect(lots.length).toBeLessThanOrEqual(150);
    expect(roads.length).toBeGreaterThan(1); // a main street and its side paths
    for (const road of roads) expect(road.points.length).toBeGreaterThanOrEqual(2);
  });
  it('is smaller when the site is smaller', () => {
    expect(plan({ radius: 120 }).lots.length).toBeLessThan(plan({ radius: 250 }).lots.length);
  });
  it('runs its main street along the contour, not up the hill', () => {
    const { roads } = plan();
    const main = roads[0]!;
    const head = main.points[0]!,
      tail = main.points[main.points.length - 1]!;
    // the hillside falls to the east, so a street along the contour keeps its height
    const fall = Math.abs(hillside(head[0], head[1]) - hillside(tail[0], tail[1]));
    const across = Math.abs(hillside(0, 0) - hillside(200, 0));
    expect(fall).toBeLessThan(across / 3);
  });
  it('stands every house out of the road and still on one', () => {
    const { lots, roads } = plan();
    for (const lot of lots) {
      // Out of the road: measured against each road's own half width, not
      // against the setback. A house fronts the street it belongs to at exactly
      // the setback, and a side path crossing nearby can pass closer than that
      // by a few centimetres -- which is a junction, not a house in the road.
      for (const road of roads) expect(toRoad(road, lot.x, lot.z)).toBeGreaterThan(road.width / 2 + 1);
      // and on one: it fronts a street rather than standing in a field
      const nearest = Math.min(...roads.map((road) => toRoad(road, lot.x, lot.z)));
      expect(nearest).toBeLessThan(VILLAGE.lots.setback + VILLAGE.lots.depth * 2);
    }
    for (let i = 0; i < lots.length; i++)
      for (let j = i + 1; j < lots.length; j++)
        expect(Math.hypot(lots[i]!.x - lots[j]!.x, lots[i]!.z - lots[j]!.z)).toBeGreaterThan(
          VILLAGE.lots.depth * 0.6,
        );
  });
  it('speaks for the ground it built on: every house is inside a reservation', () => {
    const { lots, reservations } = plan();
    for (const lot of lots) {
      const covered = reservations.some((r) => Math.hypot(r.x - lot.x, r.z - lot.z) <= r.radius);
      expect(covered).toBe(true);
    }
  });
  it('asks only for buildings the registry baked, at floors they have', () => {
    const structures = createLibrary().structures ?? [];
    const byId = new Map(structures.map((s) => [s.id, s]));
    for (const lot of plan().lots) {
      const spec = byId.get(lot.structure);
      expect(spec).toBeTruthy();
      expect(lot.floors).toBeGreaterThanOrEqual(spec!.floors[0]);
      expect(lot.floors).toBeLessThanOrEqual(spec!.floors[1]);
    }
  });
  it('tints its houses out of the settlement palette, and nothing else', () => {
    // A tint multiplies what the recipe painted, so this is what lets a town
    // and a village be built out of the same three recipes and not look it --
    // no second bake, no second pool, one instance colour.
    const { lots } = plan();
    expect(lots.length).toBeGreaterThan(20);
    const used = new Set(lots.map((l) => l.tint));
    for (const tint of used) expect(VILLAGE.palette).toContain(tint);
    expect(used.size).toBeGreaterThan(1);
    // white is in the palette twice, so a house left exactly as its recipe
    // painted it is the commonest kind
    const plain = lots.filter((l) => l.tint === 'white').length;
    expect(plain / lots.length).toBeGreaterThan(0.25);

    // A palette of one is a settlement whose houses are all their own recipe.
    const one = plan({}, hillside, { ...VILLAGE, palette: ['white'] });
    expect(new Set(one.lots.map((l) => l.tint))).toEqual(new Set(['white']));
    // and a different palette is a different-looking settlement on the same plan
    const other = plan({}, hillside, { ...VILLAGE, palette: ['barkDark'] });
    expect(other.lots.map((l) => [l.x, l.z])).toEqual(one.lots.map((l) => [l.x, l.z]));
    expect(new Set(other.lots.map((l) => l.tint))).toEqual(new Set(['barkDark']));
  });
  it('keeps the village inside its own radius', () => {
    const one = site();
    for (const lot of plan().lots)
      expect(Math.hypot(lot.x - one.x, lot.z - one.z)).toBeLessThanOrEqual(one.radius);
  });
  it('hedges an orchard or two on the fringe, and nowhere near the houses', () => {
    const one = site();
    const { lines, lots } = plan();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(VILLAGE.orchards.tries);
    const [ow, oh] = VILLAGE.orchards.size;
    for (const hedge of lines) {
      expect(hedge.kind).toBe('hedge');
      // a closed plot: five points, the last one back at the first
      expect(hedge.points).toHaveLength(5);
      expect(hedge.points[4]).toEqual(hedge.points[0]);
      const xs = hedge.points.map((p) => p[0]),
        zs = hedge.points.map((p) => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2,
        cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      // out on the fringe, in the band the parameters name
      const out = Math.hypot(cx - one.x, cz - one.z) / one.radius;
      expect(out).toBeGreaterThanOrEqual(VILLAGE.orchards.band[0] - 1e-9);
      expect(out).toBeLessThanOrEqual(VILLAGE.orchards.band[1] + 1e-9);
      // the right size, whichever way the site's yaw turned it
      const a = Math.hypot(
          hedge.points[1]![0] - hedge.points[0]![0],
          hedge.points[1]![1] - hedge.points[0]![1],
        ),
        b = Math.hypot(hedge.points[2]![0] - hedge.points[1]![0], hedge.points[2]![1] - hedge.points[1]![1]);
      expect(a).toBeCloseTo(ow, 6);
      expect(b).toBeCloseTo(oh, 6);
      // and never over a house
      for (const lot of lots)
        expect(Math.hypot(lot.x - cx, lot.z - cz)).toBeGreaterThanOrEqual(Math.max(ow, oh) * 0.8);
    }
  });
  it('drew them last, so growing hedges moved not one house', () => {
    const bare = plan({}, hillside, { ...VILLAGE, orchards: undefined as never });
    const hedged = plan();
    expect(bare.lines).toHaveLength(0);
    expect(hedged.lots).toEqual(bare.lots);
    expect(hedged.roads).toEqual(bare.roads);
    expect(hedged.reservations).toEqual(bare.reservations);
  });
});
