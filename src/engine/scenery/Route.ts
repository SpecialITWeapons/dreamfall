// The road between two settlements, as a pure function of the seed and the
// pair. A* over the base height on a grid, from the end with the smaller id,
// so the road is the same whichever way the flight came to it: a road that
// depended on the approach would move under a flyer who turned round.
//
// The cost is the road's own: the run, a grade that costs its square and is
// refused past `maxGrade` so a hillside is climbed in turns, and on the flat a
// slow noise that stands for everything the terrain does not say -- a wet
// meadow, somebody's field -- without which a road on a plain is a ruler.
// Pure CPU: no three, no DOM; the worker runs it off the main thread.
import { fbm, hash2, sstep } from '../terrain/noise';

export const ROUTE = {
  /** Metres between the nodes the search walks. */
  grid: 48,
  /** How far outside the pair's own box the search may go, m. */
  pad: 3000,
  /** Ground under this is sea, and a wall. */
  sea: 3,
  /** The steepest grade a road takes; a hillside past it is climbed in turns. */
  maxGrade: 0.12,
  /** What a grade costs, on top of the run: `run * gradeCost * grade^2`. */
  gradeCost: 40,
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
  const { grid, pad, sea, maxGrade, gradeCost, wander } = ROUTE;
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
      if (grade > maxGrade && i !== start && j !== goal) continue;
      const mx = x0 + (ix + dx / 2) * grid,
        mz = z0 + (iz + dz / 2) * grid;
      const field = (fbm(mx / wander.scale, mz / wander.scale, salt, 3) + 1) / 2;
      const flat = 1 - sstep(wander.flat[0], wander.flat[1], grade);
      const next = cost[i]! + run * (1 + gradeCost * grade * grade + wander.weight * field * flat);
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
