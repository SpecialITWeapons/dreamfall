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
