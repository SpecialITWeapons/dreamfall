// What the figure is doing in the air, as five directions a side, and nothing
// about what the figure is made of.
//
// This was inside `ProceduralHuman.ts`, where it was written, and it came out
// when a second body turned up that had to move the same way. A pose is not a
// property of a mesh: the shapes, the thresholds they are chosen on, the
// spring in every joint and the flutter the air puts through it are the same
// arithmetic whether the surface under them was grown from a distance field or
// drawn by a person in Blender. One copy of it, and a skeleton that differs
// only in what it is called.
//
// Pure CPU, no DOM and no renderer: `Quaternion` and `Vector3` are arithmetic.
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { FlightPose } from './Avatar';
import { SPEED } from '../flight/FlightController';
import { perlin2 } from '../terrain/noise';

const UP = new Vector3(0, 1, 0),
  AXIS_X = new Vector3(1, 0, 0);

/**
 * The rotation a limb pointing along `a` wears, with the roll about its own
 * axis **decided** rather than left to whatever `setFromUnitVectors` happens
 * to produce.
 *
 * That function gives the minimal rotation taking +Y to `a`, which is one of
 * infinitely many, and the one it picks turns as `a` moves. Nothing hanging
 * off a limb can tell the difference between a shoulder that swept back and a
 * shoulder that swept back while rolling ninety degrees -- but a forearm can,
 * because it is carried by both. Measured on the controller: with the roll
 * left to the accident, an arm sweeping from the box to the delta took the
 * forearm to 0.79 of the figure's up and held it above 0.5 for a second.
 *
 * Here the limb's own frame is built against the figure's up, so a limb that
 * returns to a direction returns to the same roll and a limb passing through
 * one passes through the same roll on the way. Only the two joints that hang
 * off the chest use it: an arm never points within 70 degrees of the figure's
 * up in any of the shapes -- the furthest is the turn's inner arm at 0.34 --
 * and neither does a thigh, so the basis is never near the degenerate case
 * this construction has. A folded shin does point up, which is why a knee is
 * not built this way.
 *
 * `hand` is which way round the frame is built, and an arm and a leg do not
 * want the same answer. Deciding the roll fixes *which* roll a limb wears, and
 * that number then lands on the bone and twists the skin on it. Measured
 * against the minimal rotation, which adds no twist at all: the shoulder's
 * frame sits 51 degrees off it in level flight, and the hip's sat **153**.
 * An arm survives that, because an arm reads much the same rolled either way;
 * a leg does not. The knee hinged backwards and the thigh wrung itself out,
 * which is what a skinned limb looks like turned inside its own sleeve. So the
 * hip builds its frame the other way round -- a half turn about the limb's own
 * axis, which is still right-handed, `(-x, y, -z)` -- and lands within 27
 * degrees of no twist instead of 153.
 *
 * Nothing below these two joints has to know: `under` reads the parent's frame
 * through this same function, so a knee stays exactly where the pose put it
 * whichever way its thigh is rolled. The twist is the only thing that moves.
 */
const basis = new Matrix4(),
  across = new Vector3(),
  along = new Vector3();
const rolled = (a: Vector3, out: Quaternion, hand: 1 | -1 = 1) => {
  across.crossVectors(UP, a).multiplyScalar(hand).normalize();
  // `z = x cross y`, in that order: the other way round is a left-handed
  // basis, whose matrix has a determinant of minus one and whose quaternion is
  // not a rotation at all.
  along.crossVectors(across, a);
  return out.setFromRotationMatrix(basis.makeBasis(across, a, along));
};

/**
 * Which way round each of the two rolled joints builds its frame. See
 * `rolled`: an arm and a leg want opposite answers, and the two places that
 * read this -- the frame a joint wears, and the frame its child is measured
 * in -- have to read the same one or the child moves.
 */
const ROLL = { shoulder: 1, hip: -1 } as const satisfies Partial<Record<Kind, 1 | -1>>;

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

export type Kind = 'shoulder' | 'elbow' | 'hip' | 'knee' | 'ankle';

/**
 * Where every joint of one side points in one pose, **in the frame of the
 * joint above it** -- the same chain rule the skeleton is built with, so a
 * pose cannot drift out of step with the skeleton it is worn on.
 *
 * Directions rather than rotations, and parent-relative rather than the
 * figure's, and both halves of that were a fault this carried from the day it
 * was written.
 *
 * It used to keep `setFromUnitVectors(UP, d)` per joint and slerp those to
 * blend two shapes. That quaternion is the *minimal* rotation taking +Y to
 * `d`, one of infinitely many that do, and the roll it happens to carry about
 * the limb's own axis is an accident of where `d` points; interpolating two
 * accidents traces no arc anyone chose. Flown on the controller it put the
 * forearm at 0.97 of the figure's up -- standing vertical over the back.
 *
 * Blending the directions in the figure's frame instead fixed the shoulder and
 * left the elbow where it was, for a reason worth writing down: in the box the
 * forearm points **forward** and in the delta it points **back**, 165 degrees
 * apart. A weighted mean of two nearly opposite vectors very nearly cancels,
 * and what survives is whatever small component they had in common -- here a
 * little `y` -- which normalising then blows up to a unit vector pointing
 * almost straight up. Measured: box 0.41, delta 0.48, turn 0.11 gives a sum of
 * length 0.15 and a direction of (-0.45, 0.89, 0.02). The arm went over the
 * top because the arithmetic had nothing else left to say.
 *
 * Parent-relative, the same motion is an elbow going from bent to straight:
 * 76 degrees, nowhere near the antipode, and a blend that means what it says.
 * The endpoints are unchanged to the bit -- a blend of one shape is that shape
 * -- so every threshold measured against the old code still holds.
 */
const poseAims = (pose: Pose, side: 1 | -1, inner: boolean): Record<Kind, Vector3> => {
  const upper = pose.upper(side, inner),
    fore = pose.fore(side, inner),
    thigh = pose.thigh(side, inner),
    shin = pose.shin(side, inner),
    foot = pose.foot(side, inner);
  // Each direction is taken in the frame its own parent will actually be
  // wearing, which means building the chain here exactly as `aimed` and
  // `chain` will build it: the top of a limb gets `rolled`'s decided frame,
  // and everything under it the minimal rotation, laid on its parent's.
  //
  // Guessing the parent's frame instead of composing it is a bug with one
  // symptom and it is not a subtle one. The ankle used to be measured against
  // `setFromUnitVectors(UP, shin)` -- the frame the shin *would* wear if
  // nothing above it had a roll. What the shin actually wears is the thigh's
  // decided roll with that laid on top, so the foot arrived 167 degrees round
  // its own axis from where the file draws it: a sole pointing at the sky.
  const frame = new Quaternion();
  const beneath = (parent: Quaternion, d: Vector3) => d.clone().applyQuaternion(parent.clone().invert());
  const shoulder = rolled(upper, new Quaternion(), ROLL.shoulder);
  const hip = rolled(thigh, new Quaternion(), ROLL.hip);
  const knee = hip.clone().multiply(frame.setFromUnitVectors(UP, beneath(hip, shin)));
  return {
    shoulder: upper.clone(),
    elbow: beneath(shoulder, fore),
    hip: thigh.clone(),
    knee: beneath(hip, shin),
    ankle: beneath(knee, foot),
  };
};

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
export const POSE = {
  dive: 0.4,
  climb: 0.42,
  fast: 0.28,
  slow: 0.22,
  bank: 0.38,
  lean: 0.7,
  floor: 0.005,
  /**
   * How fast a roll has to be going to count as a whole one, rad/s. Measured
   * on the controller like every other number here: holding the stick hard
   * over rolls at 0.32 and reversing an S-turn peaks at 0.62, so 0.45 is a
   * brisk entry rather than a ceiling nothing reaches.
   */
  roll: 0.45,
  /**
   * What a roll is worth against a bank that is merely being held. Half: a
   * flyer rolling into a turn is *doing* something and a flyer sitting in one
   * has already done it, and the difference between those two is most of what
   * makes a turn look intended rather than suffered. It goes the other way on
   * the way out, so the shape starts unwinding while the bank is still there
   * -- which is the only anticipation available to something that cannot see
   * the future.
   */
  lead: 0.5,
  /** How long the roll rate is smoothed over, s. A raw derivative of a banking angle is noise. */
  rollLag: 0.12,
};

/**
 * How long a joint takes to catch up with what the air is asking of it, s. The
 * limbs used to arrive in the same frame as the shoulders, which is what made
 * the figure read as a puppet: nothing had any weight. A first-order lag per
 * joint, longer the further it is from the chest, is the cheapest honest
 * substitute for inertia -- and it is also the phase offset the flutter needed,
 * so it is not applied twice.
 */
const LAG: Record<Kind, number> = {
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
const TRAIL: Record<Kind, number> = {
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
export const clamp01 = (v: number, min = 0) => (v < min ? min : v > 1 ? 1 : v);

/** The ten joints the shapes speak to, in the order a chain is walked. */
export const JOINTS: ReadonlyArray<{ kind: Kind; side: 1 | -1 }> = [1, -1].flatMap((side) =>
  (['shoulder', 'elbow', 'hip', 'knee', 'ankle'] as const).map((kind) => ({ kind, side: side as 1 | -1 })),
);

/** Which joint each one hangs off, or null where it hangs off the chest. */
const PARENT: Record<Kind, Kind | null> = {
  shoulder: null,
  elbow: 'shoulder',
  hip: null,
  knee: 'hip',
  ankle: 'knee',
};

interface Joint {
  kind: Kind;
  side: 1 | -1;
  /** Where this joint points in each of the shapes, in its parent's frame. */
  aims: Record<Slot, Vector3>;
  /** The blend of those, this frame. */
  aim: Vector3;
  /** How much of each shape it is wearing; a spring per slot, not one for the figure. */
  weight: Record<Slot, Spring>;
  /** What the joint is actually doing, as opposed to what the air asked for. */
  swing: Spring;
  /** Parent-relative, this frame. */
  local: Quaternion;
  /** In the figure's frame -- +Y taken to where this limb points -- this frame. */
  world: Quaternion;
}

/**
 * What the torso is doing, in radians, for a body that has a spine to do it
 * with. Both are the whole of it: a consumer with three vertebrae gives each a
 * third, one with six gives each a sixth, and neither number is this module's
 * business.
 */
export interface Torso {
  /**
   * The arch. Positive is belly down and hips forward, which is the shape a
   * skydiver holds to stay stable and the first thing they are taught. It
   * follows the descent rather than the nose, because what arches a back is
   * falling, not pointing.
   */
  arch: number;
  /** Side bend into a turn: the body leads the bank rather than being carried by it. */
  lean: number;
}

/**
 * Where the figure is looking, in radians, for a body with a neck to look
 * with. Both are the whole of it, to spread over however many bones a neck
 * turns out to have.
 *
 * A head is not a limb and does not wait for the air: a person looks into a
 * turn before they are in it, which is why this is sprung faster than a
 * shoulder rather than slower. It cannot actually lead -- nothing here knows
 * what the flight is about to do -- but arriving first is most of what leading
 * looks like.
 */
export interface Gaze {
  /** Into the turn. Positive is toward the figure's left, which is +x. */
  yaw: number;
  /** Chin up, which is what keeps the eyes on the horizon while the back arches. */
  pitch: number;
}

export interface Posture {
  update(pose: FlightPose, dt: number): void;
  /** What the spine is doing this frame. Zero throughout on a body built without one. */
  readonly torso: Torso;
  /** Where the head is looking this frame, relative to the chest. */
  readonly gaze: Gaze;
  /**
   * The joint's rotation relative to the one above it. A skeleton built the
   * way `ProceduralHuman` builds its own -- chest, then shoulder, then elbow,
   * each bone along its own +Y -- wears these directly.
   */
  local(kind: Kind, side: 1 | -1): Quaternion;
  /**
   * The limb's orientation in the figure's frame: +Y taken to where it points.
   * A skeleton with joints the engine does not drive between its own -- a
   * clavicle, a hip joint, three vertebrae -- cannot use `local`, because its
   * parent is not the joint above it in this chain. It asks for this and undoes
   * its own parent.
   */
  world(kind: Kind, side: 1 | -1): Quaternion;
}

/**
 * The figure's motion, with no figure attached. `dt <= 0` means "be there
 * now" -- the springs are placed rather than stepped -- which is how a world
 * poses a body before its first frame.
 */
/**
 * How far the torso bends at the ends of what the flight can do. A skydiver's
 * arch across the whole lumbar and thoracic run is twenty degrees or so, not
 * the forty a photograph suggests -- a photograph is taken at the moment of
 * the hardest arch there is, and this figure holds its shape for minutes.
 */
const TORSO = { arch: 0.35, lean: 0.22, lag: 0.22 };

/**
 * How far the head turns, and how fast. Thirty degrees into a hard turn is
 * what a person does without moving their shoulders; past that the shoulders
 * go too, and the shoulders here are busy flying. The chin comes up with the
 * arch and by rather less than the arch, so the eyes end up somewhere between
 * the horizon and the ground rather than level -- which is where a skydiver's
 * eyes are, because the ground is the thing worth looking at.
 */
const GAZE = { yaw: 0.52, pitch: 0.24, lag: 0.08 };

export function createPosture(opts: { spine?: boolean } = {}): Posture {
  let time = 0;
  // Where the arch is felt. A body with no joint between the hips and the
  // shoulders has to put it in the hips, which is where an arch is felt
  // anyway; a body with three vertebrae puts it where it belongs and the hips
  // stop doing a job that is not theirs. Doing both would arch it twice.
  const spine = opts.spine ?? false;
  const torso: Torso = { arch: 0, lean: 0 };
  const bend = { x: 0, v: 0 } satisfies Spring;
  const sway = { x: 0, v: 0 } satisfies Spring;
  const gaze: Gaze = { yaw: 0, pitch: 0 };
  // The bank a frame ago, and how fast it is moving. Nothing in `FlightPose`
  // carries a roll rate, and the first frame has no previous bank to take one
  // from -- a resumed flight arrives already banked, and differencing against
  // a zero nobody flew would throw the figure into a turn it is not in.
  let lastBank = 0;
  let flown = false;
  const rolling = { x: 0, v: 0 } satisfies Spring;
  const look = { x: 0, v: 0 } satisfies Spring;
  const lift = { x: 0, v: 0 } satisfies Spring;
  const joints = JOINTS.map(({ kind, side }): Joint => {
    const aims = {} as Record<Slot, Vector3>;
    const weight = {} as Record<Slot, Spring>;
    for (const slot of SLOTS) {
      const { pose, inner } = SLOT_POSE[slot];
      aims[slot] = poseAims(pose, side, inner)[kind];
      // The figure starts in the box and walks out of it, which is also what
      // `dt <= 0` has to reproduce on the very first frame.
      weight[slot] = { x: slot === 'box' ? 1 : 0, v: 0 };
    }
    return {
      kind,
      side,
      aims,
      aim: aims.box.clone(),
      weight,
      swing: { x: 0, v: 0 },
      local: new Quaternion(),
      world: new Quaternion(),
    };
  });
  const at = (kind: Kind, side: 1 | -1) => joints.find((j) => j.kind === kind && j.side === side)!;
  /**
   * Turn every blended direction into the rotation its bone wears. The two
   * joints on the chest get a decided roll, because what hangs off them can
   * tell; the three below them cannot, so they keep the cheaper minimal
   * rotation and a shin that points at the sky keeps working.
   */
  const aimed = () => {
    for (const j of joints) {
      const hand = ROLL[j.kind as keyof typeof ROLL];
      if (hand) rolled(j.aim, j.local, hand);
      else j.local.setFromUnitVectors(UP, j.aim);
    }
  };
  /** Walk the chain: a limb's orientation is its parent's with its own laid on. */
  const chain = () => {
    for (const j of joints) {
      const above = PARENT[j.kind];
      if (above) j.world.copy(at(above, j.side).world).multiply(j.local);
      else j.world.copy(j.local);
    }
  };
  // The box, before anyone has asked for a frame. `local` starts there and
  // `world` has to agree, or a body that reads the rest pose off this at load
  // -- to know how far a limb has since travelled -- reads an identity that
  // the figure was never in.
  aimed();
  chain();
  const want = {} as Record<Slot, number>;
  const qx = new Quaternion();

  return {
    torso,
    gaze,
    local: (kind, side) => at(kind, side).local,
    world: (kind, side) => at(kind, side).world,
    update(pose, dt) {
      time += dt;
      // The air, as a limb feels it. `rush` is the airspeed over the nominal and
      // the flutter goes with its square, because what shakes a suit is the
      // dynamic pressure and not the speed.
      const rush = pose.speed / SPEED;
      const press = rush * rush;
      const flutter = (0.05 + 0.09 * pose.gust) * press;
      const drift = perlin2(time * 0.15, 0.37, 11) * 0.05;
      const w = pose.windPhase;
      // What the pressure does besides shake: it pushes the limbs back. Above
      // the nominal they trail, below it they come forward, and the far joints
      // feel it more than the near ones.
      const drag = press - 1;
      // A dive arches the back. Where that arch is worn is the one thing this
      // module lets a body differ about, because it is the one thing a body
      // can differ about: a spine or no spine.
      const arch = clamp01(-pose.vy / 20, -1);
      settle(bend, spine ? arch * TORSO.arch : 0, 1 / TORSO.lag, DAMPING.joint, dt);
      settle(
        sway,
        spine ? clamp01(pose.bank / POSE.bank, -1) * TORSO.lean : 0,
        1 / TORSO.lag,
        DAMPING.joint,
        dt,
      );
      torso.arch = bend.x;
      torso.lean = sway.x;
      // The head. A bank is the only thing here that knows a turn is happening
      // -- the heading is where the figure points, not how fast it is coming
      // round -- and a banked flyer is a turning one, so the bank is what the
      // head reads. It leans the other way from the sign of the bank for the
      // same reason the inner side of the body does: a roll about +z takes the
      // left side down, and down is the way round.
      settle(look, -clamp01(pose.bank / POSE.bank, -1) * GAZE.yaw, 1 / GAZE.lag, DAMPING.joint, dt);
      settle(lift, arch * GAZE.pitch, 1 / GAZE.lag, DAMPING.joint, dt);
      gaze.yaw = look.x;
      gaze.pitch = lift.x;

      // ---- what shape the figure is holding --------------------------------
      const dive = clamp01(-pose.pitch / POSE.dive);
      const flare = clamp01(pose.pitch / POSE.climb);
      const fast = clamp01((rush - 1) / POSE.fast);
      const slow = clamp01((1 - rush) / POSE.slow);
      const drive = (dive + fast) / 2;
      const climb = Math.max(flare, slow);
      const road = 1 - climb;
      const track = clamp01((drive - 0.5) * 2) * road;
      const delta = (1 - Math.abs(drive - 0.5) * 2) * road;
      const box = clamp01((0.5 - drive) * 2) * road;
      // How much of a turn the figure is wearing. Two things say so and they
      // are not the same thing: the bank it is holding, and how fast that bank
      // is being changed. Before this only the first was read, so rolling into
      // a turn and sitting in one looked alike -- and coming out of one, the
      // shape unwound exactly as slowly as the bank did, which is a figure
      // being carried by a turn rather than flying one.
      const roll = dt > 0 && flown ? (pose.bank - lastBank) / dt : 0;
      lastBank = pose.bank;
      flown = true;
      settle(rolling, roll, 1 / POSE.rollLag, DAMPING.joint, dt);
      // Positive where the roll is going the way the bank already leans, which
      // is into the turn; negative on the way out, where it takes lean away.
      const lead = clamp01((Math.sign(pose.bank) * rolling.x) / POSE.roll, -1);
      const lean = clamp01(Math.abs(pose.bank) / POSE.bank + lead * POSE.lead) * POSE.lean;
      const spare = (1 - lean) / (track + delta + climb + box || 1);
      want.box = box * spare;
      want.delta = delta * spare;
      want.track = track * spare;
      want.climb = climb * spare;
      // A roll about +z takes the left side (+x) down when the bank is
      // negative, which is a turn to the left, and the left side is then the
      // inner one.
      const innerLeft = pose.bank < 0;
      for (const j of joints) {
        const inner = j.side > 0 === innerLeft;
        want.turnIn = inner ? lean : 0;
        want.turnOut = inner ? 0 : lean;

        const phase = j.side > 0 ? 0 : 2.1;
        let swing = 0;
        switch (j.kind) {
          case 'shoulder':
            swing = Math.sin(w + phase) * flutter + drift;
            break;
          case 'elbow':
            swing = Math.sin(w * 1.3 + 0.7 + phase) * flutter * 1.2;
            break;
          case 'hip':
            swing = Math.sin(w * 0.8 + 1.1 + phase) * flutter * 0.7 + drift + (spine ? 0 : arch * 0.12);
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
        swing -= drag * TRAIL[j.kind];
        const omega = 1 / LAG[j.kind];
        settle(j.swing, swing, omega, DAMPING.joint, dt);

        // The shapes, blended by what this joint has actually taken up. The
        // weights are sprung and then renormalised, so a joint on its way from
        // one shape to another is never wearing more or less than one pose --
        // it is the running average that keeps a blend on the sphere.
        let sum = 0;
        for (const slot of SLOTS) {
          const spring = j.weight[slot];
          settle(spring, want[slot], omega, DAMPING.pose, dt);
          if (spring.x < 0) spring.x = 0;
          sum += spring.x;
        }
        // A weighted mean of the directions, then back onto the sphere. Two
        // shapes blended this way travel the arc between them; the quaternion
        // slerp this replaced did not.
        j.aim.set(0, 0, 0);
        for (const slot of SLOTS) {
          const share = sum > 0 ? j.weight[slot].x / sum : slot === 'box' ? 1 : 0;
          if (share <= POSE.floor) continue;
          j.aim.addScaledVector(j.aims[slot], share);
        }
        // Only reachable if the kept shares cancelled, which two opposed
        // directions at equal weight would. The box is where a figure goes
        // when the air has asked it for nothing it can answer.
        if (j.aim.lengthSq() < 1e-8) j.aim.copy(j.aims.box);
        j.aim.normalize();
      }
      aimed();
      // The air, on top of the shape: a swing about the parent's own x, which
      // for a shoulder is the figure's left-right axis and for the joints
      // under it is whatever that limb hangs from. It is applied to the
      // rotation rather than to the direction because it is the one thing here
      // that is meant to carry down the chain -- a wrist trails further than a
      // shoulder because it wears the shoulder's swing and then its own.
      for (const j of joints) j.local.premultiply(qx.setFromAxisAngle(AXIS_X, j.swing.x));
      chain();
    },
  };
}
