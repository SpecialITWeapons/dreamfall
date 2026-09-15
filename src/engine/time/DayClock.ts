// The day: one clock for the world (dayPhase, 600 s a turn) and one for the
// sun (solar), which runs at one pace by day and faster through a night that
// is NIGHT_SHARE of the cycle, blended over the twilights so nothing jumps at
// the crossing. The palette, the sky bodies and everything keyed to the sun's
// height read solar phase; midnight is 0, noon is 0.5, in both clocks.
// Ported from fly-with-me's main.js.
import { Color, type Vector3 } from 'three';
import { applyLook, type Look, type PaletteKey } from '../render/ColorGrade';
import { sstep } from '../terrain/noise';

/** One full turn of the day clock, s. */
export const DAY_SECONDS = 600;
/** Night as a share of the day clock, sunset to sunrise. */
export const NIGHT_SHARE = 0.25;
/** Share of the day clock spent at the night pace, around midnight. */
export const NIGHT_CORE = 0.18;

export const solar = (() => {
  const half = NIGHT_SHARE / 2,
    core = NIGHT_CORE / 2,
    ramp = half - core;
  const dayPace = 0.5 / (1 - NIGHT_SHARE); // half the sun's arc over the day
  // the night's half of the arc: the core at the night pace, each ramp at the mean of both
  const nightPace = (0.25 - (dayPace * ramp) / 2) / (core + ramp / 2);
  const rise = (nightPace - dayPace) / 2;
  const fold = (q: number) => {
    // 0..0.5 from midnight; the pace along a ramp is dayPace + rise * (1 + cos)
    if (q <= core) return nightPace * q;
    if (q <= half) {
      const u = (q - core) / ramp;
      return nightPace * core + ramp * ((dayPace + rise) * u + (rise * Math.sin(Math.PI * u)) / Math.PI);
    }
    return 0.25 + dayPace * (q - half);
  };
  return (phase: number) => {
    const whole = Math.floor(phase),
      q = phase - whole;
    return whole + (q <= 0.5 ? fold(q) : 1 - fold(1 - q));
  };
})();

const C = (hex: number) => new Color(hex);
const P = (
  t: number,
  zenith: number,
  upper: number,
  horizon: number,
  below: number,
  sun: number,
  sunI: number,
  hemiSky: number,
  hemiGround: number,
  hemiI: number,
  horizonWarm = horizon,
  upperWarm = upper,
  glow = horizonWarm,
): PaletteKey => ({
  t,
  zenith: C(zenith),
  upper: C(upper),
  horizon: C(horizon),
  horizonWarm: C(horizonWarm),
  upperWarm: C(upperWarm),
  glow: C(glow),
  below: C(below),
  sun: C(sun),
  sunI,
  hemiSky: C(hemiSky),
  hemiGround: C(hemiGround),
  hemiI,
});
const night = (t: number) =>
  P(t, 0x071222, 0x10192e, 0x2e2831, 0x10121b, 0xffb070, 2.4, 0x213258, 0x0e1116, 0.6);

/** The ungraded look: palette anchors through the day keyed in solar phase, terrain and cloud colors, the moon. */
export function baseLook(): Look {
  return {
    sat: 1,
    fogDensity: 0.00018,
    moon: { color: 0xa8bce8, intensity: 0.7 },
    keys: [
      night(0.0),
      // astronomical dawn: the first hint of warmth low on the sun's side
      P(
        0.17,
        0x03071a,
        0x0a1430,
        0x1a2a4c,
        0x0b1224,
        0xffb070,
        2.4,
        0x22335a,
        0x101318,
        0.55,
        0x2b3454,
        0x0a1430,
        0x3a3450,
      ),
      // civil dawn: a deep orange band under a mauve sky, the land still blue
      P(
        0.215,
        0x11254e,
        0x2c4878,
        0x6b7d9c,
        0x2a3448,
        0xffa860,
        2.5,
        0x4c5f88,
        0x2a2b2a,
        0.9,
        0xe28a52,
        0x8a6a8e,
        0xf07038,
      ),
      // sunrise: gold on the horizon, peach above it, long cool shadows
      P(
        0.25,
        0x2d5c92,
        0x6d95bc,
        0x9eafbc,
        0x5f7480,
        0xffb070,
        2.9,
        0xa8c2d6,
        0x4a5a44,
        1.5,
        0xffb066,
        0xe8a88a,
        0xff9a4a,
      ),
      // morning
      P(
        0.3,
        0x3a80b4,
        0x74a8cc,
        0x9dbdcb,
        0x83a3a8,
        0xffe0b0,
        3.0,
        0xbcd8e8,
        0x6a8850,
        1.8,
        0xf3d6a2,
        0xb9ccd6,
        0xf8d29c,
      ),
      // noon: the approved day
      P(
        0.5,
        0x3e8dbb,
        0x76acd0,
        0x96bdcd,
        0x8dacae,
        0xfff1cb,
        3,
        0xc2deeb,
        0x739054,
        1.8,
        0xe2e4c3,
        0xabcfda,
      ),
      // late afternoon: the light turns gold
      P(
        0.7,
        0x3f7fae,
        0x7ca4c2,
        0xa4b4ba,
        0x8a9a94,
        0xffd9a0,
        2.9,
        0xc4d4d8,
        0x6a7a50,
        1.7,
        0xf4c584,
        0xc4b8a0,
        0xf8b468,
      ),
      // sunset: orange fire low, salmon above, the far side already rose and blue
      P(
        0.75,
        0x2f4a82,
        0x6c7aa0,
        0x9aa0b0,
        0x5a5c6a,
        0xff9a40,
        2.7,
        0xa898b0,
        0x5a4a40,
        1.35,
        0xffa040,
        0xe09a78,
        0xff6a2a,
      ),
      // civil dusk: afterglow, purple upper sky, the first stars
      P(
        0.785,
        0x172850,
        0x394272,
        0x6c6480,
        0x2e3448,
        0xff9048,
        2.4,
        0x4a4a76,
        0x2a2828,
        0.9,
        0xf07a3a,
        0xa06a82,
        0xf25a2a,
      ),
      // nautical dusk: the last warmth drains into blue
      P(
        0.83,
        0x060c22,
        0x0e1838,
        0x243050,
        0x0e1424,
        0xffb070,
        2.4,
        0x263658,
        0x121418,
        0.55,
        0x3d3452,
        0x101838,
        0x50384a,
      ),
      night(1.0),
    ],
    terrain: {
      sand: 0xc5bc85,
      snow: 0xe1e5d2,
      seaFloor: 0x6d9988,
      waterDeep: 0x286e7b,
      waterShallow: 0x74b9a9,
    },
    cloud: { white: 0xe1e4cb },
  };
}

export interface Palette {
  zenith: Color;
  upper: Color;
  horizon: Color;
  horizonWarm: Color;
  upperWarm: Color;
  glow: Color;
  below: Color;
  sun: Color;
  sunI: number;
  hemiSky: Color;
  hemiGround: Color;
  hemiI: number;
}

const PALETTE_COLORS = [
  'zenith',
  'upper',
  'horizon',
  'horizonWarm',
  'upperWarm',
  'glow',
  'below',
  'sun',
  'hemiSky',
  'hemiGround',
] as const;

export interface DayClock {
  /** The graded look: palette keys, terrain and cloud colors, the moon. */
  readonly look: Look;
  /** Day-clock phase, 0 midnight, 0.5 noon. */
  phase: number;
  /** Day-clock speed multiplier (the opening stretches the day in a later milestone). */
  rate: number;
  /** The palette at the current phase, refreshed by advance() and evalPalette(). */
  readonly palette: Palette;
  advance(dt: number): void;
  evalPalette(): void;
  /** Where the sun and the moon stand at a day-clock phase, as unit vectors. The moon rides its own arc. */
  skyBodies(phase: number, sunOut: Vector3, moonOut: Vector3): void;
}

export function createDayClock(opts: { phase?: number } = {}): DayClock {
  const look = applyLook(baseLook());
  const keys = look.keys;
  const palette: Palette = {
    zenith: C(0),
    upper: C(0),
    horizon: C(0),
    horizonWarm: C(0),
    upperWarm: C(0),
    glow: C(0),
    below: C(0),
    sun: C(0),
    sunI: 1,
    hemiSky: C(0),
    hemiGround: C(0),
    hemiI: 1,
  };
  let phase = opts.phase ?? 0.3;
  const evalPalette = () => {
    let p = solar(phase);
    p = p - Math.floor(p);
    let i = 0;
    while (keys[i + 1]!.t < p) i++;
    const a = keys[i]!,
      b = keys[i + 1]!;
    const t = sstep(0, 1, (p - a.t) / (b.t - a.t));
    for (const k of PALETTE_COLORS) palette[k].copy(a[k]).lerp(b[k], t);
    palette.sunI = a.sunI + (b.sunI - a.sunI) * t;
    palette.hemiI = a.hemiI + (b.hemiI - a.hemiI) * t;
  };
  evalPalette();
  return {
    look,
    get phase() {
      return phase;
    },
    set phase(v: number) {
      phase = ((v % 1) + 1) % 1;
    },
    rate: 1,
    palette,
    advance(dt) {
      phase = (phase + (dt * this.rate) / DAY_SECONDS) % 1;
      evalPalette();
    },
    evalPalette,
    skyBodies(at, sunOut, moonOut) {
      const elev = (solar(at) - 0.25) * Math.PI * 2;
      sunOut
        .set(-0.18 - 0.27 * Math.sin(elev), Math.sin(elev) * 0.7, Math.cos(elev) * 0.65 + 0.55)
        .normalize();
      const melev = elev + Math.PI + 0.35;
      moonOut
        .set(0.3 - 0.2 * Math.sin(melev), Math.sin(melev) * 0.45, -(Math.cos(melev) * 0.5 + 0.45))
        .normalize();
    },
  };
}
