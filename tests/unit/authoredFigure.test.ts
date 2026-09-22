import { Euler, Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { FlightPose } from '../../src/engine/avatar/Avatar';
import { createAuthoredFigure } from '../../src/engine/avatar/AuthoredFigure';
import { createPosture } from '../../src/engine/avatar/Posture';
import { SPEED } from '../../src/engine/flight/FlightController';

/**
 * A CMU skeleton made of bones rather than of a megabyte of .glb, and every
 * one of them wearing a rest rotation of its own. That is the whole point of
 * the fixture: the retarget's arithmetic must not assume that anything starts
 * at identity, because on the real figure nothing does.
 */
const TREE: Record<string, readonly string[]> = {
  Hips: ['LowerBack', 'LHipJoint', 'RHipJoint'],
  LowerBack: ['Spine'],
  Spine: ['Spine1'],
  Spine1: ['LeftShoulder', 'RightShoulder', 'Neck'],
  LeftShoulder: ['LeftArm'],
  LeftArm: ['LeftForeArm'],
  RightShoulder: ['RightArm'],
  RightArm: ['RightForeArm'],
  Neck: ['Neck1'],
  Neck1: ['Head'],
  LHipJoint: ['LeftUpLeg'],
  LeftUpLeg: ['LeftLeg'],
  LeftLeg: ['LeftFoot'],
  RHipJoint: ['RightUpLeg'],
  RightUpLeg: ['RightLeg'],
  RightLeg: ['RightFoot'],
};

const skeleton = () => {
  let n = 0;
  const build = (name: string): Object3D => {
    const bone = new Object3D();
    bone.name = name;
    // Nothing tidy: a spread of angles and offsets no formula here could
    // accidentally agree with.
    n += 1;
    bone.quaternion.setFromEuler(new Euler(0.11 * n, -0.07 * n, 0.19 * n, 'XYZ'));
    bone.position.set(0, 0.1 + 0.01 * n, 0);
    for (const child of TREE[name] ?? []) bone.add(build(child));
    return bone;
  };
  const root = new Object3D();
  root.add(build('Hips'));
  return root;
};

const pose = (over: Partial<FlightPose> = {}): FlightPose => ({
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  bank: 0,
  pitch: 0,
  vy: 0,
  speed: SPEED,
  windPhase: 0,
  gust: 0,
  view: 'tpp',
  ...over,
});

/**
 * Where a bone faces **in the figure's own frame** -- x left, y up, z ahead --
 * which is the frame the posture speaks. Not the scene's: `object` carries the
 * flight's own pitch, heading and bank, so a bone's world rotation is the
 * figure's pose with the whole flight laid on top of it.
 */
const worldOf = (figure: { object: Object3D }, name: string) => {
  figure.object.updateMatrixWorld(true);
  const inFigure = figure.object.getWorldQuaternion(new Quaternion()).invert();
  return inFigure.multiply(figure.object.getObjectByName(name)!.getWorldQuaternion(new Quaternion()));
};

describe('createAuthoredFigure', () => {
  it('refuses a skeleton that is not a CMU one, by name', () => {
    const stripped = skeleton();
    stripped.getObjectByName('LeftForeArm')!.name = 'arm.L';
    expect(() => createAuthoredFigure(stripped)).toThrow(/LeftForeArm/);
  });

  it('puts the upper arm exactly where the posture says, however far the back is arched', () => {
    // A hard dive: the spine is bent about as far as this figure ever bends it.
    const dive = pose({ vy: -20, pitch: -0.4, speed: SPEED * 1.4, bank: 0.3 });
    const figure = createAuthoredFigure(skeleton());
    figure.update(dive, 0);
    const expected = createPosture({ spine: true });
    expected.update(dive, 0);
    for (const [side, bone] of [
      [1, 'LeftArm'],
      [-1, 'RightArm'],
    ] as const) {
      // This is the invariant the whole retarget rests on. The arm hangs off a
      // collarbone that hangs off a spine that is bending, and `POSE`'s
      // thresholds were measured against the flight's envelope rather than
      // against an arm an arched back had already carried somewhere else.
      expect(worldOf(figure, bone).angleTo(expected.world('shoulder', side))).toBeLessThan(1e-6);
    }
  });

  it('the collarbone goes about a quarter of the way with the arm', () => {
    const rest = createAuthoredFigure(skeleton());
    rest.update(pose(), 0);
    const restArm = worldOf(rest, 'LeftArm');
    const restCollar = worldOf(rest, 'LeftShoulder');

    const track = pose({ vy: -20, pitch: -0.4, speed: SPEED * 1.45 });
    const moved = createAuthoredFigure(skeleton());
    moved.update(track, 0);
    const travelled = restArm.angleTo(worldOf(moved, 'LeftArm'));
    const carried = restCollar.angleTo(worldOf(moved, 'LeftShoulder'));
    expect(travelled).toBeGreaterThan(0.25);
    // Not exact: the collarbone also rides the spine, which is arching under
    // it, and the arm's travel is measured against a rest the spine has since
    // left. A quarter and change is the shape of it, and nought or a half
    // would both be the fault worth catching.
    expect(carried / travelled).toBeGreaterThan(0.12);
    expect(carried / travelled).toBeLessThan(0.45);
  });

  it('the joints under a driven bone wear the posture as it comes', () => {
    const flight = pose({ vy: -12, pitch: -0.3, speed: SPEED * 1.2, bank: -0.2 });
    const figure = createAuthoredFigure(skeleton());
    figure.update(flight, 0);
    const expected = createPosture({ spine: true });
    expected.update(flight, 0);
    for (const [bone, kind, side] of [
      ['LeftForeArm', 'elbow', 1],
      ['RightLeg', 'knee', -1],
      ['LeftFoot', 'ankle', 1],
    ] as const) {
      const local = figure.object.getObjectByName(bone)!.quaternion;
      expect(local.angleTo(expected.local(kind, side))).toBeLessThan(1e-6);
    }
  });

  it('a level glide leaves the back straight and the head square', () => {
    const figure = createAuthoredFigure(skeleton());
    const straight = skeleton();
    figure.update(pose(), 0);
    for (const bone of ['LowerBack', 'Spine', 'Spine1', 'Neck', 'Neck1', 'Head']) {
      const now = figure.object.getObjectByName(bone)!.quaternion;
      expect(now.angleTo(straight.getObjectByName(bone)!.quaternion)).toBeLessThan(1e-6);
    }
  });

  it('reports an eye ahead of and under the body, where a face-down flyer has one', () => {
    const figure = createAuthoredFigure(skeleton());
    expect(figure.eye.z).toBeGreaterThan(0.5);
    expect(figure.eye.y).toBeLessThan(0);
    expect(figure.bounds.below).toBeGreaterThan(0);
    expect(new Vector3().copy(figure.eye).length()).toBeLessThan(1);
  });
});
