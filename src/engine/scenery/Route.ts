// The road between two settlements, as a pure function of the seed and the
// pair. A* over the base height on a grid, from the end with the smaller id,
// so the road is the same whichever way the flight came to it: a road that
// depended on the approach would move under a flyer who turned round.
//
// The cost is the road's own: the run, a grade that costs its square and
// costs a great deal more past `maxGrade`, so a hillside is climbed in turns
// where turns are cheaper than the climb; and on the flat a slow noise that
// stands for everything the terrain does not say -- a wet meadow, somebody's
// field -- without which a road on a plain is a ruler.
//
// Past `maxGrade` is a cost and not a wall, and that is measured: this world
// tilts 10 % over the median 48 m step and 23 % over one step in four, and a
// wall at 12 % joined one pair in fourteen on seed 42 where nine have a land
// way at all. With the cost, the sea is what decides which pairs are joined,
// and the road climbs 15 to 18 % at nineteen steps in twenty.
// Pure CPU: no three, no DOM; the worker runs it off the main thread.
import { fbm, hash2, sstep } from '../terrain/noise';

export const ROUTE = {
  /** Metres between the nodes the search walks. */
  grid: 48,
  /** How far outside the pair's own box the search may go, m. */
  pad: 3000,
  /** Ground under this is sea, and a wall. */
  sea: 3,
  /** The grade a road takes without complaint; past it every step costs `steepCost`. */
  maxGrade: 0.12,
  /** What a grade costs, on top of the run: `run * gradeCost * grade^2`. */
  gradeCost: 40,
  /** What each step past `maxGrade` costs: `run * steepCost * (grade - maxGrade)^2`. */
  steepCost: 400,
  /** A grade no road takes: a cliff, and a wall. */
  cliff: 0.6,
  /**
   * The flat's own reasons to bend. `weight` is the most it adds to a metre;
   * it fades out between the two grades of `flat`, where the terrain starts to
   * give the road reasons of its own.
   */
  wander: { scale: 600, weight: 0.8, salt: 0x70ad, flat: [0.02, 0.08] as [number, number] },
  /** A road longer than this times the straight line is a detour round a bay, and is not built. */
  detour: 2.5,
};

export interface RouteEnd {
  id: string;
  x: number;
  z: number;
}
export type HeightAt = (x: number, z: number) => number;

const STEPS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** A pair's own salt, from both ids and the seed: two roads never wander alike. */
export function pairSalt(a: RouteEnd, b: RouteEnd, seed: number): number {
  let h = seed | 0;
  for (const c of `${a.id}|${b.id}`) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return hash2(h, 0x5eed, 0x7a11) & 0xffff;
}

/**
 * The grid path from the end with the smaller id to the other, its two ends
 * the settlements' own centres; or null, when there is no land way inside the
 * corridor or only a detour.
 */
export function pathBetween(
  first: RouteEnd,
  second: RouteEnd,
  heightAt: HeightAt,
  seed: number,
): Array<[number, number]> | null {
  const [a, b] = first.id < second.id ? [first, second] : [second, first];
  const { grid, pad, sea, maxGrade, gradeCost, steepCost, cliff, wander } = ROUTE;
  const salt = pairSalt(a, b, seed);
  // The grid is the world's, not the pair's: its nodes sit on multiples of the
  // step, so two roads out of one village share their first metres of lattice.
  const x0 = Math.floor((Math.min(a.x, b.x) - pad) / grid) * grid,
    z0 = Math.floor((Math.min(a.z, b.z) - pad) / grid) * grid;
  const w = Math.ceil((Math.max(a.x, b.x) + pad - x0) / grid) + 1,
    h = Math.ceil((Math.max(a.z, b.z) + pad - z0) / grid) + 1;
  const n = w * h;
  const height = new Float32Array(n).fill(Number.NaN);
  const heightOf = (i: number) => {
    if (Number.isNaN(height[i]!)) height[i] = heightAt(x0 + (i % w) * grid, z0 + Math.floor(i / w) * grid);
    return height[i]!;
  };
  const node = (x: number, z: number) => Math.round((z - z0) / grid) * w + Math.round((x - x0) / grid);
  const start = node(a.x, a.z),
    goal = node(b.x, b.z);
  if (heightOf(start) < sea || heightOf(goal) < sea) return null;
  const gx = goal % w,
    gz = Math.floor(goal / w);
  const guess = (i: number) => Math.hypot((i % w) - gx, Math.floor(i / w) - gz) * grid;

  const cost = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  // A binary heap of node and key, in two arrays: this runs over a hundred
  // thousand nodes and allocates nothing per step.
  const heap: number[] = [],
    keys: number[] = [];
  const push = (i: number, key: number) => {
    let c = heap.length;
    heap.push(i);
    keys.push(key);
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (keys[p]! <= keys[c]!) break;
      [heap[p], heap[c]] = [heap[c]!, heap[p]!];
      [keys[p], keys[c]] = [keys[c]!, keys[p]!];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0]!;
    const last = heap.pop()!,
      lastKey = keys.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      keys[0] = lastKey;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1,
          r = l + 1;
        let m = c;
        if (l < heap.length && keys[l]! < keys[m]!) m = l;
        if (r < heap.length && keys[r]! < keys[m]!) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c]!, heap[m]!];
        [keys[m], keys[c]] = [keys[c]!, keys[m]!];
        c = m;
      }
    }
    return top;
  };

  cost[start] = 0;
  push(start, guess(start));
  while (heap.length > 0) {
    const i = pop();
    if (closed[i]) continue;
    closed[i] = 1;
    if (i === goal) break;
    const ix = i % w,
      iz = Math.floor(i / w),
      hi = heightOf(i);
    for (const [dx, dz] of STEPS) {
      const jx = ix + dx,
        jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= w || jz >= h) continue;
      const j = jz * w + jx;
      if (closed[j]) continue;
      const hj = heightOf(j);
      if (hj < sea) continue;
      const run = Math.hypot(dx, dz) * grid,
        grade = Math.abs(hj - hi) / run;
      // The first and last steps leave and enter a settlement, whose plateau is
      // not in the base height: they may take any grade.
      if (grade > cliff && i !== start && j !== goal) continue;
      const over = Math.max(0, grade - maxGrade);
      const mx = x0 + (ix + dx / 2) * grid,
        mz = z0 + (iz + dz / 2) * grid;
      const field = (fbm(mx / wander.scale, mz / wander.scale, salt, 3) + 1) / 2;
      const flat = 1 - sstep(wander.flat[0], wander.flat[1], grade);
      const next =
        cost[i]! +
        run * (1 + gradeCost * grade * grade + steepCost * over * over + wander.weight * field * flat);
      if (next < cost[j]!) {
        cost[j] = next;
        from[j] = i;
        push(j, next + guess(j));
      }
    }
  }
  if (from[goal] === -1) return null;
  const path: Array<[number, number]> = [];
  for (let i = goal; i !== -1; i = from[i]!) path.push([x0 + (i % w) * grid, z0 + Math.floor(i / w) * grid]);
  path.reverse();
  path[0] = [a.x, a.z];
  path[path.length - 1] = [b.x, b.z];
  let length = 0;
  for (let i = 1; i < path.length; i++)
    length += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]);
  if (length > ROUTE.detour * Math.hypot(b.x - a.x, b.z - a.z)) return null;
  return path;
}

export const SHAPE = {
  /** Metres between the points of the finished road. */
  sample: 24,
  /** Rounding passes over the grid's stairs: Chaikin's, which cuts corners and never straightens a bend. */
  chaikin: 2,
  /**
   * A country road's own sway: a few metres off its line, a few hundred metres
   * a wave, and none of it on a hillside, where the terrain already bends it
   * and a sway would only add a grade. It tapers to nothing at the two ends, so
   * the road meets a settlement's street straight.
   */
  meander: {
    amplitude: 9,
    wavelength: 350,
    salt: 0x3ea7,
    taper: 200,
    steep: [0.04, 0.12] as [number, number],
  },
  /**
   * The tightest bend, m: 40 in open country, 20 on a slope steeper than
   * `steepSlope`, where a serpentine's hairpin is what a road does.
   */
  turn: { radius: 40, steep: 20, steepSlope: 0.15, passes: 24 },
  /** Metres either side the slope under a point is measured across. */
  probe: 60,
};

/** Chaikin's corner cutting, the two ends kept where they are. */
function chaikin(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length < 3) return points;
  const out: Array<[number, number]> = [points[0]!];
  for (let i = 0; i + 1 < points.length; i++) {
    const [x0, z0] = points[i]!,
      [x1, z1] = points[i + 1]!;
    out.push([x0 * 0.75 + x1 * 0.25, z0 * 0.75 + z1 * 0.25], [x0 * 0.25 + x1 * 0.75, z0 * 0.25 + z1 * 0.75]);
  }
  out.push(points.at(-1)!);
  return out;
}

/** The polyline walked every `step` metres, its two ends included. */
function resample(points: Array<[number, number]>, step: number): Array<[number, number]> {
  const out: Array<[number, number]> = [points[0]!];
  let carry = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const [x0, z0] = points[i]!,
      [x1, z1] = points[i + 1]!;
    const length = Math.hypot(x1 - x0, z1 - z0);
    let at = step - carry;
    while (at < length) {
      const t = at / length;
      out.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]);
      at += step;
    }
    carry = length - (at - step);
  }
  const last = points.at(-1)!,
    tail = out.at(-1)!;
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.25) out.push(last);
  else out[out.length - 1] = last;
  return out;
}

/**
 * The road a flight follows: the path rounded, swayed on the flat, its bends
 * eased to what a road can take, and sampled every `SHAPE.sample` metres,
 * from the end with the smaller id to the other. Null where `pathBetween` is.
 */
export function routeBetween(
  first: RouteEnd,
  second: RouteEnd,
  heightAt: HeightAt,
  seed: number,
): Array<[number, number]> | null {
  const path = pathBetween(first, second, heightAt, seed);
  if (!path) return null;
  const [a, b] = first.id < second.id ? [first, second] : [second, first];
  const salt = pairSalt(a, b, seed) ^ SHAPE.meander.salt;
  let points = path;
  for (let k = 0; k < SHAPE.chaikin; k++) points = chaikin(points);
  points = resample(points, SHAPE.sample);
  const slopeAt = (x: number, z: number) => {
    const p = SHAPE.probe;
    return (
      Math.hypot(heightAt(x + p, z) - heightAt(x - p, z), heightAt(x, z + p) - heightAt(x, z - p)) / (2 * p)
    );
  };
  const slopes = points.map(([x, z]) => slopeAt(x, z));

  // The sway: across the road, by a slow noise of the distance walked.
  const total = (points.length - 1) * SHAPE.sample;
  const { amplitude, wavelength, taper, steep } = SHAPE.meander;
  const out = points.map(([x, z], i): [number, number] => {
    if (i === 0 || i === points.length - 1) return [x, z];
    const [px, pz] = points[i - 1]!,
      [nx, nz] = points[i + 1]!;
    const dx = nx - px,
      dz = nz - pz,
      d = Math.hypot(dx, dz) || 1;
    const along = i * SHAPE.sample;
    const ends = sstep(0, taper, along) * sstep(0, taper, total - along);
    const open = 1 - sstep(steep[0], steep[1], slopes[i]!);
    const offset = amplitude * ends * open * fbm(along / wavelength, 0.5, salt, 2);
    return [x - (dz / d) * offset, z + (dx / d) * offset];
  });

  // The bends a road cannot take are eased: a point that turns the road more
  // than its radius allows moves half way to its neighbours' middle, and the
  // pass repeats until none does.
  for (let pass = 0; pass < SHAPE.turn.passes; pass++) {
    let eased = false;
    for (let i = 1; i < out.length - 1; i++) {
      const [ax, az] = out[i - 1]!,
        [bx, bz] = out[i]!,
        [cx, cz] = out[i + 1]!;
      const u = Math.atan2(bz - az, bx - ax),
        v = Math.atan2(cz - bz, cx - bx);
      const angle = Math.abs(Math.atan2(Math.sin(v - u), Math.cos(v - u)));
      const radius = slopes[i]! > SHAPE.turn.steepSlope ? SHAPE.turn.steep : SHAPE.turn.radius;
      if (angle <= SHAPE.sample / radius) continue;
      out[i] = [bx + ((ax + cx) / 2 - bx) * 0.5, bz + ((az + cz) / 2 - bz) * 0.5];
      eased = true;
    }
    if (!eased) break;
  }
  return out;
}
