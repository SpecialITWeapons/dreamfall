// Sky events. While the sun or the moon crosses the horizon the flight turns
// to fly straight at it and holds that course until the sky settles, unless
// the viewer steers away; then it is free until the next event. The crossings
// are found on the same arcs the sky draws, so they cannot drift from it.
// Once a night, after the sunset has let go, the flight makes one turn toward
// the core of the galaxy and lets go as soon as it faces it. Ported from
// fly-with-me's updateSunward and updateNightward.
import { Vector3 } from 'three';
import { sstep } from '../terrain/noise';
import { solar, type DayClock } from '../time/DayClock';
import { wrapAngle } from './angles';

export interface SkyEvent {
  body: 'sun' | 'moon';
  rising: boolean;
  /** Day-clock phase of the crossing. */
  phase: number;
  /** Solar phase of the crossing; the pull's window is measured in it. */
  solar: number;
  /** How long before and after the crossing the pull lasts, in solar phase. */
  before: number;
  after: number;
}

// A rising body from its first glow until it stands clear, a setting one from
// its last stretch until the afterglow fades, the moon only while its disc is low.
const SPANS = {
  sun: { rising: [0.035, 0.07], setting: [0.02, 0.045] },
  moon: { rising: [0.012, 0.03], setting: [0.035, 0.004] },
} as const;
/** Solar phase over which a pull comes and goes. */
export const SKY_FADE = 0.015;
/**
 * The bearing of the Milky Way's core, in the world. Not written down beside
 * the galaxy but **read out of it**: `brightestMatter` finds the peak of the
 * stellar light in the same field the sky is drawn from, and this is that
 * bearing through the galactic axes. A unit test asks the bake for it again, so
 * a galaxy that moves fails rather than leaving the flight turning toward where
 * its core used to be.
 *
 * It was 0.95 while it was a guess from the original's written core longitude,
 * which was three degrees out.
 */
export const GALAXY_HEADING = 1.0002;
export const NIGHTWARD = {
  /** Radians of heading that count as facing the core. */
  aligned: 0.03,
  /** Seconds the pull takes to come and go. */
  fade: 1.2,
  /** Seconds after which the turn gives up rather than hold the flight. */
  give: 90,
};

export function findSkyEvents(clock: DayClock): SkyEvent[] {
  const sun = new Vector3(),
    moon = new Vector3();
  const height = (body: 'sun' | 'moon', phase: number) => {
    clock.skyBodies(phase, sun, moon);
    return (body === 'sun' ? sun : moon).y;
  };
  const events: SkyEvent[] = [];
  const steps = 720;
  for (const body of ['sun', 'moon'] as const) {
    let previous = height(body, 0);
    for (let i = 1; i <= steps; i++) {
      const next = height(body, i / steps);
      if (previous < 0 !== next < 0) {
        let lo = (i - 1) / steps,
          hi = i / steps;
        for (let k = 0; k < 24; k++) {
          const mid = (lo + hi) / 2;
          if (height(body, mid) < 0 === previous < 0) lo = mid;
          else hi = mid;
        }
        const rising = next > previous;
        const [before, after] = SPANS[body][rising ? 'rising' : 'setting'];
        const phase = (lo + hi) / 2;
        events.push({ body, rising, phase, solar: solar(phase), before, after });
      }
      previous = next;
    }
  }
  return events.sort((a, b) => a.phase - b.phase);
}

export function skyEventWeight(event: SkyEvent, phase: number): number {
  const s = solar(phase) - event.solar;
  const d = s - Math.round(s);
  const arriving = sstep(-event.before - SKY_FADE, -event.before, d),
    leaving = sstep(event.after, event.after + SKY_FADE, d);
  return arriving * (1 - leaving);
}

export interface SkyPulls {
  readonly events: SkyEvent[];
  readonly sunrise: SkyEvent;
  readonly sunset: SkyEvent;
  /** 0..1, how firmly the sky holds the heading right now. */
  readonly pull: number;
  /** Where it pulls to. */
  readonly heading: number;
  /** The viewer steered away from the current event. */
  readonly released: boolean;
  readonly event: SkyEvent | null;
  isNight(phase: number): boolean;
  update(phase: number, t: number, heading: number, dt: number): void;
  /** The viewer took the reins: the current event and the night's turn let go. */
  release(): void;
  /** For a resumed flight: whether the current event had been released. */
  restore(released: boolean): void;
}

export function createSkyPulls(clock: DayClock, opts: { galaxyHeading?: number } = {}): SkyPulls {
  const galaxyHeading = opts.galaxyHeading ?? GALAXY_HEADING;
  const events = findSkyEvents(clock);
  const sunrise = events.find((e) => e.body === 'sun' && e.rising)!;
  const sunset = events.find((e) => e.body === 'sun' && !e.rising)!;
  // Night, sunset to sunrise, on the same crossings the events were found on.
  const nightSpan = (((sunrise.phase - sunset.phase) % 1) + 1) % 1;
  const isNight = (phase: number) => (((phase - sunset.phase) % 1) + 1) % 1 < nightSpan;
  const sun = new Vector3(),
    moon = new Vector3();
  const sunward = { event: null as SkyEvent | null, pull: 0, heading: 0, released: false };
  const nightward = {
    night: null as boolean | null,
    armed: false,
    done: false,
    turning: false,
    pull: 0,
    since: 0,
  };
  let pull = 0,
    heading = 0;
  // The event (if any) with the strongest pull at a phase, shared by update() and restore()
  // so a resumed flight primes `sunward.event` the same way the next update() would find it.
  const strongestEvent = (phase: number): { event: SkyEvent | null; weight: number } => {
    let weight = 0,
      event: SkyEvent | null = null;
    for (const candidate of events) {
      const w = skyEventWeight(candidate, phase);
      if (w > weight) {
        weight = w;
        event = candidate;
      }
    }
    return { event, weight };
  };
  return {
    events,
    sunrise,
    sunset,
    get pull() {
      return pull;
    },
    get heading() {
      return heading;
    },
    get released() {
      return sunward.released;
    },
    get event() {
      return sunward.event;
    },
    isNight,
    update(phase, t, current, dt) {
      const { event, weight: best } = strongestEvent(phase);
      if (event !== sunward.event) sunward.released = false;
      sunward.event = event;
      sunward.pull = sunward.released ? 0 : best;
      if (event) {
        clock.skyBodies(phase, sun, moon);
        const dir = event.body === 'sun' ? sun : moon;
        sunward.heading = Math.atan2(dir.x, dir.z);
      }
      const night = isNight(phase);
      if (nightward.night !== night) {
        // the first update only reads where the day stands, so a flight resumed
        // into a night that began without it is left alone
        if (night && nightward.night !== null) {
          nightward.armed = true;
          nightward.done = false;
          nightward.turning = false;
        }
        if (!night) nightward.armed = false;
        nightward.night = night;
      }
      const holding = nightward.armed && !nightward.done;
      // the sunset's own pull has the flight until the sky settles into night
      if (holding && !nightward.turning && sunward.pull === 0) {
        nightward.turning = true;
        nightward.since = t;
      }
      if (
        holding &&
        nightward.turning &&
        (Math.abs(wrapAngle(galaxyHeading - current)) < NIGHTWARD.aligned ||
          t - nightward.since > NIGHTWARD.give)
      )
        nightward.done = true;
      const want = nightward.armed && !nightward.done && nightward.turning ? 1 : 0;
      nightward.pull = Math.max(0, Math.min(1, nightward.pull + (want ? dt : -dt) / NIGHTWARD.fade));
      // one thing pulls at a time: a sky event first, then the night's one turn
      pull = Math.max(sunward.pull, nightward.pull);
      heading = sunward.pull >= nightward.pull ? sunward.heading : galaxyHeading;
    },
    release() {
      if (sunward.event) sunward.released = true;
      nightward.done = true;
    },
    restore(released) {
      // Prime `sunward.event` from the clock's current phase (already the resumed
      // flight's phase at this point, before any advance()), so the very next
      // update() sees the same event and doesn't treat it as "changed" -- which
      // would otherwise reset `released` back to false one tick after resume.
      sunward.event = strongestEvent(clock.phase).event;
      sunward.released = released;
    },
  };
}
