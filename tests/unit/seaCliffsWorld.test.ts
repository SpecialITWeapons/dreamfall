import { describe, expect, it } from 'vitest';
import type { Biome } from '../../library/contract';
import { createLibrary } from '../../library/index.js';
import { createHeightfield } from '../../src/engine/terrain/Heightfield';
import { createWorldSampler, type WorldSampler } from '../../src/engine/terrain/WorldSampler';

const lib = createLibrary();
const sampler = createWorldSampler(42, { biomes: lib.biomes });
/** The two cliffs of seed 42 the probes photographed. */
const PLACES = [
  { x: 3584, z: -2992 },
  { x: 2720, z: 2240 },
];

/** A point near (x, z) the cliffs cut by at least `depth` metres, on a 16 m grid. */
const cutNear = (s: WorldSampler, x0: number, z0: number, depth: number) => {
  const out = new Float64Array(5);
  for (let r = 0; r <= 600; r += 16)
    for (let a = 0; a < 32; a++) {
      const x = x0 + Math.cos((a / 32) * Math.PI * 2) * r,
        z = z0 + Math.sin((a / 32) * Math.PI * 2) * r;
      s.baseFields(x, z, out);
      if (s.cliffs.at(x, z, out[0]!, 1) < -depth) return { x, z, b: out[0]! };
    }
  throw new Error(`no cut of ${depth} m near ${x0}, ${z0}`);
};

describe('sea cliffs in the sampler', () => {
  it('adds the cut to the window and leaves the base fields alone', () => {
    const { x, z, b } = cutNear(sampler, PLACES[0]!.x, PLACES[0]!.z, 20);
    const out = new Float64Array(4),
      slots = new Uint8Array(4),
      base = new Float64Array(5);
    sampler.baseFields(x, z, base);
    expect(base[0]).toBe(b);
    sampler.sampleWindow(x, z, out, slots);
    expect(out[0]).toBeLessThan(b - 20);
    const bare = createWorldSampler(42, { biomes: lib.biomes, seaCliffs: false });
    bare.sampleWindow(x, z, out, slots);
    expect(out[0]).toBeGreaterThan(b - 20);
  });
  it('gives way to a settlement by exactly its share of the texel', () => {
    const plain = { id: 'plain', presence: () => 1 } as unknown as Biome;
    const town = { id: 'town', presence: () => 1, inherit: { trees: 0.5 } } as unknown as Biome;
    const halved = createWorldSampler(42, { biomes: [plain, town] });
    const { x, z, b } = cutNear(halved, PLACES[0]!.x, PLACES[0]!.z, 20);
    const out = new Float64Array(4),
      slots = new Uint8Array(4);
    halved.sampleWindow(x, z, out, slots);
    expect(out[0]).toBeCloseTo(b + halved.cliffs.at(x, z, b, 0.5), 9);
    const alone = createWorldSampler(42, { biomes: [plain] });
    alone.sampleWindow(x, z, out, slots);
    expect(out[0]).toBeCloseTo(b + alone.cliffs.at(x, z, b, 1), 9);
  });
  it('cuts without a pit and leaves no islet taller than a ripple in front of a cliff', () => {
    // Measures what the eye would see, not every threshold crossing: a smooth
    // cut passing through the "cut" line (h < base - 2) is not a pit, and a
    // sub-metre sliver at the edge of a partial cut is a ragged wet shore,
    // not land standing in the sea. Both places run even if the first turns
    // up something, so a failure reports both.
    const size = 192;
    const near = (k: number) => [k - 1, k + 1, k - size, k + size];
    let totalPits = 0,
      totalIslets = 0;
    for (const place of PLACES) {
      const hf = createHeightfield(sampler, { size });
      const cx = Math.round(place.x / 16),
        cz = Math.round(place.z / 16);
      hf.fillAll(cx, cz);
      const base = new Float64Array(5);
      const h = new Float64Array(size * size),
        cut = new Uint8Array(size * size);
      for (let j = 0; j < size; j++)
        for (let i = 0; i < size; i++) {
          const x = (cx - size / 2 + i) * 16,
            z = (cz - size / 2 + j) * 16;
          sampler.baseFields(x, z, base);
          h[j * size + i] = hf.heightAt(x, z);
          cut[j * size + i] = h[j * size + i]! < base[0]! - 2 ? 1 : 0;
        }
      let cuts = 0;
      for (let k = 0; k < size * size; k++) if (cut[k]) cuts++;
      expect(cuts).toBeGreaterThan(100); // the place still has its cliff

      // a pit: a cell more than 3 m below every one of its four neighbours
      for (let j = 1; j < size - 1; j++)
        for (let i = 1; i < size - 1; i++) {
          const k = j * size + i;
          if (near(k).every((n) => h[k]! < h[n]! - 3)) {
            totalPits++;
            const x = (cx - size / 2 + i) * 16,
              z = (cz - size / 2 + j) * 16;
            sampler.baseFields(x, z, base);
            console.log(
              `pit at (${x},${z}) h=${h[k]!.toFixed(2)} base=${base[0]!.toFixed(2)} neighbours=${near(k)
                .map((n) => h[n]!.toFixed(2))
                .join(',')}`,
            );
          }
        }

      // an islet: land (h > 0) under 9 cells, touching a cut cell, whose
      // highest point still stands over a metre
      const seen = new Uint8Array(size * size);
      for (let k = 0; k < size * size; k++) {
        if (seen[k] || !(h[k]! > 0)) continue;
        const stack = [k],
          cells: number[] = [];
        seen[k] = 1;
        while (stack.length) {
          const c = stack.pop()!;
          cells.push(c);
          const ci = c % size;
          for (const n of near(c)) {
            if (n < 0 || n >= size * size || Math.abs((n % size) - ci) > 1) continue;
            if (!seen[n] && h[n]! > 0) {
              seen[n] = 1;
              stack.push(n);
            }
          }
        }
        if (cells.length >= 9 || !cells.some((c) => near(c).some((n) => cut[n]))) continue;
        const highest = Math.max(...cells.map((c) => h[c]!));
        if (highest <= 1) continue;
        totalIslets++;
        const coords = cells.map((c) => {
          const i = c % size,
            j = Math.floor(c / size);
          const x = (cx - size / 2 + i) * 16,
            z = (cz - size / 2 + j) * 16;
          return `(${x},${z}) h=${h[c]!.toFixed(2)}`;
        });
        console.log(`islet (${cells.length} cells, highest ${highest.toFixed(2)}): ${coords.join(' | ')}`);
      }
    }
    expect(totalPits).toBe(0);
    expect(totalIslets).toBe(0);
  });
  it('cuts a tenth to a fifth of the coast, here and there', () => {
    const out = new Float64Array(4),
      slots = new Uint8Array(4),
      base = new Float64Array(5);
    let coast = 0,
      cut = 0;
    for (let z = -20000; z <= 20000; z += 48)
      for (let x = -20000; x <= 20000; x += 48) {
        sampler.baseFields(x, z, base);
        if (base[0]! < 0.5 || base[0]! > 3) continue;
        coast++;
        sampler.sampleWindow(x, z, out, slots);
        if (out[0]! < base[0]! - 3) cut++;
      }
    const share = cut / coast;
    console.log(`coast samples ${coast}, cut ${cut}, share ${(share * 100).toFixed(1)}%`);
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.2);
  }, 60_000);
});
