import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildFlesh } from '../../src/engine/avatar/Flesh';
import type { Chain } from '../../src/engine/avatar/Skin';

const BONES = ['body', 'shoulder', 'elbow'];
const index = (name: string) => BONES.indexOf(name);
/** A chest along z and an arm out of its side along x: two tubes that have to meet. */
const chest = (over: Partial<Chain> = {}): Chain => ({
  bones: ['body', 'body'],
  joints: [new Vector3(0, 0, -0.3), new Vector3(0, 0, 0.3)],
  profile: () => 0.12,
  swatch: () => 'suit',
  flatten: 1.3,
  ...over,
});
const arm = (over: Partial<Chain> = {}): Chain => ({
  bones: ['shoulder', 'elbow', 'elbow'],
  joints: [new Vector3(0.1, 0, 0.15), new Vector3(0.4, 0, 0.15), new Vector3(0.7, 0, 0.15)],
  profile: (t) => 0.06 - 0.02 * t,
  swatch: (t) => (t > 0.9 ? 'gloves' : 'suit'),
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

describe('buildFlesh', () => {
  const skin = buildFlesh([chest(), arm()], index, { cell: 0.02, blend: 0.05 });
  const count = skin.position.length / 3;

  it('closes the surface: every edge belongs to exactly two triangles', () => {
    // One surface over both chains, and a hole in it is a hole you can see
    // through the figure.
    expect(skin.index.length).toBeGreaterThan(0);
    for (const owners of edges(skin.index).values()) expect(owners).toBe(2);
  });
  it("faces out: every triangle winds the way its vertices' normals point", () => {
    const a = new Vector3(),
      b = new Vector3(),
      c = new Vector3(),
      n = new Vector3();
    const at = (v: number, out: Vector3) =>
      out.set(skin.position[v * 3]!, skin.position[v * 3 + 1]!, skin.position[v * 3 + 2]!);
    let agree = 0;
    for (let t = 0; t < skin.index.length; t += 3) {
      const [i, j, k] = [skin.index[t]!, skin.index[t + 1]!, skin.index[t + 2]!];
      at(i, a);
      at(j, b);
      at(k, c);
      n.crossVectors(b.sub(a), c.sub(a));
      const nv = new Vector3(skin.normal[i * 3]!, skin.normal[i * 3 + 1]!, skin.normal[i * 3 + 2]!);
      if (n.dot(nv) > 0) agree++;
    }
    expect(agree / (skin.index.length / 3)).toBeGreaterThan(0.98);
  });
  it('lies on the chains, within a cell of their surface', () => {
    // A vertex sits where the field crosses zero: off the chest by its radius,
    // off the arm by its taper, never floating and never sunk.
    for (let v = 0; v < count; v++) {
      const x = skin.position[v * 3]!,
        y = skin.position[v * 3 + 1]!,
        z = skin.position[v * 3 + 2]!;
      const inChest = Math.hypot(x / 1.3, y * 1.3) <= 0.12 + 0.025 && Math.abs(z) <= 0.3 + 0.12 + 0.025;
      const t = Math.min(Math.max((x - 0.1) / 0.6, 0), 1);
      const inArm =
        Math.hypot(y, z - 0.15) <= 0.06 - 0.02 * t + 0.025 && x >= 0.1 - 0.06 - 0.025 && x <= 0.7 + 0.06;
      expect(inChest || inArm, `vertex ${v} at ${x.toFixed(3)} ${y.toFixed(3)} ${z.toFixed(3)}`).toBe(true);
    }
  });
  it('binds every vertex to bones that exist, with weights that add to one', () => {
    for (let v = 0; v < count; v++) {
      let sum = 0;
      for (let s = 0; s < 4; s++) {
        sum += skin.skinWeight[v * 4 + s]!;
        expect(skin.skinIndex[v * 4 + s]).toBeLessThan(BONES.length);
      }
      expect(sum).toBeCloseTo(1, 5);
    }
  });
  it('fills the join: the field is solid where the arm meets the chest', () => {
    // The whole reason for a field. Two tubes pushed together leave a crease
    // and, seen from the right angle, daylight; blended, the point on the
    // chest's surface where the arm's root sits is inside, and the surface
    // rounds over it. Measured as: no vertex of the surface within the blend
    // of that point sits at the chest's own radius -- they all stand off it.
    const root = new Vector3(0.1, 0, 0.15);
    let near = 0;
    for (let v = 0; v < count; v++) {
      const x = skin.position[v * 3]!,
        y = skin.position[v * 3 + 1]!,
        z = skin.position[v * 3 + 2]!;
      if (Math.abs(z - root.z) < 0.03 && x > 0.12 && x < 0.2) {
        near++;
        // between the chest's surface and the arm's, a fillet: further from
        // the arm's axis than the arm is thick
        expect(Math.hypot(y, z - root.z)).toBeGreaterThan(0.06 - 0.005);
      }
    }
    expect(near).toBeGreaterThan(0);
  });
  it('shares a vertex on the fillet between the two chains it lies between', () => {
    let shared = 0;
    for (let v = 0; v < count; v++) {
      const bones = new Set<number>();
      for (let s = 0; s < 4; s++)
        if (skin.skinWeight[v * 4 + s]! > 0.05) bones.add(skin.skinIndex[v * 4 + s]!);
      if (bones.has(index('body')) && bones.has(index('shoulder'))) shared++;
    }
    expect(shared).toBeGreaterThan(0);
  });
  it('wears the swatch of the chain each vertex is nearest to, patches included', () => {
    const worn = new Set(skin.swatch);
    expect(worn.has('suit')).toBe(true);
    expect(worn.has('gloves')).toBe(true);
    const patched = buildFlesh(
      [chest({ patch: (t, around) => (Math.sin(around) > 0.9 && t > 0.4 ? 'badge' : null) })],
      index,
      {
        cell: 0.02,
      },
    );
    expect(new Set(patched.swatch).has('badge')).toBe(true);
    // a patch's edge is a mix of the two swatches it runs between, in
    // proportion, and never a third colour
    let mixed = 0;
    for (let v = 0; v < patched.swatch.length; v++) {
      expect(patched.mix[v]).toBeGreaterThanOrEqual(0);
      expect(patched.mix[v]).toBeLessThanOrEqual(0.5);
      if (patched.mix[v]! > 0) {
        mixed++;
        expect(new Set([patched.swatch[v], patched.swatch2[v]])).toEqual(new Set(['suit', 'badge']));
      }
    }
    expect(mixed).toBeGreaterThan(0);
    // and every vertex knows where it sits on its chain
    for (let v = 0; v < count; v++) {
      expect(skin.along[v]).toBeGreaterThanOrEqual(0);
      expect(skin.along[v]).toBeLessThanOrEqual(1);
      expect(skin.around[v]).toBeGreaterThanOrEqual(0);
      expect(skin.around[v]).toBeLessThan(Math.PI * 2 + 1e-6);
    }
  });
  it('is the same surface every time', () => {
    const again = buildFlesh([chest(), arm()], index, { cell: 0.02, blend: 0.05 });
    expect(again.position).toEqual(skin.position);
    expect(again.index).toEqual(skin.index);
  });
  it('refuses what it cannot build', () => {
    expect(() => buildFlesh([], index, { cell: 0.02 })).toThrow(/needs a chain/);
    expect(() => buildFlesh([chest({ joints: [new Vector3()] })], index, { cell: 0.02 })).toThrow(
      /at least two/,
    );
    expect(() => buildFlesh([chest()], index, { cell: 0 })).toThrow(/cell/);
  });
});
