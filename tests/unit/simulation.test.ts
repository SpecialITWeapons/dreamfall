import { describe, expect, it } from 'vitest';
import { AIRSPEED, SPEED, headingFromSeed } from '../../src/engine/flight/FlightController';
import { MAX_STEP, createSimulation } from '../../src/engine/sim/Simulation';
import { DAY_SECONDS } from '../../src/engine/time/DayClock';

describe('createSimulation', () => {
  it('steps the flight and the day clock together, and rejects bad steps', () => {
    const sim = createSimulation({ seed: 42, groundAt: () => 0 });
    expect(sim.seed).toBe(42);
    expect(sim.clock.phase).toBe(0.3);
    expect(sim.state.heading).toBe(headingFromSeed(42));
    expect(sim.state.y).toBe(120);
    for (const dt of [0, -0.01, NaN, Infinity, MAX_STEP + 0.001]) expect(sim.step(dt)).toBe(false);
    expect(sim.state.t).toBe(0);
    expect(sim.clock.phase).toBe(0.3);
    expect(sim.step(MAX_STEP)).toBe(true);
    expect(sim.state.t).toBe(MAX_STEP);
    expect(sim.clock.phase).toBeCloseTo(0.3 + MAX_STEP / DAY_SECONDS, 9);
    // airspeed is live now: it starts level and follows the climb from there
    expect(sim.speed).toBeCloseTo(SPEED, 1);
    for (let i = 0; i < 400; i++) sim.step(0.05);
    expect(sim.speed).toBe(sim.state.speed);
    expect(sim.speed).toBeGreaterThanOrEqual(AIRSPEED.min);
    expect(sim.speed).toBeLessThanOrEqual(AIRSPEED.max);
  });
  it('snapshots the flight and resumes from the snapshot, phase and release included', () => {
    const a = createSimulation({ seed: 7, groundAt: () => 0 });
    // 6000 steps (300 s) carries the day clock from its 0.3 start into the
    // moonrise pull's window (~[270.60 s, 324.45 s) from that start, followed
    // immediately by sunset's ~[324.45 s, 368.60 s)), so there is an actual
    // event for release() to act on; fewer steps land in broad daylight,
    // where release() is a no-op (see plan-defects.md, Task 3).
    for (let i = 0; i < 6000; i++) a.step(0.05);
    a.pulls.release();
    const memory = a.snapshot();
    expect(memory.seed).toBe(7);
    expect(memory.t).toBeCloseTo(300, 6);
    expect(memory.dayPhase).toBeCloseTo(0.3 + 300 / DAY_SECONDS, 9);
    expect(memory.low).toEqual(a.state.low);
    expect(memory.low).not.toBe(a.state.low);
    const b = createSimulation({ seed: 7, groundAt: () => 0, resume: memory });
    expect(b.clock.phase).toBe(memory.dayPhase);
    expect(b.state.x).toBe(memory.x);
    expect(b.state.y).toBe(memory.y);
    expect(b.state.t).toBe(memory.t);
    expect(b.state.cloudOrigin).toBe(memory.cloudOrigin);
    expect(b.pulls.released).toBe(true);
    b.step(0.05);
    expect(b.state.t).toBeCloseTo(300.05, 6);
    expect(createSimulation({ seed: 7, groundAt: () => 0, resume: null }).state.t).toBe(0);
  });
  it('flies 200 km over rolling ground and keeps every number finite and inside the envelope', () => {
    const sim = createSimulation({
      seed: 42,
      groundAt: (x, z) => 30 + 20 * Math.sin(x / 700) * Math.sin(z / 900),
    });
    const steps = Math.ceil(200_000 / 40 / MAX_STEP);
    for (let i = 0; i < steps; i++) sim.step(MAX_STEP);
    const { x, y, z, heading, vy, bank, pitch } = sim.state;
    expect(sim.state.t).toBeCloseTo(steps * MAX_STEP, 6);
    for (const v of [x, y, z, heading, vy, bank, pitch]) expect(Number.isFinite(v)).toBe(true);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThanOrEqual(1400);
    expect(Math.abs(heading)).toBeLessThanOrEqual(Math.PI);
  }, 60_000);
});
