import { describe, expect, it } from 'vitest';
import type { Library } from '../../library/contract';
import { createLibrary } from '../../library/index.js';
import { planVillage } from '../../library/settlements/plan.js';
import { settlement } from '../../library/settlements/settlement.js';
import { VILLAGE } from '../../library/settlements/village.js';
import { createOverrides } from '../../src/engine/scenery/Overrides';
import { createSites } from '../../src/engine/scenery/Sites';
import { createHeightfield } from '../../src/engine/terrain/Heightfield';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';

/** The sites of seed 42's world. Seating reads the sampler, so the window is never filled. */
const sitesOf = (library: Library) => {
  const sampler = createWorldSampler(42, { biomes: library.biomes });
  return createSites({
    library,
    sampler,
    heightfield: createHeightfield(sampler),
    overrides: createOverrides([]),
  });
};

/** Every village seated within `reach` of the middle of the world, by id. */
const villages = (library: Library, reach: number) =>
  new Set(
    sitesOf(library)
      .near(0, 0, reach, [])
      .filter((s) => s.biome === 'village')
      .map((s) => s.id),
  );

describe('how often a village stands', () => {
  it('stands half again as many villages, and every one that stood before still stands', () => {
    // The carry draw is one number per cell against the odds, so raising the
    // odds only ever adds a village -- and dropping `minTemp` adds the cold
    // ones. Measured before the change: one village per 90 km2 of land, 9.4 km
    // apart; at 0.75 that is about 7.7 km.
    const now = createLibrary();
    const before: Library = {
      ...now,
      biomes: now.biomes.map((b) =>
        b.id === 'village'
          ? settlement({ ...VILLAGE, odds: 0.5, ground: { ...VILLAGE.ground, minTemp: 0.2 } }, planVillage)
          : b,
      ),
    };
    const was = villages(before, 60000),
      is = villages(now, 60000);
    expect(was.size).toBeGreaterThan(50);
    for (const id of was) expect(is.has(id), id).toBe(true);
    expect(is.size / was.size).toBeGreaterThan(1.3);
    expect(is.size / was.size).toBeLessThan(1.8);
  });

  it("keeps the browser test's village-free wood free of villages", () => {
    // tests/e2e/smoke.spec.ts VILLAGE_FREE: the ring there must see no site.
    expect(sitesOf(createLibrary()).near(6000, 6000, 2600, [])).toEqual([]);
  });
});
