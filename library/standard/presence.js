/**
 * Standard presence hooks: where a biome is, as a number from zero to one.
 * A biome made of data names one of these; a biome made of code writes its own
 * function of the same shape. The engine normalises what comes back across the
 * whole registry, so two hooks never have to agree on a scale -- only to be
 * monotonic in "how much of this place is mine".
 */

import { clamp01, sstep } from './math.js';

/**
 * The climate space, ported from fly-with-me: the axes are stretched around
 * their middle so the ends of temperature, moisture and region are reachable,
 * a cell is a soft sphere of this radius, and the sharpening keeps most ground
 * inside one biome with bands a few hundred metres wide between them.
 */
export const CLIMATE = { stretch: 2.2, radius: 0.12, sharpness: 2.2 };

/** @type {(v: number) => number} */
const axis = (v) => clamp01((v - 0.5) * CLIMATE.stretch + 0.5);

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
 * How near the water line a lattice centre counts as a shore, m. The engine's
 * `shore` field is the same reach around the same line; the library may not
 * import from src/, and the bonus wants the shore of the centre rather than the
 * shore of whatever texel the hook is standing on.
 */
const SHORE_REACH = 25;

/**
 * The stream a cell draws its site from. Not stream 0: `Fields.lattice` keys the
 * streams on the rounded centre and salts the first of them exactly as it salts
 * the jitter, so a cell whose centre jittered towards the lower corner of itself
 * draws under a half every time -- with odds of a half that is two cells in
 * three carrying a site rather than one in two. The streams after it are clean.
 */
const CARRY = 1;

/**
 * A place someone built on: one centre per cell of a lattice, and a circle of
 * presence around the centre that fades over a feather.
 *
 * Everything that decides whether a cell carries anything at all reads the
 * centre -- the cell's own stream against the odds, the centre's height against
 * `land`, its nearness to the water against `shoreBonus`. So a cell answers the
 * same everywhere inside itself, which is the whole point: odds read where the
 * hook happens to stand would let one cell say yes at its wet edge and no at its
 * dry one, and a fringe of presence around a village that is not there reads as
 * a bug in the terrain.
 *
 * `maxSlope` refuses the ground a plateau on this same lattice would have to
 * cut: the rise from the centre to here is the only slope a hook sampling one
 * texel can measure, and it is the one that matters, because that rise is the
 * cut. Inside the radius it is measured against the radius, so a single rough
 * texel by the centre cannot punch a hole in the village.
 *
 * The carry draw is the cell's stream 1, not its stream 0; whatever else stands
 * on this lattice -- the plan of the settlement, its buildings -- takes the
 * streams after it.
 *
 * `maxSlope` refuses the whole cell when the centre's own ground is steeper
 * than it, and separately fades the settlement where the ground departs from
 * that centre. The first is what the design asks for and what a seat is judged
 * by; the second is what keeps a rough edge from reading as a village.
 *
 * `minTemp` is another of the cell-level refusals and reads the centre's own
 * temperature for the same reason `land` reads its height: a settlement that
 * refuses a glacier must refuse the whole cell, or the ground is painted and
 * flattened for a village the site finder will not seat.
 *
 * `maxCut` is the second of those two, said in metres instead: how far the
 * ground may have run from the centre by the time it reaches here. A settlement
 * a few hundred metres wide can leave it unsaid and let the slope stand for
 * both, which is what a village does. One nine hundred metres wide cannot: over
 * that distance the departure is the terrain's relief and has almost nothing to
 * do with the slope at the centre, so the one number would have to be chosen
 * for the fade and would then refuse most of the seats for no gain.
 *
 * @param {{ cell: number, radius?: number, feather?: number, odds?: number, salt?: number, land?: number, minTemp?: number, maxSlope?: number, maxCut?: number, shoreBonus?: number }} spec
 * @returns {(f: import('../contract').Fields) => number}
 */
export function lattice({
  cell,
  radius = 200,
  feather = 150,
  odds = 0.5,
  salt = 0x5117,
  land = -Infinity,
  minTemp = -Infinity,
  maxSlope = Infinity,
  maxCut = undefined,
  shoreBonus = 0,
}) {
  return (f) => {
    const hit = f.lattice(cell, salt);
    // Nearly every texel of a cell kilometres wide is nowhere near its centre,
    // so the distance is asked first and the rest of the cell costs nothing.
    const near = 1 - sstep(radius, radius + feather, hit.d);
    if (near === 0 || hit.h < land || hit.t < minTemp) return 0;
    // The centre's own ground, refused for the whole cell. The rise measured
    // below runs from the centre outward and is zero at the centre, so it can
    // fade an edge and never refuse a seat -- and the seat is the only place a
    // settlement is ever judged.
    if (hit.s > maxSlope) return 0;
    const shore = 1 - sstep(0, SHORE_REACH, Math.abs(hit.h));
    if (hit.u(CARRY) >= odds * (1 + shoreBonus * shore)) return 0;
    if (maxCut === undefined && maxSlope === Infinity) return near; // neither set: no ceiling at all
    // Said in metres, the allowance is the same everywhere in the settlement.
    // Said as a slope it grows with the distance, which is the older reading
    // and the one a village keeps: out past the radius the fade is already
    // doing the work and the term only has to stop fighting it.
    const room = maxCut ?? maxSlope * Math.max(hit.d, radius);
    return near * (1 - sstep(room, room * 2, Math.abs(f.baseHeight - hit.h)));
  };
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
    case 'lattice':
      return lattice(hook);
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
