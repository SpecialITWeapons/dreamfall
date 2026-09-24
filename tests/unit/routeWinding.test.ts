import { describe, expect, it } from 'vitest';
import { createLibrary } from '../../library/index.js';
import { relativeNeighbours } from '../../src/engine/scenery/RoadNetwork';
import { ROUTE, routeBetween } from '../../src/engine/scenery/Route';
import { createOverrides } from '../../src/engine/scenery/Overrides';
import { createSites } from '../../src/engine/scenery/Sites';
import { createHeightfield } from '../../src/engine/terrain/Heightfield';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';

/**
 * The pairs around the middle of three worlds, and the ground a road between
 * them crosses: about 160 pairs, of which the sea parts a little more than half.
 */
const PAIRS = [42, 7, 1234].flatMap((seed) => {
  const library = createLibrary();
  const sampler = createWorldSampler(seed, { biomes: library.biomes });
  const sites = createSites({
    library,
    sampler,
    heightfield: createHeightfield(sampler),
    overrides: createOverrides([]),
  });
  const out = new Float64Array(5);
  const heightAt = (x: number, z: number) => {
    sampler.baseFields(x, z, out);
    return out[0]!;
  };
  const slope = (x: number, z: number) =>
    Math.hypot(heightAt(x + 60, z) - heightAt(x - 60, z), heightAt(x, z + 60) - heightAt(x, z - 60)) / 120;
  return relativeNeighbours(sites.near(0, 0, 50000, []))
    .filter((e) => Math.hypot(e.a.x, e.a.z) < 36000)
    .map((edge) => {
      let relief = 0;
      for (let t = 0.1; t < 0.95; t += 0.1)
        relief += slope(edge.a.x + (edge.b.x - edge.a.x) * t, edge.a.z + (edge.b.z - edge.a.z) * t);
      return { seed, edge, heightAt, relief: relief / 9 };
    });
});

/** Every road over those pairs: how much it winds, and the grade it climbs at nineteen steps in twenty. */
const roads = () =>
  PAIRS.map((pair) => {
    const path = routeBetween(pair.edge.a, pair.edge.b, pair.heightAt, pair.seed);
    if (!path) return { ...pair, path, winding: Number.NaN, grade: Number.NaN };
    let length = 0;
    const grades: number[] = [];
    for (let i = 1; i < path.length; i++) {
      const [x0, z0] = path[i - 1]!,
        [x1, z1] = path[i]!;
      const run = Math.hypot(x1 - x0, z1 - z0);
      length += run;
      // the first and last few hundred metres climb onto a plateau the base height does not have
      if (i > 10 && i < path.length - 10)
        grades.push(Math.abs(pair.heightAt(x1, z1) - pair.heightAt(x0, z0)) / run);
    }
    grades.sort((p, q) => p - q);
    return {
      ...pair,
      path,
      winding: length / pair.edge.length,
      grade: grades[Math.floor(grades.length * 0.95)] ?? 0,
    };
  });

const median = (xs: number[]) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)] ?? Number.NaN;

describe('how a road winds', () => {
  it(
    'bends like a road over every kind of ground, and climbs no steeper than one',
    { timeout: 60_000 },
    () => {
      // This world is steep: the median ground under a pair tilts more than 15 %,
      // so the classes are the world's own thirds by relief rather than a flat,
      // a hill and a mountain written down beforehand -- measured on these pairs,
      // hard thresholds put one road on the flat and fifty in the mountains.
      const built = roads().filter((r) => r.path);
      expect(built.length).toBeGreaterThan(40);
      const relief = built.map((r) => r.relief).sort((p, q) => p - q);
      const low = relief[Math.floor(relief.length / 3)]!,
        high = relief[Math.floor((relief.length * 2) / 3)]!;
      const thirds = [
        built.filter((r) => r.relief < low),
        built.filter((r) => r.relief >= low && r.relief < high),
        built.filter((r) => r.relief >= high),
      ];
      for (const third of thirds) {
        const winding = median(third.map((r) => r.winding));
        // Never a ruler, never a detour: measured 1.25 to 1.37 across the thirds.
        expect(winding).toBeGreaterThan(1.1);
        expect(winding).toBeLessThan(1.6);
        // The grade the steep cost holds a road to: measured 0.15 to 0.18.
        expect(median(third.map((r) => r.grade))).toBeLessThan(0.22);
      }
    },
  );

  it(
    'is kept off no land way by its grade: the sea decides which pairs are joined',
    { timeout: 60_000 },
    () => {
      const joined = roads().filter((r) => r.path).length;
      const cliff = ROUTE.cliff;
      ROUTE.cliff = Infinity;
      const anyGrade = roads().filter((r) => r.path).length;
      ROUTE.cliff = cliff;
      expect(joined).toBeGreaterThanOrEqual(Math.floor(anyGrade * 0.9));
    },
  );
});
