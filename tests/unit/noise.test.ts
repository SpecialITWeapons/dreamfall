import { describe, expect, it } from 'vitest';
import {
  fbm,
  hash2,
  mulberry32,
  perlin2,
  pyramidPeaks,
  ridgedMulti,
  sstep,
} from '../../src/engine/terrain/noise';

// Golden values computed with fly-with-me's src/noise.js; a difference is a porting error.
describe('noise port', () => {
  it('matches fly-with-me bit for bit on the primitives', () => {
    expect(hash2(3, -7, 42)).toBe(764713383);
    expect(perlin2(1.25, -3.5, 7)).toBeCloseTo(0.47242028042674067, 12);
    expect(fbm(12.3, 4.5, 99, 4)).toBeCloseTo(-0.31147698148452646, 12);
    expect(ridgedMulti(0.7, 1.9, 5, 4)).toBeCloseTo(0.48915312145654183, 12);
    expect(pyramidPeaks(1234, -567, 42, 2400, 850, 1.7)).toBeCloseTo(0.10478791970718869, 12);
    expect(sstep(0, 1, 0.25)).toBe(0.15625);
  });
  it('mulberry32 is a deterministic stream', () => {
    const r = mulberry32(42);
    expect([r(), r(), r()]).toEqual([0.6011037519201636, 0.44829055899754167, 0.8524657934904099]);
    const again = mulberry32(42);
    expect(again()).toBe(0.6011037519201636);
  });
  it('keeps perlin roughly inside [-1, 1] and fbm inside it', () => {
    let lo = 1,
      hi = -1;
    for (let i = 0; i < 2000; i++) {
      const v = perlin2(i * 0.37, i * 0.11, 3);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeGreaterThan(-1.2);
    expect(hi).toBeLessThan(1.2);
    expect(Math.abs(fbm(3.3, 9.9, 1, 6))).toBeLessThanOrEqual(1.2);
  });
  it('ridgedMulti and pyramidPeaks stay in [0, 1]', () => {
    for (let i = 0; i < 500; i++) {
      const r = ridgedMulti(i * 0.013, i * 0.029, 11, 4);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      const p = pyramidPeaks(i * 97, i * 53, 5, 2400, 850, 1.7);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1.05);
    }
  });
});
