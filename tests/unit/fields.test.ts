import { describe, expect, it } from 'vitest';
import { createFields } from '../../src/engine/terrain/Fields';
import { CELL, createWorldSampler } from '../../src/engine/terrain/WorldSampler';

const fields = () => createFields(createWorldSampler(42));
/** Walks east from the origin until the ground meets a condition, so a test asserts about real terrain. */
const walkTo = (test: (h: number) => boolean) => {
  const f = fields();
  for (let x = 0; x < 120_000; x += 64) if (test(f.at(x, 0).baseHeight)) return x;
  throw new Error('seed 42 has no such ground within 120 km east of the origin');
};
/** The water line east of the origin, found by bisecting the first crossing. */
const waterLine = () => {
  const f = fields();
  let dry = 0;
  const wet = walkTo((h) => h < 0);
  for (let x = wet - 64; x >= 0; x -= 64)
    if (f.at(x, 0).baseHeight > 0) {
      dry = x;
      break;
    }
  let lo = dry,
    hi = wet;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (f.at(mid, 0).baseHeight > 0) lo = mid;
    else hi = mid;
  }
  return lo;
};

describe('createFields', () => {
  it('carries the base fields of the sampler, with the altitude cooling split out', () => {
    const f = fields().at(0, 0);
    expect(f.x).toBe(0);
    expect(f.z).toBe(0);
    expect(f.baseHeight).toBeCloseTo(43.8859, 3); // seed 42 at the origin
    expect(f.baseTemp).toBeCloseTo(f.temp + Math.max(0, f.baseHeight) / 2600, 9);
    expect(f.baseTemp).toBeGreaterThan(f.temp); // the origin is above the sea
    for (const v of [f.cont, f.temp, f.moist, f.region, f.shore]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it('is one object, rewritten in place: a hook may read it but never keep it', () => {
    const f = fields();
    const first = f.at(1000, -2000);
    const height = first.baseHeight;
    const second = f.at(9000, 4000);
    expect(second).toBe(first); // the same object, on purpose
    expect(second.baseHeight).not.toBe(height);
    expect(f.at(1000, -2000).baseHeight).toBe(height); // and the same place reads the same
  });
  it('hashes per cell, not per point, and stays in 0..1', () => {
    const f = fields();
    const a = f.at(0, 0).hash(7),
      b = f.at(CELL * 0.4, CELL * 0.4).hash(7), // same cell
      c = f.at(CELL * 3, 0).hash(7),
      d = f.at(0, 0).hash(8);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(d).not.toBe(a);
    for (const v of [a, c, d]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('gives fractal noise in -1..1, by scale and salt', () => {
    const f = fields().at(2000, 3000);
    const a = f.noise(600, 1),
      b = f.noise(600, 2),
      c = f.noise(6000, 1);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    for (const v of [a, b, c]) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(fields().at(2000, 3000).noise(600, 1)).toBe(a);
  });
  it('salts noise and hashes with the world seed, so two worlds are two worlds', () => {
    const here = createFields(createWorldSampler(7)).at(2000, 3000);
    const noise = here.noise(370, 1),
      hash = here.hash(7);
    // the lattice too: it is where the sites of M4 will stand, and two worlds
    // whose villages sit on the same grid are one world with two palettes
    const centre = here.lattice(6000, 3),
      where = [centre.cx, centre.cz],
      stream = centre.u(0);
    const other = createFields(createWorldSampler(8)).at(2000, 3000);
    expect(other.noise(370, 1)).not.toBe(noise);
    expect(other.hash(7)).not.toBe(hash);
    const elsewhere = other.lattice(6000, 3);
    expect([elsewhere.cx, elsewhere.cz]).not.toEqual(where);
    expect(elsewhere.u(0)).not.toBe(stream);
    const again = createFields(createWorldSampler(7)).at(2000, 3000);
    expect(again.noise(370, 1)).toBe(noise); // and one seed is still one world
    expect(again.hash(7)).toBe(hash);
    const back = again.lattice(6000, 3);
    expect([back.cx, back.cz]).toEqual(where);
    expect(back.u(0)).toBe(stream);
    expect(noise).toBeGreaterThanOrEqual(-1);
    expect(noise).toBeLessThanOrEqual(1);
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThan(1);
  });
  it('shores at the water line and lets go of the high ground', () => {
    const f = fields();
    const coast = waterLine();
    expect(Math.abs(f.at(coast, 0).baseHeight)).toBeLessThan(0.01);
    expect(f.at(coast, 0).shore).toBeGreaterThan(0.99);
    const high = walkTo((h) => h > 120);
    expect(f.at(high, 0).shore).toBe(0);
    // the sea floor is not a shore either: the shelf bottoms it out near -46 m,
    // which is outside the reach on purpose
    const deep = walkTo((h) => h < -40);
    expect(f.at(deep, 0).shore).toBe(0);
  });
  it('carries the height of the lattice centre, sampled once per cell', () => {
    const sampler = createWorldSampler(42);
    const f = createFields(sampler);
    const hit = f.at(3000, 3000).lattice(6000, 3);
    // the centre's own height, not this point's: that is what a plateau flattens toward
    const there = new Float64Array(5);
    sampler.baseFields(hit.cx, hit.cz, there);
    expect(hit.h).toBeCloseTo(there[0]!, 9);
    expect(hit.h).not.toBeCloseTo(f.at(3000, 3000).baseHeight, 3);
    // a neighbour in the same lattice cell gets the same centre and the same height
    const same = f.at(3400, 2600).lattice(6000, 3);
    expect(same.cx).toBe(hit.cx);
    expect(same.h).toBe(hit.h);
  });

  it('gives one lattice centre per cell, with its own random stream', () => {
    const f = fields();
    const hit = f.at(3000, 3000).lattice(6000, 3);
    expect(Math.hypot(hit.cx - 3000, hit.cz - 3000)).toBeCloseTo(hit.d, 6);
    // a neighbouring point inside the same lattice cell finds the same centre
    const same = f.at(3200, 3100).lattice(6000, 3);
    expect(same.cx).toBe(hit.cx);
    expect(same.cz).toBe(hit.cz);
    expect(same.u(0)).toBe(hit.u(0));
    expect(same.u(1)).not.toBe(same.u(0));
    for (let k = 0; k < 4; k++) {
      expect(same.u(k)).toBeGreaterThanOrEqual(0);
      expect(same.u(k)).toBeLessThan(1);
    }
    // the hit is rewritten in place as well, so a test -- and a hook -- must
    // read what it needs before asking again
    const cx = hit.cx,
      u0 = hit.u(0);
    expect(f.at(3000, 3000).lattice(6000, 4).cx).not.toBe(cx); // another salt, another lattice
    expect(f.at(21000, 3000).lattice(6000, 3).cx).not.toBe(cx); // another cell, another centre
    expect(f.at(3000, 3000).lattice(6000, 3).u(0)).toBe(u0); // and back again
    // the centre stays inside its own cell
    expect(cx).toBeGreaterThan(0);
    expect(cx).toBeLessThan(6000);
  });
});
