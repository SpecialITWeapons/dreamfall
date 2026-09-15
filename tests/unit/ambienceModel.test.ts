import { describe, expect, it } from 'vitest';
import { PENTA, chimeNote, waterAmount, windParams } from '../../src/engine/audio/AmbienceModel';

describe('windParams', () => {
  it('rises with altitude, climb and gusts', () => {
    const low = windParams({ altitude: 0, vy: 0, gust: 0, t: 0 }),
      high = windParams({ altitude: 1000, vy: 0, gust: 0, t: 0 }),
      gusty = windParams({ altitude: 0, vy: 0, gust: 1, t: 0 }),
      climbing = windParams({ altitude: 0, vy: 10, gust: 0, t: 0 });
    expect(high.frequency - low.frequency).toBeCloseTo(700, 9);
    expect(gusty.frequency).toBeGreaterThan(low.frequency);
    expect(gusty.gain).toBeGreaterThan(low.gain);
    expect(climbing.gain).toBeCloseTo(low.gain + 0.05, 9);
    expect(climbing.frequency).toBeCloseTo(low.frequency + 180, 9);
    expect(low.gain).toBeGreaterThan(0.15);
    expect(gusty.gain).toBeLessThanOrEqual(0.31);
    expect(windParams({ altitude: -50, vy: 0, gust: 0, t: 0 }).frequency).toBe(low.frequency);
  });
});

describe('waterAmount', () => {
  it('is loud over the sea near the surface, silent high up or inland, and partial at a shore', () => {
    const sea = () => -10,
      land = () => 50;
    expect(waterAmount(sea, 0, 0, 0)).toBe(1);
    expect(waterAmount(sea, 0, 0, 250)).toBeCloseTo(0.5, 9);
    expect(waterAmount(sea, 0, 0, 600)).toBe(0);
    expect(waterAmount(land, 0, 0, 0)).toBe(0);
    // three of the eight ring samples (x > 1) lie in the sea, the point itself is on land
    const shore = (x: number) => (x > 1 ? -5 : 5);
    expect(waterAmount(shore, 0, 0, 0)).toBeCloseTo(0.3, 9);
  });
});

describe('chimeNote', () => {
  it('picks a pentatonic note and sometimes the octave above', () => {
    expect(chimeNote(0, 0.5)).toBe(PENTA[0]);
    expect(chimeNote(0, 0.1)).toBe(PENTA[0]! * 2);
    expect(chimeNote(0.999, 0.5)).toBe(PENTA[PENTA.length - 1]);
  });
});
