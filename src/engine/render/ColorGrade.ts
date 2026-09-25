// Storybook Punch: the world's look. Richer daylight blue, higher saturation
// and contrast, stronger bloom, ACES kept. Palette nudges follow solar time so
// dawn and dusk stay gold and night stays dark. Cheap: copies at load plus a
// few ops in the display pass. Ported from fly-with-me's color-grade.js.
import { Color } from 'three';

export interface PaletteKey {
  t: number;
  zenith: Color;
  upper: Color;
  horizon: Color;
  horizonWarm: Color;
  upperWarm: Color;
  glow: Color;
  sun: Color;
  sunI: number;
  hemiSky: Color;
  hemiGround: Color;
  hemiI: number;
}

export interface Look {
  sat: number;
  fogDensity: number;
  moon: { color: number; intensity: number };
  keys: PaletteKey[];
  terrain: Record<string, number>;
  cloud: { white: number };
}

export const LOOK = {
  sat: 1.26,
  exposure: 1.12,
  bloom: { strength: 0.34, radius: 0.68, threshold: 1.02 },
  materialGray: 0,
  materialPow: 0.84,
  /**
   * The illustrated response (`SoftIllustratedLighting`): what a face turned
   * from the light still gets, and how much of the response is bands rather
   * than the plain cosine. At 0.18 and 0.65 every slope that saw the sun at
   * all got the same light, so the land had no relief in it at noon.
   */
  bands: { floor: 0.08, share: 0.4 },
  sunI: 1.12,
  hemiI: 1.08,
  /** The far air's density over the palette's. It was 0.82, and the land behind the land was a wall of haze. */
  fog: 0.55,
  moonI: 1.05,
  /** How much of the direct light a cast shadow takes away, sun and moon. */
  shadow: { sun: 0.82, moon: 0.43 },
  /**
   * What a clear day is made of: the sun several times the sky, warm light
   * and blue shade. Weighed by the day, so dawn and dusk keep their keys. The
   * sky's light was two thirds of the sun's, which lit the world like an
   * overcast morning however high the sun stood.
   */
  daylight: {
    sunI: 1.3,
    hemiI: 0.7,
    sun: { hueTarget: 0.11, huePull: 0.25, light: -0.03 },
    /** Sunlit cloud over paper white, so it is the brightest thing in the sky and the bloom finds it. */
    cloudSun: 1.45,
    /** Light scattered forward around the sun in the air: a broad lobe and a tight one. */
    scatter: { broad: 0.2, tight: 0.32 },
    /**
     * Exposure by day, times the grade's: the stronger sun would otherwise
     * push the lit ground into the shoulder of the tone curve, where colour
     * goes to white and the land looks bleached rather than sunny.
     */
    exposure: 0.88,
    /** The sun's disc by day, times its dawn brightness: far over the bloom's threshold. */
    disc: 6,
    /** How far the eye stops down looking straight into a high sun, and how fast, 1/s. */
    glare: { stop: 0.16, rate: 2.5 },
  },
  post: {
    sat: 1.18,
    contrast: 1.14,
    mul: 0.98,
    lift: [0.006, 0.01, 0.016] as [number, number, number],
  },
  sky: {
    dayBlue: { hueTarget: 0.585, huePull: 0.78, sat: 0.26, light: -0.05 },
    dayHorizon: { hueTarget: 0.56, huePull: 0.5, sat: 0.16, light: -0.03 },
    twilightSat: 0.12,
    nightBlue: { sat: 0.04, light: -0.01 },
  },
  terrain: { sat: 0.08, light: 0.01 },
} as const;

interface Recipe {
  hueTarget?: number;
  huePull?: number;
  sat?: number;
  light?: number;
}

const hsl = { h: 0, s: 0, l: 0 };

export function adjustColor(
  color: Color,
  { hueTarget, huePull = 0, sat = 0, light = 0 }: Recipe,
  amount = 1,
): Color {
  if (amount <= 0) return color;
  color.getHSL(hsl);
  if (hueTarget != null && huePull) {
    let d = hueTarget - hsl.h;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    hsl.h = (hsl.h + d * huePull * amount + 1) % 1;
  }
  hsl.s = Math.min(1, Math.max(0, hsl.s + sat * amount));
  hsl.l = Math.min(1, Math.max(0.02, Math.min(0.96, hsl.l + light * amount)));
  color.setHSL(hsl.h, hsl.s, hsl.l);
  return color;
}

export function dayWeight(t: number): number {
  if (t <= 0.22 || t >= 0.8) return 0;
  if (t >= 0.34 && t <= 0.66) return 1;
  if (t < 0.34) return (t - 0.22) / 0.12;
  return (0.8 - t) / 0.14;
}

function twilightWeight(t: number): number {
  const near = (center: number, width: number) => Math.max(0, 1 - Math.abs(t - center) / width);
  return Math.max(near(0.215, 0.05), near(0.25, 0.06), near(0.75, 0.06), near(0.785, 0.05));
}

function nightWeight(t: number): number {
  if (t <= 0.17 || t >= 0.83) return 1;
  if (t >= 0.22 && t <= 0.8) return 0;
  if (t < 0.22) return (0.22 - t) / 0.05;
  return Math.min(1, (t - 0.8) / 0.03);
}

function adjustHex(hex: number, recipe: Recipe, amount: number): number {
  return adjustColor(new Color(hex), recipe, amount).getHex();
}

/** Applies the grade to a base look in place and returns it. */
export function applyLook(look: Look): Look {
  look.sat = LOOK.sat;
  look.fogDensity *= LOOK.fog;
  look.moon.intensity *= LOOK.moonI;
  for (const key of Object.keys(look.terrain))
    look.terrain[key] = adjustHex(look.terrain[key]!, LOOK.terrain, 1);
  for (const key of look.keys) {
    const day = dayWeight(key.t);
    const dusk = twilightWeight(key.t);
    const night = nightWeight(key.t);
    const sky = LOOK.sky;
    if (day) {
      for (const field of ['zenith', 'upper', 'hemiSky'] as const) adjustColor(key[field], sky.dayBlue, day);
      adjustColor(key.horizon, sky.dayHorizon, day * 0.85);
    }
    if (dusk) {
      for (const field of ['glow', 'horizonWarm', 'upperWarm', 'sun'] as const)
        adjustColor(key[field], { sat: sky.twilightSat }, dusk);
    }
    if (night) {
      for (const field of ['zenith', 'upper', 'hemiSky'] as const)
        adjustColor(key[field], sky.nightBlue, night);
    }
    if (day) adjustColor(key.sun, LOOK.daylight.sun, day);
    key.sunI *= LOOK.sunI * (1 + (LOOK.daylight.sunI - 1) * day);
    key.hemiI *= LOOK.hemiI * (1 + (LOOK.daylight.hemiI - 1) * day);
  }
  return look;
}
