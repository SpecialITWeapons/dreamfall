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
  Vector3,
  type Mesh,
  type Object3D,
} from 'three';
import { vertexColor } from 'three/tsl';
import type { LitMaterial } from '../render/SoftLighting';
import { HUMAN_BOUNDS, type Avatar, type FlightPose } from './Avatar';
import { POSE, createPosture, type Kind } from './Posture';
import { buildFlesh } from './Flesh';
import { mergeSkins, type Chain, type Skin } from './Skin';
import { OUTFIT, type Outfit, type Swatch } from './Outfit';

/** How far the figure hangs under its center, and how far it reaches sideways, m; the flight reads these before the figure exists. */
export { HUMAN_BOUNDS };
export { POSE };

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

const UP = new Vector3(0, 1, 0);

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
 * A profile: half-width along a chain, given as stops and read between them.
 * This is the shape of the body and it is deliberately data -- a waist, a
 * shoulder, a calf and an ankle are four numbers here, and were four solids
 * before.
 *
 * Read with a monotone cubic (Fritsch-Carlson) rather than straight lines:
 * the stops are hit exactly and nothing overshoots between them, but the
 * curve turns smoothly through each, where a line makes a kink -- and a limb
 * read as a chain of cone frustums, one crease at every stop, from a chase
 * camera three metres off.
 */
const ramp = (stops: Array<[number, number]>) => {
  const n = stops.length;
  if (n < 2) return () => stops[0]?.[1] ?? 0;
  const t = stops.map((s) => s[0]),
    r = stops.map((s) => s[1]);
  const h: number[] = [],
    d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(t[i + 1]! - t[i]! || 1e-9);
    d.push((r[i + 1]! - r[i]!) / h[i]!);
  }
  // Tangents: the harmonic mean of the neighbouring secants where they agree
  // in sign, and zero where they do not, which is what keeps a waist a waist.
  const m: number[] = new Array<number>(n).fill(0);
  m[0] = d[0]!;
  m[n - 1] = d[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    const a = d[i - 1]!,
      b = d[i]!;
    m[i] = a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  }
  return (x: number): number => {
    if (x <= t[0]!) return r[0]!;
    if (x >= t[n - 1]!) return r[n - 1]!;
    let i = 0;
    while (i < n - 2 && x > t[i + 1]!) i++;
    const s = (x - t[i]!) / h[i]!,
      s2 = s * s,
      s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * r[i]! +
      (s3 - 2 * s2 + s) * h[i]! * m[i]! +
      (-2 * s3 + 3 * s2) * r[i + 1]! +
      (s3 - s2) * h[i]! * m[i + 1]!
    );
  };
};
/** A swatch by distance along a chain: the first stop whose end is past t. */
const bands =
  (stops: Array<[number, string]>) =>
  (t: number): string =>
    stops.find(([end]) => t <= end)?.[1] ?? stops[stops.length - 1]![1];

/**
 * One bone the posture drives. What the joint is *doing* -- its shapes, its
 * weights, its spring -- lives in `Posture` now, because a second body has to
 * do the same thing with a different skeleton. What is left here is the bone
 * and which of the posture's joints writes to it.
 */
interface Hinge {
  pivot: Bone;
  side: 1 | -1;
  kind: Kind;
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
  // The posture is made before the skeleton because the skeleton is built in
  // the pose it holds on its first frame -- the box -- and the skin is cut for
  // that pose. Asking the posture for it rather than writing it down twice is
  // what keeps a bone from drifting out of step with the shape it wears.
  const posture = createPosture();
  const hinge = (kind: Kind, name: string, parent: Object3D, at: Vector3, side: 1 | -1): Hinge => {
    const pivot = new Bone();
    pivot.name = name;
    pivot.position.copy(at);
    pivot.quaternion.copy(posture.local(kind, side));
    parent.add(pivot);
    bones.push(pivot);
    const h: Hinge = { pivot, side, kind };
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
  const limbs: Chain[] = [
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
      // A chest is flatter than the waist under it, and the hips are between:
      // the same 1.2 from tail to neck made a body of one cross-section, and
      // a body of one cross-section is a pipe however it tapers.
      flatten: ramp([
        [0, 1.15],
        [0.2, 1.22],
        [0.54, 1.12],
        [0.8, 1.32],
        [0.93, 1.15],
        [1, 1.05],
      ]),
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
          flatten: 0.85,
        }),
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
            flatten: 1.12,
            across,
          } satisfies Chain;
        })(),
      ];
    }),
  ];
  /**
   * The hands: a palm and five fingers a side, grown as a region of their own
   * at a finer grid than the body -- a finger is two and a half centimetres
   * across, and the body's cells are one and a half -- and laid over the
   * sleeve's end at the wrist, where the glove covers the join.
   */
  const hands: Chain[][] = ([1, -1] as const).map((side) => {
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
        flatten: 1.7,
        across: hand.across,
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
    ];
  });
  const parts: Chain[] = [...limbs, ...hands.flat()];
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
  /**
   * The surfaces, grown from the chains' fields: the body as one region, so
   * the arms and the legs round into the torso instead of standing in it; each
   * hand as a region of its own on a grid fine enough for a finger; the head
   * on its own, because the first person hides it. The cells are what the
   * thinnest thing in each region can afford, and the blend is how far two
   * chains fillet into each other where they meet.
   */
  const bodySkin = mergeSkins([
    buildFlesh(limbs, boneIndex, { cell: 0.02, blend: 0.05 }),
    ...hands.map((hand) => buildFlesh(hand, boneIndex, { cell: 0.006, blend: 0.008 })),
  ]);
  const headSkin = buildFlesh([skull], boneIndex, { cell: 0.007, blend: 0.01 });
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
    const tint = new Color();
    for (let v = 0; v < skin.swatch.length; v++) {
      tint.copy(tints[skin.swatch[v]! as Swatch]!).lerp(tints[skin.swatch2[v]! as Swatch]!, skin.mix[v]!);
      const shade = skin.shade[v]!;
      colors[v * 3] = tint.r * shade;
      colors[v * 3 + 1] = tint.g * shade;
      colors[v * 3 + 2] = tint.b * shade;
    }
    attribute.needsUpdate = true;
  }

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
      // the baker takes one number; a body whose section changes along it is
      // described at its middle, and the samples' radii carry the rest
      flatten: typeof chain.flatten === 'function' ? chain.flatten(0.5) : (chain.flatten ?? 1),
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
      object.position.set(pose.x, pose.y, pose.z);
      object.rotation.set(-pose.pitch, pose.heading, pose.bank);
      // What the figure is doing in the air is `Posture`'s, and what it is made
      // of is this file's. The chain it hands back is the one this skeleton is
      // built with -- chest, shoulder, elbow -- so each bone wears its joint's
      // rotation as it comes.
      posture.update(pose, dt);
      for (const h of hinges) h.pivot.quaternion.copy(posture.local(h.kind, h.side));
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
