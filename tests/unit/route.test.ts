import { describe, expect, it } from 'vitest';
import { ROUTE, pathBetween } from '../../src/engine/scenery/Route';

/** Rolling land with a sea to the south of z = -3000. */
const land = (x: number, z: number) => (z < -3000 ? -20 : 60 + 25 * Math.sin(x / 700) * Math.cos(z / 900));
const a = { id: 'village:0,0', x: 0, z: 0 },
  b = { id: 'village:1,0', x: 6000, z: 1500 };
const length = (p: Array<[number, number]>) =>
  p.slice(1).reduce((sum, q, i) => sum + Math.hypot(q[0] - p[i]![0], q[1] - p[i]![1]), 0);

describe('pathBetween', () => {
  it('walks from the end with the smaller id to the other, whichever is asked first', () => {
    const one = pathBetween(a, b, land, 42)!,
      two = pathBetween(b, a, land, 42)!;
    expect(one).not.toBeNull();
    expect(two).toEqual(one);
    expect(one[0]).toEqual([a.x, a.z]);
    expect(one.at(-1)).toEqual([b.x, b.z]);
  });

  it('keeps to land and to a grade a road can take', () => {
    const path = pathBetween(a, b, land, 42)!;
    for (let i = 1; i < path.length; i++) {
      const [x0, z0] = path[i - 1]!,
        [x1, z1] = path[i]!;
      expect(land(x1, z1)).toBeGreaterThanOrEqual(ROUTE.sea);
      const run = Math.hypot(x1 - x0, z1 - z0);
      if (i > 1 && i < path.length - 1)
        expect(Math.abs(land(x1, z1) - land(x0, z0)) / run).toBeLessThanOrEqual(ROUTE.maxGrade + 1e-9);
    }
    expect(length(path)).toBeLessThan(Math.hypot(b.x - a.x, b.z - a.z) * ROUTE.detour);
  });

  it('finds no road across the sea', () => {
    expect(pathBetween(a, { id: 'village:0,-2', x: 0, z: -9000 }, land, 42)).toBeNull();
  });

  it('bends on the flat, where nothing else would make it', () => {
    const flat = () => 50;
    const path = pathBetween(a, { id: 'village:1,0', x: 8000, z: 0 }, flat, 42)!;
    // a ruler would keep every point on z = 0
    expect(Math.max(...path.map((p) => Math.abs(p[1])))).toBeGreaterThan(ROUTE.grid);
  });
});
