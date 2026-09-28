import { describe, expect, it } from 'vitest';
import type { Biome } from '../../library/contract';
import { createLibrary } from '../../library/index.js';
import { createOverrides } from '../../src/engine/scenery/Overrides';
import { createSites } from '../../src/engine/scenery/Sites';
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
  it('gives way to a settlement by its own presence, not by its share of the slots', () => {
    // A quarter of the town against all of the plain: the slots give the town
    // a fifth of the texel, and the cut gives way by a quarter. A raw presence
    // is what fades smoothly over a settlement's feather; the slots stay the
    // settlement's until it is a thousandth, because a country's own presence
    // is that small.
    const plain = { id: 'plain', presence: () => 1 } as unknown as Biome;
    const town = { id: 'town', presence: () => 0.25, inherit: { trees: 0.5 } } as unknown as Biome;
    const quarter = createWorldSampler(42, { biomes: [plain, town] });
    const { x, z, b } = cutNear(quarter, PLACES[0]!.x, PLACES[0]!.z, 20);
    const out = new Float64Array(4),
      slots = new Uint8Array(4);
    quarter.sampleWindow(x, z, out, slots);
    expect(out[2]).toBeCloseTo(0.2, 9);
    expect(out[0]).toBeCloseTo(b + quarter.cliffs.at(x, z, b, 0.75), 9);
    const alone = createWorldSampler(42, { biomes: [plain] });
    alone.sampleWindow(x, z, out, slots);
    expect(out[0]).toBeCloseTo(b + alone.cliffs.at(x, z, b, 1), 9);
  });
  it('lets a coastal town go back to the cliffs over its whole feather, never in one cell', () => {
    // Seed 42's town at about (-5289, -7577), 824 m wide, stands on a cliff
    // coast. Its share of the cut used to be read off the normalised slots,
    // which stay the town's until its raw presence is a thousandth, and then
    // the cut came back whole in one 16 m step: a wall side-on to the coast.
    // Every step along a radius across its rim is held against the two
    // grounds it lies between -- the uncut one (a sampler without cliffs) and
    // the fully cut one (that plus `cliffs.at(..., 1)`), neither of which
    // knows the town. The town's say may add to a step at most half the full
    // cut there: the face is 32 m, so a full cut of H metres is spread over at
    // least two 16 m cells, H / 2 a cell. Mixed by a share that moves by at
    // most one step of a sstep over the feather, the excess is |ds| * H.
    const bare = createWorldSampler(42, { biomes: lib.biomes, seaCliffs: false });
    const sites = createSites({
      library: lib,
      sampler,
      heightfield: createHeightfield(sampler, { size: 32 }),
      overrides: createOverrides(),
    });
    const town = sites.charted(-5349, -8069, 1000, []).find((s) => s.id.startsWith('town'));
    expect(town).toBeDefined();
    const { x: cx, z: cz, radius } = town!;
    const out = new Float64Array(4),
      slots = new Uint8Array(4),
      base = new Float64Array(5);
    const at = (x: number, z: number) => {
      sampler.sampleWindow(x, z, out, slots);
      const h = out[0]!;
      bare.sampleWindow(x, z, out, slots);
      sampler.baseFields(x, z, base);
      const full = sampler.cliffs.at(x, z, base[0]!, 1);
      return { h, bare: out[0]!, full };
    };
    // The largest excess, and the tightest against its allowance.
    let largest = { excess: 0, allowed: 0, a: 0, r: 0 },
      over = -Infinity,
      cut = 0;
    for (let a = 0; a < 360; a++) {
      const ca = Math.cos((a * Math.PI) / 180),
        sa = Math.sin((a * Math.PI) / 180);
      let prev = at(cx + ca * (radius - 32), cz + sa * (radius - 32));
      for (let r = radius - 16; r <= radius + 360; r += 16) {
        const p = at(cx + ca * r, cz + sa * r);
        if (p.full < -20) cut++;
        const step = Math.abs(p.h - prev.h),
          own = Math.max(Math.abs(p.bare - prev.bare), Math.abs(p.bare + p.full - prev.bare - prev.full));
        const allowed = Math.max(-p.full, -prev.full) / 2;
        if (step - own > largest.excess)
          largest = { excess: step - own, allowed, a, r: Math.round(r - radius) };
        over = Math.max(over, step - own - allowed);
        prev = p;
      }
    }
    console.log(
      `town rim: largest excess ${largest.excess.toFixed(1)} m against ${largest.allowed.toFixed(1)} allowed, at ${largest.a} deg, ${largest.r} m past the radius; tightest ${over.toFixed(1)} m over`,
    );
    expect(cut).toBeGreaterThan(100); // the rim does run into the cliffs
    expect(over).toBeLessThanOrEqual(0);
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

      // an islet: land (h > 0) under 9 cells, clear of the window's edge,
      // touching a cut cell, whose highest point still stands over a metre
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
        // land that runs off the window may be the mainland: the window cut
        // it off, not the sea
        const border = (c: number) => {
          const i = c % size,
            j = Math.floor(c / size);
          return i === 0 || j === 0 || i === size - 1 || j === size - 1;
        };
        if (cells.some(border)) continue;
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
