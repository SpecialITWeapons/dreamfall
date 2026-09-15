// The simulation: the CPU aggregate the world steps once per frame. It owns
// the day clock, the sky pulls that read it and the flight controller that
// reads both; the presentation reads the state and never writes it. A
// snapshot of it is what the page remembers, and what a resumed flight
// continues from. Pure CPU, no Three.js beyond the math classes, no DOM.
import {
  MAX_STEP,
  SPEED,
  createFlightController,
  type FlightController,
  type FlightState,
  type LowPass,
} from '../flight/FlightController';
import { createSkyPulls, type SkyPulls } from '../flight/SkyPulls';
import type { Obstacles } from '../scenery/Obstacles';
import { createDayClock, type DayClock } from '../time/DayClock';

export { MAX_STEP };
export type { FlightState };

/** A remembered flight: place, course, time of day and the schedules that hang off the clock. */
export interface ResumeState {
  seed: number;
  x: number;
  y: number;
  z: number;
  t: number;
  heading: number;
  vy: number;
  bank: number;
  pitch: number;
  yawRate: number;
  dayPhase: number;
  cloudSchedule: number;
  cloudOrigin: number;
  low: LowPass;
  released: boolean;
}

export interface Simulation {
  readonly seed: number;
  readonly state: FlightState;
  readonly speed: number;
  readonly clock: DayClock;
  readonly pulls: SkyPulls;
  readonly flight: FlightController;
  /** Advances the world by dt seconds; false when the step is invalid and was skipped. */
  step(dt: number): boolean;
  /** Everything a later visit needs to continue this flight. */
  snapshot(): ResumeState;
}

export interface SimulationOptions {
  seed: number;
  groundAt: (x: number, z: number) => number;
  obstacles?: Obstacles;
  /** How far the figure hangs under its center, m. */
  below?: number;
  /** A remembered flight to continue; a fresh one starts in the morning at the origin. */
  resume?: ResumeState | null;
  random?: () => number;
}

export function createSimulation(opts: SimulationOptions): Simulation {
  const resume = opts.resume ?? null;
  const clock = createDayClock({ phase: resume ? resume.dayPhase : 0.3 });
  const pulls = createSkyPulls(clock);
  pulls.restore(resume?.released ?? false);
  const flight = createFlightController({
    seed: opts.seed,
    groundAt: opts.groundAt,
    obstacles: opts.obstacles,
    pulls,
    dayPhase: () => clock.phase,
    below: opts.below,
    start: resume
      ? {
          x: resume.x,
          y: resume.y,
          z: resume.z,
          t: resume.t,
          heading: resume.heading,
          vy: resume.vy,
          bank: resume.bank,
          pitch: resume.pitch,
          yawRate: resume.yawRate,
          cloudSchedule: resume.cloudSchedule,
          cloudOrigin: resume.cloudOrigin,
          low: { ...resume.low },
        }
      : undefined,
    random: opts.random,
  });
  const state = flight.state;
  return {
    seed: opts.seed >>> 0,
    state,
    speed: SPEED,
    clock,
    pulls,
    flight,
    step(dt) {
      if (!flight.step(dt)) return false;
      clock.advance(dt);
      return true;
    },
    snapshot() {
      return {
        seed: opts.seed >>> 0,
        x: state.x,
        y: state.y,
        z: state.z,
        t: state.t,
        heading: state.heading,
        vy: state.vy,
        bank: state.bank,
        pitch: state.pitch,
        yawRate: state.yawRate,
        dayPhase: clock.phase,
        cloudSchedule: state.cloudSchedule,
        cloudOrigin: state.cloudOrigin,
        low: { ...state.low },
        released: pulls.released,
      };
    },
  };
}
