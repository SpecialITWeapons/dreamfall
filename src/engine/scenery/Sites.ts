// Sites: the places someone built. A sparse lattice carries them, the ground
// decides whether one fits, and a plan -- roads, lots, reservations -- is built
// for it in a queue with a budget rather than in the frame that first saw it.
//
// Nothing here makes geometry. A plan is data, which is what lets the village
// generator be a pure function with a test in Node, and what will let the
// editor of M6 change one. The pools turn a plan into instances, exactly as
// they turn a scatter into trees.
import type {
  Biome,
  Fields,
  Library,
  LineSpec,
  LotSpec,
  Reservation,
  RoadSpec,
  SceneryColor,
  SiteKit,
  SitePlan,
  SitesSpec,
} from '../../../library/contract';
import { swatchColor } from '../../../library/contract';
import { SITE_STREAM, resolvePresence } from '../../../library/standard/index.js';
import { Color } from 'three';
import { createFields } from '../terrain/Fields';
import { LINE_KINDS } from './LineKit';
import type { Heightfield } from '../terrain/Heightfield';
import { mulberry32 } from '../terrain/noise';
import type { WorldSampler } from '../terrain/WorldSampler';
import { siteKey as keyOf, type Overrides } from './Overrides';

export { siteKey } from './Overrides';

/**
 * The default the standard `lattice` presence hook uses; a settlement that does
 * not name its salt gets the same lattice the hook would read.
 */
const LATTICE_SALT = 0x5117;
/**
 * The streams of a site's own cell, taken from the library rather than written
 * again here. The presence hook draws the width of a settlement out of
 * `SITE_STREAM.radius` and the seat below draws it out of the same one, which
 * is the whole reason the ground that is painted is the ground the settlement
 * covers; two copies of the number would be two things to keep in step.
 */
const { radius: RADIUS_STREAM, yaw: YAW_STREAM, plan: PLAN_STREAM } = SITE_STREAM;
/** Plans further than this beyond the asking reach are forgotten, m. */
const KEEP_PAD = 4000;

export interface Site {
  /** Stable across sessions: the biome and the lattice cell, which is what it is. */
  id: string;
  biome: string;
  x: number;
  z: number;
  radius: number;
  yaw: number;
  /** The fields at the site's own centre, copied: the shared one moves on. */
  fields: Fields;
  random(): number;
}

export interface Sites {
  /** Every site whose own ground is within reach of (x, z); nearest first. */
  near(x: number, z: number, reach: number, out: Site[]): Site[];
  /** The plan of a site, or null while it is still queued. */
  planFor(site: Site): SitePlan | null;
  /** Builds queued plans until the budget runs out; called once a frame. */
  work(budgetMs: number): void;
  readonly built: number;
  readonly queued: number;
}

/** A copy of the fields, because the reader hands out one object and moves on. */
const copyFields = (f: Fields): Fields => ({ ...f });

export function createSites(deps: {
  library: Library;
  sampler: WorldSampler;
  heightfield: Heightfield;
  overrides: Overrides;
}): Sites {
  const { library, sampler, heightfield, overrides } = deps;
  // A settlement's presence hook is resolved here, not read out of the sampler,
  // because the seat asks it a question the window never asks: does *this cell*
  // carry a site? Asked at the lattice centre it is one call and one lottery --
  // the same lottery that paints the ground and flattens it.
  const settled = library.biomes
    .filter((biome): biome is Biome & { sites: SitesSpec } => Boolean(biome.sites))
    .map((biome) => ({
      biome,
      spec: biome.sites,
      presence: resolvePresence(biome.presence),
      salt: biome.sites.salt ?? LATTICE_SALT,
    }));
  const fields = createFields(sampler);
  // What was actually baked, so a plan naming something else is told at once.
  const structures = new Map((library.structures ?? []).map((entry) => [entry.id, entry]));
  // What the lattice carries, by cell: a site, or nothing. Nothing is worth
  // remembering too -- it is the answer to the same question.
  const found = new Map<string, Site | null>();
  const plans = new Map<string, SitePlan>();
  const queue: Site[] = [];
  let built = 0;

  // How far the height window actually knows the ground. Past it heightAt wraps
  // around the torus and answers with the other side of the world, so a plan
  // built out there would lay its street over ground that is not underneath it.
  // The seat itself needs no window -- it reads the sampler, which answers
  // everywhere -- so this guards the queue and nothing else.
  const known = (heightfield.size / 2 - 2) * heightfield.cell;
  const inWindow = (x: number, z: number, pad: number) =>
    Math.abs(x - heightfield.center.cx * heightfield.cell) < known - pad &&
    Math.abs(z - heightfield.center.cz * heightfield.cell) < known - pad;

  /**
   * Does this lattice cell carry a site, and where does it stand?
   *
   * The cell's own presence hook answers both. Asked at the lattice centre it
   * is the same draw, on the same salt, against the same odds and the same
   * ground that the sampler makes when it paints the cell and the plateau when
   * it flattens it -- so a village stands in the middle of its own flat square
   * by construction rather than by two lotteries happening to agree. They did
   * not: measured on seed 42 before this, the two agreed on half the cells,
   * which is what two coins do.
   */
  const seat = (entry: (typeof settled)[number], gx: number, gz: number): Site | null => {
    const { spec, biome, salt, presence } = entry;
    const id = `${biome.id}:${gx},${gz}`;
    if (overrides.size > 0 && overrides.for(keyOf(id))?.skip) return null;
    // Any point of the cell gives the same hit; its centre is the plain one.
    const hit = fields.at((gx + 0.5) * spec.cell, (gz + 0.5) * spec.cell).lattice(spec.cell, salt);
    const x = hit.cx,
      z = hit.cz;
    const radius = spec.radius[0] + hit.u(RADIUS_STREAM) * (spec.radius[1] - spec.radius[0]);
    const yaw = hit.u(YAW_STREAM) * Math.PI * 2;
    // The hit is one shared object and fields.at moves it, so read what the
    // seat needs off it before asking the fields at the centre.
    const here = fields.at(x, z);
    if (presence(here) <= 0 || !spec.fits(here)) return null;
    // Its own stream, fixed from here on: the plan draws from it, so a site
    // planned now and planned after a reload is the same village. It is one of
    // the cell's own streams, which is what carries the world's seed into it --
    // `salt` here is the library's number and is the same in every world.
    const stream = mulberry32(Math.floor(hit.u(PLAN_STREAM) * 4294967296));
    return { id, biome: biome.id, x, z, radius, yaw, fields: copyFields(here), random: stream };
  };

  /** The kit a build hook writes its plan through; it collects, it never draws. */
  const collect = (site: Site): { kit: SiteKit; plan: SitePlan } => {
    const roads: RoadSpec[] = [],
      lines: LineSpec[] = [],
      lots: LotSpec[] = [],
      reservations: Reservation[] = [];
    const plan: SitePlan = {
      id: site.id,
      x: site.x,
      z: site.z,
      radius: site.radius,
      roads,
      lines,
      lots,
      reservations,
    };
    const kit: SiteKit = {
      height: (x, z) => heightfield.heightAt(x, z),
      slope: (x, z) => heightfield.slopeAt(x, z),
      road: (points, width, opts) => {
        roads.push({ points: points.map(([x, z]) => [x, z] as [number, number]), width, color: opts?.color });
      },
      line: (points, kind, opts) => {
        // Refused here rather than in the ring, for the reason a lot's structure
        // is: the queue is not the render loop, and a line naming a kind nobody
        // bakes would otherwise be dropped in a frame without a word.
        if (!(kind in LINE_KINDS))
          throw new Error(`scenery library: site ${site.id}: unknown line kind "${kind}"`);
        lines.push({
          points: points.map(([x, z]) => [x, z] as [number, number]),
          kind,
          ...(opts?.height === undefined ? {} : { height: opts.height }),
        });
      },
      reserve: (x, z, radius) => {
        reservations.push({ x, z, radius });
      },
      structure: (kindId, x, z, opts) => {
        // Said here, where it is safe to say: the queue is not the render loop,
        // and a lot naming a building nobody baked would otherwise be dropped
        // without a word when the ring came to raise it.
        const kind = structures.get(kindId);
        if (!kind) throw new Error(`scenery library: site ${site.id}: unknown structure "${kindId}"`);
        const floors = opts?.floors ?? kind.floors[0];
        if (floors < kind.floors[0] || floors > kind.floors[1])
          throw new Error(
            `scenery library: site ${site.id}: ${kindId} has no ${floors}-storey bake, only ${kind.floors[0]}..${kind.floors[1]}`,
          );
        lots.push({
          x,
          z,
          yaw: opts?.yaw ?? 0,
          structure: kindId,
          floors,
          tint: opts?.tint,
        });
      },
      tree: () => {
        throw new Error('scenery library: a site plants through its cells, not through its plan');
      },
      prop: (propId, x, z, opts) => {
        // A prop on a plan is a lot with no building: the ring places it.
        lots.push({
          x,
          z,
          yaw: opts?.yaw ?? 0,
          structure: propId,
          floors: 0,
          tint: opts?.tint as SceneryColor,
        });
      },
      color: (value) => new Color(swatchColor(value)),
    };
    return { kit, plan };
  };

  const build = (site: Site) => {
    const entry = settled.find((s) => s.biome.id === site.biome);
    if (!entry) return;
    const { kit, plan } = collect(site);
    entry.spec.build({ ...site, fields: site.fields }, kit);
    plans.set(site.id, plan);
    built++;
  };

  /** Forgets plans the flight has left well behind, so a long flight is not a leak. */
  const forget = (x: number, z: number, reach: number) => {
    const keep = reach + KEEP_PAD;
    for (const [id, plan] of plans) if (Math.hypot(plan.x - x, plan.z - z) > keep) plans.delete(id);
    for (const [key, site] of found) if (site && Math.hypot(site.x - x, site.z - z) > keep) found.delete(key);
    // The queue too. Seating reads the sampler, so a cell is decided wherever
    // the reach touches it, and a site whose ground the window cannot answer
    // for goes back on the queue: without this, a flight across the world would
    // leave behind a queue of villages it is never coming back to, and the
    // budget would spend itself walking past them.
    if (queue.length > 0) {
      const kept = queue.filter((site) => Math.hypot(site.x - x, site.z - z) <= keep);
      if (kept.length !== queue.length) queue.splice(0, queue.length, ...kept);
    }
    if (built > plans.size) built = plans.size;
  };

  return {
    near(x, z, reach, out) {
      out.length = 0;
      for (const entry of settled) {
        const cell = entry.spec.cell;
        // A site reaches `reach` when its own ground is within it; the widest a
        // site may be is its radius, so look that much further out.
        const span = reach + entry.spec.radius[1];
        const x0 = Math.floor((x - span) / cell),
          x1 = Math.floor((x + span) / cell),
          z0 = Math.floor((z - span) / cell),
          z1 = Math.floor((z + span) / cell);
        for (let gz = z0; gz <= z1; gz++)
          for (let gx = x0; gx <= x1; gx++) {
            const key = `${entry.biome.id}:${gx},${gz}`;
            let site = found.get(key);
            if (site === undefined) {
              // Seating reads the sampler, which answers anywhere, so a cell is
              // decided here once and for all and never depends on where the
              // window happened to be.
              site = seat(entry, gx, gz);
              found.set(key, site);
              if (site) queue.push(site);
            }
            if (site && Math.hypot(site.x - x, site.z - z) <= span) out.push(site);
          }
      }
      out.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
      forget(x, z, reach);
      return out;
    },
    planFor: (site) => plans.get(site.id) ?? null,
    work(budgetMs) {
      if (budgetMs <= 0) return;
      const until = performance.now() + budgetMs;
      // A plan reads the window, so a site the window cannot answer for waits
      // its turn again rather than laying its street over the other side of the
      // world. Each site is looked at once per call: without the count, a queue
      // of nothing but far sites would spin until the budget ran out.
      let left = queue.length;
      while (left-- > 0 && queue.length > 0 && performance.now() < until) {
        const site = queue.shift()!;
        if (plans.has(site.id)) continue;
        if (!inWindow(site.x, site.z, site.radius)) {
          queue.push(site);
          continue;
        }
        build(site);
      }
    },
    get built() {
      return built;
    },
    get queued() {
      return queue.length;
    },
  };
}
