import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DECK, createCloudCover, deckTop } from '../../src/engine/sky/CloudCover';
import { CLOUD_SEA_DROP } from '../../src/engine/sky/CloudSea';
import {
  CLUSTER,
  CLOUD_FORM,
  CLUSTER_SPRITES,
  cloudForm,
  clusterShapes,
  createClouds,
  createClusterLayout,
  layoutClusters,
  setCloudForm,
} from '../../src/engine/sky/Clouds';
import { createSkyUniforms } from '../../src/engine/sky/SkyUniforms';
import { createDayClock } from '../../src/engine/time/DayClock';

const cover = createCloudCover(42);
const wind = { x: 11, z: -4 };
const frame = (camera: { x: number; y: number; z: number }, t = 0) => ({
  bx: camera.x,
  bz: camera.z,
  t,
  camera,
  originX: 0,
  originZ: 0,
  wind,
});

describe('clusterShapes', () => {
  it('heaps each cluster into a dome on a flat base, the same for the same world', () => {
    const shapes = clusterShapes(42);
    expect(shapes).toHaveLength(CLUSTER.count);
    for (const c of shapes) {
      expect(c.sprites).toHaveLength(CLUSTER.sprites);
      for (const s of c.sprites) {
        expect(s.oy).toBeGreaterThanOrEqual(0);
        expect(s.oy).toBeLessThanOrEqual(1);
        // the higher a sprite, the nearer the axis: a heap, not a ball
        expect(Math.hypot(s.ox, s.oz)).toBeLessThanOrEqual(0.15 + 0.85 * Math.sqrt(1 - s.oy * s.oy) + 1e-9);
      }
    }
    expect(clusterShapes(42)).toEqual(shapes);
    expect(clusterShapes(43)).not.toEqual(shapes);
  });
});

describe('layoutClusters', () => {
  it('draws back to front, so the blending comes out in the order the eye sees it', () => {
    const shapes = clusterShapes(42);
    const out = createClusterLayout();
    const camera = { x: 0, y: 900, z: 0 };
    layoutClusters(shapes, cover, out, frame(camera, 30));
    expect(out.count).toBeGreaterThan(20);
    let last = Infinity;
    for (let i = 0; i < out.count; i++) {
      const d = Math.hypot(
        out.sprite[i * 4]! - camera.x,
        out.sprite[i * 4 + 1]! - camera.y,
        out.sprite[i * 4 + 2]! - camera.z,
      );
      expect(d).toBeLessThanOrEqual(last + 1e-3);
      last = d;
      expect(out.shape[i * 4 + 3]).toBeGreaterThan(0);
      expect(out.shape[i * 4 + 3]).toBeLessThanOrEqual(1);
    }
  });

  it('stands a cluster on the deck where it is, and only where the deck has a bank', () => {
    const shapes = clusterShapes(42);
    const out = createClusterLayout();
    // Far below every base, so nothing is buried and nothing is too near.
    layoutClusters(shapes, cover, out, frame({ x: 0, y: 0, z: 0 }));
    for (let i = 0; i < out.count; i++) {
      const x = out.sprite[i * 4]!,
        y = out.sprite[i * 4 + 1]!,
        z = out.sprite[i * 4 + 2]!;
      // a sprite is somewhere over its cluster's centre, whose base is within a
      // region's slope of the base under the sprite itself
      expect(y).toBeGreaterThan(cover.baseAt(x, z) - 60);
      expect(y).toBeLessThan(deckTop(DECK.base[1], 1) + CLUSTER.tower + 200);
      expect(cover.at(x, z)).toBeGreaterThanOrEqual(0);
    }
  });

  it('lets the buried sprites go when the camera is over the deck, and fades what it is about to fly into', () => {
    const shapes = clusterShapes(42);
    const under = createClusterLayout(),
      over = createClusterLayout();
    layoutClusters(shapes, cover, under, frame({ x: 0, y: 500, z: 0 }));
    layoutClusters(shapes, cover, over, frame({ x: 0, y: 1900, z: 0 }));
    expect(over.count).toBeLessThan(under.count / 2);
    for (let i = 0; i < under.count; i++) {
      const d = Math.hypot(under.sprite[i * 4]!, under.sprite[i * 4 + 1]! - 500, under.sprite[i * 4 + 2]!);
      expect(d).toBeGreaterThan(under.sprite[i * 4 + 3]! * 0.9);
      expect(d).toBeLessThan(CLUSTER.far[1]);
    }
  });
});

describe('createClouds', () => {
  it('binds six vertex buffers, under the eight a WebGPU pipeline allows', () => {
    const clouds = createClouds(42, createSkyUniforms(createDayClock().look, cover), cover);
    const g = clouds.mesh.geometry;
    // the quad's position, the sprite, its shape, its floor and its rag, and the instance matrix
    expect(Object.keys(g.attributes).sort()).toEqual(['floor', 'position', 'rag', 'shape', 'sprite']);
    expect(Object.keys(g.attributes).length + 1).toBeLessThanOrEqual(8);
    expect(clouds.mesh.count).toBe(0);
    expect(clouds.mesh.instanceMatrix.count).toBe(CLUSTER_SPRITES);
    clouds.dispose();
  });

  it('turns every sprite to the camera it is given', () => {
    const clouds = createClouds(42, createSkyUniforms(createDayClock().look, cover), cover);
    const camera = new Vector3(0, 900, 0);
    const world = new Matrix4();
    world.makeRotationY(0.7).setPosition(camera);
    clouds.update(0, 0, 30, camera, world, 0, 0, wind);
    expect(clouds.drawn).toBeGreaterThan(0);
    expect(clouds.mesh.count).toBe(clouds.drawn);
    clouds.dispose();
  });
});

describe('the cloud form', () => {
  it('starts inside its ranges and clamps whatever it is asked for into them', () => {
    const form = cloudForm();
    for (const [key, [min, max, start]] of Object.entries(CLOUD_FORM)) {
      expect(start).toBeGreaterThanOrEqual(min);
      expect(start).toBeLessThanOrEqual(max);
      expect(form[key as keyof typeof form]).toBe(start);
    }
    setCloudForm(form, { stretch: 99, rag: -1, puff: Number.NaN, height: 1.2 });
    expect(form.stretch).toBe(CLOUD_FORM.stretch[1]);
    expect(form.rag).toBe(CLOUD_FORM.rag[0]);
    expect(form.puff).toBe(CLOUD_FORM.puff[2]);
    expect(form.height).toBe(1.2);
  });

  it('draws a cluster out along the wind, keeping its footprint', () => {
    // One cluster, a solid bank everywhere, the camera right under it: all its
    // sprites are drawn, and their spread along the wind against across it says
    // whether it is round or long.
    const solid = { ...cover, at: () => 1, baseAt: () => 800 };
    const [one] = clusterShapes(42);
    const spread = (stretch: number) => {
      const out = createClusterLayout();
      const f = { ...frame({ x: one!.x, y: 0, z: one!.z }), wind: { x: 0, z: 12 } };
      layoutClusters([one!], solid, out, f, { ...cloudForm(), stretch });
      expect(out.count).toBe(CLUSTER.sprites);
      let mx = 0,
        mz = 0;
      for (let k = 0; k < out.count; k++) {
        mx += out.sprite[k * 4]! / out.count;
        mz += out.sprite[k * 4 + 2]! / out.count;
      }
      let along = 0,
        across = 0;
      for (let k = 0; k < out.count; k++) {
        along += (out.sprite[k * 4 + 2]! - mz) ** 2;
        across += (out.sprite[k * 4]! - mx) ** 2;
      }
      return { ratio: along / across, area: Math.sqrt(along * across) };
    };
    const round = spread(1),
      long = spread(3);
    // the wind blows along z, and a cluster turns off it by no more than a fifth of a right angle
    expect(long.ratio).toBeGreaterThan(round.ratio * 3);
    // longer along, narrower across: the footprint is the same size
    expect(Math.abs(long.area / round.area - 1)).toBeLessThan(0.02);
  });

  it('never stands a cluster much taller than it is wide, however deep the bank', () => {
    // A column taller than its footprint read as a tree: a trunk and a crown.
    const solid = { ...cover, at: () => 1, baseAt: () => 800 };
    for (const one of clusterShapes(42).slice(0, 12)) {
      const out = createClusterLayout();
      layoutClusters([one], solid, out, { ...frame({ x: one.x, y: 0, z: one.z }), wind: { x: 0, z: 12 } });
      let low = Infinity,
        high = -Infinity;
      for (let k = 0; k < out.count; k++) {
        low = Math.min(low, out.sprite[k * 4 + 1]! - out.sprite[k * 4 + 3]! * 0.12);
        high = Math.max(high, out.sprite[k * 4 + 1]! - out.sprite[k * 4 + 3]! * 0.12);
      }
      // its own build and its swell may take it over the ceiling, never past the
      // width of its footprint
      const form = cloudForm();
      expect(high - low).toBeLessThanOrEqual(
        one.radius * CLUSTER.tallest * (1 + form.spread) * (1 + form.breath) + 1e-6,
      );
      expect(high - low).toBeLessThan(one.radius * 2);
    }
  });

  it('gives every cluster its own build around the form, and the rag never under its floor', () => {
    const solid = { ...cover, at: () => 1, baseAt: () => 800 };
    const rags = (spread: number) => {
      const out = createClusterLayout();
      const found = new Set<number>();
      for (const one of clusterShapes(42).slice(0, 24)) {
        layoutClusters(
          [one],
          solid,
          out,
          { ...frame({ x: one.x, y: 0, z: one.z }), wind: { x: 0, z: 0 } },
          {
            ...cloudForm(),
            spread,
          },
        );
        for (let k = 0; k < out.count; k++) {
          expect(out.rag[k]).toBeGreaterThanOrEqual(CLOUD_FORM.rag[0] - 1e-6);
          expect(out.rag[k]).toBeLessThanOrEqual(CLOUD_FORM.rag[1] + 1e-6);
          found.add(Math.round(out.rag[k]! * 1e4));
        }
      }
      return found;
    };
    // with no spread every cluster wears the form's own rag; with it, each its own
    expect(rags(0).size).toBe(1);
    expect(rags(CLOUD_FORM.spread[1]).size).toBeGreaterThan(10);
  });

  it('breathes: a cluster swells and settles over time, and stands still with no breath', () => {
    // A thin bank, so the ceiling on how tall a cluster stands is not what holds it.
    const thin = { ...cover, at: () => 0.6, baseAt: () => 800 };
    const extent = (one: ReturnType<typeof clusterShapes>[number], t: number, breath: number) => {
      const out = createClusterLayout();
      const f = { ...frame({ x: one.x, y: 0, z: one.z }, t), wind: { x: 0, z: 0 } };
      layoutClusters([one], thin, out, f, { ...cloudForm(), breath });
      let high = -Infinity;
      for (let k = 0; k < out.count; k++) high = Math.max(high, out.sprite[k * 4 + 1]!);
      return high;
    };
    let moved = 0;
    for (const one of clusterShapes(42).slice(0, 12)) {
      const half = Math.PI / one.pace;
      expect(extent(one, 0, 0)).toBeCloseTo(extent(one, half, 0), 6);
      if (Math.abs(extent(one, 0, 0.2) - extent(one, half, 0.2)) > 5) moved++;
    }
    expect(moved).toBeGreaterThan(6);
  });

  it('knows when the camera is inside a cluster, and whitens only there', () => {
    // One cluster over a solid bank: in its middle the camera is inside, below
    // its flat base and far to its side it is not.
    const solid = { ...cover, at: () => 1, baseAt: () => 800 };
    const [one] = clusterShapes(42);
    const inside = (dx: number, y: number, dz = 0) => {
      const out = createClusterLayout();
      const f = {
        ...frame({ x: one!.x + dx, y, z: one!.z + dz }),
        bx: one!.x,
        bz: one!.z,
        wind: { x: 0, z: 12 },
      };
      return layoutClusters([one!], solid, out, f).inside;
    };
    // its own base is the region's plus its lift
    const mid = 800 + one!.lift + 60;
    expect(inside(0, mid)).toBeGreaterThan(0.8);
    expect(inside(0, 700)).toBe(0);
    expect(inside(3000, 900)).toBe(0);
    expect(inside(0, 2000)).toBe(0);
    // long with the wind (z here): further along it than across it is still inside
    const r = one!.radius;
    expect(inside(0, mid, r * 1.3)).toBeGreaterThan(inside(r * 1.3, mid, 0));
  });

  it('keeps a cloud drawn as the camera climbs into it, until the white takes over', () => {
    // Up through a cluster from under its base: at every step either its
    // sprites are there or the camera is inside it, never neither -- that
    // was blue sky where a cloud had just been.
    const solid = { ...cover, at: () => 1, baseAt: () => 800 };
    const [one] = clusterShapes(42);
    const f = (y: number) => ({ ...frame({ x: one!.x, y, z: one!.z }), wind: { x: 0, z: 12 } });
    for (let y = 700; y <= 1100; y += 10) {
      const out = createClusterLayout();
      layoutClusters([one!], solid, out, f(y));
      let opacity = 0;
      for (let k = 0; k < out.count; k++) opacity = Math.max(opacity, out.shape[k * 4 + 3]!);
      expect(Math.max(opacity, out.inside), `at ${y} m`).toBeGreaterThan(0.5);
    }
  });

  it("does not empty the sky at the sea's level: the sprites go only once the sea is seen from over it", () => {
    // At the sea's own level the sea is edge-on and draws nothing; the sprites
    // let go there left blue sky until the flyer dipped back under the line.
    const shapes = clusterShapes(42);
    const x = -3000,
      z = -3000,
      base = cover.baseAt(x, z),
      sea = base + DECK.sea - CLOUD_SEA_DROP;
    const drawn = (y: number) => {
      const out = createClusterLayout();
      return layoutClusters(shapes, cover, out, { ...frame({ x, y, z }), bx: x, bz: z }).count;
    };
    const under = drawn(base + 20);
    for (const y of [sea - 20, sea, sea + 20, sea + 50]) expect(drawn(y), `at sea ${y - sea}`).toBe(under);
    // and well over it the buried ones are let go, or they paint balls on the sea
    expect(drawn(sea + 250)).toBeLessThan(under);
  });

  it("gives every sprite its cluster's base, where the deck's base is, to cut it flat", () => {
    const out = createClusterLayout();
    layoutClusters(clusterShapes(42), cover, out, frame({ x: 0, y: 0, z: 0 }));
    expect(out.count).toBeGreaterThan(0);
    for (let i = 0; i < out.count; i++) {
      const floor = out.floor[i]!;
      expect(floor).toBeGreaterThanOrEqual(DECK.base[0]);
      expect(floor).toBeLessThanOrEqual(DECK.base[1]);
      // the sprite's centre stands over its floor, so the cut takes only its bottom
      expect(out.sprite[i * 4 + 1]!).toBeGreaterThan(floor);
    }
  });

  it('is changed on a running world through the clouds themselves', () => {
    const clouds = createClouds(42, createSkyUniforms(createDayClock().look, cover), cover);
    clouds.setForm({ stretch: 2.5, floor: 100 });
    expect(clouds.form.stretch).toBe(2.5);
    expect(clouds.form.floor).toBe(100);
    clouds.dispose();
  });
});
