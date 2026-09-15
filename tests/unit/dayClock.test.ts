import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DAY_SECONDS, NIGHT_SHARE, createDayClock, solar } from '../../src/engine/time/DayClock';

describe('solar', () => {
  it('pins midnight, noon and the full turn', () => {
    expect(solar(0)).toBe(0);
    expect(solar(0.5)).toBeCloseTo(0.5, 9);
    expect(solar(1)).toBeCloseTo(1, 9);
    expect(solar(2.5)).toBeCloseTo(2.5, 9);
  });
  it('runs the night faster: sunrise (solar 0.25) comes at an eighth of the day clock', () => {
    expect(NIGHT_SHARE).toBe(0.25);
    expect(solar(NIGHT_SHARE / 2)).toBeCloseTo(0.25, 3);
    expect(solar(1 - NIGHT_SHARE / 2)).toBeCloseTo(0.75, 3);
  });
  it('is monotonic, continuous and symmetric around noon', () => {
    let previous = 0;
    for (let i = 1; i <= 2000; i++) {
      const s = solar(i / 2000);
      expect(s).toBeGreaterThan(previous);
      expect(s - previous).toBeLessThan(0.003);
      previous = s;
    }
    for (const q of [0.05, 0.11, 0.2, 0.33]) expect(solar(1 - q)).toBeCloseTo(1 - solar(q), 9);
  });
});

describe('createDayClock', () => {
  it('advances the phase by the day clock and wraps', () => {
    const clock = createDayClock({ phase: 0.99 });
    clock.advance(DAY_SECONDS * 0.02);
    expect(clock.phase).toBeCloseTo(0.01, 9);
    clock.rate = 0.5;
    clock.advance(DAY_SECONDS * 0.02);
    expect(clock.phase).toBeCloseTo(0.02, 9);
  });
  it('evaluates the graded palette: noon is exactly the noon key, midnight the night key', () => {
    const clock = createDayClock({ phase: 0.5 });
    const noon = clock.look.keys.find((k) => k.t === 0.5)!;
    expect(clock.palette.sun.getHex()).toBe(noon.sun.getHex());
    expect(clock.palette.sunI).toBeCloseTo(noon.sunI, 9);
    clock.phase = 0;
    clock.evalPalette();
    expect(clock.palette.zenith.getHex()).toBe(clock.look.keys[0]!.zenith.getHex());
  });
  it('blends smoothly between keys', () => {
    const clock = createDayClock({ phase: 0.5 });
    const a = clock.palette.zenith.clone();
    clock.phase = 0.6;
    clock.evalPalette();
    const b = clock.palette.zenith.clone();
    const late = clock.look.keys.find((k) => k.t === 0.7)!.zenith;
    expect(b.getHex()).not.toBe(a.getHex());
    expect(b.getHex()).not.toBe(late.getHex());
  });
  it('puts the sun high at noon, below the horizon at midnight, and rising between', () => {
    const clock = createDayClock();
    const sun = new Vector3(),
      moon = new Vector3();
    clock.skyBodies(0.5, sun, moon);
    expect(sun.y).toBeGreaterThan(0.6);
    expect(sun.length()).toBeCloseTo(1, 9);
    clock.skyBodies(0, sun, moon);
    expect(sun.y).toBeLessThan(-0.6);
    expect(moon.y).toBeGreaterThan(0);
    let crossings = 0;
    let previous = sun.y;
    for (let i = 1; i <= 240; i++) {
      clock.skyBodies(i / 240, sun, moon);
      if (previous < 0 !== sun.y < 0) crossings++;
      previous = sun.y;
    }
    expect(crossings).toBe(2);
  });
  it('starts in the morning by default', () => {
    expect(createDayClock().phase).toBe(0.3);
  });
});
