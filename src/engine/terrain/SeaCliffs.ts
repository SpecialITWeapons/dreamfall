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
/** Steps a walk takes toward the water line: one Newton step, then the secant. */
const NEWTON_STEPS = 4;
/** Nodes remembered; a power of two. */
const CACHE = 4096;
/** How far a node looks for a nearer walk, in cells either side: 1 is 3x3. */
const NEIGHBOURS = 1;
/** Where the sharpening of the cliff term starts: at or under it, no cut. */
const CLIFF_FLOOR = 0.35;
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
  const sharp = (v: number) => sstep(CLIFF_FLOOR, 0.65, v);
  // The furthest a node's line can be and one of its cells still reach a
  // band: the widest band, its wander, and the diagonal of a cell.
  const REACH = C.width[1] + C.jag + COAST_NODE * Math.SQRT2;
  // The height at each node, cached by (ix, iz): a walk sets out from its
  // own and takes its slope from its four neighbours', so a node's height is
  // sampled once, not once for every walk that needs it.
  const gridKeyX = new Float64Array(CACHE).fill(Number.NaN),
    gridKeyZ = new Float64Array(CACHE),
    gridH = new Float64Array(CACHE);
  const gridHeight = (ix: number, iz: number) => {
    const slot = hashSlot(ix, iz);
    if (gridKeyX[slot] === ix && gridKeyZ[slot] === iz) return gridH[slot]!;
    const h = height(ix * COAST_NODE, iz * COAST_NODE);
    gridKeyX[slot] = ix;
    gridKeyZ[slot] = iz;
    gridH[slot] = h;
    return h;
  };
  // The walk: a node's own straight descent toward the water line, cached by
  // (ix, iz) exactly like a node. Whether its coast is a cliff coast -- `sea`
  // and `front` -- is read off the walk's own end and direction, because both
  // belong to the walk that found them, not to whoever later reads the node.
  const walkKeyX = new Float64Array(CACHE).fill(Number.NaN),
    walkKeyZ = new Float64Array(CACHE),
    walkConverged = new Uint8Array(CACHE),
    walkStart = new Float64Array(CACHE),
    walkLx = new Float64Array(CACHE),
    walkLz = new Float64Array(CACHE),
    walkCliff = new Float64Array(CACHE);
  const walk = (ix: number, iz: number) => {
    const slot = hashSlot(ix, iz);
    if (walkKeyX[slot] === ix && walkKeyZ[slot] === iz) return slot;
    const x0 = ix * COAST_NODE,
      z0 = iz * COAST_NODE;
    const h0 = gridHeight(ix, iz);
    // One Newton step down the slope, then the secant along that same line,
    // f(s) = height(x0 - u s). The slope is the lattice's own, across the
    // node's four neighbours: those heights are cached, where a gradient
    // sampled 12 m either side cost four samples a step, and a line walked
    // by the secant costs one a step. It finds the line as often as three
    // Newton steps did, for less than half the samples.
    const gx = (gridHeight(ix + 1, iz) - gridHeight(ix - 1, iz)) / (2 * COAST_NODE);
    const gz = (gridHeight(ix, iz + 1) - gridHeight(ix, iz - 1)) / (2 * COAST_NODE);
    const g = Math.max(Math.hypot(gx, gz), 0.004);
    const ux = gx / g,
      uz = gz / g;
    let sPrev = 0,
      fPrev = h0,
      s = Math.max(-400, Math.min(400, h0 / g));
    // Where the slope says the line is more than 400 m off, the walk gives up
    // before it takes a sample: that is further than REACH from every node
    // the walk serves, so by its own estimate it could make none of them
    // found, and a quarter of a window's walks are that walk.
    const hopeless = Math.abs(h0 / g) > 400;
    let x = x0 - ux * s,
      z = z0 - uz * s,
      h = hopeless ? Infinity : height(x, z);
    for (let k = 1; !hopeless && k < NEWTON_STEPS && Math.abs(h) >= 0.5; k++) {
      const df = h - fPrev;
      if (df === 0) break;
      const next = s - Math.max(-400, Math.min(400, (h * (s - sPrev)) / df));
      sPrev = s;
      fPrev = h;
      s = next;
      x = x0 - ux * s;
      z = z0 - uz * s;
      h = height(x, z);
    }
    walkKeyX[slot] = ix;
    walkKeyZ[slot] = iz;
    walkStart[slot] = h0;
    walkLx[slot] = x;
    walkLz[slot] = z;
    // A walk that found no line says nothing, so what its coast is like is
    // never asked: two samples and a noise a walk, on nearly half of them.
    const converged = Math.abs(h) < 0.5;
    walkConverged[slot] = converged ? 1 : 0;
    walkCliff[slot] = 0;
    if (!converged) return slot;
    const W = widthAt(x, z);
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
      cliff = 0,
      own = 0;
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
        // The node's own height is where its own walk set out from.
        if (dx === 0 && dz === 0) own = walkStart[w]!;
        if (!wConverged) continue;
        const dist = Math.hypot(wLx - x0, wLz - z0);
        if (dist < bestDist) bestDist = dist;
        // Relative to the nearest walk this is exp(-(dist - nearest) / BLEND),
        // and a walk lands 1.6 km off at most (four steps of 400 m), so the
        // weight never underflows.
        const weight = Math.exp(-dist / BLEND);
        weights += weight;
        cliff += weight * wCliff;
      }
    nodeKeyX[slot] = ix;
    nodeKeyZ[slot] = iz;
    // No walk in the neighbourhood converged: the node has no distance at all
    // (NaN, which cutAt() leaves out) and says no cliff. A made-up distance
    // there -- it was 1e4 -- was mixed with a neighbour's real one and put
    // the end of the cut on the lattice line: a straight step of 28 m in 2 m.
    // A line further than REACH is no better. A walk's line is a real line,
    // so the nearest one is never nearer than the truth, only further; if
    // the node were right, no point of its four cells could be in a band,
    // and where a neighbour's line is in one, the neighbour is the one to
    // believe -- mixed with 457 m against 125 m a cell away, the face was
    // squeezed into 4 m.
    const found = weights > 0 && bestDist <= REACH;
    distance[slot] = found ? Math.sign(own) * bestDist : Number.NaN;
    cliffOf[slot] = found ? cliff / weights : 0;
    return slot;
  };
  // The four corners of the lattice cell the last point fell in: a window
  // is filled a row at a time, and four points in a row share a cell. What
  // is kept is each node's own answer, a pure function of its indices, so
  // keeping it changes nothing but how often node() is asked.
  let cellX = Number.NaN,
    cellZ = Number.NaN,
    ad = 0,
    ac = 0,
    bd = 0,
    bc = 0,
    cd = 0,
    cc = 0,
    ed = 0,
    ec = 0,
    cellCliff = 0;
  const cell = (ix: number, iz: number) => {
    if (ix === cellX && iz === cellZ) return;
    // Each node's two values are read out right after its own node() call,
    // before the next node() is asked for: two corners can hash to the same
    // CACHE slot, and asking for the next corner overwrites that slot before
    // a value read later would see it -- a texel then mixed the wrong node's
    // answer in, deterministically, wherever two of the four corners collide.
    const a = node(ix, iz);
    ad = distance[a]!;
    ac = cliffOf[a]!;
    const b = node(ix + 1, iz);
    bd = distance[b]!;
    bc = cliffOf[b]!;
    const c = node(ix, iz + 1);
    cd = distance[c]!;
    cc = cliffOf[c]!;
    const e = node(ix + 1, iz + 1);
    ed = distance[e]!;
    ec = cliffOf[e]!;
    cellX = ix;
    cellZ = iz;
    cellCliff = Math.max(ac, bc, cc, ec);
  };
  // Water already as deep as the floor is never changed: the cut takes a
  // point to min(b, -floor * s) with s in 0..1, which is b itself for any b
  // at or under -floor. Said first, it spares the lattice the whole shelf --
  // two lookups in five, and every node only the shelf asked for.
  const deepest = Math.max(C.low, -C.floor),
    highest = C.maxFace[1];
  const cutAt = (x: number, z: number, b: number, share: number) => {
    const fx = x / COAST_NODE,
      fz = z / COAST_NODE;
    const ix = Math.floor(fx),
      iz = Math.floor(fz);
    // The cliff term is sharpened below, and sharp() is nought up to 0.35:
    // a cell none of whose corners says more than that cuts nothing, and
    // neither does a point whose mix of them does not. Asked of the cell in
    // hand before the mask, which costs a noise; a cell not yet in hand is
    // asked for only past the mask, which is what keeps the walks off
    // country no cliff can stand on.
    if (ix === cellX && iz === cellZ && cellCliff <= CLIFF_FLOOR) return 0;
    const m = sstep(C.cover[0], C.cover[1], fbm(x / C.scale, z / C.scale, salt, 2)) * share;
    if (m <= 0) return 0;
    cell(ix, iz);
    if (cellCliff <= CLIFF_FLOOR) return 0;
    const tx = fx - ix,
      tz = fz - iz;
    const wa = (1 - tx) * (1 - tz),
      wb = tx * (1 - tz),
      wc = (1 - tx) * tz,
      we = tx * tz;
    // The cliff term is mixed over all four corners, an unfound one saying 0,
    // so it is that term which fades the cut out toward a node with no line.
    // The distance is mixed over the corners that have one, their weights
    // made up to one again. On a lattice line both cells mix the same two
    // corners, so it is continuous across it; it is not continuous only as
    // the weight of the corners that have one goes to 0, and there the cliff
    // term, which only they give, is under the sharpening and cuts nothing.
    const cliff = wa * ac + wb * bc + wc * cc + we * ec;
    if (cliff <= CLIFF_FLOOR) return 0;
    let sum = 0,
      mixed = 0;
    if (!Number.isNaN(ad)) {
      sum += wa;
      mixed += wa * ad;
    }
    if (!Number.isNaN(bd)) {
      sum += wb;
      mixed += wb * bd;
    }
    if (!Number.isNaN(cd)) {
      sum += wc;
      mixed += wc * cd;
    }
    if (!Number.isNaN(ed)) {
      sum += we;
      mixed += we * ed;
    }
    const dist = sum > 0 ? mixed / sum : 0;
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
  };
  return {
    // Kept this small on purpose: it is asked of every texel of a window and
    // the bounds alone answer nought for a third of them or more, so it is
    // written to be inlined where the sampler asks it, and only the rest pay
    // for a call.
    at: (x, z, b, share) => (share <= 0 || b <= deepest || b > highest ? 0 : cutAt(x, z, b, share)),
  };
}
