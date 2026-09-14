import { describe, expect, it } from 'vitest';
import { MAX_STEP, createSimulation, headingFromSeed } from '../../src/engine/sim/Simulation';

describe('createSimulation', () => {
  it('flies straight ahead at its speed', () => {
    const sim = createSimulation({ seed: 0, speed: 40 });
    const { heading } = sim.state;
    expect(sim.step(0.025)).toBe(true);
    expect(sim.state.t).toBeCloseTo(0.025);
    expect(sim.state.x).toBeCloseTo(Math.sin(heading) * 1, 9);
    expect(sim.state.z).toBeCloseTo(Math.cos(heading) * 1, 9);
    expect(sim.state.y).toBe(120);
  });
  it('rejects a non-positive, non-finite or oversized step', () => {
    const sim = createSimulation({ seed: 1 });
    for (const dt of [0, -0.01, NaN, Infinity, MAX_STEP + 0.001]) expect(sim.step(dt)).toBe(false);
    expect(sim.state.t).toBe(0);
  });
  it('takes its heading from the seed, deterministically', () => {
    expect(createSimulation({ seed: 42 }).state.heading).toBe(headingFromSeed(42));
    expect(headingFromSeed(42)).toBe(headingFromSeed(42));
    expect(headingFromSeed(42)).not.toBe(headingFromSeed(43));
    expect(headingFromSeed(42)).toBeGreaterThanOrEqual(0);
    expect(headingFromSeed(42)).toBeLessThan(Math.PI * 2);
  });
  it('defaults to 40 m/s at 120 m', () => {
    const sim = createSimulation({ seed: 5 });
    expect(sim.speed).toBe(40);
    expect(sim.state.y).toBe(120);
  });
});
