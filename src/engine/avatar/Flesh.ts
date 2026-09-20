// One surface over a set of chains, grown from a distance field rather than
// swept ring by ring. A chain is still what it was in `Skin.ts` -- joints, a
// profile, a section -- but here it is a *field*: how far a point is from the
// tube the chain describes, negative inside. The chains of one region are
// joined with a smooth minimum, so where an arm meets the chest the field
// rounds over the join instead of pushing one tube through the other, and the
// surface is pulled out of the field on a grid. No seam, no cap, no ring.
//
// Pure CPU: `Vector3` and arithmetic, so the whole figure can be read by a test
// in Node. The output is a `Skin`, the same arrays the sweep produced, and the
// rest of the figure -- the bones, the poses, the springs -- is unchanged.
//
// The surface is *surface nets*: a vertex per grid cell the surface crosses,
// placed at the mean of the crossings on the cell's edges, and a quad for
// every grid edge the surface crosses, joining the four cells round it. It
// needs no table, it is watertight by construction, and its normals come from
// the field's own gradient, which is what makes a join read as a fillet.
import { Vector3 } from 'three';
import { BLEND, type Chain, type Skin } from './Skin';

export interface FleshOptions {
  /** Grid spacing, m. Finer than a third of the thinnest thing in the region. */
  cell: number;
  /** How far the chains blend into each other where they meet, m. */
  blend?: number;
  /** Grid margin round the chains, in cells. */
  pad?: number;
}

interface Segment {
  a: Vector3;
  dir: Vector3;
  len: number;
  u: Vector3;
  v: Vector3;
  /** Distance along the chain at `a`, m. */
  walked: number;
  index: number;
}

interface Prepared {
  chain: Chain;
  segments: Segment[];
  total: number;
  min: Vector3;
  max: Vector3;
  flattenAt: (t: number) => number;
}

/** Where on a chain a point is nearest, and how far. */
interface Nearest {
  d: number;
  segment: number;
  f: number;
  t: number;
  around: number;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const FAR = 1e3;

/** The frame across a segment: the across-axis carried from the last one, so the section does not spin. */
function frameOf(dir: Vector3, carried: Vector3, u: Vector3, v: Vector3) {
  u.copy(carried).addScaledVector(dir, -carried.dot(dir));
  if (u.lengthSq() < 1e-8) {
    u.set(1, 0, 0).addScaledVector(dir, -dir.x);
    if (u.lengthSq() < 1e-8) u.set(0, 1, 0).addScaledVector(dir, -dir.y);
  }
  u.normalize();
  v.crossVectors(dir, u).normalize();
}

function prepare(chain: Chain, blend: number): Prepared {
  if (chain.joints.length < 2) throw new Error('a chain needs at least two joints');
  if (chain.bones.length !== chain.joints.length) throw new Error('a chain needs one bone per joint');
  const flattenAt = (t: number) =>
    typeof chain.flatten === 'function' ? chain.flatten(t) : (chain.flatten ?? 1);
  const segments: Segment[] = [];
  const carried = chain.across ? chain.across.clone().normalize() : new Vector3(1, 0, 0);
  let walked = 0;
  for (let i = 0; i + 1 < chain.joints.length; i++) {
    const a = chain.joints[i]!,
      b = chain.joints[i + 1]!;
    const len = a.distanceTo(b);
    const dir = new Vector3().subVectors(b, a).normalize();
    const u = new Vector3(),
      v = new Vector3();
    frameOf(dir, carried, u, v);
    carried.copy(u);
    segments.push({ a, dir, len, u, v, walked, index: i });
    walked += len;
  }
  // The chain's reach: its widest section, whichever way the section is
  // stretched, plus the blend, round the box of its joints.
  let reach = 0;
  for (let k = 0; k <= 32; k++) {
    const t = k / 32;
    const fl = flattenAt(t);
    reach = Math.max(reach, chain.profile(t) * Math.max(fl, 1 / fl));
  }
  reach += blend;
  const min = new Vector3(Infinity, Infinity, Infinity),
    max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const j of chain.joints) {
    min.min(j);
    max.max(j);
  }
  min.subScalar(reach);
  max.addScalar(reach);
  return { chain, segments, total: walked || 1e-9, min, max, flattenAt };
}

const o = new Vector3();
/**
 * How far `p` is from the chain, and where it is nearest. Each segment is a
 * tube of the profile's section, closed at both ends by the same section
 * turned into an ellipsoid: the distance is read in the section's own scaled
 * frame, so a wide chest is wide and a boot is long, and the union of the
 * segments is the chain, rounded at every joint by their overlap.
 */
function nearest(p: Vector3, c: Prepared, out: Nearest): number {
  out.d = FAR;
  for (const s of c.segments) {
    o.subVectors(p, s.a);
    const along = o.dot(s.dir);
    const f = along <= 0 ? 0 : along >= s.len ? 1 : along / s.len;
    const od = along - f * s.len;
    const oa = o.dot(s.u),
      ob = o.dot(s.v);
    const t = (s.walked + f * s.len) / c.total;
    const r = Math.max(1e-4, c.chain.profile(t));
    const fl = c.flattenAt(t);
    const ea = oa / (r * fl),
      eb = (ob * fl) / r,
      ec = od / r;
    const d = (Math.sqrt(ea * ea + eb * eb + ec * ec) - 1) * r;
    if (d < out.d) {
      out.d = d;
      out.segment = s.index;
      out.f = f;
      out.t = t;
      out.around = Math.atan2(ob, oa);
      if (out.around < 0) out.around += Math.PI * 2;
    }
  }
  return out.d;
}

/** A smooth minimum: the two fields round into each other over `k` metres. */
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

/** The bones a point on a chain belongs to, as the sweep bound them: one bone, blending into the next across the joint. */
function binding(chain: Chain, segment: number, f: number, boneIndex: (name: string) => number) {
  let bone = segment,
    weight = 0;
  if (f > 1 - BLEND && segment + 1 < chain.bones.length - 1) weight = 0.5 * smooth((f - (1 - BLEND)) / BLEND);
  else if (f < BLEND && segment > 0) {
    bone = segment - 1;
    weight = 0.5 + 0.5 * smooth(f / BLEND);
  }
  return {
    first: boneIndex(chain.bones[bone]!),
    second: boneIndex(chain.bones[Math.min(bone + 1, chain.bones.length - 1)]!),
    weight,
  };
}

/**
 * Grow the surface over `chains` and hand it back as a skin.
 *
 * @param chains the chains of one region, blended into one another
 * @param boneIndex the index of a bone by name, in the skeleton's own order
 */
export function buildFlesh(chains: Chain[], boneIndex: (name: string) => number, opts: FleshOptions): Skin {
  const cell = opts.cell;
  const blend = opts.blend ?? 0.04;
  const pad = opts.pad ?? 2;
  if (!(cell > 0)) throw new Error('flesh needs a cell size');
  if (chains.length === 0) throw new Error('flesh needs a chain');
  const prepared = chains.map((chain) => prepare(chain, blend));

  // The grid: round the chains' reach, with a margin of cells so the surface
  // never touches the edge of it (a surface on the edge is a hole).
  const min = new Vector3(Infinity, Infinity, Infinity),
    max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const c of prepared) {
    min.min(c.min);
    max.max(c.max);
  }
  min.subScalar(pad * cell);
  max.addScalar(pad * cell);
  const nx = Math.ceil((max.x - min.x) / cell) + 1,
    ny = Math.ceil((max.y - min.y) / cell) + 1,
    nz = Math.ceil((max.z - min.z) / cell) + 1;
  const at = (i: number, j: number, k: number) => (i * ny + j) * nz + k;

  const probe: Nearest = { d: FAR, segment: 0, f: 0, t: 0, around: 0 };
  const p = new Vector3();
  /** The region's field at a point: every chain in reach, rounded together. */
  const field = (x: number, y: number, z: number): number => {
    p.set(x, y, z);
    let d = FAR;
    for (const c of prepared) {
      if (x < c.min.x || x > c.max.x || y < c.min.y || y > c.max.y || z < c.min.z || z > c.max.z) continue;
      d = smin(d, nearest(p, c, probe), blend);
    }
    return d;
  };

  const values = new Float32Array(nx * ny * nz);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      for (let k = 0; k < nz; k++)
        values[at(i, j, k)] = field(min.x + i * cell, min.y + j * cell, min.z + k * cell);

  // A vertex per cell the surface crosses, at the mean of its edge crossings.
  const cells = (nx - 1) * (ny - 1) * (nz - 1);
  const vertexOf = new Int32Array(cells).fill(-1);
  const cellAt = (i: number, j: number, k: number) => (i * (ny - 1) + j) * (nz - 1) + k;
  const positions: number[] = [];
  const CORNERS = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ] as const;
  const EDGES = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ] as const;
  const corner = new Float64Array(8);
  for (let i = 0; i + 1 < nx; i++)
    for (let j = 0; j + 1 < ny; j++)
      for (let k = 0; k + 1 < nz; k++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          const [dx, dy, dz] = CORNERS[c]!;
          corner[c] = values[at(i + dx, j + dy, k + dz)]!;
          if (corner[c]! < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        let sx = 0,
          sy = 0,
          sz = 0,
          n = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a]!,
            vb = corner[b]!;
          if (va < 0 === vb < 0) continue;
          const s = va / (va - vb);
          const [ax, ay, az] = CORNERS[a]!,
            [bx, by, bz] = CORNERS[b]!;
          sx += ax + (bx - ax) * s;
          sy += ay + (by - ay) * s;
          sz += az + (bz - az) * s;
          n++;
        }
        vertexOf[cellAt(i, j, k)] = positions.length / 3;
        positions.push(min.x + (i + sx / n) * cell, min.y + (j + sy / n) * cell, min.z + (k + sz / n) * cell);
      }

  // A quad for every grid edge the surface crosses, between the four cells
  // that share the edge; wound so it faces out of the field.
  const index: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) index.push(a, d, c, a, c, b);
    else index.push(a, b, c, a, c, d);
  };
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      for (let k = 0; k < nz; k++) {
        const v0 = values[at(i, j, k)]!;
        if (i + 1 < nx && j > 0 && k > 0 && j < ny - 1 && k < nz - 1) {
          const v1 = values[at(i + 1, j, k)]!;
          if (v0 < 0 !== v1 < 0)
            quad(
              vertexOf[cellAt(i, j - 1, k - 1)]!,
              vertexOf[cellAt(i, j, k - 1)]!,
              vertexOf[cellAt(i, j, k)]!,
              vertexOf[cellAt(i, j - 1, k)]!,
              v0 >= 0,
            );
        }
        if (j + 1 < ny && i > 0 && k > 0 && i < nx - 1 && k < nz - 1) {
          const v1 = values[at(i, j + 1, k)]!;
          if (v0 < 0 !== v1 < 0)
            quad(
              vertexOf[cellAt(i - 1, j, k - 1)]!,
              vertexOf[cellAt(i - 1, j, k)]!,
              vertexOf[cellAt(i, j, k)]!,
              vertexOf[cellAt(i, j, k - 1)]!,
              v0 >= 0,
            );
        }
        if (k + 1 < nz && i > 0 && j > 0 && i < nx - 1 && j < ny - 1) {
          const v1 = values[at(i, j, k + 1)]!;
          if (v0 < 0 !== v1 < 0)
            quad(
              vertexOf[cellAt(i - 1, j - 1, k)]!,
              vertexOf[cellAt(i, j - 1, k)]!,
              vertexOf[cellAt(i, j, k)]!,
              vertexOf[cellAt(i - 1, j, k)]!,
              v0 >= 0,
            );
        }
      }

  // What each vertex is: its normal off the field's gradient, its bones and
  // its swatch off the nearest chain -- or the two nearest, where the field
  // is a blend of them, so a vertex on the fillet between the chest and the
  // arm follows both a little and tears from neither.
  const count = positions.length / 3;
  const skin: Skin = {
    position: new Float32Array(positions),
    normal: new Float32Array(count * 3),
    color: new Float32Array(count * 3),
    skinIndex: new Uint16Array(count * 4),
    skinWeight: new Float32Array(count * 4),
    index: new Uint32Array(index),
    swatch: new Array<string>(count),
    swatch2: new Array<string>(count),
    mix: new Float32Array(count),
    shade: new Float32Array(count).fill(1),
    along: new Float32Array(count),
    around: new Float32Array(count),
  };
  const h = cell * 0.5;
  const near: Array<{ c: Prepared; n: Nearest }> = prepared.map((c) => ({
    c,
    n: { d: FAR, segment: 0, f: 0, t: 0, around: 0 },
  }));
  const slots = new Map<number, number>();
  for (let v = 0; v < count; v++) {
    const x = positions[v * 3]!,
      y = positions[v * 3 + 1]!,
      z = positions[v * 3 + 2]!;
    const gx = field(x + h, y, z) - field(x - h, y, z),
      gy = field(x, y + h, z) - field(x, y - h, z),
      gz = field(x, y, z + h) - field(x, y, z - h);
    const g = Math.hypot(gx, gy, gz) || 1;
    skin.normal.set([gx / g, gy / g, gz / g], v * 3);

    p.set(x, y, z);
    for (const entry of near) nearest(p, entry.c, entry.n);
    near.sort((a, b) => a.n.d - b.n.d);
    const first = near[0]!,
      second = near[1];
    const shared = second && second.n.d - first.n.d < blend ? 1 - (second.n.d - first.n.d) / blend : 0;
    slots.clear();
    const add = (entry: { c: Prepared; n: Nearest }, share: number) => {
      const b = binding(entry.c.chain, entry.n.segment, entry.n.f, boneIndex);
      slots.set(b.first, (slots.get(b.first) ?? 0) + share * (1 - b.weight));
      slots.set(b.second, (slots.get(b.second) ?? 0) + share * b.weight);
    };
    add(first, 1 - 0.5 * shared);
    if (second && shared > 0) add(second, 0.5 * shared);
    const bound = [...slots.entries()]
      .filter(([, w]) => w > 1e-6)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    const sum = bound.reduce((n, [, w]) => n + w, 0) || 1;
    for (let s = 0; s < 4; s++) {
      skin.skinIndex[v * 4 + s] = bound[s]?.[0] ?? 0;
      skin.skinWeight[v * 4 + s] = (bound[s]?.[1] ?? 0) / sum;
    }
    const { chain } = first.c,
      { t, around } = first.n;
    // The swatch, voted over the cell rather than read at its one vertex: a
    // patch's edge is where the votes split, and the split is what the paint
    // blends by. Nine samples over the cell's footprint on the surface, in the
    // chain's own coordinates -- a cell along the chain is `cell / total` of
    // it, and round the ring `cell / radius` of a radian.
    const radius = Math.max(1e-3, chain.profile(t));
    const votes = new Map<string, number>();
    for (let dj = -1; dj <= 1; dj++)
      for (let dk = -1; dk <= 1; dk++) {
        const tt = Math.min(1, Math.max(0, t + (dj * cell * 0.5) / first.c.total));
        const aa = around + (dk * cell * 0.5) / radius;
        const name = chain.patch?.(tt, aa) ?? chain.swatch(tt);
        votes.set(name, (votes.get(name) ?? 0) + 1);
      }
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    skin.swatch[v] = ranked[0]![0];
    skin.swatch2[v] = ranked[1]?.[0] ?? ranked[0]![0];
    skin.mix[v] = (ranked[1]?.[1] ?? 0) / 9;
    skin.along[v] = t;
    skin.around[v] = around;
  }
  return skin;
}
