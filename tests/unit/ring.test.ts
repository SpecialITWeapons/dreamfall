import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import {
  defineBiome,
  defineProp,
  defineSpecies,
  type Biome,
  type GroundHook,
  type Library,
  type Prop,
} from '../../library/contract';
import { createHeightfield } from '../../src/engine/terrain/Heightfield';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';
import { createObstacles } from '../../src/engine/scenery/Obstacles';
import { createOverrides, type Override } from '../../src/engine/scenery/Overrides';
import {
  TREE_CELL,
  createRing,
  type PropInstance,
  type SceneryMetrics,
  type ScenerySink,
  type TreeInstance,
} from '../../src/engine/scenery/Ring';

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
};

/** A sink that keeps what the ring offered it, and may be told to fill up. */
const collector = (capacity = Infinity) => {
  const trees: TreeInstance[] = [],
    props: PropInstance[] = [];
  let begun = 0,
    ended = 0;
  const sink: ScenerySink = {
    begin() {
      begun++;
      trees.length = 0;
      props.length = 0;
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
    end() {
      ended++;
    },
  };
  return { sink, trees, props, counts: () => ({ begun, ended }) };
};

/** A ring over the real seed-42 ground, small enough for a test window. */
const ring = (lib: Library, opts: { overrides?: Override[]; maxTrees?: number; radius?: number } = {}) => {
  const sampler = createWorldSampler(42, { biomes: lib.biomes });
  const heightfield = createHeightfield(sampler, { size: 128 });
  heightfield.fillAll(0, 0);
  const obstacles = createObstacles();
  const sink = collector();
  return {
    ...sink,
    obstacles,
    ring: createRing({
      seed: 42,
      library: lib,
      sampler,
      heightfield,
      obstacles,
      overrides: createOverrides(opts.overrides),
      metrics,
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
  it('tints a tree by the climate it stands in and a prop by the biome it stands on', () => {
    const r = ring(library([everywhere('woods', 1, { stones: 1 })], [stones]));
    r.ring.update(0, 0, false);
    for (const tree of r.trees) expect(tree.tint).toBeInstanceOf(Color);
    const rock = new Color(0x7b8a88); // rockCold
    for (const prop of r.props) expect(prop.tint.getHexString()).toBe(rock.getHexString());
  });
});
