import { describe, expect, it } from 'vitest';
import type { Fields } from '../../library/contract';
import { CLIMATE, climatePoint, heightBand, max, mul } from '../../library/standard/presence.js';
import { offset, terraces } from '../../library/standard/height.js';
import { resolveHeight, resolvePresence } from '../../library/standard/index.js';

const at = (over: Partial<Fields> = {}): Fields => ({
  x: 0,
  z: 0,
  cont: 0.5,
  temp: 0.5,
  baseTemp: 0.5,
  moist: 0.5,
  region: 0.5,
  baseHeight: 100,
  shore: 0,
  hash: () => 0.5,
  noise: () => 0,
  lattice: () => ({ cx: 0, cz: 0, d: 0, u: () => 0.5 }),
  ...over,
});

describe('climatePoint', () => {
  it('is one at its own point and falls off with the stretched distance', () => {
    const here = climatePoint({ point: [0.5, 0.5, 0.5], radius: CLIMATE.radius });
    expect(here(at())).toBeCloseTo(1, 9);
    const near = here(at({ temp: 0.54 })),
      far = here(at({ temp: 0.75 }));
    expect(near).toBeLessThan(1);
    expect(far).toBeLessThan(near);
    expect(far).toBeGreaterThan(0);
    // the stretch: a 0.04 step in temperature is 2.2 * 0.04 / 0.12 radii away,
    // and the sharpening is the exponent's own, not the sampler's
    const d = (CLIMATE.stretch * 0.04) / CLIMATE.radius;
    expect(near).toBeCloseTo(Math.exp(-CLIMATE.sharpness * d * d), 6);
    expect(CLIMATE).toEqual({ stretch: 2.2, radius: 0.12, sharpness: 2.2 });
  });
  it('reads all three axes, and never returns a zero the sampler would have to guess about', () => {
    const here = climatePoint({ point: [0.5, 0.5, 0.5] });
    expect(here(at({ moist: 0.8 }))).toBeLessThan(1);
    expect(here(at({ region: 0.2 }))).toBeLessThan(1);
    // the far corner of climate space is tiny but not zero: float64 reaches 1e-200 long
    // before it underflows, and the sampler normalises, so ratios survive
    const corner = here(at({ temp: 0, moist: 0, region: 0 }));
    expect(corner).toBeGreaterThan(0);
    expect(corner).toBeLessThan(1e-20);
  });
  it('clamps the stretched axes, so the corners of climate space stay reachable', () => {
    const cold = climatePoint({ point: [0, 0.5, 0.5] });
    expect(cold(at({ temp: 0 }))).toBeCloseTo(1, 9);
    expect(cold(at({ temp: 0.1 }))).toBeCloseTo(1, 9); // both clamp to 0
  });
});

describe('heightBand, mul and max', () => {
  it('bands by height with a feathered edge', () => {
    const band = heightBand({ from: 200, to: 600, feather: 100 });
    expect(band(at({ baseHeight: 400 }))).toBe(1);
    expect(band(at({ baseHeight: 0 }))).toBe(0);
    expect(band(at({ baseHeight: 150 }))).toBeCloseTo(0.5, 6);
    expect(band(at({ baseHeight: 650 }))).toBeCloseTo(0.5, 6);
    expect(band(at({ baseHeight: 1000 }))).toBe(0);
  });
  it('combines', () => {
    const a = () => 0.5,
      b = () => 0.4;
    expect(mul([a, b])(at())).toBeCloseTo(0.2, 9);
    expect(max([a, b])(at())).toBeCloseTo(0.5, 9);
    expect(mul([])(at())).toBe(1);
    expect(max([])(at())).toBe(0);
  });
  it('takes descriptors as well as functions, so a biome of data can combine', () => {
    const both = mul([
      { type: 'climatePoint', point: [0.5, 0.5, 0.5] },
      { type: 'heightBand', from: 0, to: 200, feather: 10 },
    ]);
    expect(both(at({ baseHeight: 100 }))).toBeCloseTo(1, 6);
    expect(both(at({ baseHeight: 900 }))).toBe(0);
  });
});

describe('height hooks', () => {
  it('offsets and terraces around the base height', () => {
    expect(offset({ meters: 40 })(at(), 100)).toBe(140);
    expect(offset({ meters: -40 })(at(), 100)).toBe(60);
    const step = terraces({ step: 50, sharpness: 1 });
    expect(step(at(), 100)).toBeCloseTo(100, 6); // already on a step
    expect(step(at(), 124)).toBeLessThan(124); // pulled down to its own step
    expect(step(at(), 126)).toBeGreaterThan(126); // and up to the next one
    expect(step(at(), 124)).toBeCloseTo(100, 6);
    expect(step(at(), 126)).toBeCloseTo(150, 6);
    // half the sharpness is half the pull, and none of it leaves the ground alone
    expect(terraces({ step: 50, sharpness: 0.5 })(at(), 124)).toBeCloseTo(112, 6);
    expect(terraces({ step: 50, sharpness: 0 })(at(), 124)).toBeCloseTo(124, 6);
  });
});

describe('resolve*', () => {
  it('passes functions through and builds descriptors', () => {
    const fn = () => 0.25;
    expect(resolvePresence(fn)).toBe(fn);
    expect(resolvePresence({ type: 'climatePoint', point: [0.5, 0.5, 0.5] })(at())).toBeCloseTo(1, 9);
    expect(resolvePresence({ type: 'heightBand', from: 0, to: 200 })(at())).toBe(1);
    expect(resolveHeight({ type: 'offset', meters: 5 })(at(), 10)).toBe(15);
    expect(resolveHeight({ type: 'terraces', step: 20 })(at(), 10)).toBeCloseTo(20, 6);
  });
  it('names an unknown type instead of returning something that fails later', () => {
    expect(() => resolvePresence({ type: 'nope' } as never)).toThrow(/unknown hook type "nope"/);
    expect(() => resolveHeight({ type: 'nope' } as never)).toThrow(/unknown hook type "nope"/);
  });
});
