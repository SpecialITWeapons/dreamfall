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
/** How dark a vertex goes in the middle of a joint's blend, 0..1: the crease a shadow map cannot draw. */
export const CREASE = 0.22;

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
   * boot is longer than it is wide, and neither is a pipe.
   */
  flatten?: number;
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
  const count = rings * sides + (capStart ? 1 : 0) + (capEnd ? 1 : 0);
  const position = new Float32Array(count * 3),
    normal = new Float32Array(count * 3),
    color = new Float32Array(count * 3),
    skinIndex = new Uint16Array(count * 4),
    skinWeight = new Float32Array(count * 4),
    shade = new Float32Array(count);
  const swatch: string[] = new Array<string>(count);
  const flatten = chain.flatten ?? 1;
  const frame = { u: new Vector3(), v: new Vector3() };
  const carried = new Vector3(1, 0, 0);
  const point = new Vector3(),
    outward = new Vector3();

  for (let s = 0; s < rings; s++) {
    const sample = samples[s]!;
    across(sample.dir, carried, frame);
    carried.copy(frame.u);
    const radius = chain.profile(sample.t);
    const name = chain.swatch(sample.t);
    // The crease: darkest in the middle of a blend, gone at either edge of it.
    const dark = 1 - CREASE * (1 - Math.abs(sample.weight * 2 - 0.5) * 2) * (sample.weight > 0 ? 1 : 0);
    const first = boneIndex(chain.bones[sample.bone]!),
      second = boneIndex(chain.bones[Math.min(sample.bone + 1, chain.bones.length - 1)]!);
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      // The offset is the ellipse itself and is not normalised: normalising it
      // is how `flatten` came to do nothing at all but shuffle the vertices
      // around a circle. The normal of an ellipse is the other way round --
      // where the surface is flat it points further out -- so it is built from
      // the reciprocals and normalised on its own.
      const cos = Math.cos(a),
        sin = Math.sin(a);
      outward
        .copy(frame.u)
        .multiplyScalar(cos * flatten)
        .addScaledVector(frame.v, sin / flatten);
      point.copy(sample.at).addScaledVector(outward, radius);
      outward
        .copy(frame.u)
        .multiplyScalar(cos / flatten)
        .addScaledVector(frame.v, sin * flatten)
        .normalize();
      const i = s * sides + k;
      position.set([point.x, point.y, point.z], i * 3);
      normal.set([outward.x, outward.y, outward.z], i * 3);
      skinIndex.set([first, second, 0, 0], i * 4);
      skinWeight.set([1 - sample.weight, sample.weight, 0, 0], i * 4);
      swatch[i] = chain.patch?.(sample.t, a) ?? name;
      shade[i] = dark;
    }
  }

  // The caps: a single vertex at each open end, fanned to its ring.
  let capA = -1,
    capB = -1;
  const capAt = (sample: (typeof samples)[number], sign: number, i: number) => {
    point.copy(sample.at).addScaledVector(sample.dir, sign * chain.profile(sample.t));
    position.set([point.x, point.y, point.z], i * 3);
    normal.set([sample.dir.x * sign, sample.dir.y * sign, sample.dir.z * sign], i * 3);
    const first = boneIndex(chain.bones[sample.bone]!),
      second = boneIndex(chain.bones[Math.min(sample.bone + 1, chain.bones.length - 1)]!);
    skinIndex.set([first, second, 0, 0], i * 4);
    skinWeight.set([1 - sample.weight, sample.weight, 0, 0], i * 4);
    swatch[i] = chain.swatch(sample.t);
    shade[i] = 1;
  };
  if (capStart) capAt(samples[0]!, -1, (capA = rings * sides));
  if (capEnd) capAt(samples[rings - 1]!, 1, (capB = rings * sides + (capStart ? 1 : 0)));

  const quads = (rings - 1) * sides;
  const fans = (capStart ? sides : 0) + (capEnd ? sides : 0);
  const index = new Uint32Array(quads * 6 + fans * 3);
  let w = 0;
  for (let s = 0; s < rings - 1; s++)
    for (let k = 0; k < sides; k++) {
      const a = s * sides + k,
        b = s * sides + ((k + 1) % sides),
        c = (s + 1) * sides + k,
        d = (s + 1) * sides + ((k + 1) % sides);
      index[w++] = a;
      index[w++] = c;
      index[w++] = b;
      index[w++] = b;
      index[w++] = c;
      index[w++] = d;
    }
  if (capA >= 0)
    for (let k = 0; k < sides; k++) {
      index[w++] = capA;
      index[w++] = k;
      index[w++] = (k + 1) % sides;
    }
  if (capB >= 0) {
    const base = (rings - 1) * sides;
    for (let k = 0; k < sides; k++) {
      index[w++] = capB;
      index[w++] = base + ((k + 1) % sides);
      index[w++] = base + k;
    }
  }
  return { position, normal, color, skinIndex, skinWeight, index, swatch, shade };
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
    for (let k = 0; k < n; k++) out.swatch[v + k] = part.swatch[k]!;
    for (let k = 0; k < part.index.length; k++) out.index[i + k] = part.index[k]! + v;
    v += n;
    i += part.index.length;
  }
  return out;
}
