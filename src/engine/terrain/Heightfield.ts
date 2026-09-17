// The heightfield: a toroidal N x N window of world cells kept fresh around
// the flyer. Texel (ix mod N, iz mod N) always holds world cell (ix, iz), so a
// move refills only the rows and columns that entered the window. It is the
// only terrain truth: anything that needs a height reads heightAt, which
// interpolates the exact triangle the terrain grid draws.
//
// It carries who as well as how high: the height comes out of one sampling and
// so do the three biome weights that made it, because a ground painted with a
// neighbouring cell's climate would not be the ground the flight is flying
// over. Heights interpolate across the triangle; weights belong to the cell.
import { CELL, type WorldSampler } from './WorldSampler';

/** Window side in cells: 560 x 16 m is about 9 km. */
export const N = 560;

export interface Heightfield {
  readonly cell: number;
  readonly size: number;
  /** RGBA float texels (height, w0, w1, w2), ready for a DataTexture. */
  readonly data: Float32Array;
  /**
   * RGBA byte texels (i0, i1, i2, baseTemp): which biomes the weights belong
   * to, and the climate temperature the snow line is drawn on -- see
   * `packBaseTemp` in `WorldSampler`.
   */
  readonly slots: Uint8Array;
  /** Grows on every write; the presentation uploads the texture when it changes. */
  readonly version: number;
  /** Where the window sits, in cell indices: multiply by `cell` for metres. */
  readonly center: { cx: number; cz: number };
  /** Fills the whole window around a cell index -- not a world metre; see `update`. */
  fillAll(cx: number, cz: number): void;
  /** Recenters on a world position, in metres; says how much work it did. */
  update(x: number, z: number): 'none' | 'incremental' | 'jump';
  texel(ix: number, iz: number, channel: number): number;
  /** Height by barycentric interpolation on the grid's own triangles. */
  heightAt(x: number, z: number): number;
  /** The three biome slots of the cell a point falls in: registry indices and their weights. */
  weightsAt(x: number, z: number, ids: Uint8Array, weights: Float32Array): void;
  slopeAt(x: number, z: number): number;
}

export function createHeightfield(
  sampler: WorldSampler,
  opts: { cell?: number; size?: number } = {},
): Heightfield {
  const cell = opts.cell ?? CELL;
  const size = opts.size ?? N;
  const half = size / 2;
  const data = new Float32Array(size * size * 4);
  const slots = new Uint8Array(size * size * 4);
  const tmp = new Float64Array(4);
  const tmpSlots = new Uint8Array(4);
  const center = { cx: 0, cz: 0 };
  let version = 0;
  const wrap = (i: number) => ((i % size) + size) % size;
  const fillCell = (ix: number, iz: number) => {
    sampler.sampleWindow(ix * cell, iz * cell, tmp, tmpSlots);
    const o = (wrap(iz) * size + wrap(ix)) * 4;
    data[o] = tmp[0]!;
    data[o + 1] = tmp[1]!;
    data[o + 2] = tmp[2]!;
    data[o + 3] = tmp[3]!;
    slots[o] = tmpSlots[0]!;
    slots[o + 1] = tmpSlots[1]!;
    slots[o + 2] = tmpSlots[2]!;
    // the fourth byte is the climate temperature the snow line is drawn on
    slots[o + 3] = tmpSlots[3]!;
  };
  const texel = (ix: number, iz: number, channel: number) =>
    data[(wrap(iz) * size + wrap(ix)) * 4 + channel]!;
  const fillAll = (cx: number, cz: number) => {
    center.cx = cx;
    center.cz = cz;
    for (let iz = cz - half; iz < cz + half; iz++)
      for (let ix = cx - half; ix < cx + half; ix++) fillCell(ix, iz);
    version++;
  };
  return {
    cell,
    size,
    data,
    slots,
    get version() {
      return version;
    },
    center,
    fillAll,
    update(x, z) {
      const cx = Math.round(x / cell),
        cz = Math.round(z / cell);
      // A window nobody filled is all zeroes, and a scroll only writes the rows
      // it walks into: the middle would stay a flat sea and say so with a
      // straight face. The world fills on its first frame, so this costs it
      // nothing and only catches a caller that did not.
      if (version === 0 || Math.abs(cx - center.cx) > half / 2 || Math.abs(cz - center.cz) > half / 2) {
        fillAll(cx, cz);
        return 'jump';
      }
      let changed = false;
      while (center.cx < cx) {
        center.cx++;
        const ix = center.cx + half - 1;
        for (let iz = center.cz - half; iz < center.cz + half; iz++) fillCell(ix, iz);
        changed = true;
      }
      while (center.cx > cx) {
        center.cx--;
        const ix = center.cx - half;
        for (let iz = center.cz - half; iz < center.cz + half; iz++) fillCell(ix, iz);
        changed = true;
      }
      while (center.cz < cz) {
        center.cz++;
        const iz = center.cz + half - 1;
        for (let ix = center.cx - half; ix < center.cx + half; ix++) fillCell(ix, iz);
        changed = true;
      }
      while (center.cz > cz) {
        center.cz--;
        const iz = center.cz - half;
        for (let ix = center.cx - half; ix < center.cx + half; ix++) fillCell(ix, iz);
        changed = true;
      }
      if (changed) version++;
      return changed ? 'incremental' : 'none';
    },
    texel,
    heightAt(x, z) {
      const fx = x / cell,
        fz = z / cell;
      const ix = Math.floor(fx),
        iz = Math.floor(fz);
      const tx = fx - ix,
        tz = fz - iz;
      const h00 = texel(ix, iz, 0),
        h10 = texel(ix + 1, iz, 0),
        h01 = texel(ix, iz + 1, 0),
        h11 = texel(ix + 1, iz + 1, 0);
      // Same diagonal as the terrain grid, including at negative world coordinates.
      return tx + tz <= 1
        ? h00 + (h10 - h00) * tx + (h01 - h00) * tz
        : h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
    },
    weightsAt(x, z, ids, weights) {
      const o = (wrap(Math.round(z / cell)) * size + wrap(Math.round(x / cell))) * 4;
      for (let k = 0; k < 3; k++) {
        ids[k] = slots[o + k]!;
        weights[k] = data[o + 1 + k]!;
      }
    },
    slopeAt(x, z) {
      const ix = Math.round(x / cell),
        iz = Math.round(z / cell);
      const dx = texel(ix + 1, iz, 0) - texel(ix - 1, iz, 0),
        dz = texel(ix, iz + 1, 0) - texel(ix, iz - 1, 0);
      return Math.hypot(dx, dz) / (2 * cell);
    },
  };
}
