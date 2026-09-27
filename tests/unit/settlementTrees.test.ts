// The trees a settlement's plan stands, and what they come to on the real
// world: off the houses and the roads, never moving a house, and a place
// sparser than its country but never bare where the country is bare.
import { describe, expect, it } from 'vitest';
import type { LotSpec, RoadSpec, Site, SiteKit, TreeSpec } from '../../library/contract';
import { createLibrary } from '../../library/index.js';
import { planTown } from '../../library/settlements/plan-town.js';
import { planVillage } from '../../library/settlements/plan.js';
import { TOWN } from '../../library/settlements/town.js';
import { VILLAGE } from '../../library/settlements/village.js';
import { createClaims } from '../../src/engine/scenery/Claims';
import { createObstacles } from '../../src/engine/scenery/Obstacles';
import { createOverrides } from '../../src/engine/scenery/Overrides';
import { createRing, type ScenerySink } from '../../src/engine/scenery/Ring';
import { createSites } from '../../src/engine/scenery/Sites';
import { createHeightfield } from '../../src/engine/terrain/Heightfield';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';

const lib = createLibrary();
const footprints = new Map((lib.structures ?? []).map((s) => [s.id, s.footprint] as const));

const site = (id: string, radius: number): Site => {
  let n = 0;
  return {
    id,
    x: 0,
    z: 0,
    radius,
    yaw: 0.4,
    fields: { baseHeight: 200, temp: 0.5, moist: 0.5 } as Site['fields'],
    random: () => {
      n = (n * 1664525 + 1013904223) % 4294967296;
      return n / 4294967296;
    },
  };
};

/** Everything a plan says through its kit, with the trees kept or thrown away. */
const collect = (ground: (x: number, z: number) => number) => {
  const roads: RoadSpec[] = [],
    lots: LotSpec[] = [],
    trees: Array<Omit<TreeSpec, 'species'> & { species: string | null }> = [];
  const kit = {
    height: ground,
    slope: (x: number, z: number) => Math.abs(ground(x + 1, z) - ground(x - 1, z)) / 2,
    road: (points: Array<[number, number]>, width: number) => roads.push({ points, width }),
    structure: (structure: string, x: number, z: number, opts?: { yaw?: number; floors?: number }) =>
      lots.push({ structure, x, z, yaw: opts?.yaw ?? 0, floors: opts?.floors ?? 1 }),
    reserve: () => {},
    line: () => {},
    tree: (species: string | null, x: number, z: number, opts?: { yaw?: number }) =>
      trees.push({ species, x, z, yaw: opts?.yaw ?? 0 }),
    prop: () => {},
    color: () => ({}) as never,
  } as unknown as SiteKit;
  return { kit, roads, lots, trees };
};

const hillside = (x: number, z: number) => 200 - x * 0.04 + Math.sin(z / 300) * 6;
const flat = () => 200;

/** How far a point stands outside a house, m: negative inside it. Turned as `Claims` turns it. */
const outside = (lot: LotSpec, x: number, z: number) => {
  const [w, d] = footprints.get(lot.structure) ?? [10, 10];
  const dx = x - lot.x,
    dz = z - lot.z,
    cos = Math.cos(lot.yaw),
    sin = Math.sin(lot.yaw);
  const across = Math.abs(dx * cos - dz * sin) - w / 2,
    along = Math.abs(dx * sin + dz * cos) - d / 2;
  return across > 0 && along > 0 ? Math.hypot(across, along) : Math.max(across, along);
};
const toRoad = (road: RoadSpec, x: number, z: number) => {
  let best = Infinity;
  for (let i = 1; i < road.points.length; i++) {
    const [ax, az] = road.points[i - 1]!,
      [bx, bz] = road.points[i]!;
    const dx = bx - ax,
      dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best - road.width / 2;
};

const standsClear = (out: ReturnType<typeof collect>, radius: number) => {
  expect(out.trees.length).toBeGreaterThan(3);
  for (const tree of out.trees) {
    expect(tree.species).toBeNull(); // the country's, always
    expect(Math.hypot(tree.x, tree.z)).toBeLessThanOrEqual(radius);
    for (const lot of out.lots) expect(outside(lot, tree.x, tree.z)).toBeGreaterThanOrEqual(1);
    for (const road of out.roads) expect(toRoad(road, tree.x, tree.z)).toBeGreaterThanOrEqual(1);
  }
};

describe('a village stands trees', () => {
  it('in its gardens and on its empty lots, off every house and every lane', () => {
    const out = collect(hillside);
    planVillage(site('village:1,2', 220), VILLAGE, out.kit);
    standsClear(out, 220);
  });
  it('and not one house moves for them', () => {
    const planted = collect(hillside),
      bare = collect(hillside);
    planVillage(site('village:1,2', 220), VILLAGE, planted.kit);
    planVillage(site('village:1,2', 220), { ...VILLAGE, trees: { garden: 0, lot: 0, back: 0 } }, bare.kit);
    expect(bare.trees).toEqual([]);
    expect(planted.lots).toEqual(bare.lots);
    expect(planted.roads).toEqual(bare.roads);
  });
});

describe('a town stands trees', () => {
  it('on its empty lots and round its square, off every building and every street', () => {
    const out = collect(flat);
    planTown(site('town:1,2', 650), TOWN, out.kit);
    standsClear(out, 650);
    // a few round the square
    expect(out.trees.filter((t) => Math.hypot(t.x, t.z) <= TOWN.plaza.radius).length).toBeGreaterThanOrEqual(
      TOWN.trees.plaza[0],
    );
  });
  it('and not one building moves for them', () => {
    const planted = collect(flat),
      bare = collect(flat);
    planTown(site('town:1,2', 650), TOWN, planted.kit);
    planTown(site('town:1,2', 650), { ...TOWN, trees: { lot: 0, plaza: [0, 0] } }, bare.kit);
    expect(bare.trees).toEqual([]);
    expect(planted.lots).toEqual(bare.lots);
  });
});

describe('the settlements of seed 42', () => {
  it('are sparser than a country with trees, and not bare in a country without', () => {
    // Real sites on the real ground, the ring sowing around them with their
    // plans built: the trees inside each place against the country's around it.
    const sampler = createWorldSampler(42, { biomes: lib.biomes });
    const heightfield = createHeightfield(sampler);
    heightfield.fillAll(0, 0);
    const overrides = createOverrides();
    const sites = createSites({ library: lib, sampler, heightfield, overrides });
    const all = sites.charted(0, 0, 90000, []);
    const pick = [
      ...all.filter((s) => s.id.startsWith('village')).slice(0, 3),
      ...all.filter((s) => s.id.startsWith('town')).slice(0, 2),
    ];
    const seen: Array<{ id: string; inside: number; around: number }> = [];
    for (const place of pick) {
      heightfield.fillAll(Math.round(place.x / 16), Math.round(place.z / 16));
      const trees: Array<{ x: number; z: number }> = [];
      const sink: ScenerySink = {
        begin() {
          trees.length = 0;
        },
        tree(t) {
          trees.push({ x: t.x, z: t.z });
          return true;
        },
        prop: () => true,
        structure: () => true,
        site() {},
        end() {},
      };
      const ring = createRing({
        seed: 42,
        library: lib,
        sampler,
        heightfield,
        obstacles: createObstacles(),
        overrides,
        sites,
        claims: createClaims(),
        metrics: {
          species: () => ({ top: 14, radius: 5 }),
          prop: () => null,
          structure: (id) => {
            const f = footprints.get(id);
            return f ? { top: 8, radius: Math.hypot(f[0], f[1]) / 2 } : null;
          },
        },
        sink,
        propKit: { sstep: () => 0 } as never,
        radius: place.radius + 900,
      });
      ring.update(place.x, place.z, true);
      for (let k = 0; k < 400 && sites.queued > 0; k++) sites.work(1000);
      ring.update(place.x + 1, place.z, true);
      const inArea = (Math.PI * place.radius ** 2) / 1e6;
      const r0 = place.radius + 150,
        r1 = place.radius + 650;
      const outArea = (Math.PI * (r1 ** 2 - r0 ** 2)) / 1e6;
      const d = (t: { x: number; z: number }) => Math.hypot(t.x - place.x, t.z - place.z);
      seen.push({
        id: place.id,
        inside: trees.filter((t) => d(t) < place.radius).length / inArea,
        around: trees.filter((t) => d(t) > r0 && d(t) < r1).length / outArea,
      });
    }
    const wooded = seen.filter((s) => s.around >= 20),
      bare = seen.filter((s) => s.around < 5);
    expect(wooded.length).toBeGreaterThan(0);
    for (const s of wooded) {
      expect(s.inside / s.around, s.id).toBeGreaterThanOrEqual(0.3);
      expect(s.inside / s.around, s.id).toBeLessThan(1);
    }
    for (const s of bare) expect(s.inside, s.id).toBeGreaterThan(0);
  }, 120_000);
});
