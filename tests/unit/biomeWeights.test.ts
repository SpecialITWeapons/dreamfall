import { describe, expect, it } from 'vitest';
import { defineBiome, type Biome, type GroundHook } from '../../library/contract';
import { climatePoint } from '../../library/standard/presence.js';
import { createFields } from '../../src/engine/terrain/Fields';
import { MAX_HEIGHT_DELTA, SLOTS, createWorldSampler } from '../../src/engine/terrain/WorldSampler';

const ground = (() => ({ albedo: null })) as unknown as GroundHook;
/** A biome that lives at one point of climate space. */
const at = (t: number, m: number, r: number): Biome =>
  defineBiome({
    id: `b${t}-${m}-${r}`,
    name: 'b',
    params: {},
    presence: climatePoint({ point: [t, m, r] }),
    ground,
  });
const sampleAt = (sampler: ReturnType<typeof createWorldSampler>, x: number, z: number) => {
  const out = new Float32Array(4),
    slots = new Uint8Array(4);
  sampler.sampleWindow(x, z, out, slots);
  return { h: out[0]!, w: [out[1]!, out[2]!, out[3]!], i: [slots[0]!, slots[1]!, slots[2]!] };
};
const PLACES: Array<[number, number]> = [
  [0, 0],
  [4000, -9000],
  [-21000, 13000],
  [60000, 60000],
];

describe('sampleWindow', () => {
  it('without a library it is the world of M1: one slot, weight one, the base height', () => {
    const plain = createWorldSampler(42);
    const base = new Float32Array(4);
    plain.sample(1000, -500, base);
    const s = sampleAt(plain, 1000, -500);
    expect(s.h).toBeCloseTo(base[0]!, 6);
    expect(s.w).toEqual([1, 0, 0]);
    expect(s.i).toEqual([0, 0, 0]);
    expect(SLOTS).toBe(3);
  });
  it('keeps the three strongest biomes, renormalised to one', () => {
    // five points spread across climate space, so any place has a clear winner
    const biomes = [
      at(0.2, 0.2, 0.2),
      at(0.5, 0.5, 0.5),
      at(0.8, 0.8, 0.8),
      at(0.2, 0.8, 0.5),
      at(0.8, 0.2, 0.5),
    ];
    const sampler = createWorldSampler(42, { biomes });
    for (const [x, z] of PLACES) {
      const s = sampleAt(sampler, x, z);
      expect(s.w[0]! + s.w[1]! + s.w[2]!).toBeCloseTo(1, 5);
      expect(s.w[0]).toBeGreaterThanOrEqual(s.w[1]!);
      expect(s.w[1]).toBeGreaterThanOrEqual(s.w[2]!);
      expect(new Set(s.i).size).toBe(3); // three different biomes
      for (const i of s.i) expect(i).toBeLessThan(biomes.length);
    }
  });
  it('drops the tail: the three strongest stay and take the rest between them', () => {
    const biomes = [at(0.5, 0.5, 0.5), at(0.55, 0.5, 0.5), at(0.2, 0.3, 0.9), at(0.1, 0.9, 0.1)];
    const sampler = createWorldSampler(42, { biomes });
    const s = sampleAt(sampler, 0, 0);
    expect(s.w[0]! + s.w[1]! + s.w[2]!).toBeCloseTo(1, 6);
    // which three is the presences' business, not the test's: rank them here the
    // same way the sampler does, and check the sampler kept that set
    const f = createFields(createWorldSampler(42)).at(0, 0);
    const ranked = biomes
      .map((b, i) => [(b.presence as (fields: typeof f) => number)(f), i] as const)
      .sort((a, b) => b[0] - a[0])
      .slice(0, 3)
      .map(([, i]) => i);
    expect(new Set(s.i)).toEqual(new Set(ranked));
    expect(new Set(s.i).size).toBe(3);
  });
  it('gives the whole texel to a biome that owns the climate outright', () => {
    const lonely = defineBiome({ id: 'lonely', name: 'l', params: {}, presence: () => 1, ground });
    const shy = defineBiome({ id: 'shy', name: 's', params: {}, presence: () => 0, ground });
    const s = sampleAt(createWorldSampler(42, { biomes: [lonely, shy] }), 0, 0);
    expect(s.w[0]).toBe(1);
    expect(s.i[0]).toBe(0);
    expect(s.w[1]).toBe(0);
    expect(s.w[2]).toBe(0);
  });
  it('falls back to the first biome when nobody claims the place', () => {
    const none = [0, 1].map((n) =>
      defineBiome({ id: `n${n}`, name: 'n', params: {}, presence: () => 0, ground }),
    );
    const s = sampleAt(createWorldSampler(42, { biomes: none }), 0, 0);
    expect(s.w).toEqual([1, 0, 0]);
    expect(s.i[0]).toBe(0);
  });
  it('moves the ground by the weighted modifiers, clipped to MAX_HEIGHT_DELTA, off the base height', () => {
    const flat = (id: string, meters: number) =>
      defineBiome({
        id,
        name: id,
        params: {},
        presence: () => 1,
        height: (_f, base) => base + meters,
        ground,
      });
    const sampler = createWorldSampler(42, { biomes: [flat('up', 100), flat('down', -60)] });
    const base = new Float32Array(4);
    sampler.sample(0, 0, base);
    // equal presence: half of +100 and half of -60
    expect(sampleAt(sampler, 0, 0).h).toBeCloseTo(base[0]! + 20, 3);
    // and a modifier that asks for a kilometre gets 300 m
    const greedy = createWorldSampler(42, { biomes: [flat('greedy', 1000)] });
    expect(sampleAt(greedy, 0, 0).h).toBeCloseTo(base[0]! + MAX_HEIGHT_DELTA, 3);
    const digger = createWorldSampler(42, { biomes: [flat('digger', -1000)] });
    expect(sampleAt(digger, 0, 0).h).toBeCloseTo(base[0]! - MAX_HEIGHT_DELTA, 3);
    expect(MAX_HEIGHT_DELTA).toBe(300);
  });
  it('hands every modifier the base height, never the answer of the one before it', () => {
    const seen: number[] = [];
    const reader = defineBiome({
      id: 'reader',
      name: 'r',
      params: {},
      presence: () => 1,
      height: (f, base) => {
        seen.push(base);
        return base + f.shore * 50;
      },
      ground,
    });
    const loud = defineBiome({
      id: 'loud',
      name: 'l',
      params: {},
      presence: () => 1,
      height: (_f, base) => base + 200,
      ground,
    });
    const sampler = createWorldSampler(42, { biomes: [reader, loud] });
    const base = new Float32Array(4);
    sampler.sample(0, 0, base);
    sampleAt(sampler, 0, 0);
    // both hooks were handed the same base height, not each other's answer
    expect(seen[0]).toBeCloseTo(base[0]!, 6);
  });
  it('does not let the order of the registry change the ground', () => {
    const bump = (id: string, meters: number) =>
      defineBiome({
        id,
        name: id,
        params: {},
        presence: climatePoint({ point: [0.5, 0.5, 0.5] }),
        height: (_f, base) => base + meters,
        ground,
      });
    const a = createWorldSampler(42, { biomes: [bump('a', 80), bump('b', -40), bump('c', 10)] });
    const b = createWorldSampler(42, { biomes: [bump('c', 10), bump('a', 80), bump('b', -40)] });
    for (const [x, z] of PLACES) expect(sampleAt(a, x, z).h).toBeCloseTo(sampleAt(b, x, z).h, 4);
  });
  it('is the same world twice: two samplers of one seed agree everywhere', () => {
    const biomes = [at(0.3, 0.3, 0.3), at(0.7, 0.7, 0.7)];
    const a = createWorldSampler(42, { biomes }),
      b = createWorldSampler(42, { biomes });
    for (const [x, z] of PLACES) expect(sampleAt(a, x, z)).toEqual(sampleAt(b, x, z));
  });
});
