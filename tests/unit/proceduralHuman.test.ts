import { Mesh, Vector3, type Object3D } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { FlightPose } from '../../src/engine/avatar/Avatar';
import { DEFAULT_OUTFIT, DEFAULT_PATTERN, outfitById } from '../../src/engine/avatar/Outfits';
import {
  HUMAN_BOUNDS,
  HUMAN_TRIANGLE_BUDGET,
  TORSO,
  UPPER,
  createProceduralHuman,
} from '../../src/engine/avatar/ProceduralHuman';

// A stand-in for the world's lit material: the figure only needs something to hang its geometry on.
const lit = () => new MeshStandardNodeMaterial();
const pose = (over: Partial<FlightPose> = {}): FlightPose => ({
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  bank: 0,
  pitch: 0,
  vy: 0,
  speed: 40,
  windPhase: 0,
  gust: 0,
  view: 'tpp',
  ...over,
});
const world = (root: Object3D, name: string) => {
  root.updateMatrixWorld(true);
  return root.getObjectByName(name)!.getWorldPosition(new Vector3());
};
/** Every mesh of this name, both sides, in the figure's own frame. */
const parts = (root: Object3D, name: string) => {
  root.updateMatrixWorld(true);
  const out: Vector3[] = [];
  root.traverse((c) => {
    if (c.name === name) out.push(c.getWorldPosition(new Vector3()));
  });
  return out;
};
const meshes = (root: Object3D) => {
  const out: Mesh[] = [];
  root.traverse((c) => {
    if (c instanceof Mesh) out.push(c);
  });
  return out;
};

describe('createProceduralHuman', () => {
  it('hangs the arms on the torso rather than beside it', () => {
    const human = createProceduralHuman(lit);
    for (const side of ['shoulderL', 'shoulderR']) {
      const joint = world(human.object, side);
      // Where the torso's surface is in the direction of the joint: the
      // ellipsoid's own radius at that bearing. A joint further out than the
      // arm is thick leaves daylight between the arm and the body, which is
      // exactly what it used to do (8.3 cm of it).
      const local = joint.clone().sub(TORSO.at);
      const reach = Math.hypot(local.x / TORSO.rx, local.y / TORSO.ry, local.z / TORSO.rz);
      const gap = local.length() * (1 - 1 / reach);
      expect(gap).toBeLessThan(UPPER.r);
    }
  });

  it('stays inside the triangle budget, casts shadows, and has an eye ahead of the chest', () => {
    const human = createProceduralHuman(lit);
    expect(human.triangles).toBeLessThanOrEqual(HUMAN_TRIANGLE_BUDGET);
    expect(human.triangles).toBeGreaterThan(1500);
    expect(HUMAN_TRIANGLE_BUDGET).toBe(4000);
    expect(human.eye.z).toBeGreaterThan(0.4);
    expect(human.bounds).toEqual(HUMAN_BOUNDS);
    expect(HUMAN_BOUNDS.below).toBeGreaterThan(0);
    expect(HUMAN_BOUNDS.radius).toBeGreaterThan(0.8);
    const all = meshes(human.object);
    expect(all.length).toBe(20);
    expect(all.every((m) => m.castShadow)).toBe(true);
  });
  it('holds the box position: elbows and knees bent, hands ahead of the eye, feet above the back', () => {
    const human = createProceduralHuman(lit);
    human.update(pose(), 0.05);
    const shoulder = world(human.object, 'shoulderL'),
      elbow = world(human.object, 'elbowL'),
      hip = world(human.object, 'hipL'),
      knee = world(human.object, 'kneeL'),
      ankle = world(human.object, 'ankleL');
    // the upper arm reaches out and forward of the shoulder, the forearm turns in
    expect(elbow.x).toBeGreaterThan(shoulder.x + 0.15);
    expect(elbow.z).toBeGreaterThan(shoulder.z + 0.1);
    const upper = elbow.clone().sub(shoulder).normalize();
    const hands = parts(human.object, 'hand');
    expect(hands.length).toBe(2);
    // both hands sit ahead of the eye, so the first-person view has something to show
    for (const hand of hands) {
      expect(hand.z).toBeGreaterThan(human.eye.z + 0.1);
      expect(Math.abs(hand.x)).toBeGreaterThan(0.2);
    }
    // the elbow is a real bend, not a kink: between 60 and 110 degrees
    const forearm = hands[0]!.clone().sub(elbow).normalize();
    const elbowBend = Math.acos(Math.max(-1, Math.min(1, upper.dot(forearm))));
    expect(elbowBend).toBeGreaterThan((60 * Math.PI) / 180);
    expect(elbowBend).toBeLessThan((110 * Math.PI) / 180);
    // the thigh trails back, the knee folds so the ankle rides above the hip
    expect(knee.z).toBeLessThan(hip.z - 0.3);
    expect(ankle.y).toBeGreaterThan(hip.y + 0.25);
    const thigh = knee.clone().sub(hip).normalize(),
      shin = ankle.clone().sub(knee).normalize();
    const kneeBend = Math.acos(Math.max(-1, Math.min(1, thigh.dot(shin))));
    expect(kneeBend).toBeGreaterThan((55 * Math.PI) / 180);
    expect(kneeBend).toBeLessThan((100 * Math.PI) / 180);
    // the boots break away from the shin instead of continuing it
    const boots = parts(human.object, 'boot');
    expect(boots.length).toBe(2);
    const foot = boots[0]!.clone().sub(ankle).normalize();
    expect(Math.acos(Math.max(-1, Math.min(1, shin.dot(foot))))).toBeGreaterThan((20 * Math.PI) / 180);
  });
  it('sweeps the arms back in a dive and forward in a climb', () => {
    const human = createProceduralHuman(lit);
    const shoulderL = human.object.getObjectByName('shoulderL')!;
    human.update(pose(), 0.05);
    const level = shoulderL.quaternion.clone();
    // read the arm in the figure's own frame: the object's own pitch must not count
    const armIn = (p: Partial<FlightPose>) => {
      human.update(pose(p), 0.05);
      const q = shoulderL.quaternion.clone();
      return new Vector3(0, 1, 0).applyQuaternion(q);
    };
    const restArm = new Vector3(0, 1, 0).applyQuaternion(level);
    const dive = armIn({ pitch: -0.43 });
    const climb = armIn({ pitch: 0.55 });
    expect(dive.z).toBeLessThan(restArm.z - 0.1);
    expect(climb.z).toBeGreaterThan(restArm.z + 0.02);
  });
  it('takes the pose: position, then yaw, pitch and roll in YXZ order', () => {
    const human = createProceduralHuman(lit);
    human.update(pose({ x: 1, y: 2, z: 3, heading: 0.5, pitch: 0.1, bank: -0.2 }), 0.05);
    expect(human.object.position.toArray()).toEqual([1, 2, 3]);
    expect(human.object.rotation.order).toBe('YXZ');
    expect(human.object.rotation.y).toBeCloseTo(0.5, 9);
    expect(human.object.rotation.x).toBeCloseTo(-0.1, 9);
    expect(human.object.rotation.z).toBeCloseTo(-0.2, 9);
  });
  it('flutters its hinges with the wind, harder in a gust, and drops the inner arm in a turn', () => {
    const human = createProceduralHuman(lit);
    const shoulderL = human.object.getObjectByName('shoulderL')!,
      shoulderR = human.object.getObjectByName('shoulderR')!,
      knee = human.object.getObjectByName('kneeL')!;
    human.update(pose({ windPhase: 0 }), 0.05);
    const q0 = shoulderL.quaternion.clone(),
      k0 = knee.quaternion.clone();
    human.update(pose({ windPhase: Math.PI / 2 }), 0.05);
    const calm = q0.angleTo(shoulderL.quaternion);
    expect(calm).toBeGreaterThan(0.01);
    expect(calm).toBeLessThan(0.2);
    expect(k0.angleTo(knee.quaternion)).toBeGreaterThan(0.01);
    human.update(pose({ windPhase: 0 }), 0.05);
    const g0 = shoulderL.quaternion.clone();
    human.update(pose({ windPhase: Math.PI / 2, gust: 1 }), 0.05);
    expect(g0.angleTo(shoulderL.quaternion)).toBeGreaterThan(calm * 1.5);
    // a left turn (bank < 0) lowers the left arm (+x side) and leaves the right one alone
    human.update(pose({ windPhase: 0 }), 0.05);
    const restL = shoulderL.quaternion.clone(),
      restR = shoulderR.quaternion.clone();
    human.update(pose({ windPhase: 0, bank: -0.4 }), 0.05);
    expect(restL.angleTo(shoulderL.quaternion)).toBeGreaterThan(0.1);
    expect(restR.angleTo(shoulderR.quaternion)).toBeLessThan(0.01);
  });
  it('hides the body in the first person and keeps the forearms, unless told not to', () => {
    const human = createProceduralHuman(lit);
    human.update(pose({ view: 'fpp' }), 0.05);
    const visible = meshes(human.object).filter((m) => m.visible);
    expect(visible.length).toBe(4);
    expect(visible.every((m) => m.name === 'forearm' || m.name === 'hand')).toBe(true);
    human.update(pose({ view: 'tpp' }), 0.05);
    expect(meshes(human.object).every((m) => m.visible)).toBe(true);
    const bare = createProceduralHuman(lit, { fppHands: false });
    bare.update(pose({ view: 'fpp' }), 0.05);
    expect(meshes(bare.object).some((m) => m.visible)).toBe(false);
  });
  it('recolors with an outfit and falls back to the default for an unknown id', () => {
    const human = createProceduralHuman(lit);
    const torso = human.object.getObjectByName('torso') as Mesh;
    const before = (torso.geometry.getAttribute('color').array as Float32Array)[0]!;
    human.setOutfit({ ...DEFAULT_OUTFIT, id: 'test', suit: 0xff0000 }, DEFAULT_PATTERN);
    const after = torso.geometry.getAttribute('color').array as Float32Array;
    expect(after[0]).toBeCloseTo(1, 6);
    expect(after[1]).toBeCloseTo(0, 6);
    expect(after[0]).not.toBe(before);
    expect(outfitById('nope')).toBe(DEFAULT_OUTFIT);
    human.dispose();
  });
});
