// The two pieces of arithmetic every standard hook needs. They live here rather
// than in one hook's file because the presence hooks, the scatter and whatever
// comes next all want the same smooth edge, and because library/ may never
// import from src/ -- the engine keeps its own copy in terrain/noise.ts, and the
// two are the same three lines on purpose.

/** @param {number} v */
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Smoothstep: 0 below a, 1 above b, an S in between.
 * @param {number} a @param {number} b @param {number} x
 */
export function sstep(a, b, x) {
  const t = clamp01((x - a) / (b - a || 1e-9));
  return t * t * (3 - 2 * t);
}
