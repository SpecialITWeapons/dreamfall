// What the biomes cost the CPU, measured rather than argued about. The design
// gives the height hooks a soft budget of 2 µs a texel (spec 5.5) and says the
// dev panel is where it is measured, because nothing static can tell you what
// a hook does: it is a function somebody wrote.
//
// The measurement is the window fill's own work -- `sampleWindow`, once per
// texel -- timed against a sampler with no registry at all, which takes the
// base-field branch and nothing else. The difference is what presence and
// height cost together, since a height hook cannot run until presence has said
// whose ground this is. Each biome's own share is measured by leaving it out:
// a marginal cost, which is the honest answer when ten of them share a texel
// and three of them get to speak.
import type { Biome } from '../../../library/contract';
import { createWorldSampler, type WorldSampler } from './WorldSampler';

/** A biome's marginal cost, µs a texel, measured by taking it out of the registry. */
export interface BiomeCost {
  id: string;
  us: number;
}

export interface HookCosts {
  samples: number;
  /** The base fields alone, µs a texel. */
  base: number;
  /** The base fields plus the registry's hooks, µs a texel. */
  all: number;
  /** What the hooks add: `all - base`, against the budget. */
  hooks: number;
  /** The soft budget this is measured against, µs a texel. Carried in the result so a reader needs nothing else. */
  budget: number;
  perBiome: BiomeCost[];
}

/** Soft budget for the height hooks, µs a texel (spec 5.5). */
export const HEIGHT_HOOK_BUDGET_US = 2;

/**
 * The points to time over: a square walked **row by row**, which is how the
 * height window is actually filled, at the window's own reach.
 *
 * The order is not a detail. `Fields.lattice` remembers four seats, and a miss
 * costs five base samples -- the centre and four probes for its slope -- so a
 * fill that walks a row stays inside one lattice cell for hundreds of texels
 * and pays that once. Measured with a golden-angle spiral over the same disc
 * instead, which crosses cells at every step: 16.9 µs a texel around the start,
 * against 0.9 µs for the same ground walked in rows. That was a measurement of
 * the sampling order, not of the hooks.
 */
const points = (x: number, z: number, span: number, count: number) => {
  const side = Math.max(1, Math.round(Math.sqrt(count)));
  const step = span / side;
  const out = new Float64Array(count * 2);
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / side),
      column = i % side;
    out[i * 2] = x + (column - side / 2) * step;
    out[i * 2 + 1] = z + (row - side / 2) * step;
  }
  return out;
};

export function measureHeightHooks(deps: {
  seed: number;
  biomes: Biome[];
  /** Where to measure: the ground under the flyer is the ground worth measuring. */
  x?: number;
  z?: number;
  /** Across how many metres, m. A window is 2 km; this defaults to the same. */
  span?: number;
  samples?: number;
  /** Fewer, because leaving one biome out has to be done once per biome. */
  biomeSamples?: number;
  /** Passes per configuration; the fastest is kept. One pass is one pass and is not a measurement. */
  repeats?: number;
  now?: () => number;
}): HookCosts {
  const {
    seed,
    biomes,
    x = 0,
    z = 0,
    span = 2048,
    samples = 8192,
    biomeSamples = Math.max(1, samples >> 2),
    repeats = 3,
    now = () => performance.now(),
  } = deps;
  const at = points(x, z, span, samples);
  const out = new Float64Array(5);
  // Four, not three: the window's fourth slot byte is the climate temperature.
  const slots = new Uint8Array(4);
  const sweep = (sampler: WorldSampler, count: number) => {
    for (let i = 0; i < count; i++) sampler.sampleWindow(at[i * 2]!, at[i * 2 + 1]!, out, slots);
  };
  // The interpreter's own warm-up, before anything is timed at all. Almost all
  // of this time is spent in the shared noise, and the first pass over it is a
  // measurement of a cold interpreter: measured here, the same work read 19.96
  // µs a texel on the first call of a process and 2.78 on the next.
  const warm = Math.min(samples, 2048);
  sweep(createWorldSampler(seed, { biomes }), warm);
  sweep(createWorldSampler(seed, { biomes: [] }), warm);
  const time = (set: Biome[], count: number) => {
    const sampler = createWorldSampler(seed, { biomes: set });
    // This closure's own warm-up: a fresh registry is a fresh set of hooks.
    sweep(sampler, Math.min(count, 256));
    let best = Infinity;
    for (let pass = 0; pass < repeats; pass++) {
      const started = now();
      sweep(sampler, count);
      best = Math.min(best, now() - started);
    }
    return (best * 1000) / count;
  };
  const base = time([], samples);
  const all = time(biomes, samples);
  // The per-biome pass has its own reading of the whole registry, at its own
  // sample count: a marginal cost has to be a difference of two passes of the
  // same length or it is a difference of two lengths.
  const withAll = biomes.length > 0 ? time(biomes, biomeSamples) : 0;
  const perBiome = biomes.map((biome) => ({
    id: biome.id,
    us:
      withAll -
      time(
        biomes.filter((other) => other !== biome),
        biomeSamples,
      ),
  }));
  return { samples, base, all, hooks: all - base, budget: HEIGHT_HOOK_BUDGET_US, perBiome };
}
