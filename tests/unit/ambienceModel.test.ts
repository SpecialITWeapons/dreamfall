import { describe, expect, it } from 'vitest';
import {
  LAYERS,
  PENTA,
  chimeNote,
  layerMix,
  waterAmount,
  windParams,
} from '../../src/engine/audio/AmbienceModel';

describe('windParams', () => {
  it('rises with altitude, climb, gusts and the rush of a dive', () => {
    const level = { altitude: 0, vy: 0, gust: 0, t: 0, rush: 1 };
    const low = windParams(level),
      high = windParams({ ...level, altitude: 1000 }),
      gusty = windParams({ ...level, gust: 1 }),
      climbing = windParams({ ...level, vy: 10 });
    expect(high.frequency - low.frequency).toBeCloseTo(700, 9);
    expect(gusty.frequency).toBeGreaterThan(low.frequency);
    expect(gusty.gain).toBeGreaterThan(low.gain);
    expect(climbing.gain).toBeCloseTo(low.gain + 0.05, 9);
    expect(climbing.frequency).toBeCloseTo(low.frequency + 180, 9);
    expect(low.gain).toBeGreaterThan(0.15);
    expect(gusty.gain).toBeLessThanOrEqual(0.31);
    expect(windParams({ ...level, altitude: -50 }).frequency).toBe(low.frequency);
    // the air itself: a dive is louder and brighter, a climb quieter, both bounded
    const diving = windParams({ ...level, rush: 59 / 40 }),
      soaring = windParams({ ...level, rush: 27 / 40 });
    expect(diving.frequency).toBeGreaterThan(low.frequency + 150);
    expect(diving.gain).toBeGreaterThan(low.gain + 0.03);
    expect(soaring.frequency).toBeLessThan(low.frequency - 90);
    expect(soaring.gain).toBeLessThan(low.gain - 0.02);
    // and neither end runs away with it
    expect(windParams({ ...level, rush: 4 }).gain).toBeCloseTo(low.gain + 0.09 * 0.6, 9);
    expect(windParams({ ...level, rush: 0 }).gain).toBeCloseTo(low.gain - 0.09 * 0.25, 9);
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

describe('layerMix', () => {
  // Two biomes: a meadow full of insects and birds, and a coast with surf.
  const specs = [{ crickets: 1, birds: 0.8 }, { surf: 1, 'wind-high': 0.4 }, undefined];
  const at = (over: Partial<Parameters<typeof layerMix>[0]> = {}) =>
    layerMix({
      ids: [0, 1, 2],
      weights: [1, 0, 0],
      specs,
      solar: 0.5,
      altitude: 0,
      ...over,
    });

  it('weighs a biome by how much of it is under the flyer', () => {
    // Half meadow, half coast: half of each biome's own layers.
    const half = at({ weights: [0.5, 0.5, 0], altitude: 0, solar: 0.5 });
    expect(half.birds).toBeCloseTo(0.4, 6);
    expect(half.surf).toBeCloseTo(0.5, 6);
    // and a slot pointing at a biome that asked for nothing contributes nothing
    const empty = at({ ids: [2, 2, 2], weights: [1, 0, 0] });
    for (const layer of LAYERS) expect(empty[layer]).toBe(0);
  });

  it('gives the night to the crickets and the day to the birds', () => {
    const noon = at({ solar: 0.5 }),
      midnight = at({ solar: 0 });
    expect(noon.birds).toBeGreaterThan(0.7);
    expect(noon.crickets).toBe(0);
    expect(midnight.crickets).toBeGreaterThan(0.9);
    expect(midnight.birds).toBe(0);
    // and the two cross over rather than switching: at the sun's own horizon
    // both are part way, which is what a dusk sounds like.
    const dusk = at({ solar: 0.25 });
    expect(dusk.crickets).toBeGreaterThan(0);
    expect(dusk.crickets).toBeLessThan(1);
  });

  it('leaves the ground sounds on the ground and starts the high wind where they stop', () => {
    // A cricket does not carry to two hundred metres, let alone to two
    // thousand, and a flight that hears one from up there reads as a bug.
    const ground = at({ solar: 0, altitude: 0 }),
      up = at({ solar: 0, altitude: 300 }),
      high = at({ solar: 0, altitude: 600 });
    expect(ground.crickets).toBeGreaterThan(0.9);
    expect(up.crickets).toBeLessThan(ground.crickets);
    expect(high.crickets).toBe(0);
    // surf carries twice as far as a cricket, because a coastline is loud
    const coast = (altitude: number) =>
      layerMix({ ids: [1, 0, 0], weights: [1, 0, 0], specs, solar: 0.5, altitude });
    expect(coast(600).surf).toBeGreaterThan(0);
    expect(coast(300).surf).toBeGreaterThan(coast(600).surf);
    expect(coast(1200).surf).toBe(0);
    // and the high wind is the one layer that grows with height
    expect(coast(0)['wind-high']).toBe(0);
    expect(coast(1200)['wind-high']).toBeGreaterThan(0.35);
  });

  it('never asks for more than one of anything, however the weights land', () => {
    // Three slots all pointing at the loudest biome, weights over one: the
    // mixer downstream multiplies gains by these, so a 2.4 here is a clipped
    // channel there.
    const loud = layerMix({
      ids: [0, 0, 0],
      weights: [1, 1, 1],
      specs,
      solar: 0,
      altitude: 0,
    });
    for (const layer of LAYERS) {
      expect(loud[layer]).toBeGreaterThanOrEqual(0);
      expect(loud[layer]).toBeLessThanOrEqual(1);
    }
  });
});
