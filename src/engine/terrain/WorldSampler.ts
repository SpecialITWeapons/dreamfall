// The base fields of the world, ported from fly-with-me's sampleWorld: slow
// control fields decide what kind of place this is, fast noise only
// decorates. Continentalness shapes the land; temperature, moisture and
// region are the climate the biomes will read (M3). Everything is in meters.
// In M3 the biome hooks (presence, height) are applied on top of these fields;
// this module stays the single source of the base terrain.
import type { Biome } from '../../../library/contract';
import { resolveHeight, resolvePresence } from '../../../library/standard/index.js';
import { createFields } from './Fields';
import { fbm, hash2, pyramidPeaks, ridgedMulti, sstep } from './noise';

/** Terrain sample spacing, m. */
export const CELL = 16;
export const SEA_LEVEL = 0;
/** Cloud deck altitude, m. */
export const DECK_Y = 520;
/** The range: a warped ridged massif carrying a lattice of pyramidal summits. */
export const PEAKS = { cell: 2400, radius: 850, power: 1.7, lift: 900, massif: 640 } as const;
/** Width of the climate fields, m. */
export const CLIMATE_SCALE = 12000;
/** The most a biome's height hook may move the ground, m (spec 5.5). */
export const MAX_HEIGHT_DELTA = 300;
/** How many biomes mix in one point (spec 5.7). */
export const SLOTS = 3;

/** Somewhere to write the fields: the window uses Float32Array, the hooks Float64Array. */
export type FieldsOut = Float32Array | Float64Array | number[];

export interface WorldSampler {
  readonly seed: number;
  readonly seeds: { S1: number; S2: number; S3: number };
  /** Writes height (m), temperature, moisture and region for a world point. */
  sample(x: number, z: number, out: FieldsOut): void;
  /**
   * The same four, plus continentalness in the fifth slot: the biomes' hooks
   * read it, and it is already computed in here. `sample` is the frozen face
   * of this one -- its numbers are the golden values of seed 42.
   */
  baseFields(x: number, z: number, out: FieldsOut): void;
  /**
   * What the height window holds: the height every biome has had its say in,
   * and who had it. `out` takes (height, w0, w1, w2) and `slots` takes the
   * three registry indices those weights belong to.
   */
  sampleWindow(x: number, z: number, out: FieldsOut, slots: Uint8Array): void;
}

/** Three field seeds hashed from the seed rather than sliced from its bits, so small seeds do not share a climate. */
export function fieldSeeds(seed: number): { S1: number; S2: number; S3: number } {
  const s = seed >>> 0;
  return {
    S1: hash2(s, 1, 0x1a2b) & 0xffff,
    S2: hash2(s, 2, 0x3c4d) & 0xffff,
    S3: hash2(s, 3, 0x5e6f) & 0xffff,
  };
}

export function createWorldSampler(seed: number, opts: { biomes?: Biome[] } = {}): WorldSampler {
  const seeds = fieldSeeds(seed);
  const { S1, S2, S3 } = seeds;
  const scratch = new Float64Array(5);
  const biomes = opts.biomes ?? [];
  const presences = biomes.map((b) => resolvePresence(b.presence));
  const heights = biomes.map((b) => (b.height ? resolveHeight(b.height) : null));
  const raw = new Float64Array(biomes.length);
  const sampler: WorldSampler = {
    seed: seed >>> 0,
    seeds,
    sample(x, z, out) {
      this.baseFields(x, z, scratch);
      out[0] = scratch[0]!;
      out[1] = scratch[1]!;
      out[2] = scratch[2]!;
      out[3] = scratch[3]!;
    },
    baseFields(x, z, out) {
      const wx = x + 700 * fbm(x / 2200 + 31.7, z / 2200 - 12.3, S3, 3);
      const wz = z + 700 * fbm(x / 2200 - 54.1, z / 2200 + 77.9, S3 + 7, 3);
      const cont = fbm(wx / 3400, wz / 3400, S1, 4) * 0.5 + 0.5; // continentalness
      const kx = x + 900 * fbm(x / 3000 + 4.1, z / 3000 - 2.2, S3 + 41, 2),
        kz = z + 900 * fbm(x / 3000 - 7.7, z / 3000 + 5.5, S3 + 43, 2);
      const temp = fbm(kx / CLIMATE_SCALE + 9.1, kz / CLIMATE_SCALE + 3.3, S2, 2) * 0.5 + 0.5;
      const moist =
        fbm(kx / (CLIMATE_SCALE * 0.8) - 8.4, kz / (CLIMATE_SCALE * 0.8) + 15.2, S2 + 3, 2) * 0.5 + 0.5;
      const region =
        fbm(kx / (CLIMATE_SCALE * 0.9) + 21.3, kz / (CLIMATE_SCALE * 0.9) - 8.8, S3 + 19, 2) * 0.5 + 0.5;
      const land = sstep(0.4, 0.6, cont);
      const hills = fbm(wx / 520, wz / 520, S1 + 11, 4);
      const mountainMask = sstep(0.56, 0.82, cont);
      // The massif: a warped four-octave ridged multifractal, so crests carry
      // arêtes and gullies. On it, the pyramids: they stand in barely warped
      // coordinates (the 700 m continental warp would bend their faces into
      // loaves), and the massif quiets under each so its faces stay clean sheets.
      const rx = wx + 260 * fbm(wx / 900 + 3.3, wz / 900 - 1.1, S1 + 29, 2),
        rz = wz + 260 * fbm(wx / 900 - 2.2, wz / 900 + 4.4, S1 + 31, 2);
      const ridge = ridgedMulti(rx / 1600, rz / 1600, S1 + 23, 4);
      const px = x + 90 * fbm(x / 700 + 1.3, z / 700 + 2.1, S1 + 61, 2),
        pz = z + 90 * fbm(x / 700 - 3.7, z / 700 + 0.4, S1 + 63, 2);
      const peak = pyramidPeaks(px, pz, S1 + 47, PEAKS.cell, PEAKS.radius, PEAKS.power);
      const lift =
        (ridge * PEAKS.massif * (1 - 0.45 * sstep(0.05, 0.5, peak)) + peak * PEAKS.lift) * mountainMask;
      let h = -70 + 150 * land + hills * (10 + 38 * land) + lift;
      // a gentle shelf so beaches are wide and the shoreline never zigzags
      const shelf = sstep(-30, 30, h);
      h = h * (0.55 + 0.45 * shelf) + (1 - shelf) * -6;
      out[0] = h;
      out[1] = temp - Math.max(0, h) / 2600; // colder with altitude
      out[2] = moist;
      out[3] = region;
      out[4] = cont;
    },
    sampleWindow(x, z, out, slots) {
      // No library is the world of M1: one slot, all of it, the base height.
      if (biomes.length === 0) {
        this.baseFields(x, z, scratch);
        out[0] = scratch[0]!;
        out[1] = 1;
        out[2] = out[3] = 0;
        slots[0] = slots[1] = slots[2] = 0;
        return;
      }
      const f = fields.at(x, z);
      // Presence: what each biome makes of this place, clipped to 0..1. The
      // scale is nobody's business but the normalisation's -- a biome of code
      // may answer on any scale, which is why the sharpening lives in the hook.
      let sum = 0;
      for (let i = 0; i < biomes.length; i++) {
        const v = presences[i]!(f);
        raw[i] = v > 1 ? 1 : v > 0 ? v : 0;
        sum += raw[i]!;
      }
      // The three strongest, in one pass: this runs once per texel, and a full
      // window is 313 600 of them, so nothing here sorts or allocates.
      let i0 = -1,
        i1 = -1,
        i2 = -1,
        w0 = -1,
        w1 = -1,
        w2 = -1;
      for (let i = 0; i < biomes.length; i++) {
        const v = raw[i]!;
        if (v > w0) {
          i2 = i1;
          w2 = w1;
          i1 = i0;
          w1 = w0;
          i0 = i;
          w0 = v;
        } else if (v > w1) {
          i2 = i1;
          w2 = w1;
          i1 = i;
          w1 = v;
        } else if (v > w2) {
          i2 = i;
          w2 = v;
        }
      }
      // Nobody claimed it: the first biome of the registry takes it, so no
      // texel is ever painted by nothing.
      if (!(sum > 0) || !(w0 > 0)) {
        this.baseFields(x, z, scratch);
        out[0] = scratch[0]!;
        out[1] = 1;
        out[2] = out[3] = 0;
        slots[0] = slots[1] = slots[2] = 0;
        return;
      }
      const kept = w0 + Math.max(0, w1) + Math.max(0, w2);
      out[1] = w0 / kept;
      out[2] = w1 > 0 ? w1 / kept : 0;
      out[3] = w2 > 0 ? w2 / kept : 0;
      // An empty slot repeats the strongest index at weight zero: zero is a
      // real biome, and a repeat costs the shader nothing.
      slots[0] = i0;
      slots[1] = w1 > 0 ? i1 : i0;
      slots[2] = w2 > 0 ? i2 : i0;
      // Height: every modifier reads the base height, never a neighbour's
      // answer, so the order of the registry cannot change the ground.
      const base = f.baseHeight;
      let h = base;
      for (let k = 0; k < SLOTS; k++) {
        const w = out[k + 1]!;
        if (w <= 0) continue;
        const hook = heights[slots[k]!];
        if (!hook) continue;
        const delta = hook(f, base) - base;
        h +=
          w *
          (delta > MAX_HEIGHT_DELTA
            ? MAX_HEIGHT_DELTA
            : delta < -MAX_HEIGHT_DELTA
              ? -MAX_HEIGHT_DELTA
              : delta);
      }
      out[0] = h;
    },
  };
  // The fields read the sampler's own base fields, so they are built after it.
  const fields = createFields(sampler);
  return sampler;
}
