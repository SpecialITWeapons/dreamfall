// The high layer: cloud painted on the dome, far over the deck and out of
// reach. It was a field of noise cut near its middle, so it covered half the
// sky at every hour of every seed, and the owner read it as a lid over the
// blue. How much of it there is is now weather: a slow wander through
// simulation time, drawn from the seed -- clear for long stretches, a few
// scattered clouds often, a broken sky seldom. The CPU decides it once a frame
// and the dome and the water only read it (`uHighCover`), which is what lets a
// test in Node hold the odds.
import { hash2, sstep } from '../terrain/noise';

export const HIGH_CLOUD = {
  /** Seconds of simulation time between two independent draws of the weather, slow and quick. */
  period: [600, 180] as const,
  /** How much each of the two speaks. */
  weight: [0.75, 0.25] as const,
  /** Under this draw the sky is clear; the cover then rises to 1 at `full`. */
  clear: 0.42,
  full: 0.95,
};

const SALT = 0x4c1d;

/** One smooth draw through time, 0..1: independent at each knot, eased between them. */
function wander(seed: number, t: number, period: number, octave: number): number {
  const x = t / period,
    k = Math.floor(x);
  const a = hash2(seed, k, SALT + octave) / 4294967296,
    b = hash2(seed, k + 1, SALT + octave) / 4294967296;
  return a + (b - a) * sstep(0, 1, x - k);
}

/**
 * How much of the high layer there is at simulation time `t`, 0..1: 0 is a
 * clear sky and 1 the most the dome paints (a third of it or so).
 */
export function highCloudCover(seed: number, t: number): number {
  const s = seed >>> 0;
  const draw =
    wander(s, t, HIGH_CLOUD.period[0], 0) * HIGH_CLOUD.weight[0] +
    wander(s, t, HIGH_CLOUD.period[1], 1) * HIGH_CLOUD.weight[1];
  const x = Math.max(0, (draw - HIGH_CLOUD.clear) / (HIGH_CLOUD.full - HIGH_CLOUD.clear));
  return Math.min(1, x) ** 1.5;
}
