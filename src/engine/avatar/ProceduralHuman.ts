// The first figure: a skydiver's arch from ellipsoids and capsules with
// vertex colors on the world's lit material, hinged at the shoulders,
// elbows, hips, knees and ankles. The rest pose is the box position a belly-
// to-earth jumper holds: upper arms out and forward, elbows squared, thighs
// spread back, knees folded so the feet ride above the hips, toes pointed.
// The hinges flutter with the wind and a slow noise, a gust is a burst of
// stronger flutter, the inner arm drops in a turn, and the climb angle sweeps
// the arms: back into a track in a dive, forward and wide in a climb.
// Nothing here is a skeleton: the Avatar interface lets a skinned model
// replace it without touching the engine. Budget: 4 000 triangles.
import {
  CapsuleGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { vertexColor } from 'three/tsl';
import type { LitMaterial } from '../render/SoftLighting';
import { perlin2 } from '../terrain/noise';
import type { Avatar, FlightPose } from './Avatar';
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
const IDENTITY = new Quaternion();

/** Fills the color attribute with one color; writes into the existing buffer when there is one, so a repaint is an upload, not a new buffer. */
function paint(geometry: BufferGeometry, hex: number): BufferGeometry {
  const color = new Color(hex);
  const count = geometry.getAttribute('position').count;
  const existing = geometry.getAttribute('color');
  const colors = existing ? (existing.array as Float32Array) : new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  if (existing) existing.needsUpdate = true;
  else geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}
function ellipsoid(rx: number, ry: number, rz: number, segments = 16, rings = 10): BufferGeometry {
  const g = new SphereGeometry(1, segments, rings);
  g.scale(rx, ry, rz);
  return g;
}
/** A limb from its joint at the origin along +y; the far joint sits at y = length. */
function limb(radius: number, length: number): BufferGeometry {
  const g = new CapsuleGeometry(radius, length, 4, 8);
  g.translate(0, length / 2, 0);
  return g;
}

interface Hinge {
  pivot: Group;
  rest: Quaternion;
  /** Where a full dive takes this joint, when it has somewhere else to be. */
  track?: Quaternion;
  /** Orientation in the figure's frame, for the child hinge's rest. */
  world: Quaternion;
  side: 1 | -1;
  kind: 'shoulder' | 'elbow' | 'hip' | 'knee' | 'ankle';
}

export function createProceduralHuman(
  litMaterial: LitMaterial,
  opts: { fppHands?: boolean; outfit?: Outfit; pattern?: Pattern } = {},
): ProceduralHuman {
  const fppHands = opts.fppHands ?? true;
  let outfit = opts.outfit ?? DEFAULT_OUTFIT;
  let pattern = opts.pattern ?? DEFAULT_PATTERN;
  const material = litMaterial(vertexColor().rgb);
  const meshes: Mesh[] = [];
  const bySwatch: Record<Swatch, Mesh[]> = {
    suit: [],
    trim: [],
    helmet: [],
    goggles: [],
    boots: [],
    gloves: [],
    skin: [],
  };
  const hands = new Set<Mesh>();
  let triangles = 0;
  const part = (
    name: string,
    geometry: BufferGeometry,
    swatch: Swatch,
    parent: Object3D,
    x = 0,
    y = 0,
    z = 0,
  ) => {
    const mesh = new Mesh(paint(geometry, outfit[swatch]), material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    meshes.push(mesh);
    bySwatch[swatch].push(mesh);
    triangles += (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
    return mesh;
  };
  const object = new Group();
  object.name = 'human';
  object.rotation.order = 'YXZ';
  const body = new Group();
  object.add(body);
  part('torso', ellipsoid(TORSO.rx, TORSO.ry, TORSO.rz), 'suit', body, TORSO.at.x, TORSO.at.y, TORSO.at.z);
  part('pelvis', ellipsoid(0.18, 0.12, 0.16), 'suit', body, 0, -0.01, -0.3);
  const head = new Group();
  head.position.set(0, 0.02, 0.42);
  body.add(head);
  // The helmet is a shell over the skull and the back of the head, sized so the
  // face stays outside it; the goggles are a band wider than the shell and the
  // peak sits proud above them, so from behind and from the side the head reads
  // as a helmet rather than as one more ball.
  part('head', ellipsoid(0.105, 0.105, 0.105, 12, 8), 'skin', head, 0, -0.01, 0.055);
  part('helmet', ellipsoid(0.125, 0.115, 0.125), 'helmet', head, 0, 0.02, 0);
  part('visor', ellipsoid(0.113, 0.026, 0.05, 12, 8), 'helmet', head, 0, 0.062, 0.105);
  part('goggles', ellipsoid(0.115, 0.042, 0.075, 12, 8), 'goggles', head, 0, 0.005, 0.085);
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
    const pivot = new Group();
    pivot.name = name;
    pivot.position.copy(at);
    pivot.quaternion.copy(rest);
    parent.add(pivot);
    const h: Hinge = { pivot, rest, track, world, side, kind };
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
    // The cap rides on the joint, so it turns with the arm as a deltoid does
    // and closes the seam at every sweep rather than only at rest.
    // The whole arm is what the first person keeps: a forearm on its own hangs
    // in the air with nothing joining it to the viewer, and the cap is what
    // makes the shoulder end of it something rather than a cut.
    hands.add(part('deltoid', ellipsoid(0.075, 0.075, 0.075, 12, 8), 'suit', shoulder.pivot));
    hands.add(part('upperArm', limb(UPPER.r, UPPER.len), 'suit', shoulder.pivot));
    const elbow = hinge(
      'elbow',
      `elbow${s}`,
      shoulder.pivot,
      new Vector3(0, UPPER.len, 0),
      foreDir(side),
      shoulder,
      side,
    );
    hands.add(part('forearm', limb(FORE.r, FORE.len), 'trim', elbow.pivot));
    hands.add(
      part('hand', ellipsoid(0.045, 0.09, 0.03, 12, 8), 'gloves', elbow.pivot, 0, FORE.len + 0.05, 0),
    );
    const hip = hinge('hip', `hip${s}`, body, HIP.clone().setX(side * HIP.x), thighDir(side), null, side);
    part('thigh', limb(THIGH.r, THIGH.len), 'suit', hip.pivot);
    const knee = hinge('knee', `knee${s}`, hip.pivot, new Vector3(0, THIGH.len, 0), shinDir(side), hip, side);
    part('shin', limb(SHIN.r, SHIN.len), 'suit', knee.pivot);
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
    part('boot', ellipsoid(FOOT.rx, FOOT.ry, FOOT.rz, 12, 8), 'boots', ankle.pivot, 0, FOOT.ry * 0.8, 0);
  }
  const qx = new Quaternion(),
    qy = new Quaternion(),
    qz = new Quaternion();
  let time = 0;
  let view: FlightPose['view'] | null = null;
  return {
    object,
    eye: new Vector3(0, -0.03, 0.56),
    bounds: HUMAN_BOUNDS,
    get triangles() {
      return triangles;
    },
    update(pose, dt) {
      time += dt;
      object.position.set(pose.x, pose.y, pose.z);
      object.rotation.set(-pose.pitch, pose.heading, pose.bank);
      // the hinges: wind flutter, stronger in a gust, plus a slow drift; the inner arm drops in a turn
      const flutter = 0.05 + 0.09 * pose.gust;
      const slow = perlin2(time * 0.15, 0.37, 11) * 0.05;
      const w = pose.windPhase;
      // The air the figure meets: a dive sweeps the arms back into a track and
      // straightens the knees, a climb spreads the arms forward and wide. Both
      // are rotations around the figure's own up axis, so the arms travel in
      // the plane of the shoulders instead of flapping.
      const dive = Math.min(Math.max(-pose.pitch, 0), TRACK.at) / TRACK.at;
      // A climb still spreads the arms about the up axis; only the dive has
      // somewhere specific to be.
      const sweep = -Math.min(Math.max(pose.pitch, 0), 0.6) * 0.32;
      const straighten = dive * TRACK.elbow;
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
            swing = Math.sin(w * 0.8 + 1.1 + phase) * flutter * 0.7 + slow;
            break;
          case 'knee':
            swing = Math.sin(w * 1.1 + 2.4 + phase) * flutter * 1.4 - dive * TRACK.knee;
            break;
          case 'ankle':
            swing = Math.sin(w * 1.1 + 3.6 + phase) * flutter * 0.8;
            break;
        }
        h.pivot.quaternion.copy(h.rest);
        if (h.track && dive > 0) h.pivot.quaternion.slerp(h.track, dive);
        // Straightening is a walk of the joint's own bend back toward none of
        // it, so the forearm ends up along the upper arm whatever direction the
        // upper arm is pointing by then.
        if (h.kind === 'elbow' && straighten > 0) h.pivot.quaternion.slerp(IDENTITY, straighten);
        h.pivot.quaternion
          .premultiply(qz.setFromAxisAngle(AXIS_Z, -h.side * drop))
          .premultiply(qy.setFromAxisAngle(AXIS_Y, h.side * back))
          .premultiply(qx.setFromAxisAngle(AXIS_X, swing));
      }
      if (pose.view !== view) {
        view = pose.view;
        for (const m of meshes) m.visible = view === 'tpp' || (fppHands && hands.has(m));
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
      for (const swatch of Object.keys(bySwatch) as Swatch[])
        for (const m of bySwatch[swatch]) paint(m.geometry, outfit[swatch]);
    },
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      material.dispose();
    },
  };
}
