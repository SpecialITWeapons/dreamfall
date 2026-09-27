/**
 * The arithmetic two settlement plans both need. Not a kit and not a hook: a
 * plan is a pure function and this is the part of one that has no opinions --
 * where a point is against a line someone already drew.
 *
 * It is one file rather than one copy per plan for the reason the mitre is one
 * walk: the second copy is the one that does not get the fix.
 */

/**
 * A number in 0..1 fixed by a place and a salt. What a plan decides with this
 * it decides without drawing from the site's stream, so a plan that learns to
 * stand trees keeps every house it laid before where it was.
 *
 * @param {number} x @param {number} z @param {number} salt
 */
export function rollAt(x, z, salt) {
  let h =
    (Math.imul(Math.round(x * 8) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(z * 8) | 0, 0x165667b1) ^ salt) >>>
    0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * The distance from a point to a segment, m.
 *
 * @param {number} ax @param {number} az @param {number} bx @param {number} bz
 * @param {number} x @param {number} z
 */
export function toSegment(ax, az, bx, bz, x, z) {
  const dx = bx - ax,
    dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

/**
 * The distance from a point to a polyline, m. Infinity for a line of one point,
 * which is not a line.
 *
 * @param {Array<[number, number]>} points
 * @param {number} x @param {number} z
 */
export function toPolyline(points, x, z) {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (!a || !b) continue;
    best = Math.min(best, toSegment(a[0], a[1], b[0], b[1], x, z));
  }
  return best;
}
