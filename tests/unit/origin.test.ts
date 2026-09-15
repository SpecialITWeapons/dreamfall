import { describe, expect, it } from 'vitest';
import { createOrigin } from '../../src/engine/sim/Origin';

describe('createOrigin', () => {
  it('starts at zero and does not move inside the threshold', () => {
    const o = createOrigin();
    expect([o.x, o.z]).toEqual([0, 0]);
    expect(o.shiftFor(3999, -3999)).toBe(false);
    expect([o.x, o.z]).toEqual([0, 0]);
    expect(o.localX(1234.5)).toBe(1234.5);
  });
  it('snaps to a whole cell near the flyer once either axis passes the threshold', () => {
    const o = createOrigin({ cell: 16, threshold: 4000 });
    expect(o.shiftFor(4100, 10)).toBe(true);
    expect(o.x % 16).toBe(0);
    expect(o.z % 16).toBe(0);
    expect(Math.abs(o.localX(4100))).toBeLessThanOrEqual(8);
    expect(Math.abs(o.localZ(10))).toBeLessThanOrEqual(8);
    expect(o.shiftFor(4100, -4001)).toBe(true);
    expect(o.z).toBe(-4000);
  });
  it('round-trips world and local coordinates exactly at large distances', () => {
    const o = createOrigin();
    o.shiftFor(123_456_789.5, -98_765_432.25);
    const wx = 123_456_800.125,
      wz = -98_765_400.75;
    expect(o.worldX(o.localX(wx))).toBe(wx);
    expect(o.worldZ(o.localZ(wz))).toBe(wz);
    expect(Math.abs(o.localX(wx))).toBeLessThan(64);
  });
});
