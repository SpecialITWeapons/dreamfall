/**
 * The plan of a village: where the streets run, what stands along them, and
 * which ground is spoken for. Data only -- it calls the kit and returns nothing
 * -- so it is a pure function of the site, the parameters and whatever the kit
 * answers about the ground. That is what lets it have a test in Node with no
 * terrain anywhere, and what will let the editor of M6 change one.
 *
 * The order matters and is fixed, because the site's own stream is drawn in it:
 * main street, side paths, lots, kinds, reservations. Change the order and the
 * same village comes out different, which is a thing a player can notice.
 */

/** Steps of this length walk the contour; shorter reads as a polygon, longer cuts the corner. */
const STEP = 25;
/** How far to reach when measuring which way the ground falls. */
const PROBE = 40;

/**
 * Which way the ground runs level here: the perpendicular of its fall. On flat
 * ground the fall is noise, so the site's own yaw decides instead and the street
 * still lies somewhere deliberate.
 *
 * @param {import('../contract').SiteKit} kit
 * @param {number} x @param {number} z @param {number} yaw
 * @returns {[number, number]}
 */
function contour(kit, x, z, yaw) {
  const dx = kit.height(x + PROBE, z) - kit.height(x - PROBE, z),
    dz = kit.height(x, z + PROBE) - kit.height(x, z - PROBE);
  const fall = Math.hypot(dx, dz);
  if (fall < 0.5) return [Math.cos(yaw), Math.sin(yaw)];
  return [-dz / fall, dx / fall];
}

/**
 * The main street: a walk from the centre outward in both directions, turning
 * with the hill at every step, so it stays level instead of running up it.
 *
 * @param {import('../contract').SiteKit} kit
 * @param {import('../contract').Site} site
 * @returns {Array<[number, number]>}
 */
function mainStreet(kit, site) {
  const half = site.radius * 0.85;
  /** @param {number} sign @returns {Array<[number, number]>} */
  const walk = (sign) => {
    /** @type {Array<[number, number]>} */
    const points = [];
    let x = site.x,
      z = site.z;
    for (let travelled = 0; travelled < half; travelled += STEP) {
      const [ux, uz] = contour(kit, x, z, site.yaw);
      x += ux * STEP * sign;
      z += uz * STEP * sign;
      if (Math.hypot(x - site.x, z - site.z) > half) break;
      points.push([x, z]);
    }
    return points;
  };
  return [...walk(-1).reverse(), [site.x, site.z], ...walk(1)];
}

/**
 * A path off the street, running until the ground tilts too much or the village
 * ends. It is what gives a village depth: one street of houses is a row, two is
 * a place.
 *
 * @param {import('../contract').SiteKit} kit
 * @param {import('../contract').Site} site
 * @param {[number, number]} from @param {[number, number]} along @param {number} sign
 * @param {typeof import('./village.js').VILLAGE} params
 * @returns {Array<[number, number]> | null}
 */
function sidePath(kit, site, from, along, sign, params) {
  const [ax, az] = along;
  const ux = -az * sign,
    uz = ax * sign;
  /** @type {Array<[number, number]>} */
  const points = [from];
  let x = from[0],
    z = from[1];
  for (let travelled = 0; travelled < params.roads.reach; travelled += STEP) {
    const nx = x + ux * STEP,
      nz = z + uz * STEP;
    if (Math.hypot(nx - site.x, nz - site.z) > site.radius * 0.9) break;
    if (kit.slope(nx, nz) > params.roads.maxSlope) break;
    x = nx;
    z = nz;
    points.push([x, z]);
  }
  return points.length > 1 ? points : null;
}

/**
 * Lay a village out through the kit.
 *
 * @param {import('../contract').Site} site
 * @param {typeof import('./village.js').VILLAGE} params
 * @param {import('../contract').SiteKit} kit
 */
export function planVillage(site, params, kit) {
  const street = mainStreet(kit, site);
  kit.road(street, params.roads.width);
  /** @type {Array<{ points: Array<[number, number]> }>} */
  const streets = [{ points: street }];

  // Side paths every `spacing` along the street, alternating sides so a village
  // does not grow entirely off one shoulder.
  let walked = 0,
    side = 1;
  for (let i = 1; i < street.length; i++) {
    const a = street[i - 1],
      b = street[i];
    if (!a || !b) continue;
    const [ax, az] = a,
      [bx, bz] = b;
    walked += Math.hypot(bx - ax, bz - az);
    if (walked < params.roads.spacing) continue;
    walked = 0;
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const path = sidePath(kit, site, [bx, bz], [(bx - ax) / len, (bz - az) / len], side, params);
    side = -side;
    if (!path) continue;
    kit.road(path, params.roads.width * 0.6);
    streets.push({ points: path });
  }

  // Lots along every street, both shoulders, thinning toward the edge of the
  // village: the centre is where people crowd.
  const kinds = Object.entries(params.buildings).filter(([, weight]) => weight > 0);
  const total = kinds.reduce((sum, [, weight]) => sum + weight, 0);
  /** @type {Array<{ x: number, z: number }>} */
  const taken = [];
  for (const road of streets)
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1],
        b = road.points[i];
      if (!a || !b) continue;
      const [ax, az] = a,
        [bx, bz] = b;
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const ux = (bx - ax) / len,
        uz = (bz - az) / len;
      for (let along = 0; along + params.lots.depth <= len; along += params.lots.depth) {
        const cx = ax + ux * (along + params.lots.depth / 2),
          cz = az + uz * (along + params.lots.depth / 2);
        for (const shoulder of [1, -1]) {
          const x = cx - uz * shoulder * params.lots.setback,
            z = cz + ux * shoulder * params.lots.setback;
          const out = Math.hypot(x - site.x, z - site.z) / site.radius;
          if (out > 1) continue;
          if (site.random() > params.lots.density * (1 - out * out)) continue;
          // Never two houses in one place: a street and its path cross, and a
          // crossing would otherwise get a house from each of them.
          if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < params.lots.depth * 0.9)) continue;
          taken.push({ x, z });
          let pick = site.random() * total,
            structure = kinds[0]?.[0] ?? 'cottage';
          for (const [id, weight] of kinds) {
            pick -= weight;
            structure = id;
            if (pick <= 0) break;
          }
          const floors = structure === 'mill' ? 3 : site.random() < 0.3 ? 2 : 1;
          // The settlement's own tint, drawn here and nowhere else: it is the
          // last number this lot takes from the stream, so adding one changes
          // every house after it and none before. A tint multiplies what the
          // recipe painted, so a palette of one white is a settlement whose
          // houses are all exactly their recipe.
          const palette = params.palette ?? ['white'];
          const tint = palette[Math.min(palette.length - 1, Math.floor(site.random() * palette.length))];
          // Facing the street: the house turns its front to the axis it stands on.
          const yaw = Math.atan2(ux, uz) + (shoulder > 0 ? 0 : Math.PI);
          kit.structure(structure, x, z, { yaw, floors, tint });
          kit.reserve(x, z, params.lots.depth * 0.7);
        }
      }
    }

  // Orchards, last of everything and therefore free: every draw below comes
  // after every house, so a village that grew hedges kept all of its houses
  // exactly where they were. A hedge claims no ground -- that is the contract's
  // own word for it -- so what grows inside the plot is the biome's own scatter,
  // which is what makes a walled square of trees read as a planted one.
  const orchards = params.orchards;
  if (!orchards) return;
  const [ow, oh] = orchards.size;
  const [from, to] = orchards.band;
  for (let k = 0; k < orchards.tries; k++) {
    const bearing = site.random() * Math.PI * 2,
      out = (from + (to - from) * site.random()) * site.radius;
    const x = site.x + Math.cos(bearing) * out,
      z = site.z + Math.sin(bearing) * out;
    // Not over the houses, and not up the side of the hill either: a hedge
    // follows the ground it is laid on and a steep one reads as a fence falling
    // over. A dropped plot is one orchard fewer, never a retry somewhere else.
    if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < Math.max(ow, oh) * 0.8)) continue;
    if (kit.slope(x, z) > orchards.maxSlope) continue;
    const ca = Math.cos(site.yaw),
      sa = Math.sin(site.yaw);
    /** @param {number} u @param {number} v @returns {[number, number]} */
    const corner = (u, v) => [x + ca * u - sa * v, z + sa * u + ca * v];
    kit.line(
      [
        corner(-ow / 2, -oh / 2),
        corner(ow / 2, -oh / 2),
        corner(ow / 2, oh / 2),
        corner(-ow / 2, oh / 2),
        corner(-ow / 2, -oh / 2),
      ],
      'hedge',
    );
  }
}
