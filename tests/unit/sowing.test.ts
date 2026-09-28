import { describe, expect, it } from 'vitest';
import { createLibrary } from '../../library/index.js';
import { CELL_TREES } from '../../library/standard/index.js';
import { createSowing, type TreeInstance } from '../../src/engine/scenery/Sowing';
import { createHeightfield } from '../../src/engine/terrain/Heightfield';
import { createSampledGround, type GroundQuery } from '../../src/engine/terrain/SampledGround';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';

const lib = createLibrary();
const sampler = createWorldSampler(42, { biomes: lib.biomes });
const SIZE = 96;

/** Sows cells ix0..ix0+n-1 of one row over a ground and says what stood, cell by cell. */
const sowRow = (
  ground: GroundQuery,
  iz: number,
  ix0: number,
  n: number,
  opts: { admit?: (id: string) => boolean } = {},
) => {
  const out: Array<{ ix: number; trees: TreeInstance[] } | { ix: number; sea: true }> = [];
  let current: TreeInstance[] = [];
  const sowing = createSowing({
    seed: 42,
    library: lib,
    sampler,
    ground,
    size: SIZE,
    occupied: () => false,
    admit: opts.admit ?? (() => true),
    baked: () => true,
    emit: (tree) => {
      current.push({ ...tree, tint: tree.tint.clone() });
      return true;
    },
  });
  for (let ix = ix0; ix < ix0 + n; ix++) {
    if (!sowing.enter(ix, iz)) {
      out.push({ ix, sea: true });
      continue;
    }
    current = [];
    sowing.sowTrees();
    out.push({ ix, trees: current });
  }
  return out;
};

describe('Sowing', () => {
  it('sows the same trees over the near window and over the sampled ground', () => {
    const hf = createHeightfield(sampler, { size: 128 });
    hf.fillAll(0, 0);
    // cells -8..7 of rows -2..1: well inside the window's ±1 km
    for (const iz of [-2, -1, 0, 1])
      expect(sowRow(createSampledGround(sampler), iz, -8, 16)).toEqual(sowRow(hf, iz, -8, 16));
  });

  it('puts up at most CELL_TREES in a cell, and something somewhere', () => {
    const ground = createSampledGround(sampler);
    let total = 0;
    for (const iz of [-3, 0, 3])
      for (const cell of sowRow(ground, iz, -20, 40))
        if ('trees' in cell) {
          expect(cell.trees.length).toBeLessThanOrEqual(CELL_TREES);
          total += cell.trees.length;
        }
    expect(total).toBeGreaterThan(0);
  });

  it('draws nothing for a tree it is not admitted to put up', () => {
    const ground = createSampledGround(sampler);
    const all = sowRow(ground, 0, -20, 40);
    // Refuse one species everywhere: every other tree stands exactly where it did,
    // because the refusal comes before any roll is drawn.
    const refused = all.flatMap((c) => ('trees' in c ? c.trees : []))[0]!.species;
    const without = sowRow(ground, 0, -20, 40, { admit: (id) => id !== refused });
    const keep = (cells: typeof all) =>
      cells.flatMap((c) => ('trees' in c ? c.trees.filter((t) => t.species !== refused) : []));
    expect(keep(without)).toEqual(keep(all));
  });

  it('does not count a refused tree toward its cell', () => {
    // Mixed country, where two or three biomes share a cell and between them
    // offer more trees than CELL_TREES. The first tree of every cell is refused
    // after its rolls are drawn; the cell must still fill to CELL_TREES where
    // it has the offers to, or a full pool thins every wood it touches.
    const ground = createSampledGround(sampler);
    let offered = 0,
      stood = 0,
      fullAfterRefusal = 0;
    const sowing = createSowing({
      seed: 42,
      library: lib,
      sampler,
      ground,
      size: SIZE,
      occupied: () => false,
      admit: () => true,
      baked: () => true,
      emit: () => {
        offered++;
        if (offered === 1) return false;
        stood++;
        return true;
      },
    });
    const gx = Math.floor(-30000 / SIZE),
      gz = Math.floor(25000 / SIZE);
    for (let iz = gz - 12; iz < gz + 12; iz++)
      for (let ix = gx - 12; ix < gx + 12; ix++) {
        if (!sowing.enter(ix, iz)) continue;
        offered = stood = 0;
        sowing.sowTrees();
        expect(stood).toBeLessThanOrEqual(CELL_TREES);
        if (offered > 0 && stood === CELL_TREES) fullAfterRefusal++;
      }
    expect(fullAfterRefusal).toBeGreaterThan(0);
  });

  it('stands a lone tree of its own size and climate, and leaves the next cell as it was', () => {
    const hf = createHeightfield(sampler, { size: 128 });
    hf.fillAll(0, 0);
    const plain = sowRow(hf, 0, -8, 16);
    // the same row, with a tree stood alone between every two cells
    const out: string[] = [];
    let stood: TreeInstance | null = null;
    const sowing = createSowing({
      seed: 42,
      library: lib,
      sampler,
      ground: hf,
      size: SIZE,
      occupied: () => false,
      admit: () => true,
      baked: () => true,
      emit: (tree) => {
        out.push(`${tree.species} ${tree.x} ${tree.z} ${tree.tint.getHexString()}`);
        return true;
      },
    });
    for (let ix = -8; ix < 8; ix++) {
      if (sowing.enter(ix, 0)) sowing.sowTrees();
      let n = 0;
      stood = sowing.stand('oak', 30 + ix, 40, 1.5, () => (n++ % 2 ? 0.25 : 0.75));
    }
    const expected = plain
      .flatMap((c) => ('trees' in c ? c.trees : []))
      .map((t) => `${t.species} ${t.x} ${t.z} ${t.tint.getHexString()}`);
    expect(out).toEqual(expected);
    const oak = lib.species!.find((s) => s.id === 'oak')!;
    expect(stood!.yaw).toBe(1.5);
    expect(stood!.scale).toBeCloseTo(oak.scale[0] + 0.75 * (oak.scale[1] - oak.scale[0]), 9);
    expect(stood!.y).toBe(hf.heightAt(37, 40));
    expect(sowing.stand('baobab', 0, 0, 0, () => 0.5)).toBeNull();
  });

  it('says a cell over the sea is not sown', () => {
    const ground = createSampledGround(sampler);
    // Walk out along a row until the centre of a cell is under LAND; seed 42 has sea within 40 km of the origin.
    let found = false;
    for (let ix = 0; ix < 400 && !found; ix++) {
      const [cell] = sowRow(ground, 0, ix, 1);
      found = 'sea' in cell!;
    }
    expect(found).toBe(true);
  });
});
