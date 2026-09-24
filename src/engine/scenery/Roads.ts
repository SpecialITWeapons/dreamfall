// The roads between settlements: which pairs, their routes, and what of each
// the ring draws. The routes are searched in a worker -- 14 to 45 ms each over
// nine thousand samples of the ground, and past a hundred round a bay, which a
// frame cannot pay -- and kept here by pair. A pair is asked for once the
// flight is within reach of its line, nearest first; one that has no land way
// is remembered as refused, so an island does not ask again every time the
// flight passes it.
//
// Every road ends at a settlement at both ends, which is the whole point of
// one: it is how a village is found from the air.
//
// The worker is the default runner; a test hands in its own.
import type { SitePlan } from '../../../library/contract';
import { toPolyline, toSegment } from '../../../library/settlements/geometry.js';
import { MAX_EDGE, relativeNeighbours } from './RoadNetwork';
import type { Site, Sites } from './Sites';

/** A road between settlements, m: a country road, narrower than a street. */
export const ROUTE_WIDTH = 5;
/** How far past the ring a pair is asked for, so a road is ready before it is seen, m. */
const LOOKAHEAD = 3000;
/** How far the flight moves before the network is looked at again, m. */
const DISCOVER_STEP = 1000;
/** Routes further than this beyond the reach are forgotten, m. */
const KEEP_PAD = 8000;
/** Where a route meets a street: this near the street's own edge, m. */
const MEET = 2;

export interface RoadRoute {
  id: string;
  /** The end with the smaller id: the route is walked from it. */
  a: Site;
  b: Site;
  points: Array<[number, number]>;
}
export interface RouteJob {
  id: string;
  seed: number;
  a: { id: string; x: number; z: number };
  b: { id: string; x: number; z: number };
}
/** Searches one route and answers once; returns a way to stop listening. */
export type RouteRunner = (
  job: RouteJob,
  done: (points: Array<[number, number]> | null) => void,
) => () => void;

export interface Roads {
  /** Looks at the network around (x, z) when the flight has moved far enough, and asks for what is missing. */
  update(x: number, z: number): void;
  /** The built routes whose line comes within `reach` of (x, z), in id order. */
  near(x: number, z: number, reach: number, out: RoadRoute[]): RoadRoute[];
  /** Grows by one whenever a route arrives: the ring rebuilds on it. */
  readonly version: number;
  readonly built: number;
  /** Waiting for the worker, the one it is searching included. */
  readonly queued: number;
  /** Pairs with no land way between them inside the corridor. */
  readonly refused: number;
  dispose(): void;
}

/** One worker, one route at a time, in the order asked. */
const workerRunner = (): { run: RouteRunner; dispose(): void } => {
  let worker: Worker | null = null;
  const waiting = new Map<string, (points: Array<[number, number]> | null) => void>();
  const start = () => {
    if (worker) return worker;
    worker = new Worker(new URL('./routes.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<{ id: string; points: Float64Array | null }>) => {
      const { id, points } = event.data;
      const done = waiting.get(id);
      waiting.delete(id);
      if (!done) return;
      if (!points) return done(null);
      const out: Array<[number, number]> = [];
      for (let i = 0; i < points.length; i += 2) out.push([points[i]!, points[i + 1]!]);
      done(out);
    });
    return worker;
  };
  return {
    run(job, done) {
      waiting.set(job.id, done);
      start().postMessage(job);
      return () => waiting.delete(job.id);
    },
    dispose() {
      worker?.terminate();
      worker = null;
      waiting.clear();
    },
  };
};

export function createRoads(deps: { seed: number; sites: Sites; run?: RouteRunner; reach?: number }): Roads {
  const { seed, sites } = deps;
  const reach = deps.reach ?? 2600;
  const own = deps.run ? null : workerRunner();
  const run = deps.run ?? own!.run;
  /** A route by pair, or null for a pair that has no land way. */
  const routes = new Map<string, RoadRoute | null>();
  const queue: Array<{ id: string; a: Site; b: Site; d: number }> = [];
  let running: string | null = null,
    stop: (() => void) | null = null,
    version = 0,
    atX = Number.NaN,
    atZ = Number.NaN;
  const charted: Site[] = [];

  const next = () => {
    if (running || queue.length === 0) return;
    const job = queue.shift()!;
    running = job.id;
    stop = run(
      {
        id: job.id,
        seed,
        a: { id: job.a.id, x: job.a.x, z: job.a.z },
        b: { id: job.b.id, x: job.b.x, z: job.b.z },
      },
      (points) => {
        routes.set(job.id, points ? { id: job.id, a: job.a, b: job.b, points } : null);
        if (points) version++;
        running = null;
        stop = null;
        next();
      },
    );
  };

  return {
    update(x, z) {
      if (Math.hypot(x - atX, z - atZ) < DISCOVER_STEP) return;
      atX = x;
      atZ = z;
      // Every place within one edge of every end a wanted road may have, so the
      // graph is decided with all of each pair's rivals in it.
      const places = sites.charted(x, z, reach + LOOKAHEAD + 2 * MAX_EDGE, charted);
      const line = (a: Site, b: Site) => toSegment(a.x, a.z, b.x, b.z, x, z);
      for (const edge of relativeNeighbours(places)) {
        const d = line(edge.a, edge.b);
        if (d > reach + LOOKAHEAD) continue;
        if (routes.has(edge.id) || running === edge.id || queue.some((q) => q.id === edge.id)) continue;
        queue.push({ id: edge.id, a: edge.a, b: edge.b, d });
      }
      // Nearest first, from where the flight is now; a pair the flight has left
      // behind before its turn came stays queued and waits.
      for (const job of queue) job.d = line(job.a, job.b);
      queue.sort((p, q) => p.d - q.d);
      for (const [id, route] of routes)
        if (route && line(route.a, route.b) > reach + LOOKAHEAD + KEEP_PAD) routes.delete(id);
      next();
    },
    near(x, z, within, out) {
      out.length = 0;
      for (const route of routes.values())
        if (route && toPolyline(route.points, x, z) <= within) out.push(route);
      out.sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
      return out;
    },
    get version() {
      return version;
    },
    get built() {
      let n = 0;
      for (const route of routes.values()) if (route) n++;
      return n;
    },
    get queued() {
      return queue.length + (running ? 1 : 0);
    },
    get refused() {
      let n = 0;
      for (const route of routes.values()) if (!route) n++;
      return n;
    },
    dispose() {
      stop?.();
      own?.dispose();
      queue.length = 0;
    },
  };
}

/** The nearest point on a polyline to (x, z), and how far it is. */
function nearestOn(points: Array<[number, number]>, x: number, z: number) {
  let best = { x: points[0]![0], z: points[0]![1], d: Infinity };
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1]!,
      [bx, bz] = points[i]!;
    const dx = bx - ax,
      dz = bz - az,
      len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    const px = ax + dx * t,
      pz = az + dz * t,
      d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { x: px, z: pz, d };
  }
  return best;
}

/**
 * Where one end of a route stops, walking in from outside the settlement: the
 * index of the first point outside its radius, and with a plan, the point on
 * its street the route runs into.
 */
function endOf(points: Array<[number, number]>, at: Site, plan: SitePlan | null) {
  let out = 0;
  while (out < points.length - 1 && Math.hypot(points[out]![0] - at.x, points[out]![1] - at.z) <= at.radius)
    out++;
  if (!plan || plan.roads.length === 0) return { index: out, join: null };
  // In from the edge until the route comes within reach of a street; it joins
  // the street where it came nearest, so it never stops short in a garden.
  let best = { index: out, x: 0, z: 0, d: Infinity };
  for (let i = out; i >= 0; i--) {
    const [x, z] = points[i]!;
    for (const road of plan.roads) {
      if (road.points.length < 2) continue;
      const on = nearestOn(road.points, x, z);
      const gap = on.d - road.width / 2;
      if (gap < best.d) best = { index: i, x: on.x, z: on.z, d: gap };
    }
    if (best.d <= MEET) break;
  }
  if (!Number.isFinite(best.d)) return { index: out, join: null };
  return { index: best.index, join: [best.x, best.z] as [number, number] };
}

/**
 * What of a route is drawn. Outside the two settlements it is drawn always;
 * inside one it is drawn only once that settlement's plan is built, and then
 * only as far as the street it runs into -- before that it stops at the edge,
 * because a road into a village with no street yet is a road into a field.
 */
export function stretchOf(
  route: RoadRoute,
  planA: SitePlan | null,
  planB: SitePlan | null,
): Array<[number, number]> {
  const points = route.points;
  const head = endOf(points, route.a, planA);
  const tail = endOf([...points].reverse(), route.b, planB);
  const last = points.length - 1 - tail.index;
  if (last <= head.index) return [];
  const body = points.slice(head.index, last + 1);
  if (head.join) body.unshift(head.join);
  if (tail.join) body.push(tail.join);
  return body;
}

/** A route cut into pieces of about `length` m, each sharing its first point with the last of the one before. */
export function chunksOf(points: Array<[number, number]>, length = 1000): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  let piece: Array<[number, number]> = [];
  let walked = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const prev = piece.at(-1);
    if (prev) walked += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    piece.push(p);
    if (walked >= length && i < points.length - 1) {
      out.push(piece);
      piece = [p];
      walked = 0;
    }
  }
  if (piece.length > 1) out.push(piece);
  return out;
}
