import { describe, expect, it } from 'vitest';
import { COVER, createCloudCover } from '../../src/engine/sky/CloudCover';

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
});
