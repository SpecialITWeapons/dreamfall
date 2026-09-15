import { describe, expect, it } from 'vitest';
import { FPP, TPP, bodyToWorld, createChaseCamera } from '../../src/engine/flight/ChaseCamera';
import type { FlightState } from '../../src/engine/flight/FlightController';
import { ORBIT } from '../../src/engine/flight/Steering';

const state = (over: Partial<FlightState> = {}): FlightState => ({
  t: 0,
  x: 100,
  y: 200,
  z: 300,
  heading: 0,
  vy: 0,
  speed: 40,
  bank: 0,
  pitch: 0,
  yawRate: 0,
  nudgeYaw: 0,
  nudgeAlt: 0,
  steer: 0,
  aim: 0,
  aimHold: 0,
  windPhase: 0,
  gust: 0,
  gustBurst: 0,
  gustTimer: 0,
  cloudSchedule: 0,
  cloudOrigin: 0,
  low: { on: false, next: 0, until: 0, amount: 0 },
  ...over,
});
const orbit = { yaw: 0, pitch: ORBIT.pitch, dist: ORBIT.dist };
const look = { yaw: 0, pitch: 0 };
const eye = { x: 0, y: -0.03, z: 0.56 };
const flat = () => 0;

describe('bodyToWorld', () => {
  it('turns a body point through heading, pitch and bank', () => {
    const out = { x: 0, y: 0, z: 0 };
    bodyToWorld({ x: 0, y: 0, z: 1 }, state({ heading: Math.PI / 2 }), out);
    expect(out.x).toBeCloseTo(101, 9);
    expect(out.z).toBeCloseTo(300, 9);
    bodyToWorld({ x: 0, y: 0, z: 1 }, state({ pitch: Math.PI / 2 }), out);
    expect(out.y).toBeCloseTo(201, 9); // nose up lifts what is ahead
    expect(out.z).toBeCloseTo(300, 9);
    bodyToWorld({ x: 1, y: 0, z: 0 }, state({ bank: -Math.PI / 2 }), out);
    expect(out.y).toBeCloseTo(199, 9); // a left bank lowers the left side (+x)
  });
});

describe('createChaseCamera', () => {
  it('hangs behind and above the figure in the third person and looks a little above it', () => {
    const chase = createChaseCamera();
    const pose = chase.update({ state: state(), view: 'tpp', orbit, look, eye, floorAt: flat, dt: 0.05 });
    const cp = Math.cos(ORBIT.pitch);
    expect(pose.x).toBeCloseTo(100, 9);
    expect(pose.z).toBeCloseTo(300 - cp * ORBIT.dist, 9); // behind a heading of 0 (+z) is -z
    expect(pose.y).toBeCloseTo(200 + Math.sin(ORBIT.pitch) * ORBIT.dist, 9);
    expect([pose.lookX, pose.lookY, pose.lookZ]).toEqual([100, 200 + TPP.lookRise, 300]);
    expect(pose.fov).toBe(55);
    expect(pose.near).toBe(TPP.near);
    expect(pose.roll).toBe(0);
  });
  it('orbits with the yaw and lifts over ground and obstacles, settling back slowly', () => {
    const chase = createChaseCamera();
    let pose = chase.update({
      state: state(),
      view: 'tpp',
      orbit: { ...orbit, yaw: Math.PI },
      look,
      eye,
      floorAt: flat,
      dt: 0.05,
    });
    expect(pose.z).toBeGreaterThan(300); // yaw pi puts the camera ahead
    const high = () => 300;
    pose = chase.update({ state: state(), view: 'tpp', orbit, look, eye, floorAt: high, dt: 0.05 });
    expect(pose.y).toBeGreaterThanOrEqual(300 + TPP.settle);
    for (let i = 0; i < 40; i++)
      pose = chase.update({ state: state(), view: 'tpp', orbit, look, eye, floorAt: high, dt: 0.05 });
    expect(pose.y).toBeCloseTo(300 + TPP.clearance, 2);
    const lifted = chase.lift;
    chase.update({ state: state(), view: 'tpp', orbit, look, eye, floorAt: flat, dt: 0.05 });
    expect(chase.lift).toBeLessThan(lifted);
    expect(chase.lift).toBeGreaterThan(lifted * 0.8);
  });
  it('sits in the eye in the first person, faces the course plus the look, rolls with a share of the bank, bobs', () => {
    const chase = createChaseCamera();
    const s = state({ heading: 1, bank: -0.5, windPhase: Math.PI / 2 });
    const pose = chase.update({
      state: s,
      view: 'fpp',
      orbit,
      look: { yaw: 0.3, pitch: 0.2 },
      eye,
      floorAt: flat,
      dt: 0.05,
    });
    const world = bodyToWorld(eye, s, { x: 0, y: 0, z: 0 });
    expect(pose.x).toBeCloseTo(world.x, 9);
    expect(pose.z).toBeCloseTo(world.z, 9);
    expect(pose.y).toBeCloseTo(world.y + FPP.bob, 9);
    const dx = pose.lookX - pose.x,
      dz = pose.lookZ - pose.z,
      dy = pose.lookY - pose.y;
    expect(Math.atan2(dx, dz)).toBeCloseTo(1.3, 9);
    expect(Math.atan2(dy, Math.hypot(dx, dz))).toBeCloseTo(0.2, 9);
    expect(pose.roll).toBeCloseTo(0.5 * FPP.bankShare, 9);
    expect(pose.fov).toBe(75);
    expect(pose.near).toBe(0.1);
    const still = chase.update({
      state: s,
      view: 'fpp',
      orbit,
      look,
      eye,
      floorAt: flat,
      dt: 0.05,
      reducedMotion: true,
    });
    expect(still.y).toBeCloseTo(world.y, 9);
    expect(chase.lift).toBe(0);
  });
});
