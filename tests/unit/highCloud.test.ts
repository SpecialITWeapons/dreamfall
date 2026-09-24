import { describe, expect, it } from 'vitest';
import { highCloudCover } from '../../src/engine/sky/HighCloud';

/** The cover every ten seconds over a long flight. */
const sweep = (seed: number, hours = 12) =>
  Array.from({ length: (hours * 3600) / 10 }, (_, i) => highCloudCover(seed, i * 10));

describe('highCloudCover', () => {
  it('is a share, 0..1, and the same answer for the same seed and time', () => {
    for (const c of sweep(42, 2)) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
    expect(highCloudCover(42, 1234.5)).toBe(highCloudCover(42, 1234.5));
  });

  it('leaves the sky mostly blue: clear for long stretches, heavy seldom', () => {
    // The owner asked for far fewer high clouds than the layer that covered the
    // whole blue: the mean is low, a good part of the time there are none, and
    // the heaviest skies are a small share of it.
    for (const seed of [1, 7, 42, 1234, 99999]) {
      const all = sweep(seed);
      const mean = all.reduce((s, c) => s + c, 0) / all.length;
      const clear = all.filter((c) => c === 0).length / all.length;
      const heavy = all.filter((c) => c > 0.6).length / all.length;
      expect(mean, `seed ${seed}`).toBeLessThan(0.3);
      expect(clear, `seed ${seed}`).toBeGreaterThan(0.2);
      expect(heavy, `seed ${seed}`).toBeLessThan(0.15);
    }
  });

  it('changes over a flight, and differs from one seed to the next', () => {
    const a = sweep(42);
    expect(Math.max(...a)).toBeGreaterThan(0.4);
    expect(a.filter((c) => c > 0.05).length).toBeGreaterThan(0);
    const b = sweep(7);
    expect(a.some((c, i) => Math.abs(c - b[i]!) > 0.2)).toBe(true);
  });

  it('drifts rather than jumps: weather, not a switch', () => {
    // Ten seconds never moves it by more than a few hundredths, so a sky
    // clears and fills while it is watched, never between two frames.
    for (const seed of [1, 42, 99999]) {
      const all = sweep(seed);
      for (let i = 1; i < all.length; i++) expect(Math.abs(all[i]! - all[i - 1]!)).toBeLessThan(0.08);
    }
  });
});
