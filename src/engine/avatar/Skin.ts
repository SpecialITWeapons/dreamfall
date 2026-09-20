// One continuous surface stretched over a chain of bones, instead of a bag of
// closed solids. This is the geometry half of the skinned figure and it knows
// nothing about the renderer: it takes joints and a profile and returns arrays,
// so the shape of the body can be read by a test in Node.
//
// What it makes is a tube. Rings of vertices are threaded along the chain and
// stitched into a surface; each vertex is bound to the bone whose segment it
// sits on and blends into the next one across a band around the joint, which is
// what makes an elbow bend rather than come apart. A cap closes an end that has
// nothing beyond it.
//
// Three facts decide the whole look and all three live in the caller's data:
// the profile (how thick the body is along its length), the blend band (how
// soft a joint is) and the ring count near a joint (how round a bend reads).
import { Vector3 } from 'three';

/** Vertices around one ring; the caller may ask for fewer on a thin limb. */
export const SIDES = 8;
/**
 * How far either side of a joint the skin shares between two bones, as a share
 * of the shorter segment. Nothing is a crease, a half is a rubber hose: this is
 * the one number to turn when an elbow looks wrong.
 */
export const BLEND = 0.34;
/**
 * How dark a vertex goes in the middle of a joint's blend, 0..1: the crease a
 * shadow map cannot draw. It was 0.22, and at three metres a band that dark on
 * every joint read as a stripe of grime rather than a fold.
 */
export const CREASE = 0.08;
/**
 * Rings in a cap between the last ring of the tube and the pole. A cap used to
 * be the pole alone, fanned to the ring: a cone, so the crown of the head, the
 * chin, every fingertip and the toe of a boot came to a point, with a hard
 * crease where the fan met the tube. Three rings make it a dome.
 */
export const CAP_RINGS = 3;

/** One limb, spine or neck: the bones it runs along and how thick it is. */
export interface Chain {
  /** Bone names, root first. Every vertex is bound to two of these. */
  bones: string[];
  /** Where those bones rest, in the figure's frame, m. */
  joints: Vector3[];
  /** Half-width across the chain at this distance along it, 0..1 -> m. */
  profile: (t: number) => number;
  /** Which swatch the surface takes at this distance along it. */
  swatch: (t: number) => string;
  /**
   * A swatch for one *place* on the surface rather than one band around it:
   * the distance along the chain and the angle around the ring, in radians
   * from the first across-axis. Returning null leaves the band's own colour.
   *
   * A band cannot paint a visor. It paints a stripe the whole way round the
   * head, and a dark stripe across a pale oval is a face from every angle at
   * once -- so the figure appeared to turn its head to follow the camera, all
   * the way round to its own back. Nothing was turning. A patch is what a
   * visor, a badge or a flash down one sleeve actually is.
   */
  patch?: (t: number, around: number) => string | null;
  /** Vertices around the tube. */
  sides?: number;
  /** Rings per segment, not counting the one shared with the next segment. */
  rings?: number;
  /** Close the first end, the last end, or neither. */
  capStart?: boolean;
  capEnd?: boolean;
  /**
   * The cross-section's shape: 1 is a circle, above it an ellipse wider across
   * the first axis than the second. A chest is wider than it is thick and a
   * boot is longer than it is wide, and neither is a pipe. Given as a function
   * of the distance along the chain, it may change on the way: a chest is
   * flatter than the waist under it.
   */
  flatten?: number | ((t: number) => number);
  /**
   * Which way the first axis points, when it matters. The across-axis is
   * otherwise seeded from x and carried along the chain, which is fine for a
   * limb -- it only has to not spin -- and a lottery for anything flattened: a
   * palm is wide across the hand and thin through it, and a palm whose first
   * axis came out edge-on is a blade. Given here, it is projected square to the
   * chain and carried from there as usual.
   */
  across?: Vector3;
}

export interface Skin {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  index: Uint32Array;
  /** The swatch each vertex takes, so a repaint is a walk of this array. */
  swatch: string[];
  /** How dark each vertex sits against its swatch, 0..1; 1 is the swatch itself. */
  shade: Float32Array;
  /**
   * Where each vertex sits on its own chain, 0..1 from the first joint to the
   * last, and where it sits around the ring, 0..2pi. The pair is what a
   * *pattern* is painted with -- a band across a sleeve is a range of the
   * first, a stripe down the outside of a leg is a range of the second -- and
   * they are written here rather than worked out again later, because the only
   * place that knows them is the sweep that put the vertex there. A cap vertex
   * takes the ring's own `along` and an angle of zero: it is a point, and a
   * point has no way round it.
   */
  along: Float32Array;
  around: Float32Array;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * A frame across the chain at a joint: the direction along it, and two axes
 * across. The across-axis is carried from the previous ring rather than rebuilt,
 * so the tube does not spin about its own length where the chain bends -- a
 * spin that shows up as the skin twisting between two rings.
 */
function across(dir: Vector3, carried: Vector3, out: { u: Vector3; v: Vector3 }) {
  out.u.copy(carried).addScaledVector(dir, -carried.dot(dir));
  if (out.u.lengthSq() < 1e-8) {
    // The chain doubled back on itself: any axis across it will do.
    out.u.set(1, 0, 0).addScaledVector(dir, -dir.x);
    if (out.u.lengthSq() < 1e-8) out.u.set(0, 1, 0).addScaledVector(dir, -dir.y);
  }
  out.u.normalize();
  out.v.crossVectors(dir, out.u).normalize();
}

/**
 * Stitch one chain into a tube.
 *
 * @param chain what to build
 * @param boneIndex the index of a bone by name, in the skeleton's own order
 */
export function buildChain(chain: Chain, boneIndex: (name: string) => number): Skin {
  const sides = chain.sides ?? SIDES;
  const perSegment = chain.rings ?? 3;
  const segments = chain.joints.length - 1;
  if (segments < 1) throw new Error('a chain needs at least two joints');
  if (chain.bones.length !== chain.joints.length) throw new Error('a chain needs one bone per joint');

  // Where the rings go: every segment gets `perSegment` of them plus the one
  // that closes it, and the rings crowd toward a joint because that is where
  // the surface has to bend.
  const samples: Array<{ at: Vector3; dir: Vector3; t: number; bone: number; weight: number }> = [];
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < segments; i++) {
    const len = chain.joints[i + 1]!.distanceTo(chain.joints[i]!);
    lengths.push(len);
    total += len;
  }
  let walked = 0;
  for (let i = 0; i < segments; i++) {
    const a = chain.joints[i]!,
      b = chain.joints[i + 1]!;
    const dir = new Vector3().subVectors(b, a).normalize();
    const last = i === segments - 1;
    for (let r = 0; r <= perSegment; r++) {
      if (r === perSegment && !last) continue; // the next segment opens with this ring
      // Crowded at both ends of the segment, sparse in the middle: a cosine
      // spacing puts rings where a joint bends and saves them where it does not.
      const even = r / perSegment;
      const f = 0.5 - 0.5 * Math.cos(Math.PI * even);
      const at = new Vector3().lerpVectors(a, b, f);
      // The bone this ring follows, and how much of it the next bone takes. The
      // band is symmetric about the joint: a ring at the joint is halfway
      // between the two, and one a band away belongs wholly to one.
      let bone = i,
        weight = 0;
      if (f > 1 - BLEND && i + 1 < chain.bones.length - 1) {
        weight = 0.5 * smooth((f - (1 - BLEND)) / BLEND);
      } else if (f < BLEND && i > 0) {
        bone = i - 1;
        weight = 0.5 + 0.5 * smooth(f / BLEND);
      } else if (i > 0 && f <= BLEND) {
        bone = i - 1;
        weight = 1;
      }
      samples.push({ at, dir, t: (walked + f * lengths[i]!) / total, bone, weight });
    }
    walked += lengths[i]!;
  }

  const rings = samples.length;
  const capStart = chain.capStart ?? false,
    capEnd = chain.capEnd ?? false;
  const capCount = CAP_RINGS * sides + 1;
  const count = rings * sides + (capStart ? capCount : 0) + (capEnd ? capCount : 0);
  const position = new Float32Array(count * 3),
    normal = new Float32Array(count * 3),
    color = new Float32Array(count * 3),
    skinIndex = new Uint16Array(count * 4),
    skinWeight = new Float32Array(count * 4),
    shade = new Float32Array(count),
    along = new Float32Array(count),
    around = new Float32Array(count);
  const swatch: string[] = new Array<string>(count);
  const flattenAt = (t: number) =>
    typeof chain.flatten === 'function' ? chain.flatten(t) : (chain.flatten ?? 1);
  const frame = { u: new Vector3(), v: new Vector3() };
  const carried = chain.across ? chain.across.clone().normalize() : new Vector3(1, 0, 0);
  const point = new Vector3(),
    outward = new Vector3();
  /**
   * How fast the profile is changing here, in metres of radius per metre
   * along the chain: what tilts a normal on a taper. Without it a thigh is
   * shaded as a cylinder and a shoulder's swell never catches the light.
   */
  const slopeAt = (t: number) => {
    const h = 1e-3;
    const a = Math.max(0, t - h),
      b = Math.min(1, t + h);
    return b > a ? (chain.profile(b) - chain.profile(a)) / ((b - a) * total) : 0;
  };
  /**
   * One vertex of one ring: at `phi` off the ring's plane, for a cap -- the
   * ring itself is `phi` 0. `dir` is the chain's direction here, `sign` which
   * way a cap bulges, `radius` the profile's, `slope` the taper's tilt.
   */
  const write = (
    i: number,
    at: Vector3,
    dir: Vector3,
    radius: number,
    flatten: number,
    slope: number,
    phi: number,
    sign: number,
    sample: (typeof samples)[number],
    dark: number,
  ) => {
    const first = boneIndex(chain.bones[sample.bone]!),
      second = boneIndex(chain.bones[Math.min(sample.bone + 1, chain.bones.length - 1)]!);
    const name = chain.swatch(sample.t);
    const ring = radius * Math.cos(phi),
      rise = radius * Math.sin(phi) * sign;
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      // The offset is the ellipse itself and is not normalised: normalising it
      // is how `flatten` came to do nothing at all but shuffle the vertices
      // around a circle. The normal of an ellipse is the other way round --
      // where the surface is flat it points further out -- so it is built from
      // the reciprocals, tilted along the chain by the taper and, on a cap,
      // toward the pole, and normalised on its own.
      const cos = Math.cos(a),
        sin = Math.sin(a);
      outward
        .copy(frame.u)
        .multiplyScalar(cos * flatten)
        .addScaledVector(frame.v, sin / flatten);
      point.copy(at).addScaledVector(outward, ring).addScaledVector(dir, rise);
      outward
        .copy(frame.u)
        .multiplyScalar(cos / flatten)
        .addScaledVector(frame.v, sin * flatten)
        .normalize()
        .multiplyScalar(Math.cos(phi))
        .addScaledVector(dir, sign * Math.sin(phi) - slope * Math.cos(phi))
        .normalize();
      const v = i + k;
      position.set([point.x, point.y, point.z], v * 3);
      normal.set([outward.x, outward.y, outward.z], v * 3);
      skinIndex.set([first, second, 0, 0], v * 4);
      skinWeight.set([1 - sample.weight, sample.weight, 0, 0], v * 4);
      swatch[v] = chain.patch?.(sample.t, a) ?? name;
      shade[v] = dark;
      along[v] = sample.t;
      around[v] = a;
    }
  };

  for (let s = 0; s < rings; s++) {
    const sample = samples[s]!;
    across(sample.dir, carried, frame);
    carried.copy(frame.u);
    // The crease: darkest in the middle of a blend, gone at either edge of it.
    const dark = 1 - CREASE * (1 - Math.abs(sample.weight * 2 - 0.5) * 2) * (sample.weight > 0 ? 1 : 0);
    write(
      s * sides,
      sample.at,
      sample.dir,
      chain.profile(sample.t),
      flattenAt(sample.t),
      slopeAt(sample.t),
      0,
      1,
      sample,
      dark,
    );
    // A cap is a dome over this ring: rings of the same ellipse, each smaller
    // and further along, then the pole. The frame is this ring's, so the dome
    // sits square on the tube it closes.
    const cap = (s === 0 && capStart) || (s === rings - 1 && capEnd);
    if (cap) {
      const sign = s === 0 ? -1 : 1;
      const base = rings * sides + (s === 0 || !capStart ? 0 : capCount);
      const radius = chain.profile(sample.t),
        flatten = flattenAt(sample.t);
      for (let c = 0; c < CAP_RINGS; c++) {
        const phi = ((c + 1) / (CAP_RINGS + 1)) * (Math.PI / 2);
        write(base + c * sides, sample.at, sample.dir, radius, flatten, 0, phi, sign, sample, dark);
      }
      const pole = base + CAP_RINGS * sides;
      point.copy(sample.at).addScaledVector(sample.dir, sign * radius);
      position.set([point.x, point.y, point.z], pole * 3);
      normal.set([sample.dir.x * sign, sample.dir.y * sign, sample.dir.z * sign], pole * 3);
      const first = boneIndex(chain.bones[sample.bone]!),
        second = boneIndex(chain.bones[Math.min(sample.bone + 1, chain.bones.length - 1)]!);
      skinIndex.set([first, second, 0, 0], pole * 4);
      skinWeight.set([1 - sample.weight, sample.weight, 0, 0], pole * 4);
      swatch[pole] = chain.swatch(sample.t);
      shade[pole] = dark;
      along[pole] = sample.t;
      around[pole] = 0;
    }
  }

  // The tube's quads, then each cap's: its rings stitched on from the end ring
  // outward and the pole fanned to the last of them. A start cap runs the
  // other way along the chain, so its winding is turned to keep facing out.
  const quads = (rings - 1) * sides + (capStart ? CAP_RINGS * sides : 0) + (capEnd ? CAP_RINGS * sides : 0);
  const fans = (capStart ? sides : 0) + (capEnd ? sides : 0);
  const index = new Uint32Array(quads * 6 + fans * 3);
  let w = 0;
  const stitch = (from: number, to: number, flip: boolean) => {
    for (let k = 0; k < sides; k++) {
      const a = from + k,
        b = from + ((k + 1) % sides),
        c = to + k,
        d = to + ((k + 1) % sides);
      if (flip) index.set([a, b, c, b, d, c], w);
      else index.set([a, c, b, b, c, d], w);
      w += 6;
    }
  };
  const fan = (pole: number, ring: number, flip: boolean) => {
    for (let k = 0; k < sides; k++) {
      const a = ring + k,
        b = ring + ((k + 1) % sides);
      if (flip) index.set([pole, a, b], w);
      else index.set([pole, b, a], w);
      w += 3;
    }
  };
  for (let s = 0; s < rings - 1; s++) stitch(s * sides, (s + 1) * sides, false);
  const dome = (ring: number, base: number, flip: boolean) => {
    let last = ring;
    for (let c = 0; c < CAP_RINGS; c++) {
      stitch(last, base + c * sides, flip);
      last = base + c * sides;
    }
    fan(base + CAP_RINGS * sides, last, flip);
  };
  if (capStart) dome(0, rings * sides, true);
  if (capEnd) dome((rings - 1) * sides, rings * sides + (capStart ? capCount : 0), false);
  return { position, normal, color, skinIndex, skinWeight, index, swatch, shade, along, around };
}

/** Lay several chains into one set of arrays, keeping every vertex's swatch and shade. */
export function mergeSkins(parts: Skin[]): Skin {
  const count = parts.reduce((n, p) => n + p.position.length / 3, 0);
  const indices = parts.reduce((n, p) => n + p.index.length, 0);
  const out: Skin = {
    position: new Float32Array(count * 3),
    normal: new Float32Array(count * 3),
    color: new Float32Array(count * 3),
    skinIndex: new Uint16Array(count * 4),
    skinWeight: new Float32Array(count * 4),
    index: new Uint32Array(indices),
    swatch: new Array<string>(count),
    shade: new Float32Array(count),
    along: new Float32Array(count),
    around: new Float32Array(count),
  };
  let v = 0,
    i = 0;
  for (const part of parts) {
    const n = part.position.length / 3;
    out.position.set(part.position, v * 3);
    out.normal.set(part.normal, v * 3);
    out.skinIndex.set(part.skinIndex, v * 4);
    out.skinWeight.set(part.skinWeight, v * 4);
    out.shade.set(part.shade, v);
    out.along.set(part.along, v);
    out.around.set(part.around, v);
    for (let k = 0; k < n; k++) out.swatch[v + k] = part.swatch[k]!;
    for (let k = 0; k < part.index.length; k++) out.index[i + k] = part.index[k]! + v;
    v += n;
    i += part.index.length;
  }
  return out;
}
