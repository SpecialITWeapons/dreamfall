// What the sea cliffs cost a full window fill: run with MEASURE=1, never in CI
// (a shared runner measures its own weather). The minimum of each side over
// three rounds is kept, the method of docs/perf-notes.md, but the two sides
// are interleaved a row at a time rather than a fill at a time: a fill is
// 0.55 s, and the machine these numbers were taken on drops its clock by
// about a third two or three seconds into a run, so whole fills in turn
// measured which side ran after the drop. A row of each in turn puts both
// under the same clock. Each row is what `fillAll` asks of the sampler, in
// its order: every texel of the window, a row at a time.
import { describe, expect, it } from 'vitest';
import { createLibrary } from '../../library/index.js';
import { N } from '../../src/engine/terrain/Heightfield';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';

const lib = createLibrary();
const PLACES = [
  { name: 'cliff', x: 3584, z: -2992 },
  { name: 'cliff 2', x: 2720, z: 2240 },
  { name: 'origin', x: 0, z: 0 },
];

describe.runIf(process.env.MEASURE)('what the sea cliffs cost a fill', () => {
  it('times a full window with and without them', () => {
    const out = new Float64Array(4),
      slots = new Uint8Array(4);
    for (const place of PLACES) {
      const best = { with: Infinity, without: Infinity };
      const cx = Math.round(place.x / 16),
        cz = Math.round(place.z / 16);
      for (let round = 0; round < 3; round++) {
        const samplers = {
          without: createWorldSampler(42, { biomes: lib.biomes, seaCliffs: false }),
          with: createWorldSampler(42, { biomes: lib.biomes }),
        };
        const spent = { with: 0, without: 0 };
        for (let iz = cz - N / 2; iz < cz + N / 2; iz++)
          for (const side of iz % 2 ? (['with', 'without'] as const) : (['without', 'with'] as const)) {
            const sampler = samplers[side];
            const t = performance.now();
            for (let ix = cx - N / 2; ix < cx + N / 2; ix++)
              sampler.sampleWindow(ix * 16, iz * 16, out, slots);
            spent[side] += performance.now() - t;
          }
        best.with = Math.min(best.with, spent.with);
        best.without = Math.min(best.without, spent.without);
      }
      const more = best.with / best.without - 1;
      console.log(
        `${place.name}: ${best.without.toFixed(0)} ms without, ${best.with.toFixed(0)} ms with, +${(more * 100).toFixed(1)}%`,
      );
      expect.soft(more, place.name).toBeLessThan(0.08);
    }
  }, 120_000);
});
