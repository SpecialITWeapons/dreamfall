import { describe, expect, it } from 'vitest';
import { createFlightController } from '../../src/engine/flight/FlightController';
import { LOOK, ORBIT, TURN_PER_PIXEL, createSteering } from '../../src/engine/flight/Steering';

const flight = () => createFlightController({ seed: 1, groundAt: () => 0, start: { heading: 0 } });

describe('createSteering', () => {
  it('orbits the camera with the left button and reports a framing worth remembering', () => {
    const s = createSteering(flight());
    expect(s.orbit).toEqual({ yaw: 0, pitch: ORBIT.pitch, dist: ORBIT.dist });
    expect(s.view).toBe('tpp');
    expect(s.pointerDown(0, 100, 100)).toBe(true);
    expect(s.dragging).toBe(true);
    s.pointerMove(150, 120);
    expect(s.orbit.yaw).toBeCloseTo(-50 * TURN_PER_PIXEL, 9);
    expect(s.orbit.pitch).toBeCloseTo(ORBIT.pitch + 20 * TURN_PER_PIXEL, 9);
    expect(s.pointerUp()).toBe(true);
    expect(s.pointerUp()).toBe(false);
    s.pointerDown(0, 0, 0);
    s.pointerMove(0, 10000);
    expect(s.orbit.pitch).toBe(ORBIT.maxPitch);
    s.pointerUp();
  });
  it('steers with the right button or a touch: turns, aims, releases the sky, lets the vertical go on release', () => {
    const f = flight();
    const s = createSteering(f);
    expect(s.pointerDown(1, 0, 0)).toBe(false);
    expect(s.pointerDown(2, 100, 100)).toBe(true);
    expect(s.held).toBe(true);
    expect(f.held).toBe(true);
    s.pointerMove(125, 90);
    expect(f.state.steer).toBeCloseTo(-25 * TURN_PER_PIXEL, 9);
    expect(f.state.aim).toBeCloseTo(10 * TURN_PER_PIXEL, 9);
    expect(f.state.aimHold).toBe(1);
    expect(s.orbit.pitch).toBeCloseTo(ORBIT.pitch - 10 * TURN_PER_PIXEL, 9);
    s.pointerUp();
    expect(f.held).toBe(false);
    expect(s.held).toBe(false);
    expect(s.pointerDown(0, 0, 0, true)).toBe(true);
    expect(s.dragButton).toBe(2);
    s.pointerUp();
  });
  it('turns the figure to face the camera while steering, and leaves the orbit where it was put', () => {
    const f = flight();
    const s = createSteering(f, { orbit: { yaw: 1 } });
    s.pointerDown(2, 0, 0);
    s.update(0.05);
    expect(s.orbit.yaw).toBeCloseTo(0.8, 9);
    expect(f.state.steer).toBeCloseTo(0.2, 9);
    s.pointerUp();
    s.update(1);
    expect(s.orbit.yaw).toBeCloseTo(0.8, 9);
  });
  it('zooms with the wheel inside the range', () => {
    const s = createSteering(flight());
    s.wheel(120);
    expect(s.orbit.dist).toBeCloseTo(ORBIT.dist * Math.exp(120 * 0.0012), 9);
    for (let i = 0; i < 50; i++) s.wheel(500);
    expect(s.orbit.dist).toBe(ORBIT.maxDist);
    for (let i = 0; i < 50; i++) s.wheel(-500);
    expect(s.orbit.dist).toBe(ORBIT.minDist);
  });
  it('maps keys to pause, view and nudges', () => {
    const f = flight();
    const s = createSteering(f);
    expect(s.key('Space')).toBe('pause');
    expect(s.key('KeyV')).toBe('view');
    expect(s.view).toBe('fpp');
    expect(s.key('KeyV')).toBe('view');
    expect(s.view).toBe('tpp');
    expect(s.key('ArrowLeft')).toBe('nudge');
    expect(f.state.nudgeYaw).toBe(0.4);
    expect(s.key('ArrowRight')).toBe('nudge');
    expect(f.state.nudgeYaw).toBe(-0.4);
    expect(s.key('ArrowUp')).toBe('nudge');
    expect(f.state.nudgeAlt).toBe(200);
    expect(s.key('ArrowDown')).toBe('nudge');
    expect(f.state.nudgeAlt).toBe(-180);
    expect(s.key('KeyQ')).toBe(null);
  });
  it('looks around in the first person and returns to the course in about a second and a half', () => {
    const s = createSteering(flight(), { view: 'fpp' });
    s.pointerDown(0, 0, 0);
    s.pointerMove(-100000, 100000);
    expect(s.look.yaw).toBe(LOOK.yaw);
    expect(s.look.pitch).toBe(-LOOK.pitch);
    s.update(0.05);
    expect(s.look.yaw).toBe(LOOK.yaw); // held: no return
    s.pointerUp();
    for (let i = 0; i < 30; i++) s.update(0.05);
    expect(Math.abs(s.look.yaw)).toBeLessThan(LOOK.yaw * 0.06);
    for (let i = 0; i < 60; i++) s.update(0.05);
    expect(s.look.yaw).toBe(0);
    expect(s.look.pitch).toBe(0);
    s.view = 'tpp';
    expect(s.view).toBe('tpp');
  });
  it('clamps a remembered orbit into the range', () => {
    const s = createSteering(flight(), { orbit: { yaw: 10, pitch: 5, dist: 1000 } });
    expect(s.orbit.dist).toBe(ORBIT.maxDist);
    expect(s.orbit.pitch).toBe(ORBIT.maxPitch);
    expect(Math.abs(s.orbit.yaw)).toBeLessThanOrEqual(Math.PI);
  });
});
