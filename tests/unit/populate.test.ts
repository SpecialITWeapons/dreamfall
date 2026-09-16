import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import type { Cell, Fields, SceneryKit } from '../../library/contract';
import { CELL_TREES, scatter } from '../../library/standard/populate.js';
import { resolvePopulate } from '../../library/standard/index.js';
import { snowLineAt } from '../../library/standard/snowLine.js';

/** A stream with no surprises in it: the same numbers in the same order, per test. */
const rolls = (seed = 1) => {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
};

const fields = (over: Partial<Fields> = {}): Fields =>
  ({
    x: 48,
    z: 48,
    cont: 0.5,
    temp: 0.5,
    baseTemp: 0.1,
    moist: 0.5,
    region: 0.5,
    baseHeight: 100,
    shore: 0,
    hash: () => 0.5,
    // 0.3 lands at the far end of the grove ramp, so a grove is exactly six
    noise: () => 0.3,
    lattice: () => ({ cx: 0, cz: 0, d: 0, u: () => 0.5 }),
    ...over,
  }) as Fields;

const cell = (over: Partial<Cell> = {}): Cell =>
  ({
    size: 96,
    corner: { x: 0, z: 0 },
    center: { x: 48, z: 48 },
    share: 1,
    weight: () => 1,
    fields: fields(),
    mix: () => 0,
    blend: () => new Color(),
    height: () => 100,
    slope: () => 0,
    land: () => true,
    roll: rolls(),
    occupied: () => false,
    ...over,
  }) as Cell;

interface Sown {
  id: string;
  x: number;
  z: number;
  yaw?: number;
}
const sink = () => {
  const trees: Sown[] = [];
  const kit = {
    tree: (id: string, x: number, z: number, opts?: { yaw?: number }) =>
      trees.push({ id, x, z, yaw: opts?.yaw }),
    prop: () => {},
    structure: () => {},
    color: (v: string | number) => new Color(v as number),
  } as unknown as SceneryKit;
  return { trees, kit };
};

/** Sow one cell and hand back what stands in it. */
const sow = (spec: Parameters<typeof scatter>[0], over: Partial<Cell> = {}) => {
  const { trees, kit } = sink();
  scatter(spec)(cell(over), kit);
  return trees;
};

const oaks = { species: { oak: 1 }, density: 0.5 };

describe('scatter', () => {
  it('sows nothing where the biome asks for nothing, and nothing at sea', () => {
    expect(sow({ species: { oak: 1 }, density: 0 })).toEqual([]);
    expect(sow({ species: {}, density: 5 })).toEqual([]);
    expect(sow(oaks, { share: 0 })).toEqual([]);
    expect(sow(oaks, { height: () => 1 })).toEqual([]);
  });
  it('turns density, the biome share and the grove noise into a count, capped per cell', () => {
    // grove 6 at this noise, so density 0.5 is three trees and density 10 is still three
    expect(sow(oaks)).toHaveLength(3);
    expect(sow({ species: { oak: 1 }, density: 10 })).toHaveLength(CELL_TREES);
    expect(CELL_TREES).toBe(3);
    // a biome that owns a quarter of the cell sows a quarter of what it would
    expect(sow(oaks, { share: 0.25 })).toHaveLength(0);
    expect(sow({ species: { oak: 1 }, density: 2 }, { share: 0.25 })).toHaveLength(3);
    // and an open grove is thinner than a thick one
    expect(sow(oaks, { fields: fields({ noise: () => -1 }) })).toHaveLength(1);
  });
  it('stops at the tree line, and thins out through the last hundred metres below it', () => {
    const line = snowLineAt(0.1) + 60;
    expect(sow(oaks, { height: () => line + 1 })).toEqual([]);
    const thinning = sow(oaks, { height: () => line - 60 }).length;
    expect(thinning).toBeGreaterThan(0);
    expect(thinning).toBeLessThan(sow(oaks, { height: () => line - 200 }).length);
    // a warmer climate carries the trees higher, because the snow line is higher
    expect(sow(oaks, { height: () => line + 1, fields: fields({ baseTemp: 0.9 }) }).length).toBeGreaterThan(
      0,
    );
  });
  it('leaves water, steep ground and reserved ground alone', () => {
    expect(sow(oaks, { height: (x) => (x === 48 ? 100 : 2) })).toEqual([]);
    expect(sow(oaks, { slope: () => 0.9 })).toEqual([]);
    expect(sow(oaks, { occupied: () => true })).toEqual([]);
  });
  it('draws its stream in the same order whatever the ground says, so terrain never reshuffles a cell', () => {
    // one cell where nothing may stand, one where everything may: the trees that
    // do stand are in the same places either way
    const open = sow({ species: { oak: 1 }, density: 10 });
    const partly = sow(
      { species: { oak: 1 }, density: 10 },
      { slope: (_x: number, z: number) => (z > 48 ? 0.9 : 0) },
    );
    for (const tree of partly) expect(open).toContainEqual(tree);
  });
  it('picks species in the proportion the biome asked for', () => {
    const counts: Record<string, number> = { oak: 0, pine: 0 };
    for (let seed = 1; seed <= 400; seed++)
      for (const tree of sow({ species: { oak: 3, pine: 1 }, density: 10 }, { roll: rolls(seed) }))
        counts[tree.id] = (counts[tree.id] ?? 0) + 1;
    const share = counts.oak! / (counts.oak! + counts.pine!);
    expect(share).toBeGreaterThan(0.7);
    expect(share).toBeLessThan(0.8);
  });
  it('stands each tree inside its own cell, turned by its own roll', () => {
    for (const tree of sow({ species: { oak: 1 }, density: 10 })) {
      expect(tree.x).toBeGreaterThanOrEqual(0);
      expect(tree.x).toBeLessThan(96);
      expect(tree.z).toBeGreaterThanOrEqual(0);
      expect(tree.z).toBeLessThan(96);
      expect(tree.yaw).toBeGreaterThanOrEqual(0);
      expect(tree.yaw).toBeLessThan(Math.PI * 2);
    }
  });
});

describe('resolvePopulate', () => {
  it('passes a hook of code through, with no data behind it', () => {
    const hook = () => {};
    expect(resolvePopulate(hook)).toEqual({ hook, scatter: null });
  });
  it('builds the descriptor and keeps it, because the grass and the props are read from it', () => {
    const spec = {
      type: 'scatter' as const,
      species: { oak: 1 },
      density: 0.5,
      props: { boulders: 0.3 },
      grass: { tint: 'grassCool', density: 0.5 },
    };
    const resolved = resolvePopulate(spec);
    expect(resolved.scatter).toBe(spec);
    const { trees, kit } = sink();
    resolved.hook(cell(), kit);
    expect(trees).toHaveLength(3);
  });
  it('names an unknown type instead of sowing nothing and saying nothing', () => {
    expect(() => resolvePopulate({ type: 'sprinkle' } as never)).toThrow(/unknown hook type "sprinkle"/);
  });
});
