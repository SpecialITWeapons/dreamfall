import { describe, expect, it } from 'vitest';
import { defineBiome, type Biome, type GroundHook } from '../../library/contract';
import { climatePoint } from '../../library/standard/presence.js';
import { createLibrary } from '../../library/index.js';
import { HEIGHT_HOOK_BUDGET_US, measureHeightHooks } from '../../src/engine/terrain/HookCost';

const ground = (() => ({ albedo: null })) as unknown as GroundHook;
const at = (id: string, t: number, m: number, r: number): Biome =>
  defineBiome({
    id,
    name: id,
    params: {},
    presence: climatePoint({ point: [t, m, r] }),
    ground,
    height: (_fields, base) => base + 1,
  });

/**
 * A clock that hands out the times in order. Every timing takes two readings,
 * so a scripted pair is a scripted cost, and the arithmetic is checkable
 * without asking a test runner how fast it is today.
 */
const scripted = (times: number[]) => {
  let i = 0;
  return () => times[i++] ?? 0;
};

describe('measureHeightHooks', () => {
  it('reports µs a texel for the base fields, the hooks on top, and their difference', () => {
    const biomes = [at('a', 0.2, 0.2, 0.2), at('b', 0.7, 0.7, 0.7)];
    // base 1 ms, all 3 ms over 1000 samples; then the per-biome pass: all again
    // at 0.8 ms over 250, and leaving each one out at 0.5 and 0.3 ms.
    const measured = measureHeightHooks({
      seed: 42,
      biomes,
      samples: 1000,
      biomeSamples: 250,
      repeats: 1,
      now: scripted([0, 1, 10, 13, 20, 20.8, 30, 30.5, 40, 40.3]),
    });
    expect(measured.samples).toBe(1000);
    expect(measured.base).toBeCloseTo(1, 6);
    expect(measured.all).toBeCloseTo(3, 6);
    expect(measured.hooks).toBeCloseTo(2, 6);
    expect(measured.budget).toBe(HEIGHT_HOOK_BUDGET_US);
    // marginal: the pass with everything (3.2 µs a texel) less the pass without
    // that one (2.0 and 1.2), so what the biome itself adds
    expect(measured.perBiome.map((b) => b.id)).toEqual(['a', 'b']);
    expect(measured.perBiome[0]!.us).toBeCloseTo(1.2, 6);
    expect(measured.perBiome[1]!.us).toBeCloseTo(2.0, 6);
  });

  it('with no registry there is nothing to leave out, and the hooks cost nothing', () => {
    const measured = measureHeightHooks({
      seed: 7,
      biomes: [],
      samples: 100,
      repeats: 1,
      now: scripted([0, 2, 10, 12]),
    });
    expect(measured.perBiome).toEqual([]);
    expect(measured.hooks).toBeCloseTo(0, 6);
    expect(measured.base).toBeCloseTo(20, 6);
  });

  it('keeps the fastest pass, because a slow one is the machine and not the hooks', () => {
    // Three passes over the same thousand texels: 3 ms, 1 ms, 5 ms. What the
    // hooks cost is the 1 -- the other two carry whatever else the machine was
    // doing -- so the base reads 1 µs a texel and not the mean of the three.
    const measured = measureHeightHooks({
      seed: 42,
      biomes: [],
      samples: 1000,
      repeats: 3,
      now: scripted([0, 3, 3, 4, 4, 9]),
    });
    expect(measured.base).toBeCloseTo(1, 6);
  });

  it('measures the registry the world actually ships, and every biome in it', () => {
    // No threshold: what a hook costs is the machine's business and this test
    // runs on whatever CI was given. What is asserted is that the measurement
    // happened -- real time, one entry per biome, nothing infinite.
    const library = createLibrary();
    const measured = measureHeightHooks({ seed: 42, biomes: library.biomes, samples: 256, biomeSamples: 64 });
    expect(measured.perBiome.map((b) => b.id)).toEqual(library.biomes.map((b) => b.id));
    expect(measured.base).toBeGreaterThan(0);
    expect(measured.all).toBeGreaterThan(0);
    expect(Number.isFinite(measured.hooks)).toBe(true);
    for (const biome of measured.perBiome) expect(Number.isFinite(biome.us)).toBe(true);
  });

  it('asks every configuration the same questions, so a difference between passes is the hooks', () => {
    // The points walk the ground in rows, as the window does (a spiral measured
    // the lattice cache instead -- see HookCost.ts), and
    // the whole measurement rests on them being the same points every pass and
    // every run: a fresh set would compare one piece of ground with another.
    const asked = () => {
      const seen: number[] = [];
      const trap = defineBiome({
        id: 'trap',
        name: 'trap',
        params: {},
        presence: climatePoint({ point: [0.5, 0.5, 0.5] }),
        ground,
        height: (fields, base) => {
          seen.push(fields.x, fields.z);
          return base;
        },
      });
      measureHeightHooks({ seed: 3, biomes: [at('a', 0.3, 0.3, 0.3), trap], samples: 32, biomeSamples: 8 });
      return seen;
    };
    const first = asked();
    expect(first.length).toBeGreaterThan(0);
    expect(asked()).toEqual(first);
  });
});
