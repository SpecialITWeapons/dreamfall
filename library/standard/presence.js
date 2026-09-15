/**
 * Standard presence hooks: where a biome is, as a number from zero to one.
 * A biome made of data names one of these; a biome made of code writes its own
 * function of the same shape. The engine normalises what comes back across the
 * whole registry, so two hooks never have to agree on a scale -- only to be
 * monotonic in "how much of this place is mine".
 */

/**
 * The climate space, ported from fly-with-me: the axes are stretched around
 * their middle so the ends of temperature, moisture and region are reachable,
 * a cell is a soft sphere of this radius, and the sharpening keeps most ground
 * inside one biome with bands a few hundred metres wide between them.
 */
export const CLIMATE = { stretch: 2.2, radius: 0.12, sharpness: 2.2 };

/** @type {(v: number) => number} */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** @type {(v: number) => number} */
const axis = (v) => clamp01((v - 0.5) * CLIMATE.stretch + 0.5);
/**
 * Smoothstep, local so that library/ never reaches into the engine for arithmetic.
 * @type {(a: number, b: number, x: number) => number}
 */
const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a || 1e-9));
  return t * t * (3 - 2 * t);
};

/**
 * A soft cell in climate space.
 *
 * The sharpening lives in here, not in the sampler: the sampler normalises
 * linearly, because a biome of code may return any number it likes, so
 * exp(-sharpness * d^2) normalised is exactly the softmax the original took
 * over its ten biomes. fly-with-me subtracts the nearest distance first; that
 * is float32 underflow protection on the GPU, and this runs in float64, where
 * the far corner of climate space is 1e-200 -- small, but a long way from zero,
 * and the common factor cancels in the normalisation anyway.
 *
 * @param {{ point: [number, number, number], radius?: number }} spec
 * @returns {(f: import('../contract').Fields) => number}
 */
export function climatePoint({ point, radius = CLIMATE.radius }) {
  const ct = axis(point[0]),
    cm = axis(point[1]),
    cr = axis(point[2]);
  const r2 = radius * radius;
  return (f) => {
    const dt = axis(f.temp) - ct,
      dm = axis(f.moist) - cm,
      dr = axis(f.region) - cr;
    return Math.exp((-CLIMATE.sharpness * (dt * dt + dm * dm + dr * dr)) / r2);
  };
}

/**
 * A band of height, feathered at both edges: one inside, nothing outside, half
 * of it a feather's reach beyond each edge.
 *
 * @param {{ from: number, to: number, feather?: number }} spec
 * @returns {(f: import('../contract').Fields) => number}
 */
export function heightBand({ from, to, feather = 60 }) {
  return (f) =>
    Math.min(sstep(from - feather, from, f.baseHeight), 1 - sstep(to, to + feather, f.baseHeight));
}

/**
 * Everything at once: the product, so any zero is a zero.
 * @param {import('../contract').Presence[]} of
 * @returns {(f: import('../contract').Fields) => number}
 */
export function mul(of) {
  const parts = of.map(resolve);
  return (f) => parts.reduce((acc, part) => acc * part(f), 1);
}

/**
 * Any one of them: the strongest.
 * @param {import('../contract').Presence[]} of
 * @returns {(f: import('../contract').Fields) => number}
 */
export function max(of) {
  const parts = of.map(resolve);
  return (f) => parts.reduce((acc, part) => Math.max(acc, part(f)), 0);
}

/**
 * A hook or a descriptor, as a hook. Kept here rather than imported from
 * ./index.js so the combinators do not close a circle through it.
 *
 * @param {import('../contract').Presence} hook
 * @returns {(f: import('../contract').Fields) => number}
 */
export function resolve(hook) {
  if (typeof hook === 'function') return hook;
  switch (hook?.type) {
    case 'climatePoint':
      return climatePoint(hook);
    case 'heightBand':
      return heightBand(hook);
    case 'mul':
      return mul(hook.of);
    case 'max':
      return max(hook.of);
    default: {
      const odd = /** @type {{ type?: string }} */ (hook);
      throw new Error(`unknown hook type "${odd?.type}"`);
    }
  }
}
