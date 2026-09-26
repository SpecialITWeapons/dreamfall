import { describe, expect, it } from 'vitest';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';
import {
  OPENNESS,
  OPENNESS_TAPS,
  WATER_COLORS,
  WATER_LOOK,
  opennessOf,
  reachAt,
  waterLookStart,
} from '../../src/engine/water/WaterLook';

/**
 * The shores of one world, sorted by what they are the shore of: every body of
 * water on a 64 m grid over 40 km is flood-filled, and a body under 1 km2 that
 * does not run off the square is a lake, one over 10 km2 or cut by the square's
 * edge is the sea. What lies between is neither and is left out.
 */
function shoresOf(seed: number) {
  const sampler = createWorldSampler(seed);
  const STEP = 64,
    N = 625,
    half = (N * STEP) / 2;
  const out = new Float64Array(5);
  const depthAt = (x: number, z: number) => {
    sampler.baseFields(x, z, out);
    return -out[0]!;
  };
  const h = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) h[j * N + i] = -depthAt(i * STEP - half, j * STEP - half);
  const body = new Int32Array(N * N).fill(-1);
  const size: number[] = [],
    cut: boolean[] = [];
  const stack: number[] = [];
  for (let k = 0; k < N * N; k++) {
    if (h[k]! >= 0 || body[k] !== -1) continue;
    const id = size.length;
    size.push(0);
    cut.push(false);
    body[k] = id;
    stack.push(k);
    while (stack.length > 0) {
      const q = stack.pop()!;
      const x = q % N,
        y = (q / N) | 0;
      size[id]!++;
      if (x === 0 || y === 0 || x === N - 1 || y === N - 1) cut[id] = true;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const nq = ny * N + nx;
        if (h[nq]! < 0 && body[nq] === -1) {
          body[nq] = id;
          stack.push(nq);
        }
      }
    }
  }
  const km2 = (id: number) => (size[id]! * STEP * STEP) / 1e6;
  const lake: number[] = [],
    sea: number[] = [];
  const look = waterLookStart();
  // The shore is the first two metres of water; the taps must stay on the square.
  const margin = Math.ceil(OPENNESS.rings[1] / STEP) + 1;
  for (let k = 0; k < N * N; k++) {
    const d = -h[k]!;
    if (!(d > 0.2 && d < 2)) continue;
    const x = k % N,
      y = (k / N) | 0;
    if (x < margin || y < margin || x >= N - margin || y >= N - margin) continue;
    const id = body[k]!;
    const open = opennessOf(reachAt(depthAt, x * STEP - half, y * STEP - half), look.openFrom, look.openTo);
    if (!cut[id] && km2(id) < 1) lake.push(open);
    else if (cut[id] || km2(id) > 10) sea.push(open);
  }
  return { lake, sea };
}

const share = (values: number[], test: (v: number) => boolean) => values.filter(test).length / values.length;

describe('the water tells a lake from the sea', () => {
  it('lays sixteen taps on two rings, each ring at its own radius', () => {
    expect(OPENNESS_TAPS).toHaveLength(OPENNESS.rings.length * OPENNESS.taps);
    OPENNESS_TAPS.forEach(([x, z], i) => {
      expect(Math.hypot(x, z)).toBeCloseTo(OPENNESS.rings[Math.floor(i / OPENNESS.taps)]!, 6);
    });
  });

  it('reads the mean depth round a point, land as none and depth past the floor as the floor', () => {
    expect(reachAt(() => -30, 0, 0)).toBe(0);
    // two taps in sixteen are east of 400 m, the outer ring's either side of east
    expect(reachAt((x) => (x > 400 ? 20 : -5), 0, 0)).toBeCloseTo((20 / OPENNESS.full) * (2 / 16), 9);
    expect(reachAt(() => 200, 0, 0)).toBe(1);
    expect(opennessOf(0, 0.4, 0.8)).toBe(0);
    expect(opennessOf(0.6, 0.4, 0.8)).toBeCloseTo(0.5, 9);
    expect(opennessOf(1, 0.4, 0.8)).toBe(1);
    // thresholds that meet are a step, not a division by zero
    expect(opennessOf(0.5, 0.5, 0.5)).toBe(1);
    expect(opennessOf(0.4, 0.5, 0.5)).toBe(0);
  });

  it.each([42, 7])('seed %i: a lake shore is mostly a lake and a sea shore mostly the sea', (seed) => {
    const { lake, sea } = shoresOf(seed);
    expect(lake.length).toBeGreaterThan(40);
    expect(sea.length).toBeGreaterThan(400);
    // Measured: 0.79 and 0.87 of lake shores under a half, 0.84 of sea shores
    // over it. The rest is what a look round a point cannot know: how big the
    // body it stands in is.
    expect(share(lake, (v) => v < 0.5)).toBeGreaterThan(0.72);
    expect(share(sea, (v) => v > 0.5)).toBeGreaterThan(0.78);
  });

  it('starts every number inside its own range, and names four colours', () => {
    for (const [key, [min, max, start]] of Object.entries(WATER_LOOK)) {
      expect(min, key).toBeLessThan(max);
      expect(start, key).toBeGreaterThanOrEqual(min);
      expect(start, key).toBeLessThanOrEqual(max);
    }
    expect(waterLookStart().seaDeepAt).toBe(WATER_LOOK.seaDeepAt[2]);
    expect(Object.keys(WATER_COLORS).sort()).toEqual(['lakeDeep', 'lakeShallow', 'seaDeep', 'seaShallow']);
  });
});
