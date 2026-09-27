import { describe, expect, it } from 'vitest';
import { createLibrary } from '../../library/index.js';
import { createHeightfield } from '../../src/engine/terrain/Heightfield';
import { GROUND_CACHE, createSampledGround } from '../../src/engine/terrain/SampledGround';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';
import { mulberry32 } from '../../src/engine/terrain/noise';

const lib = createLibrary();
const sampler = createWorldSampler(42, { biomes: lib.biomes });

/** A window of 64 texels (±512 m) filled around a point, in metres. */
const windowAt = (x: number, z: number) => {
  const hf = createHeightfield(sampler, { size: 64 });
  hf.fillAll(Math.round(x / 16), Math.round(z / 16));
  return hf;
};

/** Everything a GroundQuery answers at one point, as plain numbers. */
const ask = (
  g: {
    heightAt(x: number, z: number): number;
    slopeAt(x: number, z: number): number;
    weightsAt(x: number, z: number, i: Uint8Array, w: Float32Array): void;
  },
  x: number,
  z: number,
) => {
  const ids = new Uint8Array(4),
    weights = new Float32Array(4);
  g.weightsAt(x, z, ids, weights);
  return { h: g.heightAt(x, z), s: g.slopeAt(x, z), ids: [...ids.slice(0, 3)], w: [...weights.slice(0, 3)] };
};

/** Points well inside a window centred on (cx, cz): 400 m of its 512, so every neighbour is in it. */
const pointsNear = (cx: number, cz: number, n: number, seed: number) => {
  const r = mulberry32(seed);
  return Array.from({ length: n }, () => [cx + (r() - 0.5) * 800, cz + (r() - 0.5) * 800] as const);
};

describe('SampledGround', () => {
  it('answers as the near window does, without one', () => {
    const hf = windowAt(0, 0),
      ground = createSampledGround(sampler);
    for (const [x, z] of pointsNear(0, 0, 200, 1)) expect(ask(ground, x, z)).toEqual(ask(hf, x, z));
  });

  it('answers as the near window does at negative coordinates', () => {
    const hf = windowAt(-37000, -52000),
      ground = createSampledGround(sampler);
    for (const [x, z] of pointsNear(-37000, -52000, 200, 2)) expect(ask(ground, x, z)).toEqual(ask(hf, x, z));
  });

  it('reads its window inside it and samples past it, and the two agree', () => {
    const near = windowAt(0, 0),
      ground = createSampledGround(sampler, near);
    for (const [x, z] of pointsNear(0, 0, 100, 3)) expect(ask(ground, x, z)).toEqual(ask(near, x, z));
    // 3 km out is past the window's 512 m: what a window filled there says
    const there = windowAt(3000, -2000);
    for (const [x, z] of pointsNear(3000, -2000, 100, 4)) expect(ask(ground, x, z)).toEqual(ask(there, x, z));
  });

  it('agrees across the window edge, where a triangle has texels on both sides', () => {
    const near = windowAt(0, 0),
      withWindow = createSampledGround(sampler, near),
      without = createSampledGround(sampler);
    // The window holds texels -32..31, so -512 m and 496 m are its edge rows.
    for (const edge of [-512, 496])
      for (let t = -400; t <= 400; t += 37) {
        for (const [x, z] of [
          [edge + 7.3, t],
          [t, edge + 7.3],
          [edge - 7.3, t],
        ] as const)
          expect(ask(withWindow, x, z)).toEqual(ask(without, x, z));
      }
  });

  it('never reads a window nobody filled', () => {
    const empty = createHeightfield(sampler, { size: 64 }),
      withEmpty = createSampledGround(sampler, empty),
      without = createSampledGround(sampler);
    for (const [x, z] of pointsNear(0, 0, 50, 5)) expect(ask(withEmpty, x, z)).toEqual(ask(without, x, z));
  });

  it('keeps its cache bounded and answers the same after dropping it', () => {
    const ground = createSampledGround(sampler),
      fresh = createSampledGround(sampler);
    const first = ask(ground, 123.4, 567.8);
    // a line of distinct points far longer than the cache
    for (let i = 0; i < GROUND_CACHE * 2; i++) ground.heightAt(i * 16.5, 9000);
    expect(ground.cached).toBeLessThanOrEqual(GROUND_CACHE);
    expect(ask(ground, 123.4, 567.8)).toEqual(first);
    expect(first).toEqual(ask(fresh, 123.4, 567.8));
  });
});
