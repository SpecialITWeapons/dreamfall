import { describe, expect, it } from 'vitest';
import { ROUTE, SHAPE, pathBetween, routeBetween } from '../../src/engine/scenery/Route';

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

  it('keeps to land, and on gentle ground to the grade a road takes without complaint', () => {
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

describe('routeBetween', () => {
  const turn = (p: Array<[number, number]>, i: number) => {
    const [ax, az] = p[i - 1]!,
      [bx, bz] = p[i]!,
      [cx, cz] = p[i + 1]!;
    const u = Math.atan2(bz - az, bx - ax),
      v = Math.atan2(cz - bz, cx - bx);
    return Math.abs(Math.atan2(Math.sin(v - u), Math.cos(v - u)));
  };

  it('is the path rounded and sampled, and the same from both ends', () => {
    const one = routeBetween(a, b, land, 42)!,
      two = routeBetween(b, a, land, 42)!;
    expect(two).toEqual(one);
    expect(one[0]![0]).toBeCloseTo(a.x, 6);
    expect(one.at(-1)![0]).toBeCloseTo(b.x, 6);
    for (let i = 1; i < one.length - 1; i++) {
      const step = Math.hypot(one[i]![0] - one[i - 1]![0], one[i]![1] - one[i - 1]![1]);
      expect(step).toBeLessThanOrEqual(SHAPE.sample * 1.5);
    }
  });

  it('turns no tighter than a road can', () => {
    const path = routeBetween(a, b, land, 42)!;
    // on this rolling land the slope never reaches the serpentine's, so every
    // bend is held to the open radius
    const limit = SHAPE.sample / SHAPE.turn.radius;
    for (let i = 1; i < path.length - 1; i++) expect(turn(path, i)).toBeLessThanOrEqual(limit * 1.05);
  });

  it('keeps near its grade after the rounding, and off the sea', () => {
    const path = routeBetween(a, b, land, 42)!;
    for (let i = 1; i < path.length; i++) {
      const [x0, z0] = path[i - 1]!,
        [x1, z1] = path[i]!;
      expect(land(x1, z1)).toBeGreaterThanOrEqual(ROUTE.sea);
      const run = Math.hypot(x1 - x0, z1 - z0);
      if (run > 1)
        expect(Math.abs(land(x1, z1) - land(x0, z0)) / run).toBeLessThanOrEqual(ROUTE.maxGrade * 1.6);
    }
  });

  it('sways on the flat', () => {
    const flat = () => 50;
    const onFlat = routeBetween(a, { id: 'village:1,0', x: 8000, z: 0 }, flat, 42)!;
    let sum = 0;
    for (let i = 1; i < onFlat.length - 1; i++) sum += turn(onFlat, i);
    expect(sum / (onFlat.length - 2)).toBeGreaterThan(0.01);
  });
});
