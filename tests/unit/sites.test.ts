import { describe, expect, it } from 'vitest';
import {
  defineBiome,
  defineStructure,
  type Biome,
  type GroundHook,
  type Library,
  type SiteKit,
  type SitesSpec,
} from '../../library/contract';
import { createOverrides, type Override } from '../../src/engine/scenery/Overrides';
import { createSites, siteKey } from '../../src/engine/scenery/Sites';
import { createHeightfield } from '../../src/engine/terrain/Heightfield';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';

const ground = (() => ({ albedo: null })) as unknown as GroundHook;
const cottage = defineStructure({
  id: 'cottage',
  name: 'cottage',
  footprint: [7, 5.5],
  floors: [1, 2],
  roof: 'gable',
  palette: { wall: 'sandPale', roof: 'terracotta' },
});

/**
 * A settlement that always fits and always builds the same three things. Its
 * lattice is 1500 m rather than the village's own 6 km: at 6 km a 3 km reach
 * sees four cells, seed 42's coast rejects most seats, and the test would be
 * measuring the shoreline instead of the machinery. The sparseness is real and
 * has a case of its own below.
 */
const village = (over: Partial<SitesSpec> = {}, id = 'village'): Biome =>
  defineBiome({
    id,
    name: id,
    params: {},
    presence: () => 0.5,
    ground,
    sites: {
      cell: 1500,
      odds: 0.5,
      radius: [120, 250],
      structures: { cottage: 1 },
      fits: () => true,
      build: (site, kit: SiteKit) => {
        kit.road(
          [
            [site.x - 100, site.z],
            [site.x + 100, site.z],
          ],
          6,
        );
        kit.structure('cottage', site.x + 20, site.z + 10, { yaw: site.random() * 6.283, floors: 1 });
        kit.reserve(site.x, site.z, 40);
      },
      ...over,
    },
  });

const library = (biomes: Biome[]): Library => ({ biomes, structures: [cottage] });

/** Sites over the real ground of seed 42, with a window wide enough to hold the search. */
const sites = (lib: Library, overrides: Override[] = []) => {
  const sampler = createWorldSampler(42, { biomes: lib.biomes });
  const heightfield = createHeightfield(sampler);
  heightfield.fillAll(0, 0);
  return createSites({
    seed: 42,
    library: lib,
    sampler,
    heightfield,
    overrides: createOverrides(overrides),
  });
};

describe('createSites', () => {
  it('finds the same sites in the same places, however often it is asked', () => {
    const a = sites(library([village()])),
      b = sites(library([village()]));
    const out: Parameters<typeof a.near>[3] = [];
    const first = a.near(0, 0, 3000, out).map((s) => `${s.id}@${s.x.toFixed(2)},${s.z.toFixed(2)}`);
    expect(first.length).toBeGreaterThan(0);
    expect(b.near(0, 0, 3000, []).map((s) => `${s.id}@${s.x.toFixed(2)},${s.z.toFixed(2)}`)).toEqual(first);
    // asked again, from a different place that still sees them
    expect(a.near(500, 500, 3500, []).map((s) => s.id)).toEqual(
      expect.arrayContaining(first.map((f) => f.split('@')[0]!)),
    );
  });
  it('leaves a sparse lattice sparse: a six-kilometre grid over a coast carries almost nothing', () => {
    // Not a failure of the finder. Four cells in reach, half of them carrying,
    // and seed 42's window is 43 % land -- so the honest answer near the origin
    // is none, and a test that demanded otherwise would be lying about the world.
    const wide = sites(library([village({ cell: 6000 })]));
    expect(wide.near(0, 0, 3000, [])).toEqual([]);
  });
  it('two worlds put their villages somewhere else', () => {
    const other = createSites({
      seed: 43,
      library: library([village()]),
      sampler: createWorldSampler(43, { biomes: library([village()]).biomes }),
      heightfield: (() => {
        const hf = createHeightfield(createWorldSampler(43));
        hf.fillAll(0, 0);
        return hf;
      })(),
      overrides: createOverrides(),
    });
    const here = sites(library([village()])).near(0, 0, 9000, []);
    const there = other.near(0, 0, 9000, []);
    expect(here.map((s) => `${s.x},${s.z}`)).not.toEqual(there.map((s) => `${s.x},${s.z}`));
  });
  it('stands its sites on land, and refuses what the biome will not have', () => {
    const found = sites(library([village()])).near(0, 0, 9000, []);
    for (const site of found) {
      expect(site.fields.baseHeight).toBeGreaterThan(0);
      expect(site.radius).toBeGreaterThanOrEqual(120);
      expect(site.radius).toBeLessThanOrEqual(250);
    }
    // a settlement that never fits has none at all
    expect(sites(library([village({ fits: () => false })])).near(0, 0, 9000, [])).toEqual([]);
    expect(sites(library([village({ odds: 0 })])).near(0, 0, 9000, [])).toEqual([]);
  });
  it('builds no plan until it is given the time, and then keeps it', () => {
    const s = sites(library([village()]));
    const found = s.near(0, 0, 3000, []);
    expect(found.length).toBeGreaterThan(0);
    expect(s.planFor(found[0]!)).toBeNull();
    expect(s.queued).toBeGreaterThan(0);
    s.work(0); // no budget, no work
    expect(s.planFor(found[0]!)).toBeNull();
    s.work(100);
    const plan = s.planFor(found[0]!)!;
    expect(plan).not.toBeNull();
    expect(plan.roads).toHaveLength(1);
    expect(plan.lots).toHaveLength(1);
    expect(plan.lots[0]!.structure).toBe('cottage');
    expect(plan.reservations).toHaveLength(1);
    expect(s.built).toBeGreaterThan(0);
    // and it is the same plan object next time: a village is built once
    expect(s.planFor(found[0]!)).toBe(plan);
  });
  it('asks the override layer before it builds anything', () => {
    const s = sites(library([village()]));
    const one = s.near(0, 0, 3000, [])[0]!;
    const skipped = sites(library([village()]), [{ key: siteKey(one.id), skip: true }]);
    expect(skipped.near(0, 0, 3000, []).map((x) => x.id)).not.toContain(one.id);
  });
  it('does not grow without bound while the flight crosses the world', () => {
    const s = sites(library([village()]));
    for (let k = 0; k < 20; k++) {
      s.near(k * 4000, 0, 3000, []);
      s.work(50);
    }
    // the cache holds what is near, not everything ever seen
    expect(s.built).toBeLessThan(20);
  });
});
