import { describe, expect, it } from 'vitest';
import { ORBIT } from '../../src/engine/flight/Steering';
import {
  OPENING,
  OPENING_SECONDS,
  createOpening,
  openingAt,
  openingSeconds,
  openingStart,
  type OpeningFrame,
} from '../../src/engine/sim/Opening';
import { DECK } from '../../src/engine/sky/CloudCover';
import { DAY_SECONDS } from '../../src/engine/time/DayClock';
import { CLIMB } from '../../src/engine/flight/FlightController';

const blank = (): OpeningFrame => ({
  yaw: 0,
  climb: 0,
  cameraYaw: 0,
  cameraPitch: 0,
  cameraDist: 0,
  dayRate: 1,
  card: 0,
  done: false,
});
const at = (t: number) => openingAt(t, blank());

describe('openingAt', () => {
  it('runs its five acts in order and hands the flight back at the end', () => {
    const { side, turn, climb, hold } = OPENING;
    // level on the beam, then a turn, then the climb, then level again, then down
    expect(at(1).yaw).toBe(0);
    expect(at(1).climb).toBe(0);
    expect(at(side + 1).yaw).toBe(1);
    expect(at(side + 1).climb).toBe(0);
    expect(at(side + turn + 1).climb).toBe(1);
    expect(at(side + turn + 1).yaw).toBe(0);
    expect(at(side + turn + climb + 1).climb).toBe(0);
    expect(at(side + turn + climb + hold + 1).climb).toBe(-1);
    expect(at(OPENING_SECONDS - 0.01).done).toBe(false);
    expect(at(OPENING_SECONDS).done).toBe(true);
  });

  it('starts under the deck and climbs out over it in the time it gives itself, however deep the deck', () => {
    // The one number the acts have to agree with: the flight's own climb rate
    // over the length of the climb has to come out over the deck, or the
    // opening's money shot is a figure still in the cloud when the music stops.
    for (const deck of [
      { base: DECK.base[0], top: DECK.base[0] + DECK.thin },
      { base: DECK.base[1], top: DECK.base[1] + DECK.thick },
      { base: 950, top: 950 + 235 },
    ]) {
      const { y, climb } = openingStart(deck);
      // under the base, in clear air, where the first act's sunrise is seen
      expect(y).toBeLessThan(deck.base);
      expect(climb).toBeGreaterThanOrEqual(OPENING.climb);
      // with room to spare: the climb rate is reached over a second or so, and
      // the ground's own clearance may hold the figure down for part of the act
      expect(CLIMB * climb).toBeGreaterThanOrEqual((deck.top + OPENING.clearTop - y) * 1.3 - 1e-9);
      // and never so long that the opening is a minute and a half of cloud
      expect(openingSeconds(climb)).toBeLessThan(60);
    }
  });

  it('runs the script to the climb it was given', () => {
    const long = 30;
    const f = blank();
    const climbAt = OPENING.side + OPENING.turn;
    expect(openingAt(climbAt + long - 0.1, f, long).climb).toBe(1);
    expect(openingAt(climbAt + long + 0.1, f, long).climb).toBe(0);
    expect(openingAt(openingSeconds(long) - 0.01, f, long).done).toBe(false);
    expect(openingAt(openingSeconds(long), f, long).done).toBe(true);
    const opening = createOpening(true, long);
    for (let i = 0; i < Math.ceil(openingSeconds(long) * 60) + 4; i++) opening.step(1 / 60);
    expect(opening.live).toBe(false);
  });

  it('keeps the camera inside the frame a person could put it in', () => {
    // The script writes the orbit directly, so it has to obey the orbit's own
    // limits: a distance under `minDist` is a camera inside the figure.
    for (let t = 0; t <= OPENING_SECONDS; t += 0.1) {
      const f = at(t);
      expect(f.cameraDist).toBeGreaterThanOrEqual(ORBIT.minDist);
      expect(f.cameraDist).toBeLessThanOrEqual(ORBIT.maxDist);
      expect(f.cameraPitch).toBeGreaterThanOrEqual(ORBIT.minPitch);
      expect(f.cameraPitch).toBeLessThanOrEqual(ORBIT.maxPitch);
      expect(Number.isFinite(f.cameraYaw)).toBe(true);
    }
    // it does begin on the beam, which is the whole point of the first act: a
    // sunrise seen from behind the figure is a glare with a silhouette in it
    expect(at(0.5).cameraYaw).toBeGreaterThan(1.2);
    expect(at(OPENING_SECONDS - 0.5).cameraYaw).toBeLessThan(0.3);
  });

  it('shows the card early and takes it away before the flight is handed over', () => {
    expect(at(0).card).toBe(0);
    expect(at(1.5).card).toBeGreaterThan(0.8);
    expect(at(OPENING.card.gone + OPENING.card.out + 0.2).card).toBe(0);
    // and the card is gone well before the end, so nobody reads a title over a dive
    expect(OPENING.card.gone + OPENING.card.out).toBeLessThan(OPENING_SECONDS - 4);
  });

  it('runs the day fast under the card and gives it back before the end', () => {
    expect(at(1).dayRate).toBeGreaterThan(2);
    expect(at(OPENING_SECONDS - 0.5).dayRate).toBeCloseTo(1, 2);
    // A sunrise, not a whole day: what the sun does over the acts before the
    // hold, in a day 600 s long, has to be a few hundredths of one. The first
    // draft ran at eighteen and crossed half a day, so the opening ended with
    // the sun going back down the far side.
    // However long the climb: the day is given back as the card goes.
    for (const climb of [OPENING.climb, 40]) {
      let turned = 0;
      const f = blank();
      for (let t = 0; t < openingSeconds(climb); t += 0.05)
        turned += (openingAt(t, f, climb).dayRate * 0.05) / DAY_SECONDS;
      expect(turned, `climb ${climb}`).toBeGreaterThan(0.03);
      expect(turned, `climb ${climb}`).toBeLessThan(0.14);
    }
  });
});

describe('createOpening', () => {
  it('plays once, and a skip ends it wherever it was', () => {
    const opening = createOpening();
    expect(opening.live).toBe(true);
    opening.step(OPENING.side + OPENING.turn + 1);
    expect(opening.frame.climb).toBe(1);
    expect(opening.frame.dayRate).toBeGreaterThan(1);
    opening.skip();
    expect(opening.live).toBe(false);
    // Everything the script was holding is let go at once: the stick, the
    // clock and the card. A skip that left the day running at eighteen times
    // would be a skip nobody could see the end of.
    expect(opening.frame.climb).toBe(0);
    expect(opening.frame.yaw).toBe(0);
    expect(opening.frame.dayRate).toBe(1);
    expect(opening.frame.card).toBe(0);
    // and it stays ended
    opening.step(1);
    expect(opening.frame.climb).toBe(0);
  });

  it('ends itself at the end, without anyone asking', () => {
    const opening = createOpening();
    for (let i = 0; i < Math.ceil(OPENING_SECONDS * 60) + 4; i++) opening.step(1 / 60);
    expect(opening.live).toBe(false);
    expect(opening.frame.dayRate).toBe(1);
  });

  it('never starts for a resumed flight or a page that asked for less motion', () => {
    const opening = createOpening(false);
    expect(opening.live).toBe(false);
    expect(opening.frame.done).toBe(true);
    expect(opening.frame.dayRate).toBe(1);
    opening.step(2);
    expect(opening.frame.card).toBe(0);
    expect(opening.frame.yaw).toBe(0);
  });
});
