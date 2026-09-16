import { Matrix4, Quaternion, Vector2, Vector3 } from 'three';
import { uniform } from 'three/tsl';
import { describe, expect, it } from 'vitest';
import { defineBiome, type GroundHook, type Library } from '../../library/contract';
import type { GroundShade } from '../../src/engine/scenery/GroundShade';
import { CARDS, FORMS, PER_FORM, TUFTS, createGrass, tuftForm } from '../../src/engine/scenery/Grass';
import type { SceneryMaterials } from '../../src/engine/scenery/Painted';
import type { SkyUniforms } from '../../src/engine/sky/SkyUniforms';
import { createOrigin } from '../../src/engine/sim/Origin';
import type { Heightfield } from '../../src/engine/terrain/Heightfield';

const VERTICES = CARDS * 4,
  TRIANGLES = CARDS * 2;

const at = (a: Float32Array, i: number, stride: number) =>
  Array.from(a.slice(i * stride, i * stride + stride));

/** The two ends of card `c`: its root edge and its tip edge, as (x, y, z) and (u, v). */
const card = (form: ReturnType<typeof tuftForm>, c: number) => {
  const b = c * 4;
  return [0, 1, 2, 3].map((i) => ({
    position: at(form.position, b + i, 3),
    uv: at(form.uv, b + i, 2),
  }));
};

/** How wide a form looks from one direction, over all its cards: a card seen along its own plane adds nothing. */
const seenFrom = (form: ReturnType<typeof tuftForm>, angle: number) => {
  let wide = 0;
  for (let c = 0; c < CARDS; c++) {
    const [root, other] = card(form, c);
    const dx = other!.position[0]! - root!.position[0]!,
      dz = other!.position[2]! - root!.position[2]!;
    wide += Math.abs(Math.cos(angle) * dz - Math.sin(angle) * dx);
  }
  return wide;
};

describe('tuftForm', () => {
  it('bakes three crossed cards: twelve vertices and six triangles to a tuft, so a full window is 120k triangles', () => {
    for (let f = 0; f < FORMS; f++) {
      const form = tuftForm(f);
      expect(form.position).toHaveLength(VERTICES * 3);
      expect(form.normal).toHaveLength(VERTICES * 3);
      expect(form.uv).toHaveLength(VERTICES * 2);
      expect(form.index).toHaveLength(TRIANGLES * 3);
      for (const i of form.index) expect(i).toBeLessThan(VERTICES);
    }
    expect(TUFTS * TRIANGLES).toBe(120000);
  });

  it('stands every card on the ground and names the root 0 and the tip 1, which is where the shade is mixed out', () => {
    for (let f = 0; f < FORMS; f++) {
      const form = tuftForm(f);
      for (let c = 0; c < CARDS; c++) {
        const [rootL, rootR, tipL, tipR] = card(form, c);
        for (const v of [rootL!, rootR!]) {
          expect(v.position[1]).toBe(0);
          expect(v.uv[1]).toBe(0);
        }
        for (const v of [tipL!, tipR!]) {
          expect(v.position[1]).toBeGreaterThan(0.5);
          expect(v.uv[1]).toBe(1);
        }
        // The tip is the wider end: the painted blades splay the way a tuft does.
        const root = Math.abs(rootR!.position[0]! - rootL!.position[0]!),
          tip = Math.abs(tipR!.position[0]! - tipL!.position[0]!);
        expect(tip).toBeGreaterThanOrEqual(root - 1e-6);
      }
    }
  });

  it('gives every form one card of the full height, so the scale is in metres of the tallest blade', () => {
    for (let f = 0; f < FORMS; f++) {
      const form = tuftForm(f);
      const heights = [...Array(CARDS).keys()].map((c) => card(form, c)[2]!.position[1]!);
      expect(Math.max(...heights)).toBe(1);
      // and the others are shorter, or the tuft is a wall of equals
      expect(Math.min(...heights)).toBeLessThan(0.9);
    }
  });

  it('takes a slice of the painted square as wide as the card itself and never leaves it', () => {
    for (let f = 0; f < FORMS; f++) {
      const form = tuftForm(f);
      for (let c = 0; c < CARDS; c++) {
        const [rootL, rootR] = card(form, c);
        const slice = rootR!.uv[0]! - rootL!.uv[0]!;
        expect(rootL!.uv[0]).toBeGreaterThanOrEqual(0);
        expect(rootR!.uv[0]).toBeLessThanOrEqual(1);
        // 2.6 nominal widths of painted square, the width the one card used to be
        const width = Math.hypot(
          rootR!.position[0]! - rootL!.position[0]!,
          rootR!.position[2]! - rootL!.position[2]!,
        );
        expect(slice).toBeCloseTo(width / 2.6, 6);
      }
    }
  });

  it('is seen from every direction, which the one card it replaces was not', () => {
    for (let f = 0; f < FORMS; f++) {
      const form = tuftForm(f);
      let thinnest = Infinity,
        widest = 0;
      for (let i = 0; i < 720; i++) {
        const wide = seenFrom(form, (i / 720) * Math.PI * 2);
        thinnest = Math.min(thinnest, wide);
        widest = Math.max(widest, wide);
      }
      // The card this replaces was 2.6 wide broadside and nothing at all along
      // its own plane, which is the streak the ground was carpeted in.
      expect(thinnest).toBeGreaterThan(0.6);
      expect(thinnest / widest).toBeGreaterThan(0.55);
      // and it stays a tuft rather than spreading into a mat: taller than wide
      expect(widest).toBeLessThan(1.5);
    }
  });

  it('bakes forms that differ from each other, and the same ones in every world', () => {
    const forms = [...Array(FORMS).keys()].map((f) => tuftForm(f));
    for (let f = 0; f < FORMS; f++) {
      expect(tuftForm(f).position).toEqual(forms[f]!.position);
      for (let g = f + 1; g < FORMS; g++) expect(forms[f]!.position).not.toEqual(forms[g]!.position);
    }
  });
});

const ground = (() => ({ albedo: null })) as unknown as GroundHook;

/** One biome everywhere, as thick as it is told: what is left is the placement's own arithmetic. */
const meadow = (density: number): Library => ({
  biomes: [
    defineBiome({
      id: 'meadow',
      name: 'meadow',
      params: {},
      presence: () => 1,
      ground,
      // No trees and no props: this window only ever reads the grass of a scatter.
      populate: { type: 'scatter', species: {}, density: 0, grass: { tint: 'grassCool', density } },
    }),
  ],
  species: [],
  props: [],
});

/** Flat ground of that one biome, so every attempt meets the same answer. */
const flat = (height = 100, onRead: () => void = () => {}): Heightfield =>
  ({
    heightAt: () => {
      onRead();
      return height;
    },
    slopeAt: () => 0,
    weightsAt: (_x: number, _z: number, ids: Uint8Array, weights: Float32Array) => {
      ids[0] = 0;
      weights[0] = 1;
      weights[1] = weights[2] = weights[3] = 0;
    },
  }) as unknown as Heightfield;

const grassOver = (density: number, heightfield = flat()) =>
  createGrass({
    seed: 42,
    library: meadow(density),
    heightfield,
    materials: { grass: () => ({ dispose() {} }) } as unknown as SceneryMaterials,
    shade: { aoNode: (node: unknown) => node } as unknown as GroundShade,
    uniforms: { uWorldOrigin: uniform(new Vector2(0, 0)) } as unknown as SkyUniforms,
  });

/** The instanced meshes behind the group, one to a form. */
const standing = (grass: ReturnType<typeof createGrass>) =>
  grass.mesh.children.map((child) => (child as { count: number }).count);

describe('createGrass', () => {
  it('hands back one mesh per form and nothing standing before the first window', () => {
    const grass = grassOver(0.2);
    expect(grass.mesh.children).toHaveLength(FORMS);
    expect(standing(grass)).toEqual([0, 0, 0, 0]);
    expect(grass.count).toBe(0);
    grass.dispose();
  });

  it('spreads a window over every form, in shares no draw of four could tell apart', () => {
    const grass = grassOver(0.2);
    grass.update(0, 0, 120, createOrigin(), false);
    const counts = standing(grass);
    expect(counts.reduce((sum, c) => sum + c, 0)).toBe(grass.count);
    expect(grass.count).toBeGreaterThan(2000);
    // A draw of four over a few thousand tufts; a fifth of the share is far
    // wider than chance and far narrower than a pick that favours a form.
    const share = grass.count / FORMS;
    for (const c of counts) {
      expect(c).toBeGreaterThan(share * 0.8);
      expect(c).toBeLessThan(share * 1.2);
    }
    grass.dispose();
  });

  it('never fills a form past its share -- the window cannot reach the ceiling in one rebuild', () => {
    const grass = grassOver(1);
    grass.update(0, 0, 120, createOrigin(), false);
    // 52 of the 121 tiles are within REACH, and each is 256 attempts: the most
    // a rebuild can write is 13312, well under the 20000 the meshes hold.
    expect(grass.count).toBe(13312);
    expect(grass.count).toBeLessThan(TUFTS);
    for (const c of standing(grass)) expect(c).toBeLessThanOrEqual(PER_FORM);
    grass.dispose();
  });

  it('stands every tuft on the ground, between 0.85 m and 1.95 m tall, squashed across without covering less ground', () => {
    const grass = grassOver(0.2);
    grass.update(0, 0, 120, createOrigin(), false);
    const matrix = new Matrix4(),
      position = new Vector3(),
      rotation = new Quaternion(),
      scale = new Vector3();
    for (const child of grass.mesh.children) {
      const mesh = child as unknown as { count: number; getMatrixAt(i: number, m: Matrix4): void };
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        matrix.decompose(position, rotation, scale);
        expect(position.y).toBe(100);
        expect(scale.y).toBeGreaterThanOrEqual(0.85);
        expect(scale.y).toBeLessThanOrEqual(1.95);
        // One axis gives what the other takes, so the ground a tuft covers is
        // the ground its height would have covered anyway.
        expect(scale.x * scale.z).toBeCloseTo(scale.y * scale.y, 6);
      }
    }
    grass.dispose();
  });

  it('writes nothing from altitude, and writes again when the origin jumps under it', () => {
    // A rebuild asks the ground thousands of times; an update that decides not
    // to rebuild asks it once, to see whether there is anything to see.
    let reads = 0;
    const grass = grassOver(
      0.2,
      flat(100, () => reads++),
    );
    const origin = createOrigin();
    const asked = () => {
      const was = reads;
      reads = 0;
      return was;
    };
    grass.update(0, 0, 9000, origin, false);
    expect(grass.mesh.visible).toBe(false);
    expect(asked()).toBe(1);
    expect(grass.count).toBe(0);
    grass.update(0, 0, 120, origin, false);
    expect(grass.mesh.visible).toBe(true);
    const written = grass.count;
    expect(written).toBeGreaterThan(0);
    expect(asked()).toBeGreaterThan(1000);
    // the same cell again: the window it already wrote is the window it wants
    grass.update(1, 1, 120, origin, false);
    expect(asked()).toBe(1);
    // an origin jump leaves every matrix relative to an origin that is gone
    grass.update(1, 1, 120, origin, true);
    expect(asked()).toBeGreaterThan(1000);
    expect(grass.count).toBe(written);
    grass.dispose();
  });
});
