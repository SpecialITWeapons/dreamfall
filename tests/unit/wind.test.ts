import { describe, expect, it } from 'vitest';
import { WIND_SPEED, windFromSeed } from '../../src/engine/sky/Wind';

describe('windFromSeed', () => {
  it('is deterministic, inside the speed range, and differs between seeds', () => {
    const a = windFromSeed(42),
      again = windFromSeed(42),
      b = windFromSeed(43);
    expect(a).toEqual(again);
    expect(a.speed).toBeGreaterThanOrEqual(WIND_SPEED.min);
    expect(a.speed).toBeLessThanOrEqual(WIND_SPEED.max);
    expect(Math.hypot(a.x, a.z)).toBeCloseTo(a.speed, 9);
    expect(Math.atan2(a.x, a.z)).toBeCloseTo(a.heading, 9);
    expect(a.heading === b.heading && a.speed === b.speed).toBe(false);
    expect(WIND_SPEED).toEqual({ min: 10, max: 15 });
  });
});
