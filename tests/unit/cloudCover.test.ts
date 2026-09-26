import { describe, expect, it } from 'vitest';
import {
  CLOUD_SEA_DROP,
  COVER,
  DECK,
  SEA_SEEN,
  bankAt,
  createCloudCover,
  deckAt,
  seaSeenOver,
} from '../../src/engine/sky/CloudCover';

const share = (data: Uint8Array) => data.reduce((sum, b) => sum + (b >= 128 ? 1 : 0), 0) / data.length;

describe('createCloudCover', () => {
  it('puts between 30 and 60 per cent of the sky under cloud, in every world', () => {
    // The owner asked for it at random between the two: broken weather and
    // heavier weather, and never the solid overcast the sea used to be.
    for (const seed of [1, 7, 42, 1234, 99999]) {
      const cover = createCloudCover(seed);
      const s = share(cover.data);
      expect(s, `seed ${seed}`).toBeGreaterThan(COVER.range[0] - 0.05);
      expect(s, `seed ${seed}`).toBeLessThan(COVER.range[1] + 0.05);
    }
  });

  it('is heavier in some places than in others, which is what a flight passes through', () => {
    // Quarters of the square, each about ten kilometres: the regional share
    // moves over them, so they do not all agree.
    const cover = createCloudCover(42);
    const n = cover.texels,
      h = n / 2;
    const quarters = [0, 1, 2, 3].map((q) => {
      let under = 0;
      for (let j = 0; j < h; j++)
        for (let i = 0; i < h; i++) {
          const x = (q % 2) * h + i,
            z = Math.floor(q / 2) * h + j;
          if (cover.data[z * n + x]! >= 128) under++;
        }
      return under / (h * h);
    });
    expect(Math.max(...quarters) - Math.min(...quarters)).toBeGreaterThan(0.05);
  });

  it('has banks with soft edges and clear sky between them, not a fog', () => {
    const cover = createCloudCover(42);
    let clear = 0,
      full = 0,
      edge = 0;
    for (const b of cover.data) {
      if (b === 0) clear++;
      else if (b === 255) full++;
      else edge++;
    }
    const n = cover.data.length;
    expect(clear / n).toBeGreaterThan(0.25);
    expect(full / n).toBeGreaterThan(0.15);
    expect(edge / n).toBeGreaterThan(0.05);
  });

  it('is the same field for the same world and a different one for another', () => {
    expect(createCloudCover(42).data).toEqual(createCloudCover(42).data);
    expect(createCloudCover(43).data).not.toEqual(createCloudCover(42).data);
  });

  it('repeats every period, seamlessly, which a texture set to repeat assumes', () => {
    const cover = createCloudCover(42);
    for (const [x, z] of [
      [0, 0],
      [1234.5, -987.25],
      [-44584, 14294],
    ] as const) {
      expect(cover.at(x + cover.period, z)).toBeCloseTo(cover.at(x, z), 9);
      expect(cover.at(x, z - 3 * cover.period)).toBeCloseTo(cover.at(x, z), 9);
    }
    // And across the seam the field does not jump: one texel either side of it
    // differs no more than neighbours anywhere else do.
    const n = cover.texels;
    let worst = 0;
    for (let j = 0; j < n; j++)
      worst = Math.max(worst, Math.abs(cover.data[j * n]! - cover.data[j * n + n - 1]!));
    let inside = 0;
    for (let j = 0; j < n; j++)
      for (let i = 1; i < n; i++)
        inside = Math.max(inside, Math.abs(cover.data[j * n + i]! - cover.data[j * n + i - 1]!));
    expect(worst).toBeLessThanOrEqual(inside);
  });

  it('reads on the CPU what a linear sampler reads from the texture on the GPU', () => {
    // At a texel's centre a linear sampler returns that texel whole; halfway
    // between two it returns their mean.
    const cover = createCloudCover(42);
    const n = cover.texels,
      m = cover.period / n;
    for (const [i, j] of [
      [0, 0],
      [17, 200],
      [255, 255],
    ] as const) {
      expect(cover.at((i + 0.5) * m, (j + 0.5) * m)).toBeCloseTo(cover.data[j * n + i]! / 255, 9);
      const next = cover.data[j * n + ((i + 1) % n)]! / 255;
      expect(cover.at((i + 1) * m, (j + 0.5) * m)).toBeCloseTo((cover.data[j * n + i]! / 255 + next) / 2, 9);
    }
  });

  it('says how solid the deck is where the wind has carried it, on the edge the GPU draws', () => {
    // The whiteout reads this: a clear sky has none, a bank has all of it.
    const cover = createCloudCover(42);
    const wind = { x: 3, z: -2 };
    let clear = 0,
      solid = 0;
    for (let i = 0; i < 400; i++) {
      const x = i * 97.3,
        z = i * -41.9,
        t = i * 11;
      const b = bankAt(cover, x, z, t, wind),
        v = cover.at(x - wind.x * t, z - wind.z * t);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
      if (v <= COVER.bank[0]) {
        expect(b).toBe(0);
        clear++;
      }
      if (v >= COVER.bank[1]) {
        expect(b).toBe(1);
        solid++;
      }
    }
    // Both ends are met. The deck is 15 to 35 per cent of the sky since the
    // owner thinned it, so a solid bank is a few per cent of a line of samples.
    expect(clear).toBeGreaterThan(40);
    expect(solid).toBeGreaterThan(8);
    // and moves with the wind: after t seconds it stands wind * t further on
    expect(bankAt(cover, 500 + 3 * 60, 800 - 2 * 60, 60, wind)).toBeCloseTo(
      bankAt(cover, 500, 800, 0, wind),
      12,
    );
  });
});

describe('the deck base', () => {
  it('stands between 700 and 1200 m, and every world reaches both ends somewhere', () => {
    for (const seed of [1, 7, 42, 1234, 99999]) {
      const cover = createCloudCover(seed);
      expect(Math.min(...cover.base), `seed ${seed}`).toBe(0);
      expect(Math.max(...cover.base), `seed ${seed}`).toBe(255);
      for (let i = 0; i < 200; i++) {
        const b = cover.baseAt(i * 311.7 - 20000, i * -173.3 + 5000);
        expect(b).toBeGreaterThanOrEqual(DECK.base[0]);
        expect(b).toBeLessThanOrEqual(DECK.base[1]);
      }
    }
  });

  it('changes by region and not by bank: a slope a flight can read as the lie of the weather', () => {
    // The base is a region's, so it never tilts steeper than this anywhere; a
    // bank's own edge is the cover's business.
    const cover = createCloudCover(42);
    const step = 40;
    let worst = 0;
    for (let z = 0; z < cover.period; z += 160)
      for (let x = 0; x < cover.period; x += 160) {
        const b = cover.baseAt(x, z);
        worst = Math.max(
          worst,
          Math.abs(cover.baseAt(x + step, z) - b),
          Math.abs(cover.baseAt(x, z + step) - b),
        );
      }
    expect(worst / step).toBeLessThan(DECK.maxGrade);
  });

  it('stays where it is while the cover drifts over it', () => {
    const cover = createCloudCover(42);
    const wind = { x: 12, z: -5 };
    const early = deckAt(cover, 1500, -800, 0, wind),
      late = deckAt(cover, 1500, -800, 400, wind);
    expect(late.base).toBe(early.base);
    expect(cover.baseAt(1500 + cover.period, -800)).toBeCloseTo(early.base, 6);
  });

  it('is as deep as the bank is solid, and never tops out over 1550 m', () => {
    const cover = createCloudCover(42);
    const wind = { x: 3, z: -2 };
    let clear = 0,
      solid = 0;
    for (let i = 0; i < 400; i++) {
      const d = deckAt(cover, i * 97.3, i * -41.9, i * 11, wind);
      expect(d.top - d.base).toBeGreaterThanOrEqual(DECK.thin - 1e-9);
      expect(d.top - d.base).toBeLessThanOrEqual(DECK.thick + 1e-9);
      expect(d.top).toBeLessThanOrEqual(1550);
      if (d.bank === 0) {
        expect(d.top - d.base).toBeCloseTo(DECK.thin, 9);
        clear++;
      }
      if (d.bank === 1) {
        expect(d.top - d.base).toBeCloseTo(DECK.thick, 9);
        solid++;
      }
    }
    expect(clear).toBeGreaterThan(20);
    expect(solid).toBeGreaterThan(8);
  });
});

describe('seaSeenOver', () => {
  it("is the sea shader's own answer: nothing under its level, all of it just over", () => {
    const cover = createCloudCover(42);
    const level = cover.baseAt(100, -200) + DECK.sea - CLOUD_SEA_DROP;
    expect(seaSeenOver(cover, 100, -200, level + SEA_SEEN[0] - 1)).toBe(0);
    expect(seaSeenOver(cover, 100, -200, level + SEA_SEEN[1] + 1)).toBe(1);
    const mid = seaSeenOver(cover, 100, -200, level + (SEA_SEEN[0] + SEA_SEEN[1]) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});
