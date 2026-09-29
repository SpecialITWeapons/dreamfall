// What the sea cliffs cost a full window fill: run with MEASURE=1, never in CI
// (a shared runner measures its own weather). The minimum of each side over
// three rounds is kept, the method of docs/perf-notes.md, but the two sides
// are interleaved a row at a time rather than a fill at a time: a fill is
// 0.55 s, and the machine these numbers were taken on drops its clock by
// about a third two or three seconds into a run, so whole fills in turn
// measured which side ran after the drop. A row of each in turn puts both
// under the same clock. Each row is what `fillAll` asks of the sampler, in
// its order: every texel of the window, a row at a time.
//
// Both windows: the near one (560 texels a side at 16 m), which the budget of
// spec 9 is about, and the far one (264 at 64 m), which pays far more for the
// cut and is only reported. Its texels stand on the cliffs' 64 m lattice
// nodes, so no two of them share a lattice cell and the corners a row keeps
// are never asked again; and a far texel is 64 m of coast, so a larger share
// of them is in a band.
import { describe, expect, it } from 'vitest';
import { createLibrary } from '../../library/index.js';
import { N } from '../../src/engine/terrain/Heightfield';
import { FAR_CELL, FAR_WINDOW } from '../../src/engine/terrain/Lod';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';

const lib = createLibrary();
const PLACES = [
  { name: 'cliff', x: 3584, z: -2992 },
  { name: 'cliff 2', x: 2720, z: 2240 },
  { name: 'origin', x: 0, z: 0 },
];
const WINDOWS = [
  { name: 'near', cell: 16, size: N, budget: 0.08 },
  { name: 'far', cell: FAR_CELL, size: FAR_WINDOW, budget: null },
];

describe.runIf(process.env.MEASURE)('what the sea cliffs cost a fill', () => {
  it('times a full window with and without them', () => {
    const out = new Float64Array(4),
      slots = new Uint8Array(4);
    for (const window of WINDOWS)
      for (const place of PLACES) {
        const { cell, size } = window;
        const best = { with: Infinity, without: Infinity };
        const cx = Math.round(place.x / cell),
          cz = Math.round(place.z / cell);
        for (let round = 0; round < 3; round++) {
          const samplers = {
            without: createWorldSampler(42, { biomes: lib.biomes, seaCliffs: false }),
            with: createWorldSampler(42, { biomes: lib.biomes }),
          };
          const spent = { with: 0, without: 0 };
          for (let iz = cz - size / 2; iz < cz + size / 2; iz++)
            for (const side of iz % 2 ? (['with', 'without'] as const) : (['without', 'with'] as const)) {
              const sampler = samplers[side];
              const t = performance.now();
              for (let ix = cx - size / 2; ix < cx + size / 2; ix++)
                sampler.sampleWindow(ix * cell, iz * cell, out, slots);
              spent[side] += performance.now() - t;
            }
          best.with = Math.min(best.with, spent.with);
          best.without = Math.min(best.without, spent.without);
        }
        const more = best.with / best.without - 1;
        // A crossing writes one row of the window: its share of the difference.
        const row = (best.with - best.without) / size;
        console.log(
          `${window.name} ${place.name}: ${best.without.toFixed(0)} ms without, ${best.with.toFixed(0)} ms with, +${(more * 100).toFixed(1)}%, +${row.toFixed(2)} ms a row`,
        );
        if (window.budget !== null)
          expect.soft(more, `${window.name} ${place.name}`).toBeLessThan(window.budget);
      }
  }, 240_000);
});
