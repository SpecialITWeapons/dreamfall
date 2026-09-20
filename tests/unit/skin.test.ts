import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildFlesh } from '../../src/engine/avatar/Flesh';
import { BLEND, mergeSkins, type Chain } from '../../src/engine/avatar/Skin';

const BONES = ['a', 'b', 'c'];
const index = (name: string) => BONES.indexOf(name);
const arm = (over: Partial<Chain> = {}): Chain => ({
  bones: BONES,
  joints: [new Vector3(0, 0, 0), new Vector3(0, 0.3, 0), new Vector3(0, 0.6, 0)],
  profile: () => 0.05,
  swatch: () => 'suit',
  ...over,
});
const grow = (chain: Chain) => buildFlesh([chain], index, { cell: 0.02 });

/** Every undirected edge of the surface, and how many triangles own it. */
const edges = (index: Uint32Array) => {
  const seen = new Map<string, number>();
  for (let t = 0; t < index.length; t += 3)
    for (const [a, b] of [
      [index[t]!, index[t + 1]!],
      [index[t + 1]!, index[t + 2]!],
      [index[t + 2]!, index[t]!],
    ] as Array<[number, number]>) {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  return seen;
};

describe('mergeSkins', () => {
  it('lays several chains into one surface without moving anything', () => {
    const a = grow(arm()),
      b = grow(arm({ swatch: () => 'boots' }));
    const one = mergeSkins([a, b]);
    expect(one.position.length).toBe(a.position.length + b.position.length);
    expect(one.index.length).toBe(a.index.length + b.index.length);
    // the second chain's triangles point at the second chain's vertices
    const offset = a.position.length / 3;
    expect(one.index[a.index.length]).toBe(b.index[0]! + offset);
    expect(one.swatch[offset]).toBe('boots');
    expect(one.swatch[0]).toBe('suit');
    // and every edge of the pair is still owned twice
    for (const owners of edges(one.index).values()) expect(owners).toBe(2);
  });
});

describe('the blend band', () => {
  it('carries the band that makes a joint soft', () => {
    expect(BLEND).toBeGreaterThan(0.1);
    expect(BLEND).toBeLessThan(0.5);
  });
});
