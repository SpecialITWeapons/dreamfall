// Where the cloud deck is, as one field every layer of it reads.
//
// There used to be four answers to that question and none of them agreed: the
// cloud sea seen from above was a sheet over the whole world at 94 per cent,
// the height fog under it whitened every metre of ground, the puffs near the
// deck stood wherever their dice put them, and the shadows on the ground came
// from a noise field of their own. So from under the deck the owner saw a few
// clouds, and from over it a solid overcast -- the same sky, told two ways.
//
// Now there is one field. It is baked here, once, into a square of texels that
// repeats every `period` metres, and the wind carries it: a layer reads it at
// `p - wind * t`, the GPU through a texture of these same bytes and the CPU
// through `at`, so a puff on the CPU stands where the sea on the GPU has a
// bank. What it says is how much cloud a place has, 0..1, soft at the edges.
//
// How much of the world is under cloud is itself a field: somewhere between
// `COVER.range[0]` and `[1]`, drifting over tens of kilometres and different in
// every world, so a long flight passes broken weather and heavier weather and
// the gaps between the banks are where the ground shows through -- which, with
// the banks between the flyer and the ground, is the parallax the owner asked
// the deck for. The fraction is honest: a place asked for 40 per cent gets the
// top 40 per cent of the bank field, by a threshold read off the field's own
// distribution rather than guessed from the noise's range.
//
// Pure CPU, no three: tested in Node, and the texture is `SkyUniforms`'.
import { hash2 } from '../terrain/noise';

export const COVER = {
  /** Texels a side of the baked square. */
  texels: 256,
  /** Metres a texel covers: the square repeats every `texels * metres`. */
  metres: 80,
  /** The share of the sky under cloud, lowest and highest, over a region. */
  range: [0.3, 0.6] as const,
  /** How soft a bank's edge is, in the bank field's own units. */
  soft: 0.06,
};

/** A square of 0..1 that repeats: the bank field and the regional share are both built on it. */
function periodicNoise(cells: number, seed: number) {
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lattice = (ix: number, iz: number) =>
    hash2(((ix % cells) + cells) % cells, ((iz % cells) + cells) % cells, seed) / 4294967296;
  /** At `u, v` in 0..1 of the square. */
  return (u: number, v: number) => {
    const x = u * cells,
      z = v * cells;
    const ix = Math.floor(x),
      iz = Math.floor(z);
    const fx = fade(x - ix),
      fz = fade(z - iz);
    const a = lattice(ix, iz),
      b = lattice(ix + 1, iz),
      c = lattice(ix, iz + 1),
      d = lattice(ix + 1, iz + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
}

export interface CloudCover {
  /** The field, one byte a texel, row by row: what the GPU samples. */
  readonly data: Uint8Array;
  readonly texels: number;
  /** Metres after which the field repeats. */
  readonly period: number;
  /**
   * How much cloud stands over a world point, 0..1, read the way the GPU reads
   * the texture: bilinear between texel centres, repeating. The caller moves
   * the point against the wind first, as the shader does.
   */
  at(x: number, z: number): number;
}

export function createCloudCover(seed: number): CloudCover {
  const n = COVER.texels;
  // The banks: four octaves, from about five kilometres down to six hundred
  // metres, which is a bank and the ragged edge of one.
  const octaves = [
    { noise: periodicNoise(4, seed ^ 0x1c0), weight: 0.45 },
    { noise: periodicNoise(8, seed ^ 0x2c1), weight: 0.3 },
    { noise: periodicNoise(16, seed ^ 0x3c2), weight: 0.17 },
    { noise: periodicNoise(32, seed ^ 0x4c3), weight: 0.08 },
  ];
  // The weather: how much of a region is under cloud, over about seven km.
  const weather = periodicNoise(3, seed ^ 0x5c4);

  const banks = new Float32Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n,
        v = (j + 0.5) / n;
      let sum = 0;
      for (const { noise, weight } of octaves) sum += noise(u, v) * weight;
      banks[j * n + i] = sum;
    }
  // The field's own distribution, so a share asked for is the share given.
  const sorted = Float32Array.from(banks).sort();
  const [low, high] = COVER.range;
  const data = new Uint8Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const share = low + (high - low) * weather((i + 0.5) / n, (j + 0.5) / n);
      const threshold = sorted[Math.min(n * n - 1, Math.floor((1 - share) * n * n))]!;
      const t = (banks[j * n + i]! - (threshold - COVER.soft)) / (2 * COVER.soft);
      const s = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
      data[j * n + i] = Math.round(s * 255);
    }

  const period = n * COVER.metres;
  const texel = (i: number, j: number) => data[(((j % n) + n) % n) * n + (((i % n) + n) % n)]! / 255;
  return {
    data,
    texels: n,
    period,
    at(x, z) {
      // Texel centres sit at half a texel, which is where a linear sampler
      // takes a texel's own value whole.
      const fx = (x / period) * n - 0.5,
        fz = (z / period) * n - 0.5;
      const i = Math.floor(fx),
        j = Math.floor(fz);
      const tx = fx - i,
        tz = fz - j;
      const a = texel(i, j),
        b = texel(i + 1, j),
        c = texel(i, j + 1),
        d = texel(i + 1, j + 1);
      return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
    },
  };
}
