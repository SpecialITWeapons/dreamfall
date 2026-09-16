/**
 * The plan of a town: a ring road, a grid of streets inside it, a plaza at the
 * middle with the landmark standing on its rim, and lots along every street.
 * Data only -- it calls the kit and returns nothing -- so it is a pure function
 * of the site, the parameters and whatever the kit answers about the ground.
 * That is what lets a town of two thousand buildings be built and read by a
 * test in Node with no terrain anywhere. It is the town's counterpart to
 * `plan.js`'s village, and it exists because a village grown to 900 m lays one
 * street with paths off it: that fills a ribbon, and a town fills a disc.
 *
 * The order of the draws is fixed, and it is the town's repeatability: the
 * ring's nudges, one per point; then every street's wander, family A in
 * ascending k and then family B; then the landmark's bearing and its height;
 * then one acceptance for every lot the grid offered, in the order the streets
 * were laid, and three more draws for each one taken. Change the order and the
 * same seed lays a different town, which a player who flies back can notice.
 *
 * It is linear in the candidates it offers, and it has to be: a town walks some
 * eight thousand of them, and the two questions each one asks -- am I on a
 * road, is there already a house here -- are answered out of hash grids rather
 * than by scanning everything that came before. `plan.js` scans, which a
 * village of a hundred and fifty can afford and a town cannot.
 */

/**
 * Metres of street per radian of the wander: a street's slow curve runs through
 * a period in some 560 m, which reads as a street laid by eye. The wander is a
 * sine of the distance along the street and not noise at every step, because
 * noise at every step reads as a rope rather than as a street.
 */
const WANDER = 90;

/** How far a building keeps off the edge of a ribbon, m: a house is not in the gutter. */
const CLEARANCE = 0.5;

/**
 * Two cell indices as one number, for a hash grid's key. A string key would
 * read better and would be the wrong call here: a 900 m town asks the grids
 * some fifteen thousand times and builds nine keys a question, so the strings
 * alone were a quarter of the plan -- measured over the real ground of seed 42,
 * 24.6 ms down to 18.8, with the same town coming out of it. The stride is
 * 2^23, so the key is exact while a cell index stays inside +/-4 million, which
 * at eighteen metres a cell is further out than any flight goes. Past that it
 * collides, and a collision is harmless both times it can happen: the bucket's
 * own distance test is what answers, and a segment or a point from the other
 * side of the world fails it.
 *
 * @param {number} cx @param {number} cz
 */
const keyOf = (cx, cz) => cx * 8388608 + cz;

/**
 * Places round the plaza's rim the landmark will try, in order, from the one it
 * drew. Twenty-four is 12 m apart on a 46 m rim, which steps clear of a 9 m
 * ribbon in one go and still stands the tower near enough to where it drew.
 */
const RIM_STEPS = 24;

/**
 * The landmark's floors when the parameters name no range for it. The tower is
 * baked at three and four stages and nothing else, and asking for a fifth
 * throws rather than shrugging.
 *
 * @type {[number, number]}
 */
const LANDMARK_FLOORS = [3, 4];

/**
 * Which way a building on a shoulder turns: its front to the axis it stands on.
 * The same expression `plan.js` uses, in one place here because the landmark
 * faces the middle of the plaza in exactly the same way -- the plaza's rim is
 * the street it stands on.
 *
 * @param {number} ux @param {number} uz the axis, a unit vector
 * @param {number} shoulder +1 for the left of it, -1 for the right
 */
function facing(ux, uz, shoulder) {
  return Math.atan2(ux, uz) + (shoulder > 0 ? 0 : Math.PI);
}

/**
 * The distance from a point to a segment, m.
 *
 * @param {number} ax @param {number} az @param {number} bx @param {number} bz
 * @param {number} x @param {number} z
 */
function toSegment(ax, az, bx, bz, x, z) {
  const dx = bx - ax,
    dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

/**
 * A hash grid of the points already spoken for. The cell is at least as wide as
 * the radius anything asks about, which is what makes the 3x3 neighbourhood the
 * whole answer.
 *
 * @param {number} cell
 */
function pointGrid(cell) {
  /** @type {Map<number, Array<[number, number]>>} */
  const cells = new Map();
  return {
    /** @param {number} x @param {number} z */
    add(x, z) {
      const key = keyOf(Math.floor(x / cell), Math.floor(z / cell));
      const bucket = cells.get(key);
      if (bucket) bucket.push([x, z]);
      else cells.set(key, [[x, z]]);
    },
    /**
     * @param {number} x @param {number} z @param {number} within
     * @returns {boolean} true when something taken stands closer than `within`
     */
    near(x, z, within) {
      const cx = Math.floor(x / cell),
        cz = Math.floor(z / cell);
      const limit = within * within;
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++) {
          const bucket = cells.get(keyOf(cx + i, cz + j));
          if (!bucket) continue;
          for (const point of bucket) {
            const dx = point[0] - x,
              dz = point[1] - z;
            if (dx * dx + dz * dz < limit) return true;
          }
        }
      return false;
    },
  };
}

/**
 * A hash grid of the ribbons, filled once the streets are laid and asked by
 * every candidate lot. A segment is filed in every cell its bounding box
 * touches, so every point of it is filed with it; the cell is wider than the
 * widest half ribbon, so anything close enough to matter is in the 3x3
 * neighbourhood of the point asking.
 *
 * @param {number} cell
 */
function ribbonGrid(cell) {
  /** @type {Map<number, Array<[number, number, number, number, number]>>} */
  const cells = new Map();
  return {
    /** @param {Array<[number, number]>} points @param {number} width */
    add(points, width) {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i];
        if (!a || !b) continue;
        /** @type {[number, number, number, number, number]} */
        const segment = [a[0], a[1], b[0], b[1], width / 2];
        const x0 = Math.floor(Math.min(a[0], b[0]) / cell),
          x1 = Math.floor(Math.max(a[0], b[0]) / cell);
        const z0 = Math.floor(Math.min(a[1], b[1]) / cell),
          z1 = Math.floor(Math.max(a[1], b[1]) / cell);
        for (let cx = x0; cx <= x1; cx++)
          for (let cz = z0; cz <= z1; cz++) {
            const key = keyOf(cx, cz);
            const bucket = cells.get(key);
            if (bucket) bucket.push(segment);
            else cells.set(key, [segment]);
          }
      }
    },
    /** @param {number} x @param {number} z @returns {boolean} true when the point is on a ribbon */
    on(x, z) {
      const cx = Math.floor(x / cell),
        cz = Math.floor(z / cell);
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++) {
          const bucket = cells.get(keyOf(cx + i, cz + j));
          if (!bucket) continue;
          for (const s of bucket)
            if (toSegment(s[0], s[1], s[2], s[3], x, z) <= s[4] + CLEARANCE) return true;
        }
      return false;
    },
  };
}

/**
 * Lay a walk as road, cut wherever the ground is too steep to carry one. What
 * is left on either side of the steep part is a run of its own rather than the
 * end of the street: a town's outskirts reach past the plateau's feather, and a
 * street that gave up at the first steep step would stop halfway across the
 * town. A gap in the walk -- a point the caller dropped for standing outside
 * the ring -- cuts it the same way, and a run of one point is not a road.
 *
 * The ring road goes through here as well. It is the outermost thing the town
 * lays, so it is the first to meet a hillside, and the rule that keeps a street
 * off one is not a rule a ring road is exempt from.
 *
 * @param {import('../contract').SiteKit} kit
 * @param {Array<[number, number] | null>} walk
 * @param {number} width
 * @param {number} maxSlope
 * @returns {Array<{ points: Array<[number, number]>, width: number }>}
 */
function layRuns(kit, walk, width, maxSlope) {
  /** @type {Array<{ points: Array<[number, number]>, width: number }>} */
  const laid = [];
  /** @type {Array<[number, number]>} */
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      kit.road(run, width);
      laid.push({ points: run, width });
    }
    run = [];
  };
  for (const point of walk) {
    if (point && kit.slope(point[0], point[1]) <= maxSlope) run.push(point);
    else flush();
  }
  flush();
  return laid;
}

/**
 * Lay a town out through the kit.
 *
 * @param {import('../contract').Site} site
 * @param {typeof import('./town.js').TOWN} params
 * @param {import('../contract').SiteKit} kit
 */
export function planTown(site, params, kit) {
  /** How far the town reaches: the ring's own radius, and everything is cut off at it. */
  const bound = params.roads.ring.at * site.radius;
  const depth = params.lots.depth;
  /** @type {Array<{ points: Array<[number, number]>, width: number }>} */
  const streets = [];

  // 1. The ring road: a closed walk, one draw a point nudging its radius, so the
  //    town is bounded by a road that was laid rather than by a compass.
  /** @type {Array<[number, number] | null>} */
  const ring = [];
  for (let i = 0; i < params.roads.ring.steps; i++) {
    const angle = (i / params.roads.ring.steps) * Math.PI * 2;
    const r = bound + (site.random() - 0.5) * params.roads.jitter;
    ring.push([site.x + Math.cos(angle) * r, site.z + Math.sin(angle) * r]);
  }
  const first = ring[0];
  if (first) ring.push([first[0], first[1]]); // closed: the last point is the first
  streets.push(...layRuns(kit, ring, params.roads.ring.width, params.roads.maxSlope));

  // 2. The grid: two families of parallel streets, one along the site's own yaw
  //    and one across it, at every offset that is a real chord of the ring.
  //    Family A ascending, then family B, and one draw per street for the phase
  //    of its wander -- the wander is the whole difference between a town and
  //    graph paper, and it costs one number a street.
  for (const across of [0, Math.PI / 2]) {
    const yaw = site.yaw + across;
    const ux = Math.cos(yaw),
      uz = Math.sin(yaw);
    const nx = -uz,
      nz = ux;
    const most = Math.ceil(bound / params.roads.spacing) - 1;
    for (let k = -most; k <= most; k++) {
      const offset = k * params.roads.spacing;
      const half = Math.sqrt(Math.max(0, bound * bound - offset * offset));
      if (half < params.roads.step) continue; // a chord shorter than a step is not a street
      const phase = site.random() * Math.PI * 2;
      const steps = Math.max(1, Math.round((2 * half) / params.roads.step));
      /** @type {Array<[number, number] | null>} */
      const walk = [];
      for (let i = 0; i <= steps; i++) {
        const along = -half + (2 * half * i) / steps;
        const side = offset + Math.sin(phase + along / WANDER) * params.roads.jitter;
        const x = site.x + nx * side + ux * along,
          z = site.z + nz * side + uz * along;
        walk.push(Math.hypot(x - site.x, z - site.z) > bound ? null : [x, z]);
      }
      streets.push(...layRuns(kit, walk, params.roads.width, params.roads.maxSlope));
    }
  }

  // Every ribbon the town has, filed once the streets are laid: the landmark
  // asks it where it may stand, and so does every candidate lot after it.
  const ribbons = ribbonGrid(Math.max(params.roads.step, params.roads.ring.width));
  for (const street of streets) ribbons.add(street.points, street.width);

  // 3. The plaza, and the landmark standing on its rim. Two draws: which way
  //    round it stands, and how tall it is. It faces the middle the way a house
  //    faces its street, because the rim is the street it stands on.
  //
  //    The grid runs through the plaza rather than round it -- a square with the
  //    streets meeting in it is a square -- so the drawn bearing can put the
  //    landmark in the middle of one. It walks round the rim from there to the
  //    first place clear of a ribbon, and that walk takes no draw of its own:
  //    the bearing is still the one number the stream gave, and a town whose
  //    tower stands in the road is not a town. Measured over 120 towns, one in
  //    six needed the walk.
  const taken = pointGrid(depth);
  kit.reserve(site.x, site.z, params.plaza.radius);
  const bearing = site.random() * Math.PI * 2;
  let landmarkX = site.x + Math.cos(bearing) * params.plaza.radius,
    landmarkZ = site.z + Math.sin(bearing) * params.plaza.radius;
  let stood = bearing;
  for (let i = 1; i <= RIM_STEPS && ribbons.on(landmarkX, landmarkZ); i++) {
    stood = bearing + (i / RIM_STEPS) * Math.PI * 2;
    landmarkX = site.x + Math.cos(stood) * params.plaza.radius;
    landmarkZ = site.z + Math.sin(stood) * params.plaza.radius;
  }
  const tall = params.storeys[params.landmark] ?? LANDMARK_FLOORS;
  const stages = Math.min(tall[1], tall[0] + Math.floor(site.random() * (tall[1] - tall[0] + 1)));
  kit.structure(params.landmark, landmarkX, landmarkZ, {
    yaw: facing(-Math.sin(stood), Math.cos(stood), -1),
    floors: stages,
    // The one building the town does not tint: a landmark seen from two
    // kilometres is its recipe's own stonework or it is a smudge.
    tint: 'white',
  });
  // Its own ground, not the plaza's: it stands on the rim, so half its footprint
  // is outside the circle the plaza reserved.
  kit.reserve(landmarkX, landmarkZ, depth * 0.7);
  taken.add(landmarkX, landmarkZ);

  // 4. The lots, in two passes over every street the town laid, the ring
  //    included -- its outer shoulder is the suburb.
  //
  //    The first pass takes no draws at all. It is the town counting what it has
  //    room for: where a building could stand, how far out it would be, and what
  //    the weights of all of them add up to. Only then can the second pass know
  //    what share of them to build.
  /** Nothing stands in the square, and nothing stands with its back against it. */
  const keepOff = params.plaza.radius + depth * 0.6;
  /** @type {Array<{ x: number, z: number, ux: number, uz: number, shoulder: number, out: number }>} */
  const candidates = [];
  let weightSum = 0;
  for (const street of streets) {
    // Stepped along the whole street rather than restarted at each of its
    // points: a street is walked in 32 m steps and a lot is 18 deep, so
    // restarting would throw away 14 m of every segment and offer the town
    // little more than half the lots it has room for.
    let along = depth / 2;
    for (let i = 1; i < street.points.length; i++) {
      const p = street.points[i - 1],
        q = street.points[i];
      if (!p || !q) continue;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len <= 0) continue;
      const ux = (q[0] - p[0]) / len,
        uz = (q[1] - p[1]) / len;
      for (; along <= len; along += depth) {
        const cx = p[0] + ux * along,
          cz = p[1] + uz * along;
        for (const shoulder of [1, -1]) {
          const x = cx - uz * shoulder * params.lots.setback,
            z = cz + ux * shoulder * params.lots.setback;
          const reach = Math.hypot(x - site.x, z - site.z);
          const out = reach / site.radius;
          if (out > 1) continue;
          if (reach < keepOff) continue;
          if (ribbons.on(x, z)) continue;
          // Never two houses in one place: streets cross, and a crossing would
          // otherwise get a house from each of them.
          if (taken.near(x, z, depth * 0.9)) continue;
          taken.add(x, z);
          candidates.push({ x, z, ux, uz, shoulder, out });
          weightSum += 1 - out * out;
        }
      }
      along -= len;
    }
  }

  // Pass two: what share of them the town actually builds. The share is chosen
  // so the count lands where the parameters ask by construction -- every
  // candidate is accepted with its own weight times `k`, and the weights add up
  // to `weightSum`, so the expected number of buildings is `target`. That one
  // expression is both the count and the thinning suburbs.
  //
  // Never by stopping the walk at a count: a cap would hit it too, and would
  // truncate the town spatially -- it walks the streets in the order they were
  // laid, so what a cap builds is a town with one side missing. That is the same
  // fault the ring's tree ceiling has, and it is a fault there as well.
  //
  // The clamp is on the chance and not on the share, and that is the difference
  // between a narrow town and no narrow town at all: a 400 m town offers 894
  // lots whose weights add up to 471, so a share capped at one caps the town at
  // 463 buildings against the 560 it is asked for, and under the 500 the
  // specification's floor is. Capping the chance instead fills the middle of it
  // solid and leaves the thinning to shape the outskirts, which is what a small
  // town looks like anyway: 538 buildings, measured. Above about 640 m the
  // share is already under one and the clamp never fires.
  const span = params.radius[1] - params.radius[0];
  const grown = span > 0 ? Math.max(0, Math.min(1, (site.radius - params.radius[0]) / span)) : 0;
  const target = params.lots.count[0] + (params.lots.count[1] - params.lots.count[0]) * grown;
  const k = weightSum > 0 ? target / weightSum : 0;

  const kinds = Object.entries(params.buildings).filter(([, weight]) => weight > 0);
  const total = kinds.reduce((sum, [, weight]) => sum + weight, 0);
  const palette = params.palette ?? ['white'];
  /** @type {[number, number]} */
  const townFloors = [params.floors.min, params.floors.max];

  for (const lot of candidates) {
    if (site.random() >= Math.min(1, k * (1 - lot.out * lot.out))) continue;
    let pick = site.random() * total,
      structure = kinds[0]?.[0] ?? 'cottage';
    for (const [id, weight] of kinds) {
      pick -= weight;
      structure = id;
      if (pick <= 0) break;
    }
    // Tall in the middle and low at the edge, which is what reads as a town from
    // the air rather than as an estate.
    const wanted =
      params.floors.min + (params.floors.max - params.floors.min) * (1 - lot.out) ** params.floors.bias;
    const jittered = Math.round(wanted + (site.random() - 0.5) * params.floors.jitter);
    // Clamped into the range this kind actually has a bake at, and that clamp is
    // not a matter of taste: asking a structure for a storey nobody baked throws
    // inside the site queue at runtime, and the clamp is what makes it
    // impossible. A kind the parameters forgot to list keeps the town's own
    // range, which is a guess; what actually holds `storeys` against the bakes
    // is a test, because the contract has no idea a settlement keeps such a
    // list and the recipes are the only place the truth is written down.
    const range = params.storeys[structure] ?? townFloors;
    const floors = Math.max(range[0], Math.min(range[1], jittered));
    // The tint last, as `plan.js` draws it and for the reason its comment gives:
    // it is the last number this lot takes from the stream, so adding one
    // changes every building after it and none before.
    const tint = palette[Math.min(palette.length - 1, Math.floor(site.random() * palette.length))];
    kit.structure(structure, lot.x, lot.z, { yaw: facing(lot.ux, lot.uz, lot.shoulder), floors, tint });
    kit.reserve(lot.x, lot.z, depth * 0.7);
  }
}
