import { describe, expect, it } from 'vitest';
import type { SitePlan } from '../../library/contract';
import {
  chunksOf,
  createRoads,
  stretchOf,
  type RoadRoute,
  type RouteRunner,
} from '../../src/engine/scenery/Roads';
import type { Site, Sites } from '../../src/engine/scenery/Sites';

const site = (id: string, x: number, z: number, radius = 200): Site => ({
  id,
  biome: 'village',
  x,
  z,
  radius,
  yaw: 0,
  fields: {} as Site['fields'],
  random: () => 0.5,
});

/** Sites that are exactly these places, charted wherever asked. */
const fixed = (places: Site[]): Sites =>
  ({
    charted: (x: number, z: number, reach: number, out: Site[]) => {
      out.length = 0;
      out.push(...places.filter((p) => Math.hypot(p.x - x, p.z - z) <= reach));
      return out;
    },
  }) as unknown as Sites;

/** A runner that answers at once with the straight line, and counts what it was asked. */
const straight =
  (asked: string[]): RouteRunner =>
  (job, done) => {
    asked.push(job.id);
    done([
      [job.a.x, job.a.z],
      [job.b.x, job.b.z],
    ]);
    return () => {};
  };

describe('createRoads', () => {
  const places = [site('village:0,0', 0, 0), site('village:1,0', 6000, 0), site('village:2,0', 12000, 0)];

  it('asks for the roads near the flight, once each, and hands them out', () => {
    const asked: string[] = [];
    const roads = createRoads({ seed: 42, sites: fixed(places), run: straight(asked) });
    roads.update(0, 0);
    // the far pair's line is 6 km off: out of reach until the flight moves on
    expect(asked).toEqual(['village:0,0|village:1,0']);
    // too short a move to look again, then far enough
    roads.update(10, 10);
    roads.update(2000, 0);
    expect(asked).toEqual(['village:0,0|village:1,0', 'village:1,0|village:2,0']);
    expect(roads.built).toBe(2);
    expect(roads.version).toBe(2);
    const near = roads.near(0, 0, 2600, []);
    expect(near.map((r) => r.id)).toEqual(['village:0,0|village:1,0']);
    expect(near[0]!.a.id).toBe('village:0,0');
  });

  it('counts a pair with no land way between as refused, and does not ask again', () => {
    const asked: string[] = [];
    const never: RouteRunner = (job, done) => {
      asked.push(job.id);
      done(null);
      return () => {};
    };
    const roads = createRoads({ seed: 42, sites: fixed(places.slice(0, 2)), run: never });
    roads.update(0, 0);
    roads.update(2000, 0);
    expect(asked).toHaveLength(1);
    expect(roads.refused).toBe(1);
    expect(roads.near(0, 0, 2600, [])).toEqual([]);
  });

  it('asks one route at a time, nearest first, while the worker is busy', () => {
    const jobs: Array<{ id: string; done: (points: Array<[number, number]> | null) => void }> = [];
    const later: RouteRunner = (job, done) => {
      jobs.push({ id: job.id, done });
      return () => {};
    };
    const roads = createRoads({ seed: 42, sites: fixed(places), run: later });
    roads.update(11000, 0);
    expect(jobs.map((j) => j.id)).toEqual(['village:1,0|village:2,0']);
    expect(roads.queued).toBe(2);
    jobs[0]!.done([
      [6000, 0],
      [12000, 0],
    ]);
    expect(jobs.map((j) => j.id)).toEqual(['village:1,0|village:2,0', 'village:0,0|village:1,0']);
    expect(roads.version).toBe(1);
  });
});

describe('stretchOf', () => {
  const a = site('village:0,0', 0, 0, 200),
    b = site('village:1,0', 6000, 0, 200);
  const route: RoadRoute = {
    id: 'village:0,0|village:1,0',
    a,
    b,
    points: Array.from({ length: 251 }, (_, i) => [i * 24, 0] as [number, number]),
  };
  const plan = (at: Site, street: Array<[number, number]>): SitePlan => ({
    id: at.id,
    x: at.x,
    z: at.z,
    radius: at.radius,
    roads: [{ points: street, width: 6 }],
    lines: [],
    lots: [],
    reservations: [],
  });

  it('stops at the edge of a settlement whose plan is not built yet', () => {
    const drawn = stretchOf(route, null, null);
    expect(drawn[0]![0]).toBeGreaterThanOrEqual(a.radius);
    expect(drawn[0]![0]).toBeLessThan(a.radius + 24);
    expect(drawn.at(-1)![0]).toBeLessThanOrEqual(b.x - b.radius);
    expect(drawn.at(-1)![0]).toBeGreaterThan(b.x - b.radius - 24);
  });

  it('runs into the street once the plan is there, and ends on it', () => {
    // a street crossing the approach 120 m out from the centre
    const street: Array<[number, number]> = [
      [120, -150],
      [120, 150],
    ];
    const drawn = stretchOf(route, plan(a, street), null);
    expect(drawn[0]![0]).toBeCloseTo(120, 0);
    expect(Math.abs(drawn[0]![1])).toBeLessThan(1);
  });
});

describe('chunksOf', () => {
  it('cuts a road into pieces of about a kilometre that share their seams', () => {
    const points = Array.from({ length: 200 }, (_, i) => [i * 24, 0] as [number, number]);
    const chunks = chunksOf(points, 1000);
    expect(chunks.length).toBe(5);
    for (let k = 1; k < chunks.length; k++) expect(chunks[k]![0]).toEqual(chunks[k - 1]!.at(-1));
    expect(chunks.flat().length).toBe(points.length + chunks.length - 1);
  });
});
