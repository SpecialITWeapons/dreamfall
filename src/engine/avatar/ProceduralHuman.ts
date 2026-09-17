// The figure: a skydiver's arch as one continuous skin over a skeleton of
// sixteen bones, with vertex colors on the world's lit material. The rest pose
// is the box position a belly-to-earth jumper holds: upper arms out and
// forward, elbows squared, thighs spread back, knees folded so the feet ride
// above the hips, toes pointed. The joints flutter with the wind and a slow
// noise, a gust is a burst of stronger flutter, the inner arm drops in a turn,
// and the climb angle sweeps the arms: back into a track in a dive, forward and
// wide in a climb.
//
// What this file owns is the skeleton, the pose and the numbers a body is made
// of -- the profiles below are the whole of what the figure looks like.
// Sweeping a surface along them is `Skin.ts`, which knows nothing about people.
// This used to be twenty solids parented to one another, and every shoulder
// sweep opened a seam between two of them that no pose could close; the
// Avatar interface was written so that this swap would not touch the engine,
// and it did not. Budget: 4 000 triangles.
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
import { DEFAULT_OUTFIT, DEFAULT_PATTERN, type Outfit, type Pattern } from './Outfits';

export const HUMAN_TRIANGLE_BUDGET = 4000;
/** How far the figure hangs under its center, and how far it reaches sideways, m; the flight reads these before the figure exists. */
export const HUMAN_BOUNDS = { below: 0.3, radius: 1.1 } as const;

export interface ProceduralHuman extends Avatar {
  readonly triangles: number;
  readonly outfit: Outfit;
  readonly pattern: Pattern;
}

type Swatch = Exclude<keyof Outfit, 'id'>;

const UP = new Vector3(0, 1, 0),
  AXIS_X = new Vector3(1, 0, 0),
  AXIS_Y = new Vector3(0, 1, 0),
  AXIS_Z = new Vector3(0, 0, 1);

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
const upperDir = (side: number) => new Vector3(side * 0.78, -0.08, 0.62).normalize();
const foreDir = (side: number) => new Vector3(side * -0.46, 0.16, 0.87).normalize();
const thighDir = (side: number) => new Vector3(side * 0.3, -0.06, -0.95).normalize();
const shinDir = (side: number) => new Vector3(side * 0.12, 0.8, -0.58).normalize();
const footDir = (side: number) => new Vector3(side * 0.05, 0.42, -0.9).normalize();
/**
 * Where the upper arms go in a full dive. A track is not the box turned about
 * the figure's own up axis -- that swings the arms out sideways, which is the
 * one direction a track does not go. It is a second pose, arms back along the
 * body, and a dive walks from one to the other.
 */
const trackDir = (side: number) => new Vector3(side * 0.15, -0.02, -0.99).normalize();
/**
 * The track. A dive folds the box into it: the upper arms swing back through
 * this many radians about the figure's own up axis, the elbows straighten by
 * this share of their bend, and the knees give up some of theirs -- so the
 * forearms end up along the body with the hands at the hips, which is the
 * position the owner asked for and the one that actually goes fast. `at` is the
 * pitch that counts as all the way down.
 */
/**
 * How far a full dive folds the box into a track: all the way to trackDir at
 * the shoulder, this share of the elbow's bend and of the knee's. `at` is the
 * pitch that counts as all the way down.
 */
const TRACK = { at: 0.5, elbow: 0.85, knee: 0.4 };
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
const IDENTITY = new Quaternion();

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

interface Hinge {
  pivot: Bone;
  rest: Quaternion;
  /** Where a full dive takes this joint, when it has somewhere else to be. */
  track?: Quaternion;
  /** Orientation in the figure's frame, for the child hinge's rest. */
  world: Quaternion;
  side: 1 | -1;
  kind: 'shoulder' | 'elbow' | 'hip' | 'knee' | 'ankle';
  /** What this joint is actually doing, as opposed to what the air asked for. */
  swing: Spring;
  drop: Spring;
  back: Spring;
  /** How far into the track this joint has folded, 0..1. */
  fold: Spring;
}

export function createProceduralHuman(
  litMaterial: LitMaterial,
  opts: { outfit?: Outfit; pattern?: Pattern } = {},
): ProceduralHuman {
  let outfit = opts.outfit ?? DEFAULT_OUTFIT;
  let pattern = opts.pattern ?? DEFAULT_PATTERN;
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
  const hinge = (
    kind: Hinge['kind'],
    name: string,
    parent: Object3D,
    at: Vector3,
    dir: Vector3,
    above: Hinge | null,
    side: 1 | -1,
    tracked?: Vector3,
  ): Hinge => {
    const world = new Quaternion().setFromUnitVectors(UP, dir);
    const rest = above ? above.world.clone().invert().multiply(world) : world.clone();
    const track = tracked
      ? (() => {
          const w = new Quaternion().setFromUnitVectors(UP, tracked);
          return above ? above.world.clone().invert().multiply(w) : w;
        })()
      : undefined;
    const pivot = new Bone();
    pivot.name = name;
    pivot.position.copy(at);
    pivot.quaternion.copy(rest);
    parent.add(pivot);
    bones.push(pivot);
    const spring = (): Spring => ({ x: 0, v: 0 });
    const h: Hinge = {
      pivot,
      rest,
      track,
      world,
      side,
      kind,
      swing: spring(),
      drop: spring(),
      back: spring(),
      fold: spring(),
    };
    hinges.push(h);
    return h;
  };
  for (const side of [1, -1] as const) {
    const s = side > 0 ? 'L' : 'R';
    const shoulder = hinge(
      'shoulder',
      `shoulder${s}`,
      body,
      SHOULDER.clone().setX(side * SHOULDER.x),
      upperDir(side),
      null,
      side,
      trackDir(side),
    );
    const elbow = hinge(
      'elbow',
      `elbow${s}`,
      shoulder.pivot,
      new Vector3(0, UPPER.len, 0),
      foreDir(side),
      shoulder,
      side,
    );
    // The wrist and the toe never turn; they are here because a chain of skin
    // needs a bone at the end of it to hang the last ring on, and because a
    // hand that follows the forearm is a hand rather than a paddle.
    const wrist = new Bone();
    wrist.name = `wrist${s}`;
    wrist.position.set(0, FORE.len, 0);
    bones.push(wrist);
    elbow.pivot.add(wrist);
    const hip = hinge('hip', `hip${s}`, body, HIP.clone().setX(side * HIP.x), thighDir(side), null, side);
    const knee = hinge('knee', `knee${s}`, hip.pivot, new Vector3(0, THIGH.len, 0), shinDir(side), hip, side);
    // The foot breaks 29 degrees away from the shin at the ankle: without a
    // hinge of its own a boot on the shin's axis is only a thicker shin, which
    // is what the figure had.
    const ankle = hinge(
      'ankle',
      `ankle${s}`,
      knee.pivot,
      new Vector3(0, SHIN.len, 0),
      footDir(side),
      knee,
      side,
    );
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
  /** Where the hand ends: a little past the wrist, along the forearm it hangs on. */
  const handAt = (side: 1 | -1) => {
    const s = side > 0 ? 'L' : 'R';
    const wrist = at(`wrist${s}`);
    return wrist.clone().addScaledVector(
      wrist
        .clone()
        .sub(at(`elbow${s}`))
        .normalize(),
      0.11,
    );
  };
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
    chain(['body', 'body', 'body', 'body', 'neck'], {
      // The spine's bones sit on top of each other -- nothing along it turns
      // yet -- so its stops are written here rather than read off the skeleton.
      // The day a back arches, these become bones and this line goes.
      joints: [
        new Vector3(0, -0.02, -0.5),
        new Vector3(0, -0.02, -0.32),
        new Vector3(0, 0, -0.02),
        new Vector3(0, 0.02, 0.2),
        new Vector3(0, 0.02, 0.34),
      ],
      // Widest across the chest and narrower at the belly, which is the way
      // round a person is. The first draft peaked at 0.5 -- the middle of the
      // back -- and the photograph showed it: a paunch with shoulders sloping
      // away from it.
      profile: ramp([
        [0, 0.085],
        [0.16, 0.145],
        [0.45, 0.138],
        [0.74, 0.178],
        [0.88, 0.163],
        [1, 0.085],
      ]),
      swatch: () => 'suit',
      sides: 12,
      rings: 3,
      flatten: 1.45,
      capStart: true,
      capEnd: false,
    }),
    ...([1, -1] as const).flatMap((side) => {
      const s = side > 0 ? 'L' : 'R';
      return [
        // The arm: a deltoid at the shoulder, a taper to the wrist, a glove.
        chain([`shoulder${s}`, `elbow${s}`, `wrist${s}`, `wrist${s}`], {
          // The last stop reaches past the wrist: that is the hand.
          joints: [at(`shoulder${s}`), at(`elbow${s}`), at(`wrist${s}`), handAt(side)],
          profile: ramp([
            [0, 0.092],
            [0.16, 0.064],
            [0.45, 0.055],
            [0.7, 0.048],
            [0.85, 0.046],
            [0.93, 0.056],
            [1, 0.024],
          ]),
          swatch: bands([
            [0.45, 'suit'],
            [0.85, 'trim'],
            [1, 'gloves'],
          ]),
          sides: 8,
          rings: 3,
          capStart: true,
          capEnd: true,
        }),
        // The leg: a thigh, a knee, a calf and a boot.
        chain([`hip${s}`, `knee${s}`, `ankle${s}`, `toe${s}`], {
          profile: ramp([
            [0, 0.09],
            [0.2, 0.077],
            [0.42, 0.061],
            [0.62, 0.052],
            [0.82, 0.045],
            [0.92, 0.058],
            [1, 0.03],
          ]),
          swatch: bands([
            [0.82, 'suit'],
            [1, 'boots'],
          ]),
          sides: 8,
          rings: 3,
          flatten: 0.85,
          capStart: true,
          capEnd: true,
        }),
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
    joints: [new Vector3(0, 0.02, 0.3), new Vector3(0, 0.03, 0.42), new Vector3(0, 0.01, 0.58)],
    profile: ramp([
      [0, 0.075],
      [0.3, 0.122],
      [0.55, 0.128],
      [0.8, 0.115],
      [1, 0.062],
    ]),
    // A band is only a band if a ring lands in it. At three rings a segment the
    // head's fall at 0, 0.107, 0.321, 0.428, 0.571, 0.857 and 1 -- and the
    // goggles, written as 0.58 to 0.8, caught none of them: the figure flew
    // about in a plain cream egg and nobody could see why. Four rings put two
    // in the visor, and the stops are written against the rings rather than
    // against a picture of a head.
    swatch: bands([
      [0.46, 'helmet'],
      [0.8, 'goggles'],
      [1, 'skin'],
    ]),
    sides: 10,
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
   * Repaint: one walk of the vertices, writing the swatch each one belongs to
   * and the shade the generator baked into it. A swatch used to be a mesh, so a
   * repaint was seven buffers; it is a range of vertices now, and it is still
   * one upload per surface rather than a new buffer.
   */
  const repaint = () => {
    const tint = new Color();
    for (const [i, skin] of skins.entries()) {
      const attribute = meshes[i]!.geometry.getAttribute('color');
      const colors = attribute.array as Float32Array;
      for (let v = 0; v < skin.swatch.length; v++) {
        tint.set(outfit[skin.swatch[v]! as Swatch]);
        const shade = skin.shade[v]!;
        colors[v * 3] = tint.r * shade;
        colors[v * 3 + 1] = tint.g * shade;
        colors[v * 3 + 2] = tint.b * shade;
      }
      attribute.needsUpdate = true;
    }
  };
  repaint();

  const qx = new Quaternion(),
    qy = new Quaternion(),
    qz = new Quaternion();
  let time = 0;
  let view: FlightPose['view'] | null = null;
  const eye = new Vector3(0, -0.03, 0.56);
  return {
    object,
    eye,
    bounds: HUMAN_BOUNDS,
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
      const slow = perlin2(time * 0.15, 0.37, 11) * 0.05;
      const w = pose.windPhase;
      // What the pressure does besides shake: it pushes the limbs back. Above
      // the nominal they trail, below it they come forward, and the far joints
      // feel it more than the near ones.
      const drag = press - 1;
      // A dive also arches the back, and the figure has no spine joint to arch
      // -- so the hips take it, which is where an arch is felt anyway.
      const arch = Math.min(Math.max(-pose.vy / 20, -1), 1);
      // The air the figure meets: a dive sweeps the arms back into a track and
      // straightens the knees, a climb spreads the arms forward and wide. Both
      // are rotations around the figure's own up axis, so the arms travel in
      // the plane of the shoulders instead of flapping.
      const dive = Math.min(Math.max(-pose.pitch, 0), TRACK.at) / TRACK.at;
      // A climb still spreads the arms about the up axis; only the dive has
      // somewhere specific to be.
      const sweep = -Math.min(Math.max(pose.pitch, 0), 0.6) * 0.32;

      for (const h of hinges) {
        const phase = h.side > 0 ? 0 : 2.1;
        let swing = 0,
          drop = 0,
          back = 0;
        switch (h.kind) {
          case 'shoulder':
            swing = Math.sin(w + phase) * flutter + slow;
            drop = Math.max(0, -pose.bank * h.side) * 0.5;
            back = sweep;
            break;
          case 'elbow':
            swing = Math.sin(w * 1.3 + 0.7 + phase) * flutter * 1.2;
            // In a climb the elbows help spread the arms; in a dive they have
            // nothing to add, because straightening is what folds them in.
            back = sweep < 0 ? sweep * 0.5 : 0;
            break;
          case 'hip':
            swing = Math.sin(w * 0.8 + 1.1 + phase) * flutter * 0.7 + slow + arch * 0.12;
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
        settle(h.drop, drop, omega, DAMPING.joint, dt);
        settle(h.back, back, omega, DAMPING.joint, dt);
        settle(h.fold, dive, omega, DAMPING.pose, dt);
        const fold = Math.min(Math.max(h.fold.x, 0), 1);
        h.pivot.quaternion.copy(h.rest);
        if (h.track && fold > 0) h.pivot.quaternion.slerp(h.track, fold);
        // Straightening is a walk of the joint's own bend back toward none of
        // it, so the forearm ends up along the upper arm whatever direction the
        // upper arm is pointing by then.
        if (h.kind === 'elbow' && fold > 0) h.pivot.quaternion.slerp(IDENTITY, fold * TRACK.elbow);
        if (h.kind === 'knee' && fold > 0) h.pivot.quaternion.slerp(IDENTITY, fold * TRACK.knee);
        h.pivot.quaternion
          .premultiply(qz.setFromAxisAngle(AXIS_Z, -h.side * h.drop.x))
          .premultiply(qy.setFromAxisAngle(AXIS_Y, h.side * h.back.x))
          .premultiply(qx.setFromAxisAngle(AXIS_X, h.swing.x));
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
    get outfit() {
      return outfit;
    },
    get pattern() {
      return pattern;
    },
    setOutfit(next, nextPattern) {
      outfit = next;
      pattern = nextPattern;
      repaint();
    },
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      skeleton.dispose();
      material.dispose();
    },
  };
}
