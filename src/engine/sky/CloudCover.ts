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
// The deck does not stand at one height either. Its base is a second field on
// the same square, `DECK.base` apart from lowest to highest over a region of a
// few kilometres, and unlike the cover it stays where it is: the banks drift
// over country whose air holds them higher or lower, so the height is a
// question with no `t` in it. A bank is as thick as it is solid, so its top is
// the base plus `DECK.thin` at a thinning edge and `DECK.thick` in its middle.
//
// Pure CPU, no three: tested in Node, and the textures are `SkyUniforms`'.
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
  /**
   * Where a bank stands solid, over the field's 0..1: the sea, its fog and the
   * whiteout all read this one edge, so the fog under a bank and the fog inside
   * it end where the bank does.
   */
  bank: [0.15, 0.6] as const,
};

/** How high the deck stands: its base by region, and its depth by how solid it is. */
export const DECK = {
  /** The lowest and the highest base, m. */
  base: [700, 1200] as const,
  /** How deep a bank is at its thinning edge and in its middle, m. */
  thin: 120,
  thick: 350,
  /** Lattice cells of the base's noise over the repeating square: regions of about five km. */
  regions: 4,
  /** The steepest the base may tilt, m a m: a region's lie, never a bank's edge. */
  maxGrade: 0.25,
};

/** Where the deck stands over a world point at time `t`. */
export interface DeckAt {
  /** The underside, m. */
  base: number;
  /** The top of the bank there, m: `base` plus its depth. */
  top: number;
  /** How solid the bank is, 0..1 (`bankAt`). */
  bank: number;
}

/** The deck's top over a base, for a bank this solid. */
export const deckTop = (base: number, bank: number) => base + DECK.thin + (DECK.thick - DECK.thin) * bank;

/** Base, top and bank over a world point: what the flight and the atmosphere ask. */
export function deckAt(
  cover: CloudCover,
  x: number,
  z: number,
  t: number,
  wind: { x: number; z: number },
  out: DeckAt = { base: 0, top: 0, bank: 0 },
): DeckAt {
  out.base = cover.baseAt(x, z);
  out.bank = bankAt(cover, x, z, t, wind);
  out.top = deckTop(out.base, out.bank);
  return out;
}

/**
 * How solid the deck is over a world point at time `t`, 0..1: the CPU's half
 * of `cloudBankAt`, carried by the same wind.
 */
export function bankAt(cover: CloudCover, x: number, z: number, t: number, wind: { x: number; z: number }) {
  const [a, b] = COVER.bank;
  const v = Math.min(1, Math.max(0, (cover.at(x - wind.x * t, z - wind.z * t) - a) / (b - a)));
  return v * v * (3 - 2 * v);
}

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
  /** The deck's base, one byte a texel over `DECK.base`, laid out as `data`. */
  readonly base: Uint8Array;
  /** The deck's base over a world point, m: read like `at`, but where the point is, not against the wind. */
  baseAt(x: number, z: number): number;
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

  // The base: one slow noise stretched over its own extremes, so every world
  // reaches both ends of the range somewhere rather than hovering in its middle.
  const region = periodicNoise(DECK.regions, seed ^ 0x6c5);
  const raw = new Float32Array(n * n);
  let lo = Infinity,
    hi = -Infinity;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const r = region((i + 0.5) / n, (j + 0.5) / n);
      raw[j * n + i] = r;
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
  const base = new Uint8Array(n * n);
  for (let k = 0; k < n * n; k++) base[k] = Math.round(((raw[k]! - lo) / Math.max(hi - lo, 1e-6)) * 255);

  const period = n * COVER.metres;
  // Texel centres sit at half a texel, which is where a linear sampler takes a
  // texel's own value whole.
  const bilinear = (bytes: Uint8Array, x: number, z: number) => {
    const texel = (i: number, j: number) => bytes[(((j % n) + n) % n) * n + (((i % n) + n) % n)]! / 255;
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
  };
  const [low0, high0] = DECK.base;
  return {
    data,
    texels: n,
    period,
    at: (x, z) => bilinear(data, x, z),
    base,
    baseAt: (x, z) => low0 + (high0 - low0) * bilinear(base, x, z),
  };
}
