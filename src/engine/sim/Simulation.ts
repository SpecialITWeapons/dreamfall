// Flight simulation: pure CPU, no Three.js and no DOM, so it can be
// tested in Node and someday moved to a worker thread. In M0 the figure
// flies straight, at a constant altitude, at a constant speed.

export interface FlightState {
  t: number;
  x: number;
  y: number;
  z: number;
  heading: number;
}

export interface Simulation {
  readonly state: FlightState;
  readonly speed: number;
  /** Advances the world by dt seconds; false when the step is invalid and was skipped. */
  step(dt: number): boolean;
}

/** Longest simulation step; a longer frame is clamped by the loop. */
export const MAX_STEP = 0.05;

/** Starting heading from the seed: different worlds fly in different directions, the same world always the same. */
export function headingFromSeed(seed: number): number {
  return ((Math.imul(seed >>> 0, 0x9e3779b1) >>> 0) / 0x1_0000_0000) * Math.PI * 2;
}

export function createSimulation(opts: { seed: number; speed?: number; altitude?: number }): Simulation {
  const speed = opts.speed ?? 40;
  const state: FlightState = {
    t: 0,
    x: 0,
    y: opts.altitude ?? 120,
    z: 0,
    heading: headingFromSeed(opts.seed),
  };
  return {
    state,
    speed,
    step(dt) {
      if (!Number.isFinite(dt) || dt <= 0 || dt > MAX_STEP) return false;
      state.t += dt;
      state.x += Math.sin(state.heading) * speed * dt;
      state.z += Math.cos(state.heading) * speed * dt;
      return true;
    },
  };
}
