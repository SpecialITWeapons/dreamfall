import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { LOOK, applyLook, type Look, type PaletteKey } from '../../src/engine/render/ColorGrade';

const key = (t: number, zenith: number, sun = 0xffe0b0): PaletteKey => ({
  t,
  zenith: new Color(zenith),
  upper: new Color(zenith),
  horizon: new Color(0x9dbdcb),
  horizonWarm: new Color(0xf3d6a2),
  upperWarm: new Color(0xb9ccd6),
  glow: new Color(0xf8d29c),
  sun: new Color(sun),
  sunI: 3,
  hemiSky: new Color(0xbcd8e8),
  hemiGround: new Color(0x6a8850),
  hemiI: 1.8,
});
const look = (): Look => ({
  sat: 1,
  fogDensity: 0.00018,
  moon: { color: 0xa8bce8, intensity: 0.7 },
  keys: [key(0, 0x071222), key(0.5, 0x3e8dbb), key(1, 0x071222)],
  terrain: { sand: 0xc5bc85 },
  cloud: { white: 0xe1e4cb },
});
const hue = (c: Color) => c.getHSL({ h: 0, s: 0, l: 0 }).h;

describe('applyLook', () => {
  it('scales fog, moon and light intensities by the grade', () => {
    const l = applyLook(look());
    expect(l.sat).toBe(LOOK.sat);
    expect(l.fogDensity).toBeCloseTo(0.00018 * LOOK.fog, 12);
    expect(l.moon.intensity).toBeCloseTo(0.7 * LOOK.moonI, 12);
    expect(l.keys[0]!.sunI).toBeCloseTo(3 * LOOK.sunI, 12);
    expect(l.keys[0]!.hemiI).toBeCloseTo(1.8 * LOOK.hemiI, 12);
  });
  it('gives a clear day a sun several times its sky, and leaves the night its own balance', () => {
    const l = applyLook(look());
    const noon = l.keys[1]!,
      night = l.keys[0]!;
    expect(noon.sunI).toBeCloseTo(3 * LOOK.sunI * LOOK.daylight.sunI, 12);
    expect(noon.hemiI).toBeCloseTo(1.8 * LOOK.hemiI * LOOK.daylight.hemiI, 12);
    expect(noon.sunI / noon.hemiI).toBeGreaterThan(3);
    expect(night.sunI / night.hemiI).toBeCloseTo((3 * LOOK.sunI) / (1.8 * LOOK.hemiI), 12);
  });
  it('pulls the daytime blue toward the target hue and leaves the night hue alone', () => {
    const before = look();
    const dayHueBefore = hue(before.keys[1]!.zenith);
    const nightHueBefore = hue(before.keys[0]!.zenith);
    const l = applyLook(before);
    const dayHueAfter = hue(l.keys[1]!.zenith);
    expect(Math.abs(dayHueAfter - LOOK.sky.dayBlue.hueTarget)).toBeLessThan(
      Math.abs(dayHueBefore - LOOK.sky.dayBlue.hueTarget),
    );
    expect(hue(l.keys[0]!.zenith)).toBeCloseTo(nightHueBefore, 6);
  });
  it('re-grades terrain colors and keeps them valid hex values', () => {
    const l = applyLook(look());
    expect(l.terrain.sand).not.toBe(0xc5bc85);
    expect(l.terrain.sand).toBeGreaterThanOrEqual(0);
    expect(l.terrain.sand).toBeLessThanOrEqual(0xffffff);
  });
});
