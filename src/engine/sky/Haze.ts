// The haze a country puts in its own air: a biome's `ambience.fogTint`, mixed
// by the same three slots of the height window the ground is painted from and
// the ambience is heard through.
//
// Nothing here touches Three.js beyond `Color`, which is arithmetic, so the mix
// is read by a test in Node. What it does *not* do is decide where the tint
// goes: the fog, the background and the dome's horizon are one uniform in this
// engine, so a tint is a tint of all three, and that is the point -- a jungle's
// air is green from inside it and the horizon over it is green too.
import type { Color } from 'three';

export interface HazeSpec {
  /** What the air is tinted toward. */
  color: Color;
  /** How far toward it, before any weighing, 0..1. */
  amount: number;
}

/** Zero at and below `from`, one at and above `to`, smooth between. */
const fade = (v: number, from: number, to: number) => {
  const t = Math.max(0, Math.min(1, (v - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/**
 * How much of a haze the air here holds, and what colour. Haze is low air: it
 * is gone by the time the flight is over it, which is what the altitude fade
 * is, and it is capped -- a biome may colour the horizon, never repaint it.
 *
 * It is also **lit** air. At midnight there is nothing for a jungle to tint
 * green, and tinting it anyway lifts the whole night sky toward the biome's
 * colour: the Milky Way's own test caught that, with the core and the far side
 * of the galaxy 0.058 and 0.051 where they had been 0.049 and 0.028 -- a
 * difference washed out by a haze that should not have been there.
 *
 * @returns how far to lerp toward `out`, 0 when there is nothing to do.
 */
export const MAX_HAZE = 0.35;

export function hazeAt(
  ids: ArrayLike<number>,
  weights: ArrayLike<number>,
  specs: ReadonlyArray<HazeSpec | undefined>,
  altitude: number,
  /** How much daylight there is, 0 at midnight: haze is lit air, and unlit air is not hazy. */
  daylight: number,
  out: Color,
): number {
  let amount = 0,
    r = 0,
    g = 0,
    b = 0;
  for (let i = 0; i < 3; i++) {
    const weight = weights[i] ?? 0;
    if (weight <= 0) continue;
    const spec = specs[ids[i] ?? -1];
    if (!spec || spec.amount <= 0) continue;
    const share = weight * spec.amount;
    amount += share;
    r += spec.color.r * share;
    g += spec.color.g * share;
    b += spec.color.b * share;
  }
  if (amount <= 0) return 0;
  // the colour is the average of what asked for it, so two biomes tinting the
  // air do not brighten it by being two
  out.setRGB(r / amount, g / amount, b / amount);
  return Math.min(MAX_HAZE, amount) * (1 - fade(altitude, 320, 1500)) * Math.max(0, Math.min(1, daylight));
}
