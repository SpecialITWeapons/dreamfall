// Sea cliffs: here and there the sea has cut into the land. Within a width W
// of the base water line the land is taken down to a floor under the sea, and
// the face stands where the width ends, as tall as the land is there -- so a
// cliff rises where high land meets the sea and a low coast stays a beach. A
// jump in height across a front is what a heightfield draws as a wall, and a
// front two cells wide is the narrowest that does not saw along the grid.
//
// Where the water line is, whether it is the sea and how tall the land at the
// front stands are asked of a lattice of nodes every COAST_NODE metres, each a
// pure function of its own indices, and read between them bilinearly: asked of
// the point itself, the distance is noise past a few metres from the water and
// the cut is full of holes. Pure CPU: no three, no DOM.
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
  const keyX = new Float64Array(CACHE).fill(Number.NaN),
    keyZ = new Float64Array(CACHE),
    distance = new Float64Array(CACHE),
    seaness = new Float64Array(CACHE),
    frontOf = new Float64Array(CACHE);
  // One node: walk down the gradient to the water line, then look past it for
  // the sea and back up it for the land the front stands in.
  const node = (ix: number, iz: number) => {
    const slot = (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) & (CACHE - 1);
    if (keyX[slot] === ix && keyZ[slot] === iz) return slot;
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
    const W = widthAt(x0, z0);
    keyX[slot] = ix;
    keyZ[slot] = iz;
    distance[slot] = Math.hypot(x - x0, z - z0) * Math.sign(height(x0, z0));
    seaness[slot] = sstep(C.deep[0], C.deep[1], -height(x - ux * C.probe, z - uz * C.probe));
    frontOf[slot] = height(x + ux * W, z + uz * W);
    return slot;
  };
  const coast = { d: 0, sea: 0, front: 0 };
  const lookup = (x: number, z: number) => {
    const fx = x / COAST_NODE,
      fz = z / COAST_NODE;
    const ix = Math.floor(fx),
      iz = Math.floor(fz);
    const tx = fx - ix,
      tz = fz - iz;
    // Each node's three values are read out right after its own node() call,
    // before the next node() is asked for: two corners can hash to the same
    // CACHE slot, and asking for the next corner overwrites that slot before
    // a value read later would see it -- a texel then mixed the wrong node's
    // answer in, deterministically, wherever two of the four corners collide.
    const a = node(ix, iz),
      ad = distance[a]!,
      as = seaness[a]!,
      af = frontOf[a]!;
    const b = node(ix + 1, iz),
      bd = distance[b]!,
      bs = seaness[b]!,
      bf = frontOf[b]!;
    const c = node(ix, iz + 1),
      cd = distance[c]!,
      cs = seaness[c]!,
      cf = frontOf[c]!;
    const e = node(ix + 1, iz + 1),
      ed = distance[e]!,
      es = seaness[e]!,
      ef = frontOf[e]!;
    const mix = (av: number, bv: number, cv: number, ev: number) =>
      (av * (1 - tx) + bv * tx) * (1 - tz) + (cv * (1 - tx) + ev * tx) * tz;
    coast.d = mix(ad, bd, cd, ed);
    coast.sea = mix(as, bs, cs, es);
    coast.front = mix(af, bf, cf, ef);
    return coast;
  };
  return {
    at(x, z, b, share) {
      if (share <= 0 || b < C.low || b > C.maxFace[1]) return 0;
      const m = sstep(C.cover[0], C.cover[1], fbm(x / C.scale, z / C.scale, salt, 2)) * share;
      if (m <= 0) return 0;
      const { d: dist, sea, front } = lookup(x, z);
      if (sea <= 0) return 0;
      const W = widthAt(x, z);
      const d = dist + C.jag * fbm(x / 160, z / 160, salt + 2, 2);
      const cut = 1 - sstep(W - C.face, W, d);
      if (cut <= 0) return 0;
      const worth = sstep(C.minFace[0], C.minFace[1], front) * (1 - sstep(C.maxFace[0], C.maxFace[1], front));
      // Sharpened, or a half-made cut leaves flat land just under the water:
      // a pale shoal in front of the cliff. The mask is not: it is what makes
      // a cliff fade along the coast, and that has to take hundreds of metres.
      const k = m * cut * sstep(0.35, 0.65, worth * sea);
      if (k <= 0) return 0;
      // A cliff stands in deep water: the floor is the same under the face and
      // for 40 m out to sea, and only then goes back to the shelf.
      return k * (Math.min(b, -C.floor * sstep(-160, -40, d)) - b);
    },
  };
}
