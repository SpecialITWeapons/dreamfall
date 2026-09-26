import { describe, expect, it } from 'vitest';
import { SEA_GRID, seaAxis } from '../../src/engine/sky/CloudSea';

describe('seaAxis', () => {
  it('is dense under the flyer and opens out evenly to the reach, symmetric about it', () => {
    const axis = seaAxis();
    expect(axis.length).toBe(SEA_GRID.steps + 1);
    expect(axis[0]).toBeCloseTo(-SEA_GRID.reach, 3);
    expect(axis[axis.length - 1]).toBeCloseTo(SEA_GRID.reach, 3);
    const mid = SEA_GRID.steps / 2;
    expect(axis[mid]).toBe(0);
    let last = 0;
    for (let i = 1; i < axis.length; i++) {
      const step = axis[i]! - axis[i - 1]!;
      expect(axis[i]!).toBeCloseTo(-axis[axis.length - 1 - i]!, 3);
      expect(step).toBeGreaterThan(0);
      if (Math.abs(axis[i]!) <= SEA_GRID.coreReach && Math.abs(axis[i - 1]!) <= SEA_GRID.coreReach)
        expect(step).toBeCloseTo(SEA_GRID.core, 3);
      // past the core each step is at least the one before it, going outward
      if (i > mid + 1) expect(step).toBeGreaterThanOrEqual(last - 1e-3);
      last = step;
    }
  });

  it('puts the core on whole steps, so a grid moved in whole steps stands still in the world', () => {
    const axis = seaAxis();
    for (const a of axis)
      if (Math.abs(a) <= SEA_GRID.coreReach)
        expect(a / SEA_GRID.core).toBeCloseTo(Math.round(a / SEA_GRID.core), 4);
  });

  it('reaches as far as the land, and no step of it is coarser than 200 m', () => {
    const axis = seaAxis();
    expect(SEA_GRID.reach).toBeGreaterThanOrEqual(8192);
    for (let i = 1; i < axis.length; i++) expect(axis[i]! - axis[i - 1]!).toBeLessThanOrEqual(200.5);
  });
});
