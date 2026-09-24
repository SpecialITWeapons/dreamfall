// The opening: half a minute or so of scripted flight under a title card, from
// the sun coming up on the beam, through the cloud deck from under its base
// and out over its top, to a dive down onto it. Pure
// arithmetic -- a function of how long it has been running -- so the whole
// performance is read by a test in Node rather than watched.
//
// What it drives, it drives with the verbs a pilot has: `fly(yaw, climb)`
// takes the **sign** of each, exactly as an arrow key does, so the opening
// cannot ask the figure for anything the flight would refuse a person. The
// envelope holds through all of it: clearance over the ground, the ceiling,
// the escape turn. What the opening does own outright is the camera and the
// pace of the day.
//
// The deck is 120 to 350 m deep depending on where the flight starts, so the
// climb is as long as the deck there asks for (`openingStart`): the flight
// begins under the base, where the sunrise is seen in clear air, and a fixed
// climb would come out over a thin bank and stay inside a deep one.
import { CLIMB } from '../flight/FlightController';

/**
 * The five acts, in seconds, and the numbers around them. The climb is the
 * long one because it is the one with something to see; `climb` here is its
 * shortest, and a deep deck at the start lengthens it (`openingStart`) so the
 * flight's own 14.3 m/s covers the deck with room to spare -- a test holds
 * those numbers against each other.
 */
export const OPENING = {
  side: 4,
  turn: 4,
  climb: 9,
  hold: 4,
  dive: 6,
  /**
   * How far under the deck's base the flight starts, m: in clear air, so the
   * first act's sunrise is seen. It started just under the top for a while, and
   * on seed 42 that was inside a solid bank and the whole sunrise was white.
   */
  startBelow: 50,
  /** How far over the deck's top the climb comes out, m. */
  clearTop: 30,
  /**
   * The margin on the climb: its rate is reached over a second or so, and the
   * ground's own clearance may hold the figure down for part of the act.
   */
  margin: 1.3,
  /**
   * The day clock at the first frame: the sun a little under the rim. Measured
   * rather than guessed -- the sun breaks the horizon at 0.126 on this clock,
   * and the first draft started at 0.212, which is mid-morning and has nothing
   * left to rise.
   */
  dawn: 0.112,
  /**
   * How fast the day runs while the card is up; it eases back to one as the
   * card goes, whatever the climb's length, or a deep deck's long climb would
   * run a quarter of the day. The day is 600 s long, so this is a few
   * hundredths of it -- a sunrise. Eighteen, which is what the first draft
   * asked for, crossed half a day before the dive and put the sun back down.
   */
  dayRate: 3,
  /** The card: up over `in` seconds, gone by `gone`, over `out`. */
  card: { in: 0.9, gone: 9.5, out: 2.2 },
} as const;

/**
 * Where a first flight starts and how long it climbs, for the deck over the
 * start: under its base, and long enough to come out over its top.
 */
export function openingStart(deck: { base: number; top: number }): { y: number; climb: number } {
  const y = deck.base - OPENING.startBelow;
  const rise = deck.top + OPENING.clearTop - y;
  return { y, climb: Math.max(OPENING.climb, (rise * OPENING.margin) / CLIMB) };
}

/** How long the whole opening runs, for a climb this long. */
export const openingSeconds = (climb: number = OPENING.climb) =>
  OPENING.side + OPENING.turn + climb + OPENING.hold + OPENING.dive;

/** The opening's length at its shortest climb. */
export const OPENING_SECONDS = openingSeconds();

export interface OpeningFrame {
  /** What the stick is asking of the course and the height: a sign, as a key gives. */
  yaw: -1 | 0 | 1;
  climb: -1 | 0 | 1;
  /** Where the camera hangs while this runs. */
  cameraYaw: number;
  cameraPitch: number;
  cameraDist: number;
  /** How fast the day runs; 1 is the world's own pace. */
  dayRate: number;
  /** The title card's opacity. */
  card: number;
  /** The opening is over and the flight is the autopilot's again. */
  done: boolean;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** How far through a stretch of the script, 0..1. */
const through = (t: number, from: number, length: number) => smooth((t - from) / length);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The whole performance at one instant. The camera swings from the beam to
 * behind the figure, drops under it while the deck goes past overhead, and
 * comes back up for the dive; the day runs fast while the card is up and is
 * back to its own pace before the flight is handed over.
 */
export function openingAt(t: number, out: OpeningFrame, climb: number = OPENING.climb): OpeningFrame {
  const { side, turn, hold } = OPENING;
  const turnAt = side,
    climbAt = turnAt + turn,
    holdAt = climbAt + climb,
    diveAt = holdAt + hold;
  out.yaw = t >= turnAt && t < climbAt ? 1 : 0;
  out.climb = t >= climbAt && t < holdAt ? 1 : t >= diveAt ? -1 : 0;
  // The camera. On the beam for the first act, because a sunrise is a thing
  // seen sideways: behind the figure it is a glare with a silhouette in it.
  const behind = through(t, turnAt, turn);
  const under = through(t, climbAt, climb * 0.55);
  const back = through(t, holdAt, hold);
  const last = through(t, diveAt, OPENING.dive * 0.6);
  out.cameraYaw = mix(Math.PI / 2, 0.32, behind) * (1 - last) + 0.06 * last;
  out.cameraPitch =
    mix(0.14, 0.34, behind) * (1 - under) + mix(-0.16, 0.26, back) * under * (1 - last) + 0.46 * last;
  out.cameraDist = mix(11, 7.5, behind) * (1 - under) + mix(6.2, 8.5, back) * under;
  // The day. Fast while there is a card over it, its own pace once it is gone.
  out.dayRate = mix(OPENING.dayRate, 1, through(t, OPENING.card.gone, hold));
  out.card = through(t, 0.35, OPENING.card.in) * (1 - through(t, OPENING.card.gone, OPENING.card.out));
  out.done = t >= openingSeconds(climb);
  return out;
}

export interface Opening {
  /** Running: the flight and the camera are the script's until this goes false. */
  readonly live: boolean;
  readonly frame: Readonly<OpeningFrame>;
  /** One step; the frame it returns is the same object every time. */
  step(dt: number): Readonly<OpeningFrame>;
  /** A key, a click, a resumed flight, a preference for less motion: the script stops. */
  skip(): void;
}

/**
 * @param play false for a flight that is being resumed, or a page that asked
 * for less motion: the opening never starts and the world is flying from the
 * first frame.
 * @param climb how long the climb act runs (`openingStart`).
 */
export function createOpening(play = true, climb: number = OPENING.climb): Opening {
  const frame: OpeningFrame = {
    yaw: 0,
    climb: 0,
    cameraYaw: Math.PI / 2,
    cameraPitch: 0.14,
    cameraDist: 11,
    dayRate: play ? OPENING.dayRate : 1,
    card: 0,
    done: !play,
  };
  let t = 0,
    live = play;
  return {
    get live() {
      return live;
    },
    frame,
    step(dt) {
      if (!live) return frame;
      t += Math.max(0, dt);
      openingAt(t, frame, climb);
      if (frame.done) this.skip();
      return frame;
    },
    skip() {
      if (!live) return;
      live = false;
      frame.yaw = 0;
      frame.climb = 0;
      frame.dayRate = 1;
      frame.card = 0;
      frame.done = true;
    },
  };
}
