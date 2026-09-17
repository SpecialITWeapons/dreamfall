import { describe, expect, it } from 'vitest';
import { N, createHeightfield } from '../../src/engine/terrain/Heightfield';
import {
  CELL,
  createWorldSampler,
  packBaseTemp,
  unpackBaseTemp,
  type WorldSampler,
} from '../../src/engine/terrain/WorldSampler';

/** A sampler whose height is a plane, so slopes and interpolation have exact answers. */
const plane = (ax: number, az: number, c = 0): WorldSampler => ({
  seed: 0,
  seeds: { S1: 0, S2: 0, S3: 0 },
  sample(x, z, out) {
    this.baseFields(x, z, out);
  },
  baseFields(x, z, out) {
    out[0] = ax * x + az * z + c;
    out[1] = 0.5;
    out[2] = 0.25;
    out[3] = 0.75;
    out[4] = 0.5;
  },
  sampleWindow(x, z, out, slots) {
    this.baseFields(x, z, out);
    out[1] = 1;
    out[2] = out[3] = 0;
    slots[0] = slots[1] = slots[2] = 0;
  },
});

describe('createHeightfield', () => {
  it('keeps world cell (ix, iz) in texel (ix mod N, iz mod N) after a full fill', () => {
    const hf = createHeightfield(plane(1, 2), { size: 16 });
    hf.fillAll(100, -40);
    expect(hf.center).toEqual({ cx: 100, cz: -40 });
    expect(hf.texel(100, -40, 0)).toBeCloseTo(100 * CELL * 1 + -40 * CELL * 2);
    expect(hf.texel(107, -33, 0)).toBeCloseTo(107 * CELL + -33 * CELL * 2);
    expect(hf.texel(107, -33, 1)).toBeCloseTo(1); // the whole cell is one biome here
    expect(hf.data.length).toBe(16 * 16 * 4);
  });
  it('refills only rows and columns on a small move and matches a fresh fill', () => {
    const sampler = createWorldSampler(42);
    const a = createHeightfield(sampler, { size: 32 });
    a.fillAll(0, 0);
    const v0 = a.version;
    expect(a.update(3 * CELL, -2 * CELL)).toBe('incremental');
    expect(a.update(3 * CELL, -2 * CELL)).toBe('none');
    expect(a.update(5 * CELL, 1 * CELL)).toBe('incremental');
    expect(a.version).toBeGreaterThan(v0);
    const b = createHeightfield(sampler, { size: 32 });
    b.fillAll(5, 1);
    expect(a.center).toEqual(b.center);
    for (let iz = 1 - 16; iz < 1 + 16; iz++)
      for (let ix = 5 - 16; ix < 5 + 16; ix++) expect(a.texel(ix, iz, 0)).toBe(b.texel(ix, iz, 0));
  });
  it('fills the whole window the first time, however small the move', () => {
    // A scroll writes the rows it walks into and nothing else, so a window
    // nobody filled would keep a flat sea in its middle and answer with it.
    const a = createHeightfield(plane(0.5, 0), { size: 16 });
    expect(a.update(CELL, 0)).toBe('jump');
    const b = createHeightfield(plane(0.5, 0), { size: 16 });
    b.fillAll(1, 0);
    for (let iz = -8; iz < 8; iz++)
      for (let ix = 1 - 8; ix < 1 + 8; ix++) expect(a.texel(ix, iz, 0)).toBe(b.texel(ix, iz, 0));
    // and afterwards it scrolls like any other window
    expect(a.update(2 * CELL, 0)).toBe('incremental');
  });
  it('treats a move of more than a quarter window as a jump and refills everything', () => {
    const hf = createHeightfield(plane(0.5, 0), { size: 16 });
    hf.fillAll(0, 0);
    expect(hf.update(5 * CELL, 0)).toBe('jump');
    expect(hf.center).toEqual({ cx: 5, cz: 0 });
    expect(hf.texel(5 + 7, 0, 0)).toBeCloseTo(0.5 * (12 * CELL));
  });
  it('interpolates height on the exact triangle the grid draws', () => {
    const hf = createHeightfield(plane(0.25, -0.5, 10), { size: 16 });
    hf.fillAll(0, 0);
    // a plane is reproduced exactly by barycentric interpolation, on both triangles of a cell
    expect(hf.heightAt(3.2, 4.1)).toBeCloseTo(0.25 * 3.2 - 0.5 * 4.1 + 10, 6);
    expect(hf.heightAt(12.9, 14.7)).toBeCloseTo(0.25 * 12.9 - 0.5 * 14.7 + 10, 6);
    expect(hf.heightAt(-20.5, 7.25)).toBeCloseTo(0.25 * -20.5 - 0.5 * 7.25 + 10, 6);
    expect(hf.heightAt(32, 48)).toBeCloseTo(hf.texel(2, 3, 0), 6);
  });
  it('uses the same diagonal as the grid, not bilinear interpolation', () => {
    // a saddle: bilinear and triangle interpolation disagree at the cell center
    const saddle: WorldSampler = {
      seed: 0,
      seeds: { S1: 0, S2: 0, S3: 0 },
      sample(x, z, out) {
        this.baseFields(x, z, out);
      },
      baseFields(x, z, out) {
        const ix = Math.round(x / CELL),
          iz = Math.round(z / CELL);
        out[0] = (ix + iz) % 2 === 0 ? 100 : 0;
        out[1] = out[2] = out[3] = out[4] = 0;
      },
      sampleWindow(x, z, out, slots) {
        this.baseFields(x, z, out);
        out[1] = 1;
        out[2] = out[3] = 0;
        slots[0] = slots[1] = slots[2] = 0;
      },
    };
    const hf = createHeightfield(saddle, { size: 8 });
    hf.fillAll(0, 0);
    // cell (0,0): h00 = 100, h10 = 0, h01 = 0, h11 = 100; the lower triangle (tx + tz <= 1) is spanned by h00, h10, h01
    expect(hf.heightAt(4, 4)).toBeCloseTo(50, 6); // on the diagonal: 100 + (0 - 100) * 0.25 + (0 - 100) * 0.25
    expect(hf.heightAt(2, 2)).toBeCloseTo(75, 6);
    expect(hf.heightAt(14, 14)).toBeCloseTo(75, 6); // upper triangle spanned by h11, h01, h10
  });
  it('measures slope from central differences', () => {
    const hf = createHeightfield(plane(0.3, 0.4), { size: 16 });
    hf.fillAll(0, 0);
    expect(hf.slopeAt(10, 10)).toBeCloseTo(Math.hypot(0.3, 0.4), 6);
  });
  it('carries the three biome slots of each cell, unlaced from the height', () => {
    // a sampler whose climate swaps biomes across x = 0, and whose height is x
    const swapping: WorldSampler = {
      seed: 1,
      seeds: { S1: 0, S2: 0, S3: 0 },
      sample(x, z, out) {
        this.baseFields(x, z, out);
      },
      baseFields(x, _z, out) {
        out[0] = x;
        out[1] = out[2] = out[3] = out[4] = 0;
      },
      sampleWindow(x, _z, out, slots) {
        out[0] = x;
        const east = x > 0;
        out[1] = east ? 0.6 : 0.9;
        out[2] = east ? 0.4 : 0.1;
        out[3] = 0;
        slots[0] = east ? 2 : 0;
        slots[1] = east ? 3 : 1;
        slots[2] = 0;
        slots[3] = packBaseTemp(0.6);
      },
    };
    const hf = createHeightfield(swapping, { size: 32 });
    hf.fillAll(0, 0);
    const ids = new Uint8Array(3),
      weights = new Float32Array(3);
    hf.weightsAt(5 * CELL, 0, ids, weights);
    expect([...ids]).toEqual([2, 3, 0]);
    expect(weights[0]).toBeCloseTo(0.6, 6);
    expect(weights[1]).toBeCloseTo(0.4, 6);
    hf.weightsAt(-5 * CELL, 0, ids, weights);
    expect([...ids]).toEqual([0, 1, 0]);
    expect(weights[0]).toBeCloseTo(0.9, 6);
    // the height still comes off channel zero, interpolated on the drawn triangle
    expect(hf.heightAt(5 * CELL, 0)).toBeCloseTo(5 * CELL, 6);
    expect(hf.slots.length).toBe(32 * 32 * 4);
    // The fourth byte is the climate temperature the snow line is drawn on, and
    // the window carries it rather than dropping it: it used to be written as
    // zero here, which is a channel the sampler fills and nobody reads.
    expect(hf.slots[3]).toBe(packBaseTemp(0.6));
    expect(unpackBaseTemp(hf.slots[3]!)).toBeCloseTo(0.6, 2);
  });
  it('bumps one version for both arrays, so the presentation uploads them together', () => {
    const hf = createHeightfield(plane(1, 1), { size: 16 });
    hf.fillAll(0, 0);
    const v = hf.version;
    expect(hf.update(1000 * CELL, 1000 * CELL)).toBe('jump');
    expect(hf.version).toBeGreaterThan(v);
  });
  it('defaults to the world window of N cells', () => {
    const hf = createHeightfield(plane(0, 0));
    expect(hf.size).toBe(N);
    expect(hf.cell).toBe(CELL);
    expect(N).toBe(560);
  });
});
