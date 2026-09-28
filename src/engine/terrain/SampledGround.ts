// The ground as the near window answers it, anywhere. A point of the 16 m
// grid is the one `sampleWindow` call the window fills its texel with, stored
// as the window stores it (float32 heights and weights, byte slots), so the
// heights, weights and slots agree with the window to the bit, and between the
// points it interpolates the same triangle the terrain grid draws. Inside the
// window it reads the window; past it, it samples and keeps the points in a
// small cache. It never reads the far window: that one is for looking at.
import type { Heightfield } from './Heightfield';
import { CELL, type WorldSampler } from './WorldSampler';

/** What sowing asks of the ground: `Heightfield` answers it inside its window, `SampledGround` everywhere. */
export interface GroundQuery {
  heightAt(x: number, z: number): number;
  slopeAt(x: number, z: number): number;
  weightsAt(x: number, z: number, ids: Uint8Array, weights: Float32Array): void;
}

export interface SampledGround extends GroundQuery {
  /** Points held in the cache now. */
  readonly cached: number;
}

/**
 * Points kept before the cache is dropped whole. One cell's sowing reuses its
 * own few dozen points and almost nothing of its neighbours', so this only has
 * to outlast a cell, and dropping it costs a resample, never a wrong answer.
 */
export const GROUND_CACHE = 8192;

/** A texel index pair as one number: exact for |index| < 2^21, which is 33 000 km of world. */
const keyOf = (ix: number, iz: number) => (ix + 2097152) * 4194304 + (iz + 2097152);

export function createSampledGround(sampler: WorldSampler, window?: Heightfield): SampledGround {
  if (window && window.cell !== CELL)
    throw new Error(`SampledGround: a window of ${window.cell} m cells is not the near window`);
  const cell = CELL;
  const half = window ? window.size / 2 : 0;
  // Stored as the window stores them, so the rounding is the window's.
  const data = new Float32Array(GROUND_CACHE * 4);
  const slots = new Uint8Array(GROUND_CACHE * 4);
  const index = new Map<number, number>();
  const tmp = new Float64Array(4);
  const tmpSlots = new Uint8Array(4);

  /** Whether the window holds this texel: filled, and inside the square it last filled. */
  const inWindow = (ix: number, iz: number) =>
    window !== undefined &&
    window.version > 0 &&
    ix >= window.center.cx - half &&
    ix < window.center.cx + half &&
    iz >= window.center.cz - half &&
    iz < window.center.cz + half;

  /** The cache slot of a point, sampled on first use. */
  const load = (ix: number, iz: number) => {
    const key = keyOf(ix, iz);
    let i = index.get(key);
    if (i === undefined) {
      if (index.size >= GROUND_CACHE) index.clear();
      i = index.size;
      sampler.sampleWindow(ix * cell, iz * cell, tmp, tmpSlots);
      data.set(tmp, i * 4);
      slots.set(tmpSlots, i * 4);
      index.set(key, i);
    }
    return i;
  };

  const height = (ix: number, iz: number) =>
    inWindow(ix, iz) ? window!.texel(ix, iz, 0) : data[load(ix, iz) * 4]!;

  return {
    get cached() {
      return index.size;
    },
    heightAt(x, z) {
      const fx = x / cell,
        fz = z / cell;
      const ix = Math.floor(fx),
        iz = Math.floor(fz);
      const tx = fx - ix,
        tz = fz - iz;
      const h00 = height(ix, iz),
        h10 = height(ix + 1, iz),
        h01 = height(ix, iz + 1),
        h11 = height(ix + 1, iz + 1);
      // The window's own arithmetic, diagonal and all (Heightfield.heightAt).
      return tx + tz <= 1
        ? h00 + (h10 - h00) * tx + (h01 - h00) * tz
        : h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
    },
    slopeAt(x, z) {
      const ix = Math.round(x / cell),
        iz = Math.round(z / cell);
      const dx = height(ix + 1, iz) - height(ix - 1, iz),
        dz = height(ix, iz + 1) - height(ix, iz - 1);
      return Math.hypot(dx, dz) / (2 * cell);
    },
    weightsAt(x, z, ids, weights) {
      const ix = Math.round(x / cell),
        iz = Math.round(z / cell);
      if (inWindow(ix, iz)) {
        window!.weightsAt(x, z, ids, weights);
        return;
      }
      const o = load(ix, iz) * 4;
      for (let k = 0; k < 3; k++) {
        ids[k] = slots[o + k]!;
        weights[k] = data[o + 1 + k]!;
      }
    },
  };
}
