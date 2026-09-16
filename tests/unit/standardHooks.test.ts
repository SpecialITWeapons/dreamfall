import { describe, expect, it } from 'vitest';
import type { Fields, GroundCtx, GroundOut, LatticeHit } from '../../library/contract';
import { CLIMATE, climatePoint, heightBand, lattice, max, mul } from '../../library/standard/presence.js';
import { offset, plateau, terraces } from '../../library/standard/height.js';
import { layers } from '../../library/standard/ground.js';
import { resolveGround, resolveHeight, resolvePresence } from '../../library/standard/index.js';
import { createFields, type FieldsReader } from '../../src/engine/terrain/Fields';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';

const hit = (over: Partial<LatticeHit> = {}): LatticeHit => ({
  cx: 0,
  cz: 0,
  d: 0,
  h: 0,
  t: 0.5,
  u: () => 0.5,
  ...over,
});

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
  lattice: () => hit(),
  ...over,
});

// The settlement hooks are tested against the engine's own fields. The library
// may not import from src/, but its test may -- and what is being proven here is
// that two hooks land on the same centre of the same world, which a lattice
// written for the test could only prove about itself. SITE is what a village
// would name: one cell, one salt, one shape around the centre.
const SITE = { cell: 6000, salt: 0x5117, radius: 200, feather: 150 };
const world = (seed = 42) => createFields(createWorldSampler(seed));

/** The centres of the first n by n lattice cells of a world, read out of the hit before it is rewritten. */
const centres = (f: FieldsReader, n: number) => {
  const out: Array<{ x: number; z: number; h: number }> = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const c = f.at((i + 0.5) * SITE.cell, (j + 0.5) * SITE.cell).lattice(SITE.cell, SITE.salt);
      out.push({ x: c.cx, z: c.cz, h: c.h });
    }
  return out;
};

/**
 * The first cell of a world that carries a site, with a point well inside its
 * radius whose ground is not already the centre's height -- so a plateau there
 * has something to do and a test can tell whether it did it.
 */
const sloping = (f: FieldsReader) => {
  const carries = lattice({ ...SITE });
  for (const c of centres(f, 20)) {
    const p = { x: c.x + 120, z: c.z - 90 }; // 150 m out, half the radius
    const base = f.at(p.x, p.z).baseHeight;
    if (Math.abs(base - c.h) > 5 && carries(f.at(c.x, c.z)) > 0) return { c, p, base };
  }
  throw new Error('this world carries no site on sloping ground in its first 400 lattice cells');
};

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

describe('lattice', () => {
  it('carries a site in about one cell in 1/odds', () => {
    const f = world();
    const cells = centres(f, 20); // 400 cells of seed 42
    const share = (odds: number) => {
      const hook = lattice({ ...SITE, odds });
      return cells.filter((c) => hook(f.at(c.x, c.z)) > 0).length / cells.length;
    };
    expect(share(0.5)).toBeGreaterThan(0.42);
    expect(share(0.5)).toBeLessThan(0.58);
    expect(share(0.25)).toBeGreaterThan(0.17);
    expect(share(0.25)).toBeLessThan(0.33);
    expect(share(0)).toBe(0);
    expect(share(1)).toBe(1);
  });
  it('answers for the cell and not for the point, and no two worlds agree', () => {
    const f = world();
    const hook = lattice({ ...SITE });
    const { c } = sloping(f);
    expect(hook(f.at(c.x, c.z))).toBe(1);
    expect(hook(f.at(c.x + 120, c.z - 90))).toBe(1); // another point of the same cell
    expect(hook(f.at(c.x, c.z))).toBe(1); // and asking twice is asking once
    const pattern = (seed: number) => {
      const w = world(seed);
      const carries = lattice({ ...SITE });
      return centres(w, 12)
        .map((cell) => (carries(w.at(cell.x, cell.z)) > 0 ? '1' : '0'))
        .join('');
    };
    expect(pattern(42)).toBe(pattern(42));
    expect(pattern(42)).not.toBe(pattern(43)); // the lattice is salted with the seed
  });
  it('is one inside the radius, nothing past the feather, and only falls in between', () => {
    const f = world();
    const hook = lattice({ ...SITE });
    const { c } = sloping(f);
    const out = (d: number) => hook(f.at(c.x + d, c.z));
    expect(out(0)).toBe(1);
    expect(out(SITE.radius)).toBe(1);
    expect(out(SITE.radius + SITE.feather / 2)).toBeCloseTo(0.5, 9);
    expect(out(SITE.radius + SITE.feather)).toBe(0);
    expect(out(SITE.radius + SITE.feather + 400)).toBe(0);
    let last = 1;
    for (let d = SITE.radius; d <= SITE.radius + SITE.feather; d += 10) {
      const v = out(d);
      expect(v).toBeLessThanOrEqual(last);
      last = v;
    }
    expect(last).toBe(0);
  });
  it('asks the centre about the ground, never the texel the hook stands on', () => {
    const plain = { cell: SITE.cell, radius: SITE.radius, feather: SITE.feather };
    // high ground over a centre down by the water: land reads the centre
    const low = at({ baseHeight: 500, lattice: () => hit({ h: 4, u: () => 0.1 }) });
    expect(lattice({ ...plain })(low)).toBe(1);
    expect(lattice({ ...plain, land: 10 })(low)).toBe(0);
    // the shore bonus lifts the odds of a centre by the water line, and only there
    const draw = () => 0.7; // over the plain odds, under the lifted ones
    const coast = at({ lattice: () => hit({ h: 5, u: draw }) });
    const inland = at({ lattice: () => hit({ h: 400, u: draw }) });
    expect(lattice({ ...plain, odds: 0.5 })(coast)).toBe(0);
    expect(lattice({ ...plain, odds: 0.5, shoreBonus: 1 })(coast)).toBe(1);
    expect(lattice({ ...plain, odds: 0.5, shoreBonus: 1 })(inland)).toBe(0);
    // and the slope: the rise a plateau would have to cut, against the radius
    const rise = (h: number) =>
      lattice({ ...plain, maxSlope: 0.25 })(
        at({ baseHeight: h, lattice: () => hit({ d: 100, h: 20, u: () => 0.1 }) }),
      );
    expect(rise(60)).toBe(1); // 40 m over the centre, inside the 50 m the radius allows
    expect(rise(95)).toBeCloseTo(0.5, 9); // 75 m, half way out of the settlement
    expect(rise(160)).toBe(0); // 140 m: not this settlement's ground
  });
});

describe('plateau', () => {
  it('pulls the ground to the height of its own lattice centre, by its strength', () => {
    const f = world();
    const { c, p, base } = sloping(f);
    expect(Math.abs(base - c.h)).toBeGreaterThan(5); // there is a slope here to flatten
    const flat = (strength: number) => plateau({ ...SITE, strength })(f.at(p.x, p.z), base);
    expect(flat(1)).toBeCloseTo(c.h, 9);
    expect(flat(0)).toBe(base);
    expect(flat(0.3)).toBeCloseTo(base + 0.3 * (c.h - base), 9);
    expect(flat(4)).toBeCloseTo(c.h, 9); // a strength over one is still flat, never inverted
    // at the centre itself the ground is already its own height
    expect(plateau({ ...SITE, strength: 1 })(f.at(c.x, c.z), c.h)).toBeCloseTo(c.h, 9);
  });
  it('lets go over the feather, and never in a step', () => {
    const flat = plateau({ ...SITE, strength: 1 });
    // ground at nought under a centre a hundred metres up: what comes back is
    // the pull itself, as a share
    const pull = (d: number) => flat(at({ baseHeight: 0, lattice: () => hit({ d, h: 100 }) }), 0) / 100;
    expect(pull(0)).toBe(1);
    expect(pull(SITE.radius)).toBe(1);
    expect(pull(SITE.radius + SITE.feather / 2)).toBeCloseTo(0.5, 9);
    expect(pull(SITE.radius + SITE.feather)).toBe(0);
    const steps: number[] = [];
    let last = 1;
    for (let d = SITE.radius; d <= SITE.radius + SITE.feather; d += 5) {
      const v = pull(d);
      expect(v).toBeLessThanOrEqual(last);
      steps.push(last - v);
      last = v;
    }
    expect(last).toBe(0);
    expect(Math.max(...steps)).toBeLessThan(0.06);
    // and no kink at either end of the feather: a smoothstep leaves and arrives flat
    expect(steps[0]!).toBeLessThan(0.01);
    expect(steps[steps.length - 1]!).toBeLessThan(0.01);
  });
});

describe('one lattice, two hooks', () => {
  it('lays the plateau under the site rather than beside it', () => {
    const f = world();
    const { c, p, base } = sloping(f);
    // the presence hook says this point is the settlement's, all of it
    expect(lattice({ ...SITE })(f.at(p.x, p.z))).toBe(1);
    // so the plateau owes it the height of the very same centre -- read here out
    // of the world, not out of the hit the two hooks share
    const ground = f.at(c.x, c.z).baseHeight;
    expect(plateau({ ...SITE, strength: 1 })(f.at(p.x, p.z), base)).toBeCloseTo(ground, 6);
    // and it is the shared salt that does it: one salt apart is another centre,
    // another height, and on the ground a village on a slope beside a flat field
    const astray = plateau({ ...SITE, salt: SITE.salt + 1, strength: 1 })(f.at(p.x, p.z), base);
    expect(Math.abs(astray - ground)).toBeGreaterThan(5);
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
  it('builds the settlement hooks too, so a biome of data can name them', () => {
    const centre = { lattice: () => hit({ h: 80, u: () => 0.1 }) };
    expect(resolvePresence({ type: 'lattice', cell: SITE.cell, radius: 200, feather: 150 })(at(centre))).toBe(
      1,
    );
    expect(
      resolveHeight({ type: 'plateau', cell: SITE.cell, radius: 200, feather: 150 })(at(centre), 0),
    ).toBeCloseTo(80, 9);
  });
  it('names an unknown type instead of returning something that fails later', () => {
    expect(() => resolvePresence({ type: 'nope' } as never)).toThrow(/unknown hook type "nope"/);
    expect(() => resolveHeight({ type: 'nope' } as never)).toThrow(/unknown hook type "nope"/);
  });
});

/** A context whose nodes are plain numbers, so the painter can be read in Node. */
const numeric = (over: Record<string, unknown> = {}) =>
  ({
    slope: 0,
    height: 100,
    weight: 1,
    params: {},
    noise: () => 0,
    hash: () => 0.5,
    color: (v: string | number) => v,
    mix: (a: unknown, b: unknown, t: unknown) => ({ a, b, t }),
    ramp: (v: number, from: number, to: number) => Math.max(0, Math.min(1, (v - from) / (to - from || 1))),
    ...over,
  }) as unknown as GroundCtx;
const painted = (out: GroundOut) => out.albedo as unknown as { a: unknown; b: unknown; t: number };

describe('layers', () => {
  it('is its first layer when there is only one', () => {
    expect(layers([{ color: 'meadow' }])(numeric()).albedo).toBe('meadow' as unknown);
  });
  it('mixes each next layer by its own mask', () => {
    const paint = layers([{ color: 'meadow' }, { color: 'rock', mask: 'slope', from: 0.3, to: 0.6 }]);
    expect(painted(paint(numeric({ slope: 0.1 }))).t).toBe(0);
    const steep = painted(paint(numeric({ slope: 0.9 })));
    expect(steep.t).toBe(1);
    expect(steep.a).toBe('meadow');
    expect(steep.b).toBe('rock');
  });
  it('reads the noise mask through the context, with the scale and salt of that layer', () => {
    const seen: Array<[number, number]> = [];
    const paint = layers([
      { color: 'gold' },
      { color: 'steppe', mask: 'noise', scale: 0.012, salt: 3, from: -0.2, to: 0.4 },
    ]);
    paint(
      numeric({
        noise: (scale: number, salt: number) => {
          seen.push([scale, salt]);
          return 0.4;
        },
      }),
    );
    expect(seen).toEqual([[0.012, 3]]);
  });
  it('stacks: every layer after the first paints over what is already there', () => {
    const paint = layers([
      { color: 'gold' },
      { color: 'steppe', mask: 'noise' },
      { color: 'rockPale', mask: 'slope', from: 0.3, to: 0.55 },
    ]);
    const top = painted(paint(numeric({ slope: 1 })));
    expect(top.b).toBe('rockPale');
    expect((top.a as { b: unknown }).b).toBe('steppe'); // under it, the one before
  });
  it('refuses a ground with no layers at all, by name of what is missing', () => {
    expect(() => layers([])).toThrow(/at least one layer/);
  });
});

describe('resolveGround', () => {
  it('passes a function through and builds a descriptor', () => {
    const fn = (() => ({ albedo: 'x' })) as unknown as (ctx: GroundCtx) => GroundOut;
    expect(resolveGround(fn)).toBe(fn);
    expect(resolveGround({ type: 'layers', layers: [{ color: 'meadow' }] })(numeric()).albedo).toBe(
      'meadow' as unknown,
    );
    expect(() => resolveGround({ type: 'nope' } as never)).toThrow(/unknown hook type "nope"/);
  });
});
