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
import { createFields } from '../../src/engine/terrain/Fields';
import { resolvePresence, widthOf } from '../../library/standard/index.js';

const ground = (() => ({ albedo: null })) as unknown as GroundHook;
const cottage = defineStructure({
  id: 'cottage',
  name: 'cottage',
  footprint: [7, 5.5],
  floors: [1, 2],
  roof: 'gable',
  palette: { wall: 'sandPale', roof: 'terracotta' },
});

/** The lattice every settlement in this file stands on. */
const CELL = 1500,
  SALT = 0x51a7;

/**
 * A settlement that always fits and always builds the same three things. Its
 * lattice is 1500 m rather than the village's own 6 km: at 6 km a 3 km reach
 * sees four cells, seed 42's coast rejects most seats, and the test would be
 * measuring the shoreline instead of the machinery. The sparseness is real and
 * has a case of its own below.
 *
 * Its presence hook is the real one, on the same cell and salt the sites get,
 * because that hook is what decides whether a cell carries a village at all.
 */
const village = (
  over: Partial<SitesSpec> = {},
  id = 'village',
  presence: Biome['presence'] = { type: 'lattice', cell: CELL, salt: SALT, radius: 250, land: 8 },
): Biome =>
  defineBiome({
    id,
    name: id,
    params: {},
    presence,
    ground,
    sites: {
      cell: CELL,
      salt: SALT,
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
  it('charts the sites of a wide reach without queueing a plan for any of them', () => {
    const s = sites(library([village()]));
    const charted = s.charted(0, 0, 3000, []);
    expect(charted.length).toBeGreaterThan(0);
    expect(s.queued).toBe(0);
    // the same places the ring would find, by the same ids
    const found = s
      .near(0, 0, 3000, [])
      .map((site) => site.id)
      .sort();
    expect(charted.map((site) => site.id).sort()).toEqual(found);
  });
  it('leaves a sparse lattice sparse: a six-kilometre grid over a coast carries one village', () => {
    // Not a failure of the finder. Nine cells around the origin, three of them
    // carrying, their centres four to eleven kilometres out, and seed 42's
    // window is 43 % land -- so the honest answer inside four kilometres is one
    // village, at (2062, 3023), and a test that demanded a handful would be
    // lying about the world.
    const wide = sites(
      library([
        village({ cell: 6000 }, 'village', { type: 'lattice', cell: 6000, salt: SALT, radius: 250, land: 8 }),
      ]),
    );
    const found = wide.near(0, 0, 4000, []);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe('village:0,0');
    // and three kilometres does not reach it: the reach is a reach, not a hint
    expect(
      sites(
        library([
          village({ cell: 6000 }, 'village', {
            type: 'lattice',
            cell: 6000,
            salt: SALT,
            radius: 250,
            land: 8,
          }),
        ]),
      ).near(0, 0, 3000, []),
    ).toEqual([]);
  });
  it('seats a site where its own presence hook says the settlement is, to the metre', () => {
    // The whole point. The hook paints the ground and drives the plateau off a
    // lattice centre; a seat drawn anywhere else puts the village on the slope
    // beside its own flat square. Measured before this rule: the two agreed on
    // half the cells, which is what two coins do.
    const lib = library([village()]);
    const sampler = createWorldSampler(42, { biomes: lib.biomes });
    const fields = createFields(sampler);
    const found = sites(lib).near(0, 0, 4000, []);
    expect(found.length).toBeGreaterThan(2);
    for (const site of found) {
      const hit = fields.at(site.x, site.z).lattice(CELL, SALT);
      expect(Math.hypot(site.x - hit.cx, site.z - hit.cz)).toBeLessThan(1e-6);
      // and the hook agrees there is a settlement standing there at all
      expect(resolvePresence(lib.biomes[0]!.presence)(fields.at(site.x, site.z))).toBeGreaterThan(0);
    }
  });
  it('is as wide as its hook painted it: one radius, drawn once, read twice', () => {
    // The same argument as the seat itself. The hook is asked at every texel of
    // the window and the site finder once per cell, and they draw the width
    // from the same lattice stream, so the painted and levelled circle is the
    // circle the settlement fills. Handed `radius[1]` instead, the hook claimed
    // the widest a settlement of its kind could be: a town drawn at 400 m stood
    // in five hundred metres of levelled nothing.
    const span: [number, number] = [120, 250];
    const lib = library([
      village({ radius: span }, 'village', {
        type: 'lattice',
        cell: CELL,
        salt: SALT,
        radius: span,
        land: 8,
      }),
    ]);
    const sampler = createWorldSampler(42, { biomes: lib.biomes });
    const fields = createFields(sampler);
    const found = sites(lib).near(0, 0, 4000, []);
    expect(found.length).toBeGreaterThan(2);
    const widths = new Set<number>();
    for (const site of found) {
      widths.add(Math.round(site.radius));
      expect(site.radius).toBeGreaterThanOrEqual(span[0]);
      expect(site.radius).toBeLessThanOrEqual(span[1]);
      // The hook's own answer, read off the same hit the seat read.
      const hit = fields.at(site.x, site.z).lattice(CELL, SALT);
      expect(widthOf(span, hit)).toBeCloseTo(site.radius, 9);
      // and the presence really does end a feather past that width, not past
      // the widest the range allows
      const hook = resolvePresence(lib.biomes[0]!.presence);
      const out = (d: number) => hook(fields.at(site.x + d, site.z));
      expect(out(site.radius - 1)).toBeGreaterThan(0);
      expect(out(site.radius + 150 + 1)).toBe(0);
    }
    // and they are not all the same width, or this would prove nothing
    expect(widths.size).toBeGreaterThan(1);
  });
  it('carries a site in exactly the cells its presence hook carries one', () => {
    const lib = library([village()]);
    const sampler = createWorldSampler(42, { biomes: lib.biomes });
    const fields = createFields(sampler);
    const presence = resolvePresence(lib.biomes[0]!.presence);
    // wide enough that no cell of the sweep is dropped for being far rather
    // than for being empty: a centre may jitter a third of a cell outward
    const seated = new Set(
      sites(lib)
        .near(0, 0, 6000, [])
        .map((s) => s.id),
    );
    let cells = 0;
    for (let gz = -2; gz <= 2; gz++)
      for (let gx = -2; gx <= 2; gx++) {
        const hit = fields.at((gx + 0.5) * CELL, (gz + 0.5) * CELL).lattice(CELL, SALT);
        const wanted = presence(fields.at(hit.cx, hit.cz)) > 0;
        expect(seated.has(`village:${gx},${gz}`)).toBe(wanted);
        cells++;
      }
    expect(cells).toBe(25);
  });
  it('two worlds put their villages somewhere else', () => {
    const other = createSites({
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
    expect(found.length).toBeGreaterThan(0);
    for (const site of found) {
      // the hook's own land line, honoured because the hook is what decides
      expect(site.fields.baseHeight).toBeGreaterThan(8);
      expect(site.radius).toBeGreaterThanOrEqual(120);
      expect(site.radius).toBeLessThanOrEqual(250);
    }
    // a settlement that never fits has none at all
    expect(sites(library([village({ fits: () => false })])).near(0, 0, 9000, [])).toEqual([]);
    // and neither has one whose hook never carries: there is no second lottery
    const never = village({}, 'village', { type: 'lattice', cell: CELL, salt: SALT, radius: 250, odds: 0 });
    expect(sites(library([never])).near(0, 0, 9000, [])).toEqual([]);
  });
  it('collects the lines a plan draws, and refuses a kind nobody bakes', () => {
    const fenced = village({
      build: (site, kit: SiteKit) => {
        kit.line(
          [
            [site.x - 40, site.z],
            [site.x + 40, site.z],
          ],
          'fence',
        );
        kit.line([[site.x, site.z - 30]], 'wall', { height: 2 });
      },
    });
    const s = sites(library([fenced]));
    const one = s.near(0, 0, 3000, [])[0]!;
    s.work(100);
    const plan = s.planFor(one)!;
    expect(plan.lines).toHaveLength(2);
    expect(plan.lines[0]!.kind).toBe('fence');
    expect(plan.lines[0]!.height).toBeUndefined();
    expect(plan.lines[0]!.points).toEqual([
      [one.x - 40, one.z],
      [one.x + 40, one.z],
    ]);
    expect(plan.lines[1]).toMatchObject({ kind: 'wall', height: 2 });
    // A line claims no ground: 1.4 m is far under the clearance the flight
    // keeps, so fencing a square is not the same as reserving it.
    expect(plan.reservations).toEqual([]);

    // and a kind nobody bakes is said here, in the queue, not dropped in a frame
    const wrong = village({
      build: (site, kit: SiteKit) => kit.line([[site.x, site.z]], 'palisade'),
    });
    const w = sites(library([wrong]));
    w.near(0, 0, 3000, []);
    expect(() => w.work(100)).toThrow(/unknown line kind "palisade"/);
  });
  it('tells the plan at once when it asks for a building nobody baked', () => {
    // The queue is not the render loop, so this is the one place it is safe to
    // be loud -- and the alternative is a house that silently does not appear.
    const wrong = village({
      build: (site, kit: SiteKit) => kit.structure('manor', site.x, site.z, { floors: 1 }),
    });
    const s = sites(library([wrong]));
    s.near(0, 0, 3000, []);
    expect(() => s.work(100)).toThrow(/unknown structure "manor"/);

    const tall = village({
      build: (site, kit: SiteKit) => kit.structure('cottage', site.x, site.z, { floors: 5 }),
    });
    const t = sites(library([tall]));
    t.near(0, 0, 3000, []);
    expect(() => t.work(100)).toThrow(/cottage has no 5-storey bake, only 1\.\.2/);
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
    // and so does the queue. A site is seated wherever the reach touches its
    // cell, but a plan needs the height window, so a site out of the window
    // goes back on the queue -- and a flight that never returns would otherwise
    // leave it there for ever, with the budget walking past it every frame.
    expect(s.queued).toBeLessThan(20);
    // and once the old ground is well behind, what is left is only what the new
    // ground seats: a Sites that has flown eighty kilometres holds no more than
    // one that has just arrived
    s.near(400_000, 400_000, 3000, []);
    const fresh = sites(library([village()]));
    fresh.near(400_000, 400_000, 3000, []);
    expect(s.queued).toBe(fresh.queued);
  });
});
