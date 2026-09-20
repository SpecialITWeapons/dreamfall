// The figure: a skydiver as one continuous skin over a skeleton of sixteen
// bones, with vertex colors on the world's lit material. It holds five shapes
// -- the box a belly-to-earth jumper rides, a delta, a track, a flare, and a
// turn laid over any of them -- and picks between them on how the flight is
// actually going: the angle, the airspeed and the bank. On top of whichever it
// is wearing, the joints flutter with the wind and a slow noise, a gust is a
// burst of stronger flutter, and the dynamic pressure trails the limbs back.
//
// What this file owns is the skeleton, the shapes and the numbers a body is
// made of -- the profiles below are the whole of what the figure looks like.
// Sweeping a surface along them is `Skin.ts`, which knows nothing about people.
// This used to be twenty solids parented to one another, and every shoulder
// sweep opened a seam between two of them that no pose could close; the
// Avatar interface was written so that this swap would not touch the engine,
// and it did not. There is no triangle budget here any more: 4 000 was a
// starting value nobody in this repository ever measured, and the figure is one
// object drawn twice against a terrain of 557 568 triangles a frame.
import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Quaternion,
  Vector3,
  type Mesh,
  type Object3D,
} from 'three';
import { vertexColor } from 'three/tsl';
import { SPEED } from '../flight/FlightController';
import type { LitMaterial } from '../render/SoftLighting';
import { perlin2 } from '../terrain/noise';
import type { Avatar, FlightPose } from './Avatar';
import { buildChain, mergeSkins, type Chain, type Skin } from './Skin';
import { OUTFIT, type Outfit, type Swatch } from './Outfit';

/** How far the figure hangs under its center, and how far it reaches sideways, m; the flight reads these before the figure exists. */
export const HUMAN_BOUNDS = { below: 0.3, radius: 1.1 } as const;

export interface ProceduralHuman extends Avatar {
  readonly triangles: number;
  /**
   * The figure as data: where its bones rest and how thick it is along each
   * chain, in the pose it is standing in. This is what the geometry is made of
   * and nothing else, which is what lets something outside the engine build the
   * same body -- `tools/figure` bakes one continuous surface out of it in
   * Blender, where a shoulder is a junction of the skin rather than a tube
   * pushed into a slab. Handing over a *copy* of these numbers instead would
   * give two figures that agree until the first time one of them is edited.
   */
  describe(): FigureDescription;
}

/** How many bearings a patched chain's colour is written down at, per sample. */
export const RING_BEARINGS = 12;

/** One chain of the figure, sampled: a point every so often with the half-width there. */
export interface ChainDescription {
  /** The bone each joint hangs on, root first. */
  bones: string[];
  /** The cross-section's shape, as `Skin.ts` means it: 1 is a circle. */
  flatten: number;
  capStart: boolean;
  capEnd: boolean;
  samples: Array<{
    /** How far along the chain, 0..1. */
    t: number;
    /** Where, in the figure's frame, m. */
    at: [number, number, number];
    /** Half-width across the chain there, before `flatten`, m. */
    radius: number;
    /** Which swatch the surface takes there. */
    swatch: string;
    /** Which bone of `bones` this point sits on. */
    bone: number;
    /**
     * The swatch at twelve bearings around the ring, present only where the
     * chain wears a `patch`. A band is one colour the whole way round and
     * `swatch` above says it; a visor is not, and a description that carried
     * only the band would have the baker paint a helmet with no visor on it.
     * The angles are `k / 12 * 2pi` in the same frame `Skin.ts` sweeps.
     */
    ring?: string[];
  }>;
}

export interface FigureDescription {
  bones: Array<{ name: string; parent: string | null; rest: [number, number, number] }>;
  chains: ChainDescription[];
}

const UP = new Vector3(0, 1, 0),
  AXIS_X = new Vector3(1, 0, 0);

// The arch, in the figure's frame (x left, y up, z ahead): joints and limb
// directions. The elbow bends 80 degrees and the knee 57, so both read as
// joints rather than as one stiff limb; the hands end up ahead of the eye and
// the feet above the back.
/** The chest, and where it sits: the shoulders have to reach it. */
export const TORSO = { rx: 0.21, ry: 0.13, rz: 0.31, at: new Vector3(0, 0, 0.05) };
/**
 * The shoulder used to sit at x = 0.24, which is 8 cm outside the chest it
 * hangs on -- more than the arm is thick, so there was daylight between the two.
 * At 0.20 the arm's own capsule reaches the surface, and the cap below covers
 * the joint the way a suit's shoulder does.
 */
const SHOULDER = new Vector3(0.2, 0.03, 0.26),
  HIP = new Vector3(0.1, -0.02, -0.42);
export const UPPER = { r: 0.055, len: 0.3 },
  FORE = { r: 0.045, len: 0.27 },
  THIGH = { r: 0.075, len: 0.42 },
  SHIN = { r: 0.055, len: 0.4 };
/** The boot: half width, half length and half thickness, m. */
const FOOT = { rx: 0.055, ry: 0.115, rz: 0.045 };

/**
 * A pose is five directions a side: where the upper arm, the forearm, the
 * thigh, the shin and the foot point in the figure's own frame. That is all a
 * pose is, which is what lets there be five of them for the price of thirty
 * numbers -- the quaternions a joint actually wears are read off these once,
 * against the same chain rule `hinge` uses, so a pose cannot disagree with the
 * skeleton it is worn on.
 *
 * `inner` is for the one pose that is not symmetric: in a turn the two sides of
 * the body do different things, and which side is the inner one depends on
 * which way the figure is banking.
 */
interface Pose {
  upper(side: number, inner: boolean): Vector3;
  fore(side: number, inner: boolean): Vector3;
  thigh(side: number, inner: boolean): Vector3;
  shin(side: number, inner: boolean): Vector3;
  foot(side: number, inner: boolean): Vector3;
}
const dir = (x: number, y: number, z: number) => new Vector3(x, y, z).normalize();

/**
 * The five shapes, and the order the weights come in. A skydiver **changes
 * shape in order to fly differently**; before this the figure did the opposite,
 * the autopilot decided the angle and the shape was its consequence, read off
 * one axis. Now the shape is read off three -- airspeed, flight angle and bank
 * -- and one axis can no longer decide everything.
 */
const POSES = {
  /** Belly to earth, arms out and forward, elbows squared, knees folded. The one the skin is cut for. */
  box: {
    upper: (side) => dir(side * 0.78, -0.08, 0.62),
    fore: (side) => dir(side * -0.46, 0.16, 0.87),
    // The thighs used to splay 0.30, which is 17 degrees off the body's own
    // line: on a torso 41 cm wide that is two legs inside one silhouette, and
    // from underneath the figure had a tail rather than knees. A box position
    // holds the knees a good deal wider than the hips.
    thigh: (side) => dir(side * 0.46, -0.06, -0.89),
    shin: (side) => dir(side * 0.16, 0.84, -0.52),
    foot: (side) => dir(side * 0.05, 0.42, -0.9),
  },
  /** Halfway: arms swept back but still out, elbows still bent, knees half open. */
  delta: {
    upper: (side) => dir(side * 0.7, -0.06, -0.28),
    fore: (side) => dir(side * 0.28, 0.06, -0.72),
    thigh: (side) => dir(side * 0.22, -0.04, -0.97),
    shin: (side) => dir(side * 0.14, 0.42, -0.9),
    foot: (side) => dir(side * 0.05, 0.28, -0.95),
  },
  /**
   * Fast and straight: arms back along the body with the hands at the hips,
   * legs straight and closed. A track is not the box turned about the figure's
   * own up axis -- that swings the arms out sideways, which is the one
   * direction a track does not go.
   */
  track: {
    upper: (side) => dir(side * 0.15, -0.02, -0.99),
    fore: (side) => dir(side * 0.1, -0.02, -0.99),
    thigh: (side) => dir(side * 0.12, -0.02, -0.99),
    shin: (side) => dir(side * 0.1, 0.02, -0.99),
    foot: (side) => dir(side * 0.05, 0.18, -0.98),
  },
  /**
   * Nose up and slow, which in this world is one state and not two: a climb is
   * paid for in airspeed, so `speed 30` and `pitch +0.56` arrive together and
   * the same shape answers both. Everything trails: the arms lie **down the
   * flanks** and the legs sweep back behind them, the chest leading and the
   * rest of the figure following it, the way a bird pulling up out of a dive
   * does.
   *
   * Two drafts were thrown away here, both from photographs. The first reached
   * the arms forward and high, which is a jumper's flare and read as a figure
   * being lifted by the wrists. The second swept them back but over the back --
   * `+y` is the back in this frame -- so the arms lifted away from the body
   * like folding wings, and the knees stayed at 94% of a full fold while the
   * rest of the figure trailed. Both are what an arm does when someone is
   * *holding* it up; neither is what the air does to one.
   *
   * What tells the climb from the track is how much: the track is a ruler, the
   * climb keeps the arms a little off the flank and a bend in the knee.
   */
  climb: {
    upper: (side) => dir(side * 0.3, -0.08, -0.95),
    fore: (side) => dir(side * 0.14, -0.06, -0.99),
    thigh: (side) => dir(side * 0.26, -0.06, -0.96),
    shin: (side) => dir(side * 0.11, 0.34, -0.93),
    foot: (side) => dir(side * 0.05, 0.26, -0.96),
  },
  /**
   * A turn, which is the only shape the two sides of the body disagree about:
   * the inner arm drops and comes back, the outer one rises and reaches
   * forward, the inner knee folds and the outer leg goes long. This replaces
   * the old `drop`, which lowered the inner arm and did nothing else --
   * a bank that only one limb has heard of reads as a twitch, not a turn.
   */
  turn: {
    upper: (side, inner) => (inner ? dir(side * 0.74, -0.34, 0.5) : dir(side * 0.76, 0.22, 0.6)),
    fore: (side, inner) => (inner ? dir(side * -0.4, -0.1, 0.9) : dir(side * -0.48, 0.3, 0.82)),
    thigh: (side, inner) => (inner ? dir(side * 0.26, -0.16, -0.95) : dir(side * 0.32, 0.02, -0.95)),
    shin: (side, inner) => (inner ? dir(side * 0.12, 0.9, -0.42) : dir(side * 0.12, 0.6, -0.78)),
    foot: (side, inner) => (inner ? dir(side * 0.05, 0.5, -0.86) : dir(side * 0.05, 0.3, -0.94)),
  },
} satisfies Record<string, Pose>;

/**
 * The slots a hinge keeps a quaternion and a weight in. The turn is two slots
 * rather than one because the pose is mirrored, and a single slot whose target
 * flips as the bank crosses zero would apply whatever weight the spring still
 * held to the wrong side of the body.
 */
const SLOTS = ['box', 'delta', 'track', 'climb', 'turnIn', 'turnOut'] as const;
type Slot = (typeof SLOTS)[number];
/** Which pose each slot wears, and whether this side is the inner one in it. */
const SLOT_POSE: Record<Slot, { pose: Pose; inner: boolean }> = {
  box: { pose: POSES.box, inner: false },
  delta: { pose: POSES.delta, inner: false },
  track: { pose: POSES.track, inner: false },
  climb: { pose: POSES.climb, inner: false },
  turnIn: { pose: POSES.turn, inner: true },
  turnOut: { pose: POSES.turn, inner: false },
};

/**
 * Where the shapes sit on the three axes, and **every one of them is inside
 * what the flight can actually produce**, which is the first thing a threshold
 * like this gets wrong. Measured against the controller, flying each corner of
 * its envelope for a minute with room under it: the steepest sustained dive is
 * `pitch -0.42` at `rush 1.48`, the steepest climb `+0.56` at `rush 0.75`, and
 * a hard turn rolls to `0.47`. `dive` was written as 0.5 first, from a picture
 * of a skydiver rather than from the figure's own envelope -- which put the
 * track a fifth of the way past the fastest dive this world has, so the pose
 * existed and could never be reached.
 *
 * `lean` is the most of the figure a turn is allowed to take over: a turn is a
 * shape laid over whatever it was doing, not one instead of it, which is why a
 * banked track still tracks. `floor` is the weight below which a slot is not
 * worth a slerp, and is what keeps the blend at two or three shapes rather
 * than six.
 */
export const POSE = { dive: 0.4, climb: 0.42, fast: 0.28, slow: 0.22, bank: 0.38, lean: 0.7, floor: 0.005 };
/**
 * How long a joint takes to catch up with what the air is asking of it, s. The
 * limbs used to arrive in the same frame as the shoulders, which is what made
 * the figure read as a puppet: nothing had any weight. A first-order lag per
 * joint, longer the further it is from the chest, is the cheapest honest
 * substitute for inertia -- and it is also the phase offset the flutter needed,
 * so it is not applied twice.
 */
const LAG: Record<Hinge['kind'], number> = {
  shoulder: 0.1,
  elbow: 0.17,
  hip: 0.1,
  knee: 0.17,
  ankle: 0.24,
};
/**
 * How far past its target a joint is allowed to swing, as a damping ratio: one
 * is the old behaviour exactly, and below one the limb overshoots and comes
 * back. That overshoot is the whole reason the spring is here. A first-order
 * filter -- what this was -- can only ever slow down as it arrives, which is
 * why every gust read as the figure being *moved* rather than as the figure
 * having weight.
 *
 * The pose blend keeps a ratio of one on purpose: a joint that overshoots a
 * blend between two poses does not swing past a target, it inverts an arm.
 */
const DAMPING = { joint: 0.62, pose: 1 };
/**
 * The air, as the figure feels it. `rush` is the airspeed over the nominal --
 * the same number `AmbienceModel` calls `rush`, so the suit and the noise agree
 * about a dive -- and what a limb feels is the dynamic pressure, which goes
 * with its square. `trail` is how far that pressure pushes a joint back, and it
 * grows with the distance from the chest: a wrist trails further than a
 * shoulder for the same reason a flag's tip moves more than its rope.
 */
const TRAIL: Record<Hinge['kind'], number> = {
  shoulder: 0.1,
  elbow: 0.16,
  hip: 0.08,
  knee: 0.14,
  ankle: 0.2,
};

/**
 * One state of a joint: where it is and how fast it is going there. Semi-implicit
 * Euler -- velocity first, then position -- because it is the cheapest
 * integrator that does not feed energy into a spring, and this one is stiff:
 * the shoulder's own frequency is 10 rad/s and a slow frame is 50 ms, which is
 * exactly the band where the explicit form starts to ring. The substep keeps
 * `omega * h` under a half whatever the frame does.
 */
interface Spring {
  x: number;
  v: number;
}
const settle = (s: Spring, target: number, omega: number, zeta: number, dt: number) => {
  // dt <= 0 is "be there now": the world places the figure once before the
  // first frame, and a spring that merely started moving would arrive during it.
  if (dt <= 0) {
    s.x = target;
    s.v = 0;
    return;
  }
  const steps = Math.min(8, Math.max(1, Math.ceil((omega * dt) / 0.5)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    s.v += (omega * omega * (target - s.x) - 2 * zeta * omega * s.v) * h;
    s.x += s.v * h;
  }
};
/** Clipped to 0..1, or to `min`..1 where a value is allowed to go the other way. */
const clamp01 = (v: number, min = 0) => (v < min ? min : v > 1 ? 1 : v);

/**
 * A profile: half-width along a chain, given as stops and read between them.
 * This is the shape of the body and it is deliberately data -- a waist, a
 * shoulder, a calf and an ankle are four numbers here, and were four solids
 * before.
 */
const ramp =
  (stops: Array<[number, number]>) =>
  (t: number): number => {
    for (let i = 1; i < stops.length; i++) {
      const [ta, ra] = stops[i - 1]!,
        [tb, rb] = stops[i]!;
      if (t <= tb) return ra + ((rb - ra) * Math.min(Math.max(t - ta, 0), tb - ta)) / (tb - ta || 1);
    }
    return stops[stops.length - 1]![1];
  };
/** A swatch by distance along a chain: the first stop whose end is past t. */
const bands =
  (stops: Array<[number, string]>) =>
  (t: number): string =>
    stops.find(([end]) => t <= end)?.[1] ?? stops[stops.length - 1]![1];

type Kind = 'shoulder' | 'elbow' | 'hip' | 'knee' | 'ankle';

/**
 * What every joint wears in one pose, on one side: parent-relative, by the same
 * chain rule the skeleton is built with -- a joint's own quaternion is its
 * parent's orientation undone and its own put on. Doing it here rather than
 * writing the numbers down twice is why a pose cannot drift out of step with
 * the skeleton it is worn on.
 */
const poseQuats = (pose: Pose, side: 1 | -1, inner: boolean): Record<Kind, Quaternion> => {
  const q = (d: Vector3) => new Quaternion().setFromUnitVectors(UP, d);
  const upper = q(pose.upper(side, inner)),
    fore = q(pose.fore(side, inner)),
    thigh = q(pose.thigh(side, inner)),
    shin = q(pose.shin(side, inner)),
    foot = q(pose.foot(side, inner));
  return {
    shoulder: upper.clone(),
    elbow: upper.clone().invert().multiply(fore),
    hip: thigh.clone(),
    knee: thigh.clone().invert().multiply(shin),
    ankle: shin.clone().invert().multiply(foot),
  };
};

interface Hinge {
  pivot: Bone;
  /** The box, which is the pose the skin is cut for; the same as `targets.box`. */
  rest: Quaternion;
  /** Where this joint goes in each of the shapes, parent-relative. */
  targets: Record<Slot, Quaternion>;
  /**
   * How much of each shape this joint is wearing. It is a spring per slot and
   * not one set for the whole figure, because a shape has to arrive the way a
   * gust does -- the shoulder first and the ankle last -- and a figure whose
   * every joint changed pose on the same frame is the puppet this file spent
   * two commits getting rid of.
   */
  weight: Record<Slot, Spring>;
  side: 1 | -1;
  kind: Kind;
  /** What this joint is actually doing, as opposed to what the air asked for. */
  swing: Spring;
}

export function createProceduralHuman(
  litMaterial: LitMaterial,
  /** A palette other than the figure's own: the tests', to see what a swatch covers. */
  opts: { outfit?: Outfit } = {},
): ProceduralHuman {
  const outfit = opts.outfit ?? OUTFIT;
  const material = litMaterial(vertexColor().rgb);
  /** Every bone, in the order the skeleton keeps them; the skin indexes into this. */
  const bones: Bone[] = [];
  const boneIndex = (name: string) => {
    const at = bones.findIndex((b) => b.name === name);
    if (at < 0) throw new Error(`the skin asks for a bone called ${name}, and there is none`);
    return at;
  };
  const object = new Group();
  object.name = 'human';
  object.rotation.order = 'YXZ';
  const body = new Bone();
  body.name = 'body';
  bones.push(body);
  object.add(body);
  // The neck carries the head and does not turn -- yet. It is a bone rather than
  // a group so the head's skin has something to hang on, and so the day the
  // head looks where the flight is going is a day this file changes one number.
  const neck = new Bone();
  neck.name = 'neck';
  neck.position.set(0, 0.02, 0.34);
  bones.push(neck);
  body.add(neck);
  const hinges: Hinge[] = [];
  const hinge = (kind: Hinge['kind'], name: string, parent: Object3D, at: Vector3, side: 1 | -1): Hinge => {
    const targets = {} as Record<Slot, Quaternion>;
    const weight = {} as Record<Slot, Spring>;
    for (const slot of SLOTS) {
      const { pose, inner } = SLOT_POSE[slot];
      targets[slot] = poseQuats(pose, side, inner)[kind];
      // The figure starts in the box and walks out of it, which is also what
      // `dt <= 0` has to reproduce on the very first frame.
      weight[slot] = { x: slot === 'box' ? 1 : 0, v: 0 };
    }
    const rest = targets.box;
    const pivot = new Bone();
    pivot.name = name;
    pivot.position.copy(at);
    pivot.quaternion.copy(rest);
    parent.add(pivot);
    bones.push(pivot);
    const h: Hinge = { pivot, rest, targets, weight, side, kind, swing: { x: 0, v: 0 } };
    hinges.push(h);
    return h;
  };
  for (const side of [1, -1] as const) {
    const s = side > 0 ? 'L' : 'R';
    const shoulder = hinge('shoulder', `shoulder${s}`, body, SHOULDER.clone().setX(side * SHOULDER.x), side);
    const elbow = hinge('elbow', `elbow${s}`, shoulder.pivot, new Vector3(0, UPPER.len, 0), side);
    // The wrist and the toe never turn; they are here because a chain of skin
    // needs a bone at the end of it to hang the last ring on, and because a
    // hand that follows the forearm is a hand rather than a paddle.
    const wrist = new Bone();
    wrist.name = `wrist${s}`;
    wrist.position.set(0, FORE.len, 0);
    bones.push(wrist);
    elbow.pivot.add(wrist);
    const hip = hinge('hip', `hip${s}`, body, HIP.clone().setX(side * HIP.x), side);
    const knee = hinge('knee', `knee${s}`, hip.pivot, new Vector3(0, THIGH.len, 0), side);
    // The foot breaks 29 degrees away from the shin at the ankle: without a
    // hinge of its own a boot on the shin's axis is only a thicker shin, which
    // is what the figure had.
    const ankle = hinge('ankle', `ankle${s}`, knee.pivot, new Vector3(0, SHIN.len, 0), side);
    const toe = new Bone();
    toe.name = `toe${s}`;
    toe.position.set(0, FOOT.ry * 1.6, 0);
    bones.push(toe);
    ankle.pivot.add(toe);
  }

  // The rest pose is what the skin is cut for, so the chains are read off the
  // skeleton rather than written down a second time: a joint that moved in the
  // pose above moves the skin with it, with nothing to keep in step by hand.
  object.updateMatrixWorld(true);
  const at = (name: string) => object.getObjectByName(name)!.getWorldPosition(new Vector3());
  /**
   * A frame at the wrist: along the forearm, across the palm, and the way the
   * palm faces. A hand is the one part of this figure that has a front and a
   * back, so it is the one part that needs to know which way is which.
   */
  const handFrame = (side: 1 | -1) => {
    const s = side > 0 ? 'L' : 'R';
    const wrist = at(`wrist${s}`);
    const along = wrist
      .clone()
      .sub(at(`elbow${s}`))
      .normalize();
    const across = new Vector3().crossVectors(UP, along).normalize().multiplyScalar(side);
    const palm = new Vector3().crossVectors(along, across).normalize();
    // The palm faces the ground in every shape this figure holds; which way the
    // cross product came out is an accident of the pose, so it is checked
    // rather than assumed.
    if (palm.y > 0) palm.negate();
    return { wrist, along, across, palm };
  };

  /** How far the palm reaches past the wrist, and the four fingers' lengths. */
  const PALM = 0.085,
    FINGERS = [0.074, 0.082, 0.077, 0.063];

  const chain = (names: string[], rest: Omit<Chain, 'bones' | 'joints'> & { joints?: Vector3[] }): Chain => ({
    ...rest,
    bones: names,
    joints: rest.joints ?? names.map(at),
  });
  /**
   * The body, as four shapes and a head. Every number in the profiles is a
   * half-width in metres at that share of the chain's length, and this is the
   * whole of what the figure looks like -- the waist, the shoulder, the calf and
   * the ankle used to be four solids and are now four stops on a curve.
   */
  const parts: Chain[] = [
    // The spine, from the tail to the neck. Wider than it is thick, because a
    // chest is, and a tube that is not says "pipe" from the first glance.
    chain(['body', 'body', 'body', 'body', 'neck', 'neck'], {
      // The spine's bones sit on top of each other -- nothing along it turns
      // yet -- so its stops are written here rather than read off the skeleton.
      // The day a back arches, these become bones and this line goes.
      //
      // The last segment is a neck, and it climbs. A jumper on his belly holds
      // his chin up; without that segment the head left the shoulders along the
      // spine's own line, and a photograph from underneath showed what that is:
      // a ball resting on the chest, with no neck anywhere in the silhouette.
      joints: [
        new Vector3(0, -0.02, -0.5),
        new Vector3(0, -0.02, -0.32),
        new Vector3(0, 0, -0.02),
        new Vector3(0, 0.02, 0.2),
        new Vector3(0, 0.02, 0.32),
        new Vector3(0, 0.065, 0.385),
      ],
      // Widest across the shoulders, a waist under it, and the hips wider than
      // the waist -- which is the way round a person is. Two photographs paid
      // for these numbers. The first draft peaked at 0.5, the middle of the
      // back, and read as a paunch with the shoulders sloping away from it. The
      // second peaked in the right place and was simply too big everywhere:
      // 51 cm across the ribs and 41 at the waist, so the arms entered a slab
      // and the thighs never came out of one. A man is about 33 cm across the
      // chest and 27 at the waist, and `flatten` has to hold the depth up with
      // it -- at 1.45 a chest that measured right across was 15 cm thick, which
      // is a plank. These stops are in metres of half-width before `flatten`.
      profile: ramp([
        [0, 0.072],
        [0.2, 0.128],
        [0.54, 0.11],
        [0.8, 0.142],
        [0.845, 0.148],
        [0.93, 0.082],
        [1, 0.055],
      ]),
      swatch: () => 'suit',
      sides: 12,
      rings: 3,
      flatten: 1.2,
      capStart: true,
      capEnd: false,
    }),
    ...([1, -1] as const).flatMap((side) => {
      const s = side > 0 ? 'L' : 'R';
      return [
        // The arm: a deltoid at the shoulder, a taper to the wrist, a cuff.
        // It used to run one stop further and call that a hand, which is how a
        // figure ends up with mittens.
        chain([`shoulder${s}`, `elbow${s}`, `wrist${s}`], {
          profile: ramp([
            [0, 0.092],
            [0.19, 0.064],
            [0.53, 0.055],
            [0.82, 0.047],
            [1, 0.044],
          ]),
          swatch: () => 'suit',
          sides: 8,
          rings: 3,
          capStart: true,
          capEnd: false,
        }),
        // The leg: a thigh, a knee and a calf. The boot is its own chain, below.
        chain([`hip${s}`, `knee${s}`, `ankle${s}`], {
          profile: ramp([
            [0, 0.09],
            [0.24, 0.077],
            [0.51, 0.061],
            [0.78, 0.05],
            [1, 0.048],
          ]),
          swatch: () => 'suit',
          sides: 8,
          rings: 3,
          flatten: 0.85,
          capStart: true,
          // Closed, although the boot stands over it: the ankle breaks 29
          // degrees, so the shin's opening does not face the way the boot
          // runs, and left open it was a hole in the leg with a boot beside it.
          capEnd: true,
        }),
      ];
    }),
    // The hands and the boots, which used to be the last two stops of the arm
    // and the leg: a taper to a point, which from any distance is a mitten and
    // a hoof. A hand is a palm and five fingers and a boot has a heel.
    ...([1, -1] as const).flatMap((side) => {
      const s = side > 0 ? 'L' : 'R';
      const hand = handFrame(side);
      const knuckles = hand.wrist.clone().addScaledVector(hand.along, PALM);
      const bone = `wrist${s}`;
      const finger = (root: Vector3, length: number, curl: number, width: number): Chain => ({
        bones: [bone, bone, bone],
        joints: [
          root,
          root
            .clone()
            .addScaledVector(hand.along, length * 0.55)
            .addScaledVector(hand.palm, length * curl * 0.35),
          root
            .clone()
            .addScaledVector(hand.along, length * 0.93)
            .addScaledVector(hand.palm, length * curl),
        ],
        profile: ramp([
          [0, width],
          [0.5, width * 0.92],
          [0.85, width * 0.86],
          [1, width * 0.55],
        ]),
        swatch: () => 'gloves',
        sides: 6,
        rings: 2,
        capStart: false,
        capEnd: true,
      });
      return [
        // The palm: wide across the hand and thin through it, which is the one
        // place on this figure where `flatten` has to be told which way is
        // which -- a palm whose across-axis came out edge-on is a blade.
        chain([bone, bone], {
          joints: [hand.wrist.clone().addScaledVector(hand.along, -0.02), knuckles],
          profile: ramp([
            [0, 0.04],
            [0.5, 0.045],
            [1, 0.042],
          ]),
          swatch: () => 'gloves',
          sides: 8,
          rings: 2,
          flatten: 1.7,
          across: hand.across,
          capStart: true,
          capEnd: false,
        }),
        // Four fingers, a little curled, because a hand in the air is not a
        // hand held out flat -- and the little finger is not the middle one.
        ...FINGERS.map((length, i) =>
          finger(
            knuckles
              .clone()
              .addScaledVector(hand.across, (i - 1.5) * 0.025)
              .addScaledVector(hand.palm, 0.004),
            length,
            0.34,
            0.0125,
          ),
        ),
        // The thumb, off the inside edge and turned across the palm.
        finger(
          hand.wrist
            .clone()
            .addScaledVector(hand.along, 0.03)
            .addScaledVector(hand.across, -0.036)
            .addScaledVector(hand.palm, 0.006),
          0.062,
          0.18,
          0.015,
        ),
        // The boot: a heel behind the ankle, a ball under it, a toe. It hangs
        // on the ankle and the toe, so it turns with the ankle hinge the way
        // the old last-two-stops-of-the-leg did.
        (() => {
          const ankle = at(`ankle${s}`),
            toe = at(`toe${s}`);
          const along = toe.clone().sub(ankle).normalize();
          const across = new Vector3().crossVectors(UP, along).normalize().multiplyScalar(side);
          return {
            bones: [`ankle${s}`, `ankle${s}`, `toe${s}`, `toe${s}`],
            joints: [
              ankle.clone().addScaledVector(along, -0.055),
              ankle.clone(),
              ankle.clone().addScaledVector(along, 0.13),
              ankle.clone().addScaledVector(along, 0.215),
            ],
            profile: ramp([
              [0, 0.045],
              [0.2, 0.06],
              [0.45, 0.062],
              [0.72, 0.056],
              [0.92, 0.046],
              [1, 0.026],
            ]),
            swatch: () => 'boots',
            sides: 8,
            rings: 3,
            flatten: 1.12,
            across,
            capStart: true,
            capEnd: true,
          } satisfies Chain;
        })(),
      ];
    }),
  ];
  /**
   * The head is its own surface on the same skeleton, and that is what lets the
   * first person hide it: with one skin there is no "hide the head", only "hide
   * the figure". Its bands are the helmet, the goggles and the face, in the
   * order an eye meets them going forward.
   */
  const skull: Chain = {
    bones: ['neck', 'neck', 'neck'],
    // Forward of the shoulders and above the back, on the neck's own line: the
    // skull's back end overlaps the neck's open end, so the two surfaces meet
    // inside the body rather than at a seam, and nothing of the head is left
    // standing in the shoulders. It used to start at z 0.325 -- level with the
    // shoulder joints -- and the crown of it came through the upper back as a
    // pale wedge, which is the hole in the back the owner drew a circle round.
    //
    // It used to measure 25 x 24 x 42 cm as well: a head as long as a forearm,
    // on a figure five heads tall where a person is seven and a half. A helmet
    // is about 18 x 18 x 25, and it is nearly as round as it is long -- the
    // profile below holds its width almost to the brow and then falls away at
    // the jaw, because a shell that tapers evenly from the crown is a bullet.
    joints: [new Vector3(0, 0.105, 0.4), new Vector3(0, 0.14, 0.465), new Vector3(0, 0.15, 0.53)],
    profile: ramp([
      [0, 0.062],
      [0.22, 0.085],
      [0.5, 0.089],
      [0.75, 0.084],
      [1, 0.05],
    ]),
    // The shell is the band and it goes the whole way round, because a helmet
    // does. What does not is the visor: it is a `patch` over the front and
    // underside, where a face looks from -- `-v` on this chain, which is why
    // the sine is the test. As a band it was an opaque belt round the head at
    // every bearing, and the eye reads a dark stripe across a pale oval as a
    // face: the figure appeared to turn its head to follow the camera, 300
    // degrees of it, round to its own back.
    //
    // The band's one stop past 0.95 is the jaw, and it exists for the end cap:
    // a cap is a single vertex on the axis and has no angle, so a patch cannot
    // reach it.
    swatch: bands([
      [0.88, 'helmet'],
      [1, 'goggles'],
    ]),
    patch: (t, around) => {
      // Measured, not assumed: on this chain a bearing of 270 degrees lands at
      // the bottom front of the head and 90 at the top back, so the sine of it
      // is how high up the head a point sits.
      const side = Math.sin(around);
      // A full-face helmet is three things from the front and not two: shell
      // over the crown, visor across the eyes, and a chin bar under it in the
      // shell's own colour. Both edges of the visor fall away toward the ear,
      // which is what closes it into a shape rather than a belt. The first
      // draft had the visor run from the eyes to the jaw with the face under
      // it, and from in front that is a slot in an egg -- what the eye sees
      // there is mostly the *side* of the head, and one threshold cuts it at
      // one height the whole way round.
      const brow = 0.45 - (1 - t) * 1.6,
        bar = -0.42 - (1 - t) * 0.6;
      if (side < brow && side > bar) return 'goggles';
      // and the chin itself, the one bit of a face this leaves out
      return side < -0.88 && t > 0.94 ? 'skin' : null;
    },
    sides: 12,
    rings: 4,
    capStart: true,
    capEnd: true,
  };

  const skeleton = new Skeleton(bones);
  const skinned = (skin: Skin, name: string): Mesh => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(skin.position, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(skin.normal, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(skin.color, 3));
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skin.skinIndex, 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(skin.skinWeight, 4));
    geometry.setIndex(new BufferAttribute(skin.index, 1));
    geometry.computeBoundingSphere();
    const mesh = new SkinnedMesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = true;
    // A skinned mesh's bounding sphere is the rest pose's, and this figure's
    // rest pose is an arch: culled against it, an arm in a track leaves the
    // sphere and the whole body blinks out. One object, so this costs nothing.
    mesh.frustumCulled = false;
    object.add(mesh);
    mesh.bind(skeleton);
    return mesh;
  };
  const bodySkin = mergeSkins(parts.map((c) => buildChain(c, boneIndex)));
  const headSkin = buildChain(skull, boneIndex);
  const skins = [bodySkin, headSkin];
  const meshes = [skinned(bodySkin, 'skin'), skinned(headSkin, 'skull')];
  const triangles = skins.reduce((n, skin) => n + skin.index.length / 3, 0);
  /**
   * Paint: one walk of the vertices, writing the colour of the swatch each one
   * belongs to and the shade the generator baked into it. Once, at build: the
   * outfit does not change.
   */
  const tints = Object.fromEntries(
    (Object.keys(outfit) as Swatch[]).map((swatch) => [swatch, new Color(outfit[swatch])]),
  ) as Record<Swatch, Color>;
  for (const [i, skin] of skins.entries()) {
    const attribute = meshes[i]!.geometry.getAttribute('color');
    const colors = attribute.array as Float32Array;
    for (let v = 0; v < skin.swatch.length; v++) {
      const tint = tints[skin.swatch[v]! as Swatch]!;
      const shade = skin.shade[v]!;
      colors[v * 3] = tint.r * shade;
      colors[v * 3 + 1] = tint.g * shade;
      colors[v * 3 + 2] = tint.b * shade;
    }
    attribute.needsUpdate = true;
  }

  const qx = new Quaternion();
  /** What the shapes are being asked for this frame; one object, refilled, never allocated. */
  const want: Record<Slot, number> = { box: 1, delta: 0, track: 0, climb: 0, turnIn: 0, turnOut: 0 };
  let time = 0;
  let view: FlightPose['view'] | null = null;
  const eye = new Vector3(0, 0.075, 0.5);
  /**
   * Walk a chain at a fixed step and write down what it looks like there. The
   * profile is a function, so it cannot be handed over; what can is its answer
   * at enough places to rebuild the shape, which is what this is.
   */
  const describeChain = (chain: Chain): ChainDescription => {
    const lengths = chain.joints.slice(1).map((p, i) => p.distanceTo(chain.joints[i]!));
    const total = lengths.reduce((a, b) => a + b, 0) || 1;
    const steps = 10 * lengths.length;
    const samples: ChainDescription['samples'] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      let walked = t * total,
        bone = 0;
      while (bone < lengths.length - 1 && walked > lengths[bone]!) walked -= lengths[bone++]!;
      const at = new Vector3().lerpVectors(
        chain.joints[bone]!,
        chain.joints[bone + 1]!,
        Math.min(1, walked / (lengths[bone] || 1)),
      );
      const sample: ChainDescription['samples'][number] = {
        t,
        at: [at.x, at.y, at.z],
        radius: chain.profile(t),
        swatch: chain.swatch(t),
        bone,
      };
      if (chain.patch) {
        const band = sample.swatch;
        sample.ring = Array.from(
          { length: RING_BEARINGS },
          (_, k) => chain.patch!(t, (k / RING_BEARINGS) * Math.PI * 2) ?? band,
        );
      }
      samples.push(sample);
    }
    return {
      bones: chain.bones,
      flatten: chain.flatten ?? 1,
      capStart: chain.capStart ?? false,
      capEnd: chain.capEnd ?? false,
      samples,
    };
  };

  return {
    object,
    eye,
    bounds: HUMAN_BOUNDS,
    describe() {
      object.updateMatrixWorld(true);
      return {
        bones: bones.map((bone) => {
          const at = bone.getWorldPosition(new Vector3());
          return {
            name: bone.name,
            parent: bone.parent instanceof Bone ? bone.parent.name : null,
            rest: [at.x, at.y, at.z] as [number, number, number],
          };
        }),
        chains: [...parts, skull].map(describeChain),
      };
    },
    get triangles() {
      return triangles;
    },
    update(pose, dt) {
      time += dt;
      object.position.set(pose.x, pose.y, pose.z);
      object.rotation.set(-pose.pitch, pose.heading, pose.bank);
      // The air, as a limb feels it. `rush` is the airspeed over the nominal and
      // the flutter goes with its square, because what shakes a suit is the
      // dynamic pressure and not the speed. Before this the figure read neither
      // `speed` nor `vy` at all -- they arrived every frame and were dropped --
      // so a dive at 62 m/s fluttered exactly like a glide at 30 while the
      // sound of it did not.
      const rush = pose.speed / SPEED;
      const press = rush * rush;
      const flutter = (0.05 + 0.09 * pose.gust) * press;
      const drift = perlin2(time * 0.15, 0.37, 11) * 0.05;
      const w = pose.windPhase;
      // What the pressure does besides shake: it pushes the limbs back. Above
      // the nominal they trail, below it they come forward, and the far joints
      // feel it more than the near ones.
      const drag = press - 1;
      // A dive also arches the back, and the figure has no spine joint to arch
      // -- so the hips take it, which is where an arch is felt anyway.
      const arch = clamp01(-pose.vy / 20, -1);

      // ---- what shape the figure is holding ----------------------------------
      // Three axes, not one. A skydiver changes shape in order to fly
      // differently; this file used to read the shape off `pitch` alone, which
      // meant a dive at 30 m/s and a dive at 62 looked identical and only the
      // sound knew the difference.
      const dive = clamp01(-pose.pitch / POSE.dive);
      const flare = clamp01(pose.pitch / POSE.climb);
      const fast = clamp01((rush - 1) / POSE.fast);
      const slow = clamp01((1 - rush) / POSE.slow);
      // How far down the go-fast road the figure has gone, off both axes at
      // once, and then box -> delta -> track along it with the delta owning the
      // middle. The first draft made the track the product of the two axes and
      // the delta their disagreement, which is defensible on paper and wrong in
      // the air: a dive buys airspeed, so the two axes agree within a second of
      // each other and the delta was a shape the figure only ever flashed
      // through. Measured on the real controller, this puts a level cruise in
      // the box, a gentle descent (vy -6) at 85% delta and the steepest dive at
      // a whole track -- three shapes that are held rather than passed.
      const drive = (dive + fast) / 2;
      // The climb is the other end of the same story and does not share the
      // road: it takes what it is owed first and the three above divide what is
      // left. Nose up and slow are one state here rather than two, because a
      // climb in this world is paid for in airspeed.
      const climb = Math.max(flare, slow);
      const road = 1 - climb;
      const track = clamp01((drive - 0.5) * 2) * road;
      const delta = (1 - Math.abs(drive - 0.5) * 2) * road;
      const box = clamp01((0.5 - drive) * 2) * road;
      // A turn is a shape laid over whatever the figure was doing rather than
      // one instead of it, so it takes a share and the rest keep their ratios:
      // a banked track still tracks.
      const lean = clamp01(Math.abs(pose.bank) / POSE.bank) * POSE.lean;
      const spare = (1 - lean) / (track + delta + climb + box || 1);
      want.box = box * spare;
      want.delta = delta * spare;
      want.track = track * spare;
      want.climb = climb * spare;
      // A roll about +z takes the left side (+x) down when the bank is
      // negative, which is a turn to the left, and the left side is then the
      // inner one.
      const innerLeft = pose.bank < 0;
      for (const h of hinges) {
        // The only two entries of `want` that are not the same for every joint:
        // whichever of the two mirrored turns this side is not wearing gets
        // nothing. They are two slots and not one because a single slot whose
        // target flipped as the bank crossed zero would hand whatever weight
        // the spring still held to the wrong side of the body -- and the bank
        // crosses zero in the middle of every S-turn.
        const inner = h.side > 0 === innerLeft;
        want.turnIn = inner ? lean : 0;
        want.turnOut = inner ? 0 : lean;

        const phase = h.side > 0 ? 0 : 2.1;
        let swing = 0;
        switch (h.kind) {
          case 'shoulder':
            swing = Math.sin(w + phase) * flutter + drift;
            break;
          case 'elbow':
            swing = Math.sin(w * 1.3 + 0.7 + phase) * flutter * 1.2;
            break;
          case 'hip':
            swing = Math.sin(w * 0.8 + 1.1 + phase) * flutter * 0.7 + drift + arch * 0.12;
            break;
          case 'knee':
            swing = Math.sin(w * 1.1 + 2.4 + phase) * flutter * 1.4;
            break;
          case 'ankle':
            swing = Math.sin(w * 1.1 + 3.6 + phase) * flutter * 0.8;
            break;
        }
        // The pressure trails the limb: it is a swing about the joint's own
        // pitch axis, so an arm goes back along the body and a leg goes back
        // along the flight, which is what the air does to both.
        swing -= drag * TRAIL[h.kind];
        const omega = 1 / LAG[h.kind];
        settle(h.swing, swing, omega, DAMPING.joint, dt);

        // The shapes, blended by what this joint has actually taken up. The
        // weights are sprung and then renormalised, so a joint on its way from
        // one shape to another is never wearing more or less than one pose --
        // it is the running average that keeps a blend on the sphere.
        let sum = 0;
        for (const slot of SLOTS) {
          const spring = h.weight[slot];
          settle(spring, want[slot], omega, DAMPING.pose, dt);
          if (spring.x < 0) spring.x = 0;
          sum += spring.x;
        }
        // An incremental weighted mean on the sphere: each shape in turn,
        // slerped by its share of everything counted so far.
        let taken = 0;
        h.pivot.quaternion.copy(h.rest);
        for (const slot of SLOTS) {
          const share = sum > 0 ? h.weight[slot].x / sum : slot === 'box' ? 1 : 0;
          if (share <= POSE.floor) continue;
          taken += share;
          // The first shape kept arrives at a ratio of exactly one, which is
          // what makes the `rest` this started from a placeholder rather than a
          // sixth vote.
          h.pivot.quaternion.slerp(h.targets[slot], share / taken);
        }
        h.pivot.quaternion.premultiply(qx.setFromAxisAngle(AXIS_X, h.swing.x));
      }
      // The first person draws none of the figure, and that is what being one
      // surface costs. What was here before was a list of parts to keep, and
      // the list was wrong: the parts on it -- the forearms -- were the two
      // black shapes the owner saw in the top corners, out at 71.6 degrees off
      // the axis of a frame whose half is 37.5. A skin cannot be culled part by
      // part, so the choice is the whole body or none of it, and measured,
      // none of this pose is inside the frame anyway. The day a pose brings the
      // hands forward, the forearms become a chain of their own with a surface
      // of their own, and then there is something to decide again.
      if (pose.view !== view) {
        view = pose.view;
        for (const m of meshes) m.visible = view === 'tpp';
      }
    },
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      skeleton.dispose();
      material.dispose();
    },
  };
}
