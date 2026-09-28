// Sea cliffs: here and there the sea has cut into the land. Within a width W
// of the base water line the land is taken down to a floor under the sea, and
// the face stands where the width ends, as tall as the land is there -- so a
// cliff rises where high land meets the sea and a low coast stays a beach. A
// jump in height across a front is what a heightfield draws as a wall, and a
// front two cells wide is the narrowest that does not saw along the grid.
//
// Where the water line is and whether the coast there is one a cliff stands on
// (the sea past it, land tall enough behind it) are asked of a lattice of nodes
// every COAST_NODE metres, each a pure function of its own indices, and read
// between them bilinearly: asked of the point itself, the distance is noise
// past a few metres from the water and the cut is full of holes. A node's own
// straight walk down the gradient can land far from where a neighbour's does
// -- a ragged coast bends between them -- so a node's distance is to the
// nearest water-line point its own 3x3 neighbourhood of walks found, never to
// its own walk alone: one walk's line, taken by itself, left pits where a
// neighbour's was nearer. Whether it is a cliff coast is not the nearest
// walk's answer but all of theirs, weighed by how near each landed: that
// answer flips between two walks a few metres apart, and taken from the
// nearest alone it flipped from node to node and left pits and islets across
// the band. Pure CPU: no three, no DOM.
import { fbm, sstep } from './noise';

export interface SeaCliffForm {
  /** Width of the slow mask that says where a coast is cut at all, m. */
  scale: number;
  /** The mask: `sstep(cover[0], cover[1], fbm)`. How much coast has a cliff. */
  cover: [number, number];
  /** How far the sea has cut in, m, drawn from a second slow noise. */
  width: [number, number];
  /** How wide the face is, m. Never under two cells. */
  face: number;
  /** How far under the sea the cut land goes, m. */
  floor: number;
  /** A face lower than this is a beach, m. */
  minFace: [number, number];
  /** A face higher than this is a mountain, m. */
  maxFace: [number, number];
  /** How far the front wanders, m. */
  jag: number;
  /** How far past the water line the sea is looked for, m. */
  probe: number;
  /** How deep the water must be there to be the sea, m: a pond is shallower. */
  deep: [number, number];
  /** The lowest base height the cut considers, m: the shelf bottoms out at about -46. */
  low: number;
}

export const SEA_CLIFF: SeaCliffForm = {
  scale: 3500,
  cover: [0.05, 0.3],
  width: [70, 190],
  face: 32,
  floor: 7,
  minFace: [18, 34],
  maxFace: [140, 190],
  jag: 22,
  probe: 300,
  deep: [3, 10],
  low: -40,
};

/** Spacing of the lattice of nodes, m. */
export const COAST_NODE = 64;
/** Newton steps a node takes toward the water line. */
const NEWTON_STEPS = 3;
/** Nodes remembered; a power of two. */
const CACHE = 4096;
/** How far a node looks for a nearer walk, in cells either side: 1 is 3x3. */
const NEIGHBOURS = 1;
/** How fast a walk's say in whether a node's coast is a cliff falls with distance, m. */
const BLEND = COAST_NODE;

export type BaseHeight = (x: number, z: number, out: Float64Array) => void;

export interface SeaCliffs {
  /** The change to a point's height, m; `share` is how much of the point may be cut. */
  at(x: number, z: number, b: number, share: number): number;
}

/** No cliffs anywhere: a sampler built without them, and a measurement's baseline. */
export const NO_CLIFFS: SeaCliffs = { at: () => 0 };

export function createSeaCliffs(base: BaseHeight, salt: number, form: SeaCliffForm = SEA_CLIFF): SeaCliffs {
  const C = form;
  const tmp = new Float64Array(5);
  const height = (x: number, z: number) => {
    base(x, z, tmp);
    return tmp[0]!;
  };
  const widthAt = (x: number, z: number) =>
    C.width[0] + (C.width[1] - C.width[0]) * (0.5 + 0.5 * fbm(x / 1400 + 5.1, z / 1400 - 2.7, salt + 1, 2));
  const hashSlot = (ix: number, iz: number) =>
    (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) & (CACHE - 1);
  // Sharpened, or a half-made cut leaves flat land just under the water: a
  // pale shoal in front of the cliff. The mask is not: it is what makes a
  // cliff fade along the coast, and that has to take hundreds of metres.
  const sharp = (v: number) => sstep(0.35, 0.65, v);
  // The walk: a node's own straight Newton descent toward the water line,
  // cached by (ix, iz) exactly like a node was before. Whether its coast is a
  // cliff coast -- `sea` and `front` -- is read off the walk's own end and
  // travel direction, because both belong to the walk that found them, not
  // to whoever later reads the node.
  const walkKeyX = new Float64Array(CACHE).fill(Number.NaN),
    walkKeyZ = new Float64Array(CACHE),
    walkConverged = new Uint8Array(CACHE),
    walkLx = new Float64Array(CACHE),
    walkLz = new Float64Array(CACHE),
    walkCliff = new Float64Array(CACHE);
  const walk = (ix: number, iz: number) => {
    const slot = hashSlot(ix, iz);
    if (walkKeyX[slot] === ix && walkKeyZ[slot] === iz) return slot;
    const x0 = ix * COAST_NODE,
      z0 = iz * COAST_NODE;
    let x = x0,
      z = z0,
      h = height(x, z),
      ux = 0,
      uz = 0;
    const E = 12;
    for (let k = 0; k < NEWTON_STEPS; k++) {
      const gx = (height(x + E, z) - height(x - E, z)) / (2 * E);
      const gz = (height(x, z + E) - height(x, z - E)) / (2 * E);
      const g = Math.max(Math.hypot(gx, gz), 0.004);
      ux = gx / g;
      uz = gz / g;
      const step = Math.max(-400, Math.min(400, h / g));
      x -= ux * step;
      z -= uz * step;
      h = height(x, z);
      if (Math.abs(h) < 0.5) break;
    }
    const W = widthAt(x, z);
    walkKeyX[slot] = ix;
    walkKeyZ[slot] = iz;
    walkConverged[slot] = Math.abs(h) < 0.5 ? 1 : 0;
    walkLx[slot] = x;
    walkLz[slot] = z;
    const sea = sstep(C.deep[0], C.deep[1], -height(x - ux * C.probe, z - uz * C.probe));
    const front = height(x + ux * W, z + uz * W);
    const worth = sstep(C.minFace[0], C.minFace[1], front) * (1 - sstep(C.maxFace[0], C.maxFace[1], front));
    // Sharpened here, per walk, and not only after the nodes are mixed: a
    // mix of `sea` and `front` sat in the middle of the sharpening over whole
    // hillsides, and there every small slope of it was a steep slope of the
    // cut -- a moat behind a beach, a pit where it met the face.
    walkCliff[slot] = sharp(worth * sea);
    return slot;
  };
  // The node: the nearest water-line point its own 3x3 neighbourhood of walks
  // found, not its own walk alone -- two neighbours' straight descents can
  // land on different stretches of a ragged coast, and the nearer one is the
  // node's true distance. Whether its coast is a cliff coast is every
  // converged walk's answer, each weighed by exp(-distance / BLEND): the
  // nearest walk's alone flipped between neighbouring nodes, because two walks
  // a few metres apart can read the sea past them differently. Cached by
  // (ix, iz) too, in its own CACHE.
  const nodeKeyX = new Float64Array(CACHE).fill(Number.NaN),
    nodeKeyZ = new Float64Array(CACHE),
    distance = new Float64Array(CACHE),
    cliffOf = new Float64Array(CACHE);
  const node = (ix: number, iz: number) => {
    const slot = hashSlot(ix, iz);
    if (nodeKeyX[slot] === ix && nodeKeyZ[slot] === iz) return slot;
    const x0 = ix * COAST_NODE,
      z0 = iz * COAST_NODE;
    let bestDist = Infinity,
      weights = 0,
      cliff = 0;
    for (let dz = -NEIGHBOURS; dz <= NEIGHBOURS; dz++)
      for (let dx = -NEIGHBOURS; dx <= NEIGHBOURS; dx++) {
        const w = walk(ix + dx, iz + dz);
        // Read out right after asking for it, before the next walk in the
        // neighbourhood is asked for: the same slot-aliasing the node cache
        // had (round 1) can happen here, since the walk cache is asked
        // (2 * NEIGHBOURS + 1)^2 times over one node.
        const wConverged = walkConverged[w]!,
          wLx = walkLx[w]!,
          wLz = walkLz[w]!,
          wCliff = walkCliff[w]!;
        if (!wConverged) continue;
        const dist = Math.hypot(wLx - x0, wLz - z0);
        if (dist < bestDist) bestDist = dist;
        // Relative to the nearest walk this is exp(-(dist - nearest) / BLEND),
        // and a walk lands a few hundred metres off at most, so the weight
        // never underflows.
        const weight = Math.exp(-dist / BLEND);
        weights += weight;
        cliff += weight * wCliff;
      }
    nodeKeyX[slot] = ix;
    nodeKeyZ[slot] = iz;
    const sign = Math.sign(height(x0, z0));
    // No walk in the neighbourhood converged: far from any line, so no cut.
    const found = weights > 0;
    distance[slot] = found ? sign * bestDist : sign * 1e4;
    cliffOf[slot] = found ? cliff / weights : 0;
    return slot;
  };
  const coast = { d: 0, cliff: 0 };
  const lookup = (x: number, z: number) => {
    const fx = x / COAST_NODE,
      fz = z / COAST_NODE;
    const ix = Math.floor(fx),
      iz = Math.floor(fz);
    const tx = fx - ix,
      tz = fz - iz;
    // Each node's two values are read out right after its own node() call,
    // before the next node() is asked for: two corners can hash to the same
    // CACHE slot, and asking for the next corner overwrites that slot before
    // a value read later would see it -- a texel then mixed the wrong node's
    // answer in, deterministically, wherever two of the four corners collide.
    const a = node(ix, iz),
      ad = distance[a]!,
      ac = cliffOf[a]!;
    const b = node(ix + 1, iz),
      bd = distance[b]!,
      bc = cliffOf[b]!;
    const c = node(ix, iz + 1),
      cd = distance[c]!,
      cc = cliffOf[c]!;
    const e = node(ix + 1, iz + 1),
      ed = distance[e]!,
      ec = cliffOf[e]!;
    const mix = (av: number, bv: number, cv: number, ev: number) =>
      (av * (1 - tx) + bv * tx) * (1 - tz) + (cv * (1 - tx) + ev * tx) * tz;
    coast.d = mix(ad, bd, cd, ed);
    coast.cliff = mix(ac, bc, cc, ec);
    return coast;
  };
  return {
    at(x, z, b, share) {
      if (share <= 0 || b < C.low || b > C.maxFace[1]) return 0;
      const m = sstep(C.cover[0], C.cover[1], fbm(x / C.scale, z / C.scale, salt, 2)) * share;
      if (m <= 0) return 0;
      const { d: dist, cliff } = lookup(x, z);
      if (cliff <= 0) return 0;
      const W = widthAt(x, z);
      const d = dist + C.jag * fbm(x / 160, z / 160, salt + 2, 2);
      const cut = 1 - sstep(W - C.face, W, d);
      if (cut <= 0) return 0;
      // Sharpened again: where the walks disagree, their mix is the vote, and
      // a half-cut there would be the shoal the walks' own sharpening keeps
      // out.
      const k = m * cut * sharp(cliff);
      if (k <= 0) return 0;
      // A cliff stands in deep water: the floor is the same under the face and
      // for 40 m out to sea, and only then goes back to the shelf.
      return k * (Math.min(b, -C.floor * sstep(-160, -40, d)) - b);
    },
  };
}
