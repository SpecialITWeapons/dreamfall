// The arithmetic of the ambience, kept apart from Web Audio so it can be
// tested in Node: what the wind sounds like at a height and a climb, how
// much sea is around, which note a chime takes.

export const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99];

export interface WindInput {
  /** Height over the ground, m. */
  altitude: number;
  vy: number;
  /** A burst of stronger flutter, 0..1. */
  gust: number;
  t: number;
  /** Airspeed against the speed of level flight: 1 level, more in a dive, less in a climb. */
  rush: number;
}

/**
 * Wind that follows altitude, climb, gusts and how fast the figure is actually
 * going: the low-pass cutoff and the gain of the pink noise. The rush is what
 * a dive is heard as -- the air itself gets louder and brighter, not just the
 * flutter it shakes out of the suit.
 */
export function windParams({ altitude, vy, gust, t, rush }: WindInput): {
  frequency: number;
  gain: number;
} {
  const swell = 0.5 + 0.5 * Math.sin(t * 0.43) * Math.sin(t * 0.071 + 1.3);
  const g = Math.max(swell, gust);
  const fast = Math.max(-0.25, Math.min(0.6, rush - 1));
  return {
    frequency:
      380 + Math.min(1, Math.max(0, altitude) / 700) * 700 + g * 260 + Math.abs(vy) * 18 + fast * 420,
    gain: 0.16 + 0.1 * g + 0.05 * Math.min(1, Math.abs(vy) / 10) + 0.09 * fast,
  };
}

/** How much of the ground around a point is under water, fading with altitude, 0..1. */
export function waterAmount(
  groundAt: (x: number, z: number) => number,
  x: number,
  z: number,
  altitude: number,
): number {
  let under = 0;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (groundAt(x + Math.cos(a) * 320, z + Math.sin(a) * 320) < 0) under++;
  }
  const near = groundAt(x, z) < 0 ? 1 : 0;
  return Math.min(1, (under / 8) * 0.8 + near * 0.4) * Math.max(0, 1 - altitude / 500);
}

/** A pentatonic note for a chime from two draws: the note, and the octave above three times in ten. */
export function chimeNote(r1: number, r2: number): number {
  return PENTA[Math.min(PENTA.length - 1, Math.floor(r1 * PENTA.length))]! * (r2 < 0.3 ? 2 : 1);
}

/**
 * The layers a biome may ask for, as the contract names them. The engine
 * synthesises all five; a biome says how much of each belongs to it, and what
 * the flyer hears is those weighed by which biomes are actually under them.
 */
export const LAYERS = ['crickets', 'birds', 'surf', 'bells', 'wind-high'] as const;
export type Layer = (typeof LAYERS)[number];

export interface LayerInput {
  /** The biome slots under the flyer, as the height window keeps them. */
  ids: ArrayLike<number>;
  /** Their weights, summing to about one. */
  weights: ArrayLike<number>;
  /** What each biome of the registry asks for, by the index its slot points at. */
  specs: ReadonlyArray<Partial<Record<Layer, number>> | undefined>;
  /** Solar phase: 0 midnight, 0.5 noon. Not the day clock -- what the sun is doing. */
  solar: number;
  /** Height over the ground, m. */
  altitude: number;
}

/** Zero at and below `from`, one at and above `to`, smooth between. */
const fade = (v: number, from: number, to: number) => {
  const t = Math.max(0, Math.min(1, (v - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/**
 * What each layer is worth here and now: the biomes under the flyer, weighed,
 * then gated by the two things that decide whether a sound reaches an ear
 * two hundred metres up in the middle of the night.
 *
 * **Height.** Crickets, birds and bells are things standing on the ground and
 * they are gone by 450 m; surf is a coastline and carries twice as far; the
 * high wind is the opposite of all of them and only starts where they stop.
 * Without this the flight hears a cricket from two kilometres, which is the
 * kind of detail that reads as a bug rather than as atmosphere.
 *
 * **The sun.** Crickets are the night's and birds are the day's -- that is not
 * in the contract, and it is the one place here where the engine decides
 * something on a biome's behalf. It does it because the alternative is every
 * biome writing the same two rules, and because a dawn chorus at midnight is
 * wrong in a way no biome would ever ask for.
 */
export function layerMix(input: LayerInput): Record<Layer, number> {
  const out = { crickets: 0, birds: 0, surf: 0, bells: 0, 'wind-high': 0 } as Record<Layer, number>;
  for (let i = 0; i < 3; i++) {
    const weight = input.weights[i] ?? 0;
    if (weight <= 0) continue;
    const spec = input.specs[input.ids[i] ?? -1];
    if (!spec) continue;
    for (const layer of LAYERS) out[layer] += weight * Math.max(0, Math.min(1, spec[layer] ?? 0));
  }
  // The sun's height off the solar phase: 0 at midnight, 1 at noon.
  const sun = Math.max(0, Math.min(1, 1 - Math.abs(input.solar - 0.5) * 2)) * 2 - 1;
  const night = 1 - fade(sun, -0.16, 0.06);
  const day = fade(sun, -0.12, 0.12);
  const ground = 1 - fade(input.altitude, 180, 450);
  const far = 1 - fade(input.altitude, 320, 900);
  out.crickets *= night * ground;
  out.birds *= day * ground;
  out.bells *= day * ground;
  out.surf *= far;
  out['wind-high'] *= fade(input.altitude, 300, 1000);
  for (const layer of LAYERS) out[layer] = Math.max(0, Math.min(1, out[layer]));
  return out;
}
