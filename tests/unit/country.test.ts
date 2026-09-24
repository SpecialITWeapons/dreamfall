import { describe, expect, it } from 'vitest';
import { countryOf, standingOf } from '../../src/engine/terrain/Country';

// Two countries and a settlement standing in them, in registry order.
const standing = standingOf([{}, {}, { inherit: { trees: 0.4 } }]);
const ids = new Uint8Array(4),
  weights = new Float32Array(4);

describe('countryOf', () => {
  it('leaves open country as it found it, with nothing cleared', () => {
    const clearing = countryOf([0, 1, 0], [0.7, 0.3, 0], standing, ids, weights);
    expect(clearing).toBe(1);
    expect(Array.from(ids.slice(0, 3))).toEqual([0, 1, 0]);
    expect(weights[0]).toBeCloseTo(0.7, 6);
    expect(weights[1]).toBeCloseTo(0.3, 6);
    expect(weights[2]).toBe(0);
  });

  it("hands a settlement's share to the country beside it, and clears its trees by it", () => {
    // A village on eight tenths of the texel, in a wood and a meadow.
    const clearing = countryOf([2, 0, 1], [0.8, 0.15, 0.05], standing, ids, weights);
    expect(weights[0]).toBe(0);
    expect(weights[1]).toBeCloseTo(0.75, 6);
    expect(weights[2]).toBeCloseTo(0.25, 6);
    expect(clearing).toBeCloseTo(1 - 0.8 * (1 - 0.4), 6);
  });

  it('gives ground with no country in it to the first biome, as the sampler does', () => {
    const clearing = countryOf([2, 2, 2], [1, 0, 0], standing, ids, weights);
    expect(Array.from(ids.slice(0, 3))).toEqual([0, 0, 0]);
    expect(Array.from(weights.slice(0, 3))).toEqual([1, 0, 0]);
    expect(clearing).toBeCloseTo(0.4, 6);
  });

  it('reads who stands in a country off the registry, and a country clears nothing', () => {
    expect(Array.from(standing.inherit)).toEqual([0, 0, 1]);
    expect(standing.trees[0]).toBe(1);
    expect(standing.trees[2]).toBeCloseTo(0.4, 6);
  });
});
