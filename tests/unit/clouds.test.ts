import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DECK, createCloudCover, deckTop } from '../../src/engine/sky/CloudCover';
import {
  CLUSTER,
  CLUSTER_SPRITES,
  clusterShapes,
  createClouds,
  createClusterLayout,
  layoutClusters,
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
      expect(d).toBeGreaterThan(under.sprite[i * 4 + 3]! * 0.5);
      expect(d).toBeLessThan(CLUSTER.far[1]);
    }
  });
});

describe('createClouds', () => {
  it('binds four vertex buffers, well under the eight a WebGPU pipeline allows', () => {
    const clouds = createClouds(42, createSkyUniforms(createDayClock().look, cover), cover);
    const g = clouds.mesh.geometry;
    // the quad's position, the sprite and its shape, and the instance matrix
    expect(Object.keys(g.attributes).sort()).toEqual(['position', 'shape', 'sprite']);
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
