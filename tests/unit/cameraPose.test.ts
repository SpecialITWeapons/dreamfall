import { describe, expect, it } from 'vitest';
import { cameraPoseFor } from '../../src/engine/sim/cameraPose';
import type { FlightState } from '../../src/engine/sim/Simulation';

// cameraPoseFor only reads x, y, z and heading; the rest of FlightState is
// filled with neutral values so a plain literal can stand in for the state
// the real flight controller produces.
const state = (overrides: Partial<FlightState>): FlightState => ({
  t: 0,
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  vy: 0,
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
  ...overrides,
});

describe('cameraPoseFor', () => {
  it('hangs behind and above the flyer and looks ahead of it', () => {
    const pose = cameraPoseFor(state({ x: 100, y: 120, z: 200, heading: 0 }), { back: 12, up: 4, ahead: 30 });
    expect(pose.x).toBeCloseTo(100);
    expect(pose.y).toBeCloseTo(124);
    expect(pose.z).toBeCloseTo(188);
    expect(pose.lookX).toBeCloseTo(100);
    expect(pose.lookY).toBeCloseTo(120);
    expect(pose.lookZ).toBeCloseTo(230);
  });
  it('turns with the heading', () => {
    const pose = cameraPoseFor(state({ x: 0, y: 0, z: 0, heading: Math.PI / 2 }), {
      back: 10,
      up: 0,
      ahead: 10,
    });
    expect(pose.x).toBeCloseTo(-10);
    expect(pose.z).toBeCloseTo(0);
    expect(pose.lookX).toBeCloseTo(10);
  });
});
