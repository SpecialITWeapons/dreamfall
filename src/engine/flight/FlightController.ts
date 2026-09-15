// Flight controller: rails with a gentle hand. The figure flies itself over
// the ground it is given; a drag turns it and aims its nose, and takes the
// vertical away from whatever the flight had planned for as long as it is
// held and a moment after. Pure CPU: the world hands in groundAt, the
// obstacle registry and the sky pulls, and reads the state back. Ported from
// fly-with-me's updateFlight with the figure's own envelope: a hard floor of
// MIN_CLEARANCE over ground and obstacles, a ceiling at MAX_ALTITUDE, and
// gusts of suit flutter in place of wing beats.
import { createObstacles, type Obstacle, type Obstacles } from '../scenery/Obstacles';
import { mulberry32, perlin2 } from '../terrain/noise';
import { DECK_Y, SEA_LEVEL, fieldSeeds } from '../terrain/WorldSampler';
import { wrapAngle } from './angles';
import type { SkyPulls } from './SkyPulls';

/** Level airspeed, fastest climb and fastest descent, m/s. */
export const SPEED = 40;
export const CLIMB = 11;
export const DESCENT = 16;
/** Hard floor over ground and obstacles, m. */
export const MIN_CLEARANCE = 25;
/** Ceiling, m above sea level. */
export const MAX_ALTITUDE = 1400;
/** Longest simulation step; a longer frame is clamped by the loop. */
export const MAX_STEP = 0.05;
export const AIM = {
  // The ends of the stick are the ends of the figure's own envelope: a full
  // drag reaches its fastest climb or descent and no further.
  up: Math.asin(CLIMB / SPEED),
  down: Math.asin(DESCENT / SPEED),
  /** Seconds over which the flight takes the altitude back. */
  release: 2.2,
  /** How firmly the ground ahead and the ceiling take the aim back. */
  brake: 0.35,
};
/** The deck schedule: high for the last (period - high) seconds of every period. */
export const SCHEDULE = { period: 300, high: 200 };
/** Gusts of suit flutter, s. */
export const GUST = { length: 2.2, lengthSpread: 2, every: 7, everySpread: 9 };
/**
 * Airspeed trades with the climb: a dive gains it, a climb spends it. Level
 * flight is SPEED; a full descent reaches about 59 m/s and a full climb falls
 * to 27, both inside the clamp. The look-ahead scales with it, so a faster
 * figure looks proportionally further down its own path.
 */
export const AIRSPEED = { min: 30, max: 62, perVy: 1.2, ease: 1.2 };
/** Flying by hand: what an arrow key asks for. */
export const MANUAL = { turn: 0.35 };
/** The ceiling's own margin: terrain that needs more than this turns the flight aside. */
export const ESCAPE = { margin: 120, probe: 0.7 };

/** Starting heading from the seed: different worlds fly in different directions, the same world always the same. */
export function headingFromSeed(seed: number): number {
  return ((Math.imul(seed >>> 0, 0x9e3779b1) >>> 0) / 0x1_0000_0000) * Math.PI * 2;
}

export interface LowPass {
  on: boolean;
  next: number;
  until: number;
  amount: number;
}

export interface FlightState {
  t: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  vy: number;
  /** Airspeed, m/s: SPEED in level flight, more in a dive, less in a climb. */
  speed: number;
  bank: number;
  pitch: number;
  yawRate: number;
  /** Heading change from steering, applied whole on the next step. */
  steer: number;
  /** Climb angle the pilot steered to, radians, and how much of the vertical is theirs (1 while they steer). */
  aim: number;
  aimHold: number;
  /** Suit flutter: the phase advances with the wind; gust is a burst of stronger flutter, 0..1. */
  windPhase: number;
  gust: number;
  gustBurst: number;
  gustTimer: number;
  /** 0 below the deck, 1 above it, and the origin of the schedule. */
  cloudSchedule: number;
  cloudOrigin: number;
  low: LowPass;
}

export interface FlightDeps {
  seed: number;
  groundAt: (x: number, z: number) => number;
  obstacles?: Obstacles;
  pulls?: SkyPulls;
  /** Day-clock phase for the pulls; without it nothing pulls. */
  dayPhase?: () => number;
  /** Deterministic stream for low passes and gusts; one from the seed by default. */
  random?: () => number;
  /** How far the figure hangs under its center, m (Avatar.bounds.below). */
  below?: number;
  /** A remembered flight to continue, or a start. */
  start?: Partial<Omit<FlightState, 'low'>> & { low?: Partial<LowPass> };
  /** Tests: force the schedule high (1) or low (0). */
  schedule?: () => 0 | 1 | null;
}

export interface FlightController {
  readonly state: FlightState;
  readonly speed: number;
  /** The pilot holds the stick. */
  readonly held: boolean;
  /** The flight flies itself: wander, sky pulls and the deck schedule. */
  readonly autopilot: boolean;
  /** Hands the flight back to itself, or takes it away; taking it holds the present course and height. */
  setAutopilot(on: boolean): void;
  /**
   * Flying by hand: a turn and a climb direction, each -1, 0 or 1. Any
   * direction takes the autopilot off; zeroes hold the course and the height
   * where the pilot let go.
   */
  fly(yaw: number, climb: number): void;
  /** Advances the flight by dt seconds; false when the step is invalid and was skipped. */
  step(dt: number): boolean;
  /** Turns the figure by delta on the next step, one to one with the pointer. */
  steerBy(delta: number): void;
  /** Aims the nose; the vertical is the pilot's while the stick is held and a moment after. */
  aimBy(delta: number): void;
  setSteering(held: boolean): void;
  /** The pilot took the reins: the sky lets go. */
  release(): void;
  /** The hard floor at a world point: sea, ground and obstacle tops. */
  floorAt(x: number, z: number): number;
  clearance(): number;
}

export function createFlightController(deps: FlightDeps): FlightController {
  const { groundAt } = deps;
  const obstacles = deps.obstacles ?? createObstacles();
  const pulls = deps.pulls ?? null;
  const dayPhase = deps.dayPhase ?? (() => 0.3);
  const random = deps.random ?? mulberry32(deps.seed ^ 0xf11e);
  const below = deps.below ?? 0;
  const { S1, S2 } = fieldSeeds(deps.seed);
  const { low: lowStart, ...start } = deps.start ?? {};
  const x0 = start.x ?? 0,
    z0 = start.z ?? 0;
  const state: FlightState = {
    t: 0,
    x: x0,
    y: Math.max(groundAt(x0, z0), SEA_LEVEL) + 120,
    z: z0,
    heading: headingFromSeed(deps.seed),
    vy: 0,
    speed: SPEED,
    bank: 0,
    pitch: 0,
    yawRate: 0,
    steer: 0,
    aim: 0,
    aimHold: 0,
    windPhase: 0,
    gust: 0,
    gustBurst: 0,
    gustTimer: GUST.every,
    cloudSchedule: 0,
    cloudOrigin: -150,
    ...start,
    low: { on: false, next: 160, until: 0, amount: 0, ...lowStart },
  };
  let held = false;
  const n1 = (t: number, s: number) => perlin2(t, 0.37, s);
  const floorAt = (px: number, pz: number) =>
    Math.max(SEA_LEVEL, groundAt(px, pz), obstacles.floorAt(px, pz, 5));
  const nearby: Obstacle[] = [];
  // The highest ground or obstacle along the path ahead. The path bends with
  // the current turn rate, so the look-ahead follows that arc rather than a
  // straight line, and the corridor is wider than the figure so a crown beside
  // the path lifts it before it is over it.
  const terrainAhead = (dist: number) => {
    obstacles.near(state.x, state.z, dist + 60, nearby);
    let h = -1e9,
      px = state.x,
      pz = state.z;
    const step = 30;
    for (let d = 0; d <= dist; d += step) {
      if (d > 0) {
        const heading = state.heading + (state.yawRate * d) / state.speed;
        px += Math.sin(heading) * step;
        pz += Math.cos(heading) * step;
      }
      h = Math.max(h, groundAt(px, pz));
      for (const o of nearby) {
        const margin = o.radius + 18;
        if ((o.x - px) ** 2 + (o.z - pz) ** 2 < margin * margin) h = Math.max(h, o.top);
      }
    }
    return h;
  };
  // The range's pyramids rise faster than the figure can climb, so the flight
  // looks further ahead than its clearance does: the altitude it needs now to
  // clear every point of the next two kilometres, along the arc of the current
  // turn, at four fifths of its own climb rate.
  const climbAhead = (dist: number, offset = 0) => {
    let need = -1e9,
      px = state.x,
      pz = state.z;
    const step = 60;
    for (let d = step; d <= dist; d += step) {
      const heading = state.heading + offset + (state.yawRate * d) / state.speed;
      px += Math.sin(heading) * step;
      pz += Math.cos(heading) * step;
      need = Math.max(need, groundAt(px, pz) + MIN_CLEARANCE + 15 - (d / state.speed) * CLIMB * 0.8);
    }
    return need;
  };
  const endLow = () => {
    state.low.on = false;
    state.low.next = state.t + 170 + random() * 130;
  };
  let autopilot = true;
  /** Arrow keys, each -1, 0 or 1. */
  const manual = { yaw: 0, climb: 0 };
  /** The height the pilot let go at; what the flight holds with the autopilot off. */
  let hold = state.y;
  // The world has no edge to turn back from: the terrain runs on forever and
  // the window travels with the figure. What can end a flight is a range too
  // tall to climb, so when the path ahead asks for more height than the ceiling
  // allows, the flight leans towards whichever side asks for less. This happens
  // in both modes: a hand on the stick does not get to fly into a mountain.
  const escapeTurn = (wall: number, dist: number) => {
    const over = wall - (MAX_ALTITUDE - ESCAPE.margin);
    if (over <= 0) return 0;
    const left = climbAhead(dist, ESCAPE.probe),
      right = climbAhead(dist, -ESCAPE.probe);
    if (Math.min(left, right) >= wall) return 0;
    const urgency = Math.min(1, over / ESCAPE.margin);
    return (left < right ? MANUAL.turn : -MANUAL.turn) * urgency;
  };
  return {
    state,
    get speed() {
      return state.speed;
    },
    get held() {
      return held;
    },
    get autopilot() {
      return autopilot;
    },
    setAutopilot(on) {
      if (on === autopilot) return;
      autopilot = on;
      manual.yaw = 0;
      manual.climb = 0;
      if (on) {
        // Hand it back where the pilot left it rather than where the schedule
        // would have been: a crossing stands a while longer if they left the
        // figure over the deck, exactly as it does when they let go of the stick.
        state.cloudOrigin = state.t - (state.y > DECK_Y ? 210 : 0);
      } else {
        hold = state.y;
        pulls?.release();
        if (state.low.on) endLow();
      }
    },
    fly(yaw, climb) {
      // Taking the flight away zeroes the keys, so the takeover happens first
      // and the pilot's own directions are written over the top of it.
      if ((yaw || climb) && autopilot) this.setAutopilot(false);
      manual.yaw = Math.sign(yaw);
      manual.climb = Math.sign(climb);
      if (!autopilot && manual.yaw === 0 && manual.climb === 0) hold = state.y;
    },
    step(dt) {
      if (!Number.isFinite(dt) || dt <= 0 || dt > MAX_STEP) return false;
      const s = state;
      s.t += dt;
      // where the schedule wants us: a slow climb through the deck every few minutes
      const cyc = (((s.t - s.cloudOrigin) % SCHEDULE.period) + SCHEDULE.period) % SCHEDULE.period;
      const wantHigh = deps.schedule?.() ?? (cyc > SCHEDULE.high ? 1 : 0);
      s.cloudSchedule += (wantHigh - s.cloudSchedule) * Math.min(1, dt * 0.5);
      // How far down its own path the figure looks, in proportion to how fast it
      // is going. Both look-aheads are read here, before the heading moves, so
      // the turn away from a wall and the altitude that clears it see the same
      // ground; a step's worth of heading is a hundredth of a radian either way.
      const reach = s.speed / SPEED;
      const ahead = terrainAhead(520 * reach),
        wall = climbAhead(2200 * reach);
      // heading: slow noise, a low sun or moon to fly at, the pilot's nudge, and
      // steering that turns the figure directly -- or, with the autopilot off,
      // only what the pilot asks for. The turn away from a wall is added in
      // either case.
      const wander = 0.22 * n1(s.t * 0.045 + 3.1, S2 + 5) + 0.08 * n1(s.t * 0.19, S2 + 9);
      pulls?.update(dayPhase(), s.t, s.heading, dt);
      const pull = autopilot ? (pulls?.pull ?? 0) : 0;
      const pulled = pulls?.heading ?? s.heading;
      const toward = Math.max(-0.2, Math.min(0.2, wrapAngle(pulled - s.heading) * 0.5));
      const aside = escapeTurn(wall, 2200 * reach);
      const yawRateTarget = autopilot
        ? wander * (1 - pull) + toward * pull + aside
        : manual.yaw * MANUAL.turn + aside;
      s.yawRate += (yawRateTarget - s.yawRate) * Math.min(1, dt * 1.5);
      const turn = s.steer;
      s.steer = 0;
      s.heading = wrapAngle(s.heading + s.yawRate * dt + turn);
      const steerRate = Math.max(-1.2, Math.min(1.2, (turn / dt) * 0.6));
      // altitude: cruise above the terrain ahead, higher when the schedule says so,
      // lower during a pass over ground that stays gentle for a while ahead
      const here = Math.max(groundAt(s.x, s.z), SEA_LEVEL);
      const gentle = terrainAhead(1100 * reach) < here + 70 && here < 420;
      const lowWindow = s.low.on ? s.t < s.low.until : s.t > s.low.next;
      if (
        autopilot &&
        !s.low.on &&
        lowWindow &&
        wantHigh === 0 &&
        s.cloudSchedule < 0.05 &&
        gentle &&
        !s.aimHold
      ) {
        s.low.on = true;
        s.low.until = s.t + 45 + random() * 35;
      }
      if (s.low.on && (!autopilot || !lowWindow || wantHigh === 1)) endLow();
      const wantLow = s.low.on && gentle ? 1 : 0;
      s.low.amount += (wantLow - s.low.amount) * Math.min(1, dt * (wantLow ? 0.16 : 0.35));
      const low = s.low.amount;
      const cruise = Math.max(
        ahead + 110 - 80 * low + 40 * (1 - 0.6 * low) * n1(s.t * 0.03, S1 + 4),
        SEA_LEVEL + 55 - 32 * low,
      );
      const high = DECK_Y + 190 + 30 * n1(s.t * 0.05, S1 + 8);
      let target = autopilot ? cruise + (high - Math.min(cruise, high)) * s.cloudSchedule : hold;
      // The envelope: never above the ceiling, never closer to the ground ahead
      // than the clearance plus a margin, so the hard floor below stays a last resort.
      const floor = Math.max(ahead + MIN_CLEARANCE + 10, here + MIN_CLEARANCE + 20, wall);
      target = Math.max(Math.min(target, MAX_ALTITUDE), floor);
      // A low pass follows the ground more eagerly: the gap the figure settles
      // into over falling ground is the ground's descent rate over this gain.
      let vyTarget = Math.max(-DESCENT, Math.min(CLIMB, (target - s.y) * (0.12 + 0.2 * low)));
      // The pilot's own climb: while an arrow is down the figure climbs or
      // descends at its best rate and the held height follows it, so letting go
      // levels off where they left it. The envelope still brakes at both ends.
      if (!autopilot && manual.climb !== 0) {
        vyTarget = manual.climb > 0 ? CLIMB : -DESCENT;
        vyTarget = Math.min(vyTarget, (MAX_ALTITUDE - s.y) * AIM.brake);
        vyTarget = Math.max(vyTarget, (floor - s.y) * AIM.brake);
        hold = s.y;
      }
      // The pilot's aim overrides whatever the flight had planned: while the
      // stick is held, and for a moment after, the nose they set is the only
      // thing that moves the figure up or down, inside the same envelope. Then
      // the flight takes the altitude back from where they left it.
      if (s.aimHold > 0) {
        // The stick asks for a climb rate, not an angle of attack: its ends are
        // the ends of the envelope whatever the airspeed is doing, so a full
        // drag still reaches CLIMB even though the climb itself costs speed.
        const aimed = Math.max(-DESCENT, Math.min(CLIMB, Math.sin(s.aim) * SPEED));
        vyTarget += (aimed - vyTarget) * s.aimHold;
        vyTarget = Math.min(vyTarget, (MAX_ALTITUDE - s.y) * AIM.brake);
        vyTarget = Math.max(vyTarget, (floor - s.y) * AIM.brake);
        if (!held) {
          s.aimHold = Math.max(0, s.aimHold - dt / AIM.release);
          if (s.aimHold === 0) {
            s.aim = 0;
            // a crossing stands a while longer if the figure was left over the
            // deck; under it, a full low stretch follows
            s.cloudOrigin = s.t - (s.y > DECK_Y ? 210 : 0);
          }
        }
      }
      // Pulling up answers faster than settling down, so a wall entering the
      // look-ahead lifts the figure before the clearance clamp must.
      s.vy += (vyTarget - s.vy) * Math.min(1, dt * (vyTarget > s.vy ? 2.6 : 0.9));
      // Airspeed follows the climb, a second behind it: falling buys speed,
      // climbing spends it. Everything that measures the path ahead reads it.
      const speedTarget = Math.max(AIRSPEED.min, Math.min(AIRSPEED.max, SPEED - AIRSPEED.perVy * s.vy));
      s.speed += (speedTarget - s.speed) * Math.min(1, dt * AIRSPEED.ease);
      const fx = Math.sin(s.heading),
        fz = Math.cos(s.heading);
      s.x += fx * s.speed * dt;
      s.z += fz * s.speed * dt;
      s.y += s.vy * dt;
      // The two walls of this world, in the order that matters: the ceiling is
      // hard, and the floor is harder -- ground that stands above the ceiling
      // still gets its clearance.
      s.y = Math.min(s.y, MAX_ALTITUDE);
      s.y = Math.max(s.y, floorAt(s.x, s.z) + MIN_CLEARANCE + below);
      // pose: roll leads yaw, pitch follows climb
      const bankTarget = -(s.yawRate + steerRate) * 1.35;
      s.bank += (bankTarget - s.bank) * Math.min(1, dt * 2.2);
      const pitchTarget = Math.atan2(s.vy, s.speed) * 1.6;
      s.pitch += (pitchTarget - s.pitch) * Math.min(1, dt * 2.0);
      // gusts: the suit flutters harder while climbing, and in bursts now and then while gliding
      s.gustTimer -= dt;
      let gusting = false;
      if (s.gustBurst > 0) {
        s.gustBurst -= dt;
        gusting = true;
      } else if (s.vy > 2.5) gusting = true;
      else if (s.gustTimer <= 0) {
        s.gustBurst = GUST.length + random() * GUST.lengthSpread;
        s.gustTimer = GUST.every + random() * GUST.everySpread;
        gusting = true;
      }
      s.gust += ((gusting ? 1 : 0) - s.gust) * Math.min(1, dt * (gusting ? 4 : 1.5));
      s.windPhase += dt * (4.5 + 3.5 * s.gust + Math.abs(s.vy) * 0.1);
      return true;
    },
    steerBy(delta) {
      state.steer += delta;
    },
    aimBy(delta) {
      state.aim = Math.max(-AIM.down, Math.min(AIM.up, state.aim + delta));
      state.aimHold = 1;
      // a low pass under way lets go of the figure, the way a pull does when steered
      if (state.low.on) endLow();
    },
    setSteering(value) {
      held = value;
    },
    release() {
      pulls?.release();
    },
    floorAt,
    clearance() {
      return state.y - floorAt(state.x, state.z);
    },
  };
}
