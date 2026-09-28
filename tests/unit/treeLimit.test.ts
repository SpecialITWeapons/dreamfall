import { describe, expect, it } from 'vitest';
import { RING_FADE, TREE_LIMIT, treeBandAt } from '../../src/engine/scenery/TreeLimit';

describe('treeBandAt', () => {
  it('is the ring’s own band near the ground', () => {
    expect(treeBandAt(0)).toEqual([...RING_FADE]);
    expect(treeBandAt(TREE_LIMIT.from)).toEqual([...RING_FADE]);
  });

  it('is nothing high up, and never a band of no width', () => {
    for (const alt of [TREE_LIMIT.to, 5000]) {
      const [a, b] = treeBandAt(alt);
      expect(a).toBe(0);
      expect(b).toBeGreaterThanOrEqual(a + 1);
    }
  });

  it('draws nearer steadily as the flight climbs', () => {
    let last = Infinity;
    for (let alt = TREE_LIMIT.from; alt <= TREE_LIMIT.to; alt += 25) {
      const [a] = treeBandAt(alt);
      expect(a).toBeLessThanOrEqual(last);
      last = a;
    }
  });

  it('takes its heights the wrong way round without dividing by zero', () => {
    for (const alt of [0, 800, 900, 2000]) {
      const [a, b] = treeBandAt(alt, { from: 1000, to: 800 });
      expect(Number.isFinite(a) && Number.isFinite(b)).toBe(true);
      expect(b).toBeGreaterThanOrEqual(a + 1);
    }
    expect(treeBandAt(900, { from: 900, to: 900 })).toEqual(treeBandAt(900, { from: 900, to: 901 }));
  });
});
