// Flight simulation: pure CPU, no Three.js and no DOM, so it can be tested in
// Node and someday moved to a worker thread. In M1 the figure flies straight
// at a constant speed and holds a height over the ground it is given; the
// full controller (look-ahead along the turn, cloud schedule, steering)
// arrives in M2 and replaces the altitude rule below.

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
/** Height above sea level the flight settles at over low ground, m. */
export const CRUISE_ALTITUDE = 120;
/** How far ahead along the heading the ground is read, m. */
export const LOOK_AHEAD = 300;
/** Clearance over the ground ahead and here, and the hard floor, m. */
export const CLEAR_AHEAD = 90;
export const CLEAR_HERE = 60;
export const FLOOR = 30;
/** How quickly the height eases toward its target, 1/s. */
export const FOLLOW_RATE = 1.2;

/** Starting heading from the seed: different worlds fly in different directions, the same world always the same. */
export function headingFromSeed(seed: number): number {
  return ((Math.imul(seed >>> 0, 0x9e3779b1) >>> 0) / 0x1_0000_0000) * Math.PI * 2;
}

export interface SimulationOptions {
  seed: number;
  speed?: number;
  altitude?: number;
  heading?: number;
  /** Ground height at a world point; without it the flight keeps a constant altitude. */
  groundAt?: (x: number, z: number) => number;
}

export function createSimulation(opts: SimulationOptions): Simulation {
  const speed = opts.speed ?? 40;
  const altitude = opts.altitude ?? CRUISE_ALTITUDE;
  const groundAt = opts.groundAt;
  const state: FlightState = {
    t: 0,
    x: 0,
    y: altitude,
    z: 0,
    heading: opts.heading ?? headingFromSeed(opts.seed),
  };
  return {
    state,
    speed,
    step(dt) {
      if (!Number.isFinite(dt) || dt <= 0 || dt > MAX_STEP) return false;
      state.t += dt;
      const fx = Math.sin(state.heading);
      const fz = Math.cos(state.heading);
      state.x += fx * speed * dt;
      state.z += fz * speed * dt;
      if (groundAt) {
        const here = groundAt(state.x, state.z);
        const ahead = groundAt(state.x + fx * LOOK_AHEAD, state.z + fz * LOOK_AHEAD);
        const target = Math.max(CRUISE_ALTITUDE, here + CLEAR_HERE, ahead + CLEAR_AHEAD);
        state.y += (target - state.y) * Math.min(1, dt * FOLLOW_RATE);
        state.y = Math.max(state.y, here + FLOOR);
      }
      return true;
    },
  };
}
