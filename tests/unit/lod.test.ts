import { describe, expect, it } from 'vitest';
import { N, createHeightfield } from '../../src/engine/terrain/Heightfield';
import {
  FAR_CELL,
  FAR_CELLS,
  FAR_WINDOW,
  HOLE,
  MORPH,
  NEAR_CELLS,
  NEAR_REACH,
  anchorOf,
  gridIndices,
  morphWeight,
} from '../../src/engine/terrain/Lod';
import { CELL, createWorldSampler } from '../../src/engine/terrain/WorldSampler';

describe('the far window', () => {
  it('is the near one read every fourth cell: the same samples to the bit', () => {
    const sampler = createWorldSampler(42);
    const near = createHeightfield(sampler, { size: 96 });
    const far = createHeightfield(sampler, { cell: FAR_CELL, size: 24 });
    near.fillAll(0, 0);
    far.fillAll(0, 0);
    const step = FAR_CELL / CELL;
    for (let j = -10; j < 10; j++)
      for (let i = -10; i < 10; i++)
        for (let c = 0; c < 4; c++) expect(far.texel(i, j, c)).toBe(near.texel(i * step, j * step, c));
  });

  it('holds both grids with their normals wherever the flight goes', () => {
    // The near window follows the flyer in 16 m cells and the grids in 64 m
    // anchors, so the grid can stand two cells off the window's middle.
    for (let k = 0; k < 400; k++) {
      const x = k * 23.7 - 4000,
        z = -k * 41.3 + 900;
      const nearMiddle = { x: Math.round(x / CELL), z: Math.round(z / CELL) };
      const farMiddle = { x: Math.round(x / FAR_CELL), z: Math.round(z / FAR_CELL) };
      const a = { x: anchorOf(x) / CELL, z: anchorOf(z) / CELL };
      for (const axis of ['x', 'z'] as const) {
        expect(Math.abs(a[axis] - nearMiddle[axis]) + NEAR_CELLS / 2 + 1).toBeLessThanOrEqual(N / 2 - 1);
        expect(a[axis] / (FAR_CELL / CELL)).toBe(farMiddle[axis]);
      }
      expect(FAR_CELLS / 2 + 1).toBeLessThanOrEqual(FAR_WINDOW / 2 - 1);
    }
  });
});

describe('anchorOf', () => {
  it('snaps to the far cell, so the near grid always ends on a far grid line', () => {
    for (const v of [-7777.7, -64, -31.9, 0, 31.9, 32.1, 5000]) {
      const a = anchorOf(v);
      expect(a % FAR_CELL === 0).toBe(true);
      expect(Math.abs(a - v)).toBeLessThanOrEqual(FAR_CELL / 2);
      expect((a + NEAR_REACH) % FAR_CELL === 0).toBe(true);
    }
    expect(NEAR_REACH).toBe((NEAR_CELLS * CELL) / 2);
    expect(HOLE * FAR_CELL).toBe(NEAR_REACH);
  });
});

describe('morphWeight', () => {
  it('is the near grid inside, the far one on the edge, and eases between', () => {
    expect(morphWeight(0, 0)).toBe(0);
    expect(morphWeight(NEAR_REACH - MORPH, 0)).toBe(0);
    expect(morphWeight(0, -NEAR_REACH)).toBe(1);
    expect(morphWeight(NEAR_REACH, NEAR_REACH)).toBe(1);
    const mid = morphWeight(NEAR_REACH - MORPH / 2, 100);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });
});

describe('gridIndices', () => {
  it('without a hole is the whole grid, with the diagonal buildGrid always had', () => {
    const idx = gridIndices(4);
    expect(idx.length).toBe(4 * 4 * 6);
    // cell (0,0): vertex, vertex + side, vertex + 1, vertex + side + 1, vertex + 1, vertex + side
    expect(Array.from(idx.slice(0, 6))).toEqual([0, 5, 1, 6, 1, 5]);
  });

  it('leaves out exactly the middle square the near grid covers', () => {
    const cells = FAR_CELLS,
      side = cells + 1;
    const idx = gridIndices(cells, HOLE);
    expect(idx.length / 3).toBe((cells * cells - 4 * HOLE * HOLE) * 2);
    const lo = cells / 2 - HOLE,
      hi = cells / 2 + HOLE;
    const edge = new Set<number>();
    for (let t = 0; t < idx.length; t += 3) {
      const xs = [0, 1, 2].map((k) => idx[t + k]! % side),
        zs = [0, 1, 2].map((k) => Math.floor(idx[t + k]! / side));
      const cx = Math.min(...xs),
        cz = Math.min(...zs);
      // no triangle of a cell inside the hole
      expect(cx >= lo && cx < hi && cz >= lo && cz < hi).toBe(false);
      for (let k = 0; k < 3; k++) {
        const x = xs[k]!,
          z = zs[k]!;
        const onRim =
          x >= lo && x <= hi && z >= lo && z <= hi && (x === lo || x === hi || z === lo || z === hi);
        if (onRim) edge.add(z * side + x);
      }
    }
    // every vertex of the hole's rim is used: the far grid meets the near one all the way round
    expect(edge.size).toBe(8 * HOLE);
  });
});
