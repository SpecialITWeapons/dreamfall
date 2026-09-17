/**
 * Standard height hooks: what a biome does to the ground under it. Each one is
 * handed the base height and returns the new one in metres; the engine clips
 * the difference to the budget and weighs it by the biome's own share, so a
 * hook never has to know about its neighbours.
 */

import { clamp01, sstep } from './math.js';
import { widestOf, widthOf } from './presence.js';

/**
 * Lift or sink the ground by a fixed amount.
 *
 * @param {{ meters: number }} spec
 * @returns {(f: import('../contract').Fields, base: number) => number}
 */
export function offset({ meters }) {
  return (_f, base) => base + meters;
}

/**
 * Pull the ground towards the nearest step of a staircase. At full sharpness
 * the treads are flat and the risers are cliffs exactly halfway between two
 * steps; that is what a terrace is. Less sharpness is a softer pull, and none
 * of it leaves the ground where it was.
 *
 * @param {{ step: number, sharpness?: number }} spec
 * @returns {(f: import('../contract').Fields, base: number) => number}
 */
export function terraces({ step, sharpness = 1 }) {
  const k = sharpness < 0 ? 0 : sharpness > 1 ? 1 : sharpness;
  return (_f, base) => base + (Math.round(base / step) * step - base) * k;
}

/**
 * Lay the ground flat at the height of a lattice centre: full strength inside
 * the radius, letting go over the feather. `strength` 0 leaves the ground where
 * it was, 1 puts the whole plateau at the centre's height.
 *
 * The hook never asks whether anything actually stands on that centre, and it
 * must not: the engine weighs every height change by the biome's own share, and
 * the presence hook -- same lattice, same cell, same salt -- is what makes that
 * share zero where there is no site. One salt apart and the settlement sits on
 * the slope beside its own flat ground, which looks like a fault in the terrain
 * and is nothing of the kind.
 *
 * The centre's height comes with the hit, sampled once per lattice cell: a hook
 * reads its own texel and cannot go asking the sampler about another one in the
 * middle of a fill.
 *
 * The radius may be a pair, and then it is drawn from the cell's own stream --
 * the same draw the presence hook and the site finder make. It has to be the
 * hook's own pair: a plateau a hundred metres wider than the presence above it
 * is a hundred metres of levelled ground belonging to no biome, and a plateau
 * narrower is a settlement with its outskirts on the hillside.
 *
 * @param {{ cell: number, salt?: number, radius?: number | [number, number], feather?: number, strength?: number }} spec
 * @returns {(f: import('../contract').Fields, base: number) => number}
 */
export function plateau({ cell, salt = 0x5117, radius = 200, feather = 150, strength = 1 }) {
  const k = clamp01(strength);
  const widest = widestOf(radius);
  return (f, base) => {
    const hit = f.lattice(cell, salt);
    // Out of reach of the widest plateau this cell could carry: the ground is
    // its own, and the width is not drawn. Every texel of the window asks this.
    if (hit.d >= widest + feather) return base;
    const width = widthOf(radius, hit);
    return base + (hit.h - base) * k * (1 - sstep(width, width + feather, hit.d));
  };
}

/**
 * A hook or a descriptor, as a hook.
 *
 * @param {import('../contract').HeightHook} hook
 * @returns {(f: import('../contract').Fields, base: number) => number}
 */
export function resolve(hook) {
  if (typeof hook === 'function') return hook;
  switch (hook?.type) {
    case 'offset':
      return offset(hook);
    case 'terraces':
      return terraces(hook);
    case 'plateau':
      return plateau(hook);
    default: {
      const odd = /** @type {{ type?: string }} */ (hook);
      throw new Error(`unknown hook type "${odd?.type}"`);
    }
  }
}
