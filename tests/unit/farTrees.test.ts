import { describe, expect, it } from 'vitest';
import type { SitePlan } from '../../library/contract';
import { createLibrary } from '../../library/index.js';
import { createClaims } from '../../src/engine/scenery/Claims';
import { createFarTrees, type FarTree } from '../../src/engine/scenery/FarTrees';
import { createObstacles } from '../../src/engine/scenery/Obstacles';
import { createOverrides } from '../../src/engine/scenery/Overrides';
import { TREE_CELL, createRing, type ScenerySink } from '../../src/engine/scenery/Ring';
import { createHeightfield } from '../../src/engine/terrain/Heightfield';
import { createSampledGround } from '../../src/engine/terrain/SampledGround';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';

const lib = createLibrary();
const sampler = createWorldSampler(42, { biomes: lib.biomes });
// The woods of seed 42: every cell grows something, so a missing cell shows.
const AT = { x: -48000, z: -42000 };
const window = createHeightfield(sampler, { size: 256 });
window.fillAll(Math.round(AT.x / 16), Math.round(AT.z / 16));

const rowOf = (t: { species: string; x: number; z: number }) =>
  `${t.species} ${t.x.toFixed(3)} ${t.z.toFixed(3)}`;
const rowsOf = (far: { forEach(fn: (t: FarTree) => void): void }) => {
  const rows: string[] = [];
  far.forEach((t) => rows.push(rowOf(t)));
  return rows.sort();
};
const far = (opts: {
  inner: number;
  radius: number;
  now?: () => number;
  claims?: ReturnType<typeof createClaims>;
}) =>
  createFarTrees({
    seed: 42,
    library: lib,
    sampler,
    ground: createSampledGround(sampler, window),
    baked: () => true,
    ...opts,
  });
/** What the ring itself puts up from the same place, out to `radius`. */
const ringRows = (radius: number) => {
  const rows: string[] = [];
  const sink: ScenerySink = {
    begin() {
      rows.length = 0;
    },
    tree(t) {
      rows.push(rowOf(t));
      return true;
    },
    prop: () => true,
    structure: () => true,
    site() {},
    end() {},
  };
  createRing({
    seed: 42,
    library: lib,
    sampler,
    heightfield: window,
    obstacles: createObstacles(),
    overrides: createOverrides(),
    metrics: { species: () => ({ top: 12, radius: 4 }), prop: () => null, structure: () => null },
    sink,
    propKit: { sstep: () => 0 } as never,
    radius,
    maxTrees: 1e9,
  }).update(AT.x, AT.z, true);
  return rows.sort();
};

describe('FarTrees', () => {
  it('holds exactly the trees the ring would past its own reach, and none of the ring’s', () => {
    const f = far({ inner: 600, radius: 1500 });
    f.update(AT.x, AT.z);
    f.work(Infinity);
    const inner = ringRows(600),
      outer = rowsOf(f),
      whole = ringRows(1500);
    expect(outer.length).toBeGreaterThan(100);
    expect(outer.filter((row) => inner.includes(row))).toEqual([]);
    expect([...inner, ...outer].sort()).toEqual(whole);
  });

  it('grows the same wood whichever way the flight came', () => {
    const b = { x: AT.x + 700, z: AT.z - 400 };
    const travelled = far({ inner: 500, radius: 1200 });
    travelled.update(AT.x, AT.z);
    travelled.work(Infinity);
    travelled.update(b.x, b.z);
    travelled.work(Infinity);
    const fresh = far({ inner: 500, radius: 1200 });
    fresh.update(b.x, b.z);
    fresh.work(Infinity);
    expect(rowsOf(travelled)).toEqual(rowsOf(fresh));
  });

  it('sows the nearest cells first and stops on its budget before a cell', () => {
    let t = 0;
    const f = far({ inner: 600, radius: 1500, now: () => ++t });
    f.update(AT.x, AT.z);
    const total = f.queued;
    f.work(2);
    expect(f.cells).toBeGreaterThanOrEqual(1);
    expect(f.cells).toBeLessThanOrEqual(3);
    expect(f.queued).toBe(total - f.cells);
    f.forEach((tree) => expect(Math.hypot(tree.x - AT.x, tree.z - AT.z)).toBeLessThan(600 + 3 * TREE_CELL));
  });

  it('forgets the old land at once after a jump', () => {
    const f = far({ inner: 600, radius: 1500 });
    f.update(AT.x, AT.z);
    f.work(Infinity);
    expect(f.trees).toBeGreaterThan(0);
    const before = f.version;
    f.update(AT.x + 50_000, AT.z);
    expect(f.cells).toBe(0);
    expect(f.trees).toBe(0);
    expect(f.queued).toBeGreaterThan(0);
    expect(f.version).toBeGreaterThan(before);
  });

  it('keeps a cell standing until it is sown again, and sows again only the cells a road touches', () => {
    const claims = createClaims();
    const f = far({ inner: 600, radius: 1500, claims });
    f.update(AT.x, AT.z);
    f.work(Infinity);
    const before = f.trees,
      version = f.version;
    // a road straight through the far land, from one side of it to the other
    const road = Array.from(
      { length: 61 },
      (_, i) => [AT.x - 1500 + i * 50, AT.z + 1000] as [number, number],
    );
    claims.addRoute('a|b', road, 5);
    f.update(AT.x, AT.z);
    // nothing has gone yet: the cards stand until their cells are sown again
    expect(f.trees).toBe(before);
    expect(f.version).toBe(version);
    // and only the corridor's cells are queued, not the road's whole box
    expect(f.queued).toBeGreaterThan(0);
    expect(f.queued).toBeLessThanOrEqual(3 * (3000 / 96 + 2));
    f.work(Infinity);
    const onRoad: string[] = [];
    f.forEach((t) => {
      if (Math.abs(t.z - (AT.z + 1000)) < 2.5 + 5 && Math.abs(t.x - AT.x) < 1500) onRoad.push(rowOf(t));
    });
    expect(onRoad).toEqual([]);
  });

  it('grows the same wood whether a road came and went or never came', () => {
    const claims = createClaims();
    const f = far({ inner: 600, radius: 1500, claims });
    f.update(AT.x, AT.z);
    f.work(Infinity);
    const untouched = rowsOf(f);
    const road = Array.from(
      { length: 61 },
      (_, i) => [AT.x - 1500 + i * 50, AT.z + 1000] as [number, number],
    );
    claims.addRoute('a|b', road, 5);
    f.update(AT.x, AT.z);
    f.work(Infinity);
    expect(rowsOf(f)).not.toEqual(untouched);
    claims.clear();
    f.update(AT.x, AT.z);
    f.work(Infinity);
    expect(rowsOf(f)).toEqual(untouched);
  });

  it('sows again the cells a plan arrives over', () => {
    const claims = createClaims();
    const f = far({ inner: 600, radius: 1500, claims });
    f.update(AT.x, AT.z);
    f.work(Infinity);
    let target: FarTree | null = null;
    f.forEach((tree) => {
      target ??= tree;
    });
    const tree = target as FarTree | null;
    expect(tree).not.toBeNull();
    const plan: SitePlan = {
      id: 'village:test',
      x: tree!.x,
      z: tree!.z,
      radius: 40,
      roads: [],
      lines: [],
      lots: [{ x: tree!.x, z: tree!.z, yaw: 0, structure: 'house', floors: 1 }],
      reservations: [],
    };
    claims.add(plan, { building: () => ({ radius: 20 }) });
    f.update(AT.x, AT.z);
    f.work(Infinity);
    expect(rowsOf(f)).not.toContain(rowOf(tree!));
  });
});
