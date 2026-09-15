// The base fields of the world, ported from fly-with-me's sampleWorld: slow
// control fields decide what kind of place this is, fast noise only
// decorates. Continentalness shapes the land; temperature, moisture and
// region are the climate the biomes will read (M3). Everything is in meters.
// In M3 the biome hooks (presence, height) are applied on top of these fields;
// this module stays the single source of the base terrain.
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

export function createWorldSampler(seed: number): WorldSampler {
  const seeds = fieldSeeds(seed);
  const { S1, S2, S3 } = seeds;
  const scratch = new Float64Array(5);
  return {
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
  };
}
