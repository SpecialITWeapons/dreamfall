/**
 * Standard height hooks: what a biome does to the ground under it. Each one is
 * handed the base height and returns the new one in metres; the engine clips
 * the difference to the budget and weighs it by the biome's own share, so a
 * hook never has to know about its neighbours.
 */

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
    default: {
      const odd = /** @type {{ type?: string }} */ (hook);
      throw new Error(`unknown hook type "${odd?.type}"`);
    }
  }
}
