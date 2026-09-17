import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { BLEND, buildChain, mergeSkins, type Chain } from '../../src/engine/avatar/Skin';

const BONES = ['a', 'b', 'c'];
const index = (name: string) => BONES.indexOf(name);
const arm = (over: Partial<Chain> = {}): Chain => ({
  bones: BONES,
  joints: [new Vector3(0, 0, 0), new Vector3(0, 0.3, 0), new Vector3(0, 0.6, 0)],
  profile: () => 0.05,
  swatch: () => 'suit',
  sides: 8,
  rings: 3,
  capStart: true,
  capEnd: true,
  ...over,
});

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

describe('buildChain', () => {
  it('closes the surface: every edge belongs to exactly two triangles', () => {
    // This is what "one skin" means and what twenty solids could never give.
    // A hole here is a hole you can see through the figure.
    const skin = buildChain(arm(), index);
    for (const [edge, owners] of edges(skin.index))
      expect(`${edge} owned by ${owners}`).toBe(`${edge} owned by 2`);
  });
  it('leaves the ends open when it is not asked to cap them', () => {
    const open = buildChain(arm({ capStart: false, capEnd: false }), index);
    const once = [...edges(open.index).values()].filter((n) => n === 1).length;
    // two rings of eight, each edge of them owned by one triangle
    expect(once).toBe(16);
  });
  it('binds every vertex to bones that exist, with weights that add to one', () => {
    const skin = buildChain(arm(), index);
    const count = skin.position.length / 3;
    for (let i = 0; i < count; i++) {
      const w = skin.skinWeight[i * 4]! + skin.skinWeight[i * 4 + 1]!;
      expect(w).toBeCloseTo(1, 6);
      expect(skin.skinIndex[i * 4]).toBeLessThan(BONES.length);
      expect(skin.skinIndex[i * 4 + 1]).toBeLessThan(BONES.length);
    }
  });
  it('gives the middle of a segment to one bone and the joint to two', () => {
    // The whole point of a skin: a vertex out on the upper arm follows the
    // shoulder alone, and one at the elbow is half the shoulder's and half the
    // elbow's, which is what bends instead of coming apart.
    const skin = buildChain(arm(), index);
    const count = skin.position.length / 3;
    let whole = 0,
      shared = 0;
    for (let i = 0; i < count; i++) {
      const second = skin.skinWeight[i * 4 + 1]!;
      if (second < 1e-6) whole++;
      if (second > 0.4) shared++;
    }
    expect(whole).toBeGreaterThan(0);
    expect(shared).toBeGreaterThan(0);
  });
  it('lays the skin on the chain, at the thickness it was asked for', () => {
    const thick = buildChain(arm({ profile: (t) => 0.04 + 0.03 * t }), index);
    const count = thick.position.length / 3;
    const at = new Vector3();
    const line = { a: new Vector3(0, 0, 0), b: new Vector3(0, 0.6, 0) };
    for (let i = 0; i < count; i++) {
      at.set(thick.position[i * 3]!, thick.position[i * 3 + 1]!, thick.position[i * 3 + 2]!);
      const t = Math.min(Math.max(at.y / 0.6, 0), 1);
      const off = Math.hypot(at.x - line.a.x, at.z - line.a.z);
      // within the profile at that height, with the slack of a cap that reaches
      // past the last ring along the chain rather than across it
      expect(off).toBeLessThanOrEqual(0.04 + 0.03 * t + 1e-6);
    }
  });
  it('crowds its rings at the joints, where the skin has to bend', () => {
    const skin = buildChain(arm({ capStart: false, capEnd: false }), index);
    const sides = 8;
    const ys: number[] = [];
    for (let i = 0; i < skin.position.length / 3; i += sides) ys.push(skin.position[i * 3 + 1]!);
    const gaps = ys.slice(1).map((y, i) => y - ys[i]!);
    // the gap in the middle of a segment is wider than the gap at its end
    expect(Math.max(...gaps)).toBeGreaterThan(Math.min(...gaps) * 1.5);
  });
  it('darkens the skin inside a joint and nowhere else', () => {
    const skin = buildChain(arm(), index);
    const count = skin.position.length / 3;
    let dark = 0,
      plain = 0;
    for (let i = 0; i < count; i++) {
      if (skin.shade[i]! < 0.999) dark++;
      else plain++;
    }
    expect(dark).toBeGreaterThan(0);
    expect(plain).toBeGreaterThan(dark);
  });
  it('refuses a chain that is not one', () => {
    expect(() => buildChain(arm({ joints: [new Vector3()] }), index)).toThrow(/at least two/);
    expect(() => buildChain(arm({ bones: ['a', 'b'] }), index)).toThrow(/one bone per joint/);
  });
  it('carries the band that makes a joint soft', () => {
    expect(BLEND).toBeGreaterThan(0.1);
    expect(BLEND).toBeLessThan(0.5);
  });
});

describe('mergeSkins', () => {
  it('lays several chains into one surface without moving anything', () => {
    const a = buildChain(arm(), index),
      b = buildChain(arm({ swatch: () => 'boots' }), index);
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

describe('flatten', () => {
  it('makes an ellipse rather than shuffling a circle', () => {
    // It used to normalise the offset after scaling it, which turns an ellipse
    // straight back into a circle and leaves the vertices merely bunched. A
    // chest is wider than it is thick; this is the number that says so.
    const wide = buildChain(arm({ flatten: 2, capStart: false, capEnd: false }), index);
    let across = 0,
      through = 0;
    for (let i = 0; i < wide.position.length / 3; i++) {
      across = Math.max(across, Math.abs(wide.position[i * 3]!));
      through = Math.max(through, Math.abs(wide.position[i * 3 + 2]!));
    }
    expect(across).toBeCloseTo(0.05 * 2, 6);
    expect(through).toBeCloseTo(0.05 / 2, 6);
  });
});
