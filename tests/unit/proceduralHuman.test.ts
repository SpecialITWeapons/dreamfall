import { Mesh, type Object3D } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { FlightPose } from '../../src/engine/avatar/Avatar';
import { DEFAULT_OUTFIT, DEFAULT_PATTERN, outfitById } from '../../src/engine/avatar/Outfits';
import {
  HUMAN_BOUNDS,
  HUMAN_TRIANGLE_BUDGET,
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
const meshes = (root: Object3D) => {
  const out: Mesh[] = [];
  root.traverse((c) => {
    if (c instanceof Mesh) out.push(c);
  });
  return out;
};

describe('createProceduralHuman', () => {
  it('stays inside the triangle budget, casts shadows, and has an eye ahead of the chest', () => {
    const human = createProceduralHuman(lit);
    expect(human.triangles).toBeLessThanOrEqual(HUMAN_TRIANGLE_BUDGET);
    expect(human.triangles).toBeGreaterThan(1500);
    expect(HUMAN_TRIANGLE_BUDGET).toBe(4000);
    expect(human.eye.z).toBeGreaterThan(0.4);
    expect(human.bounds).toEqual(HUMAN_BOUNDS);
    expect(HUMAN_BOUNDS.below).toBeGreaterThan(0);
    expect(HUMAN_BOUNDS.radius).toBeGreaterThan(0.8);
    const parts = meshes(human.object);
    expect(parts.length).toBe(17);
    expect(parts.every((m) => m.castShadow)).toBe(true);
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
