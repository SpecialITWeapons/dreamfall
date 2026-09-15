import { describe, expect, it } from 'vitest';
import {
  AIM,
  AIRSPEED,
  CLIMB,
  DESCENT,
  MANUAL,
  MAX_ALTITUDE,
  MAX_STEP,
  MIN_CLEARANCE,
  SPEED,
  createFlightController,
  headingFromSeed,
  type FlightController,
} from '../../src/engine/flight/FlightController';
import { wrapAngle } from '../../src/engine/flight/angles';
import type { SkyPulls } from '../../src/engine/flight/SkyPulls';
import { createObstacles } from '../../src/engine/scenery/Obstacles';
import { DECK_Y } from '../../src/engine/terrain/WorldSampler';

const flat = () => 0;
const fly = (c: FlightController, seconds: number, dt = 0.05) => {
  for (let i = 0; i < seconds / dt; i++) c.step(dt);
};
/** A sky that pulls at full strength toward one heading, so a test flies a straight line. */
const hold = (heading: number): SkyPulls => ({
  events: [],
  sunrise: undefined as never,
  sunset: undefined as never,
  pull: 1,
  heading,
  released: false,
  event: null,
  isNight: () => false,
  update() {},
  release() {},
  restore() {},
});

describe('createFlightController', () => {
  it('starts 120 m over the ground with the seed heading and rejects bad steps', () => {
    const c = createFlightController({ seed: 42, groundAt: () => 30 });
    expect(c.state.y).toBe(150);
    expect(c.state.heading).toBe(headingFromSeed(42));
    expect(c.speed).toBe(SPEED);
    for (const dt of [0, -1, NaN, Infinity, MAX_STEP + 0.001]) expect(c.step(dt)).toBe(false);
    expect(c.state.t).toBe(0);
    expect(c.step(MAX_STEP)).toBe(true);
    expect(c.state.t).toBe(MAX_STEP);
  });
  it('is deterministic for a seed', () => {
    const a = createFlightController({ seed: 9, groundAt: flat }),
      b = createFlightController({ seed: 9, groundAt: flat });
    fly(a, 120);
    fly(b, 120);
    expect(a.state).toEqual(b.state);
    expect(a.state.x).not.toBe(0);
  });
  it('never flies under the clearance over a wall, and climbs for it early', () => {
    // heading pi/2 flies along +x; a 300 m step stands from x = 1000 on
    const groundAt = (x: number) => (x >= 1000 ? 300 : 0);
    const c = createFlightController({
      seed: 1,
      groundAt,
      pulls: hold(Math.PI / 2),
      start: { heading: Math.PI / 2 },
      schedule: () => 0,
    });
    const y0 = c.state.y;
    let yAt800 = 0,
      minClearance = Infinity;
    for (let i = 0; i < 1600; i++) {
      c.step(0.05);
      minClearance = Math.min(minClearance, c.clearance());
      if (yAt800 === 0 && c.state.x >= 800) yAt800 = c.state.y;
    }
    expect(minClearance).toBeGreaterThanOrEqual(MIN_CLEARANCE - 1e-9);
    // climbAhead saw the wall two kilometres out: the flight was well up before the edge
    expect(yAt800).toBeGreaterThan(y0 + 60);
    expect(yAt800).toBeGreaterThan(200);
    // 80 s of flight: short of the 3.2 km of level cruise, because the climb
    // over the wall is paid for in airspeed (AIRSPEED.perVy)
    expect(c.state.x).toBeGreaterThan(2500);
    expect(c.state.x).toBeLessThan(3200);
    // over the plateau it settles at cruise height above it
    expect(c.state.y).toBeGreaterThan(300 + MIN_CLEARANCE + 30);
    expect(c.state.y).toBeLessThan(300 + 200);
  });
  it('follows the deck schedule up and back down, never above the ceiling', () => {
    const c = createFlightController({ seed: 3, groundAt: flat, schedule: () => 1 });
    let ymax = 0;
    for (let i = 0; i < 2400; i++) {
      c.step(0.05);
      ymax = Math.max(ymax, c.state.y);
    }
    expect(ymax).toBeLessThanOrEqual(MAX_ALTITUDE);
    expect(c.state.y).toBeGreaterThan(DECK_Y + 100);
    expect(c.state.cloudSchedule).toBeCloseTo(1, 3);
    const low = createFlightController({ seed: 3, groundAt: flat, schedule: () => 0, start: { y: 900 } });
    fly(low, 120);
    expect(low.state.y).toBeLessThan(200);
    expect(low.state.y).toBeGreaterThanOrEqual(MIN_CLEARANCE);
  });
  it('crosses the deck on its own schedule within six minutes and stays clear over rolling hills', () => {
    const hills = (x: number, z: number) => 60 + 40 * Math.sin(x / 300) * Math.cos(z / 400);
    const c = createFlightController({ seed: 42, groundAt: hills });
    let above = false,
      minClearance = Infinity,
      finite = true;
    for (let i = 0; i < 7200; i++) {
      c.step(0.05);
      minClearance = Math.min(minClearance, c.clearance());
      if (c.state.y > DECK_Y) above = true;
      const s = c.state;
      for (const v of [s.x, s.y, s.z, s.heading, s.vy, s.bank, s.pitch, s.windPhase, s.gust])
        finite &&= Number.isFinite(v);
    }
    expect(finite).toBe(true);
    expect(above).toBe(true);
    expect(minClearance).toBeGreaterThanOrEqual(MIN_CLEARANCE - 1e-9);
    expect(Math.abs(c.state.bank)).toBeLessThan(1);
  });
  it('clips the aim to the envelope and hands the vertical back after release', () => {
    const c = createFlightController({ seed: 5, groundAt: flat, schedule: () => 0 });
    c.aimBy(10);
    expect(c.state.aim).toBe(AIM.up);
    expect(c.state.aimHold).toBe(1);
    c.aimBy(-20);
    expect(c.state.aim).toBe(-AIM.down);
    expect(AIM.up).toBeCloseTo(Math.asin(CLIMB / SPEED), 9);
    expect(AIM.down).toBeCloseTo(Math.asin(DESCENT / SPEED), 9);
    c.aimBy(40); // a full climb
    c.setSteering(true);
    fly(c, 20);
    expect(c.state.vy).toBeGreaterThan(CLIMB * 0.9);
    expect(c.state.y).toBeGreaterThan(250);
    c.setSteering(false);
    fly(c, AIM.release + 0.1);
    expect(c.state.aimHold).toBe(0);
    expect(c.state.aim).toBe(0);
    fly(c, 120);
    expect(c.state.y).toBeLessThan(200); // the flight took the altitude back
  });
  it('holds an aimed climb under the ceiling', () => {
    const c = createFlightController({ seed: 5, groundAt: flat, start: { y: 1300 } });
    c.aimBy(40);
    c.setSteering(true);
    let ymax = 0;
    for (let i = 0; i < 2400; i++) {
      c.step(0.05);
      ymax = Math.max(ymax, c.state.y);
    }
    expect(ymax).toBeLessThanOrEqual(MAX_ALTITUDE + 1);
  });
  it('turns whole with steering and banks into the turn', () => {
    const c = createFlightController({ seed: 2, groundAt: flat, start: { heading: 0 } });
    c.steerBy(0.5);
    c.step(0.05);
    expect(c.state.heading).toBeCloseTo(0.5, 1);
    expect(c.state.bank).toBeLessThan(0); // a left turn banks left
    fly(c, 10);
  });
  it('clears an obstacle top like ground', () => {
    const obstacles = createObstacles();
    obstacles.add({ x: 400, z: 0, ground: 0, top: 90, radius: 30 });
    const c = createFlightController({
      seed: 1,
      groundAt: flat,
      obstacles,
      pulls: hold(Math.PI / 2),
      start: { heading: Math.PI / 2, y: 60 },
      schedule: () => 0,
    });
    let minOver = Infinity;
    for (let i = 0; i < 400; i++) {
      c.step(0.05);
      if (Math.abs(c.state.x - 400) < 30) minOver = Math.min(minOver, c.state.y - 90);
    }
    expect(minOver).toBeGreaterThanOrEqual(MIN_CLEARANCE - 1e-9);
    expect(c.floorAt(400, 0)).toBe(90);
    expect(c.floorAt(0, 0)).toBe(0);
  });
  it('gusts now and then and drives the wind phase', () => {
    const c = createFlightController({ seed: 8, groundAt: flat });
    let gusts = 0,
      was = false;
    for (let i = 0; i < 2400; i++) {
      c.step(0.05);
      const is = c.state.gust > 0.5;
      if (is && !was) gusts++;
      was = is;
    }
    expect(gusts).toBeGreaterThanOrEqual(3);
    expect(c.state.windPhase).toBeGreaterThan(400);
  });
  it('continues from a remembered state', () => {
    const c = createFlightController({
      seed: 11,
      groundAt: flat,
      start: {
        x: 5000,
        z: -3000,
        y: 400,
        t: 900,
        heading: 1,
        cloudSchedule: 0.5,
        cloudOrigin: 700,
        low: { next: 1000 },
      },
    });
    expect(c.state.t).toBe(900);
    expect(c.state.x).toBe(5000);
    expect(c.state.y).toBe(400);
    expect(c.state.low).toEqual({ on: false, next: 1000, until: 0, amount: 0 });
    c.step(0.05);
    expect(c.state.t).toBeCloseTo(900.05, 9);
  });

  it('trades height for airspeed: a dive gains it, a climb spends it, both inside the clamp', () => {
    const c = createFlightController({ seed: 5, groundAt: flat, schedule: () => 0, start: { y: 900 } });
    expect(c.state.speed).toBe(SPEED);
    expect(c.speed).toBe(SPEED);
    // falling towards the cruise height from 900 m: the descent buys speed
    fly(c, 20);
    expect(c.state.vy).toBeLessThan(-2);
    expect(c.state.speed).toBeGreaterThan(SPEED + 2);
    expect(c.state.speed).toBeCloseTo(
      Math.max(AIRSPEED.min, Math.min(AIRSPEED.max, SPEED - AIRSPEED.perVy * c.state.vy)),
      0,
    );
    // a full climb on the stick spends it again
    const up = createFlightController({ seed: 5, groundAt: flat, schedule: () => 0 });
    up.setSteering(true);
    up.aimBy(AIM.up);
    fly(up, 20);
    expect(up.state.vy).toBeGreaterThan(CLIMB * 0.9);
    expect(up.state.speed).toBeLessThan(SPEED - 6);
    expect(up.state.speed).toBeGreaterThanOrEqual(AIRSPEED.min);
    // and the envelope holds at both ends whatever the pitch
    expect(c.state.speed).toBeLessThanOrEqual(AIRSPEED.max);
  });
  it('hands the flight to the pilot on an arrow, and holds course and height when they let go', () => {
    const c = createFlightController({ seed: 7, groundAt: flat, schedule: () => 0, start: { y: 600 } });
    expect(c.autopilot).toBe(true);
    fly(c, 5);
    // a turn: the autopilot is off from the first key, and the figure turns that way
    c.fly(1, 0);
    expect(c.autopilot).toBe(false);
    const heading0 = c.state.heading;
    fly(c, 4);
    expect(wrapAngle(c.state.heading - heading0)).toBeGreaterThan(MANUAL.turn * 2);
    // let go: the turn stops and the course holds
    c.fly(0, 0);
    fly(c, 6);
    const held = c.state.heading;
    fly(c, 20);
    expect(Math.abs(wrapAngle(c.state.heading - held))).toBeLessThan(0.01);
    // a climb, then let go: the height holds where the key was released
    c.fly(0, 1);
    fly(c, 8);
    expect(c.state.vy).toBeGreaterThan(CLIMB * 0.8);
    c.fly(0, 0);
    // the height at the moment the key came up is the height it settles back to:
    // the climb still has a second of momentum in it, and that overshoot is given back
    const y = c.state.y;
    fly(c, 45);
    expect(Math.abs(c.state.y - y)).toBeLessThan(3);
    expect(Math.abs(c.state.vy)).toBeLessThan(0.3);
    const settled = c.state.y;
    fly(c, 40);
    expect(Math.abs(c.state.y - settled)).toBeLessThan(0.5);
    // the autopilot never came back on its own
    expect(c.autopilot).toBe(false);
    // handing it back lets the flight wander again
    c.setAutopilot(true);
    expect(c.autopilot).toBe(true);
    fly(c, 60);
    expect(Math.abs(wrapAngle(c.state.heading - held))).toBeGreaterThan(0.01);
  });
  it('keeps the floor and the ceiling while the pilot flies by hand', () => {
    const c = createFlightController({
      seed: 11,
      groundAt: (x: number) => (x >= 1000 ? 300 : 0),
      start: { heading: Math.PI / 2, y: 120 },
      schedule: () => 0,
    });
    c.fly(0, -1); // hold the nose down all the way at the wall
    let minClearance = Infinity;
    for (let i = 0; i < 1600; i++) {
      c.step(0.05);
      minClearance = Math.min(minClearance, c.clearance());
    }
    expect(c.autopilot).toBe(false);
    expect(minClearance).toBeGreaterThanOrEqual(MIN_CLEARANCE - 1e-9);
    const up = createFlightController({ seed: 11, groundAt: flat, schedule: () => 0 });
    up.fly(0, 1); // hold the nose up forever
    fly(up, 400);
    expect(up.state.y).toBeLessThanOrEqual(MAX_ALTITUDE);
    expect(up.state.y).toBeGreaterThan(MAX_ALTITUDE - 60);
  });
  it('turns aside from a range it cannot climb, in either mode', () => {
    // a ridge across the path, higher than the ceiling, with a gap to the left (-x)
    const groundAt = (x: number, z: number) => (z > 2000 && x > -400 ? 2200 : 0);
    const c = createFlightController({
      seed: 13,
      groundAt,
      pulls: hold(0),
      start: { heading: 0, y: 300 },
      schedule: () => 0,
    });
    fly(c, 90);
    // it never crossed into the range, and it is heading away from it
    expect(groundAt(c.state.x, c.state.z)).toBe(0);
    expect(c.clearance()).toBeGreaterThanOrEqual(MIN_CLEARANCE - 1e-9);
    // the same with the pilot flying straight at it by hand
    const hand = createFlightController({
      seed: 13,
      groundAt,
      start: { heading: 0, y: 300 },
      schedule: () => 0,
    });
    hand.fly(0, 0);
    fly(hand, 90);
    expect(groundAt(hand.state.x, hand.state.z)).toBe(0);
    expect(hand.clearance()).toBeGreaterThanOrEqual(MIN_CLEARANCE - 1e-9);
  });
});
