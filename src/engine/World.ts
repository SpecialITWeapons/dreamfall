// The world: one CPU heightfield, one horizon, one day, streamed terrain and
// water, the sky and its clouds, the display chain, and a straight flight
// over it all. Everything hangs off this object; the only module-level
// values are constants. Coordinates: the simulation lives in world space in
// double precision; the scene is in the local frame of a floating origin.
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { createPost, type Post } from './render/Post';
import { createLitMaterial, createSoftShadow } from './render/SoftLighting';
import { createOrigin, type Origin } from './sim/Origin';
import { createSimulation, type Simulation } from './sim/Simulation';
import { cameraPoseFor } from './sim/cameraPose';
import { createAtmosphere, type Atmosphere } from './sky/Atmosphere';
import { createCloudSea } from './sky/CloudSea';
import { createClouds } from './sky/Clouds';
import { createHorizon, installFog } from './sky/Fog';
import { createLights } from './sky/Lights';
import { createSkyDome } from './sky/SkyDome';
import { createSkyUniforms } from './sky/SkyUniforms';
import { createHeightfield, type Heightfield } from './terrain/Heightfield';
import { WATER_CELL, createTerrain, createTerrainPalette } from './terrain/TerrainMesh';
import { CELL, createWorldSampler } from './terrain/WorldSampler';
import { createDayClock, type DayClock } from './time/DayClock';
import { createWater } from './water/Water';

export interface World {
  readonly seed: number;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly sim: Simulation;
  readonly clock: DayClock;
  readonly origin: Origin;
  readonly heightfield: Heightfield;
  readonly atmosphere: Atmosphere;
  readonly post: Post;
  update(dt: number): void;
  resize(aspect: number): void;
  heightAt(x: number, z: number): number;
  /** World to local, in place. */
  toLocal(v: Vector3): Vector3;
  dispose(): void;
}

/** A 0x0 viewport at start-up (or any other degenerate size) yields a NaN aspect; hold 1 instead. */
const safeAspect = (aspect: number) => (Number.isFinite(aspect) && aspect > 0 ? aspect : 1);

export function createWorld(opts: { seed: number; aspect: number; renderer: WebGPURenderer }): World {
  const scene = new Scene();
  const camera = new PerspectiveCamera(55, safeAspect(opts.aspect), 0.5, 14_000);
  const clock = createDayClock({ phase: 0.3 });
  const look = clock.look;
  const uniforms = createSkyUniforms(look);
  const horizon = createHorizon(uniforms);
  // The dome covers the whole background; the clear color only matters for the frame before the dome compiles.
  scene.backgroundNode = uniforms.uHorizon;
  installFog(scene, uniforms, horizon);
  const lights = createLights(scene, look);
  const litMaterial = createLitMaterial(createSoftShadow(lights.shadowMatrix));
  const atmosphere = createAtmosphere({ clock, uniforms, lights });

  const sampler = createWorldSampler(opts.seed);
  const heightfield = createHeightfield(sampler);
  const origin = createOrigin({ cell: CELL });
  const palette = createTerrainPalette(look);
  const terrain = createTerrain({ heightfield, uniforms, litMaterial, palette });
  scene.add(terrain.mesh);
  const water = createWater({ uniforms, horizon, litMaterial, palette, loadCell: terrain.loadCell });
  scene.add(water.mesh);
  const skyDome = createSkyDome(uniforms, horizon);
  scene.add(skyDome.mesh);
  const clouds = createClouds(opts.seed, uniforms);
  scene.add(clouds.mesh);
  const cloudSea = createCloudSea(uniforms, horizon);
  scene.add(cloudSea.mesh);

  const heightAt = (x: number, z: number) => heightfield.heightAt(x, z);
  const sim = createSimulation({ seed: opts.seed, groundAt: heightAt });
  heightfield.fillAll(Math.round(sim.state.x / CELL), Math.round(sim.state.z / CELL));
  sim.state.y = Math.max(sim.state.y, heightAt(sim.state.x, sim.state.z) + 120);
  const post = createPost(opts.renderer, scene, camera);

  const follow = new Vector3();
  const toLocal = (v: Vector3) => v.set(origin.localX(v.x), v.y, origin.localZ(v.z));
  const place = (dt: number) => {
    const { state } = sim;
    origin.shiftFor(state.x, state.z);
    heightfield.update(state.x, state.z);
    terrain.upload();
    const ax = Math.round(state.x / CELL) * CELL,
      az = Math.round(state.z / CELL) * CELL;
    terrain.update(ax, az, origin.x, origin.z);
    water.update(
      Math.round(state.x / WATER_CELL) * WATER_CELL,
      Math.round(state.z / WATER_CELL) * WATER_CELL,
      origin.x,
      origin.z,
    );
    const pose = cameraPoseFor(state);
    camera.position.set(origin.localX(pose.x), pose.y, origin.localZ(pose.z));
    camera.lookAt(origin.localX(pose.lookX), pose.lookY, origin.localZ(pose.lookZ));
    uniforms.time.value = state.t;
    uniforms.uWorldOrigin.value.set(origin.x, origin.z);
    clouds.update(state.x, state.z, state.t, camera.position, origin.x, origin.z);
    cloudSea.update(origin.localX(state.x), origin.localZ(state.z));
    skyDome.follow(camera.position);
    follow.set(origin.localX(state.x), state.y, origin.localZ(state.z));
    atmosphere.update(dt, camera.position.y, follow);
    post.setExposure(atmosphere.exposure);
    cloudSea.mesh.visible = uniforms.uAbove.value > 0.001;
    clouds.mesh.visible = uniforms.uCloudBodies.value > 0.001;
  };
  place(0);
  return {
    seed: opts.seed,
    scene,
    camera,
    sim,
    clock,
    origin,
    heightfield,
    atmosphere,
    post,
    update(dt) {
      sim.step(dt);
      place(dt);
    },
    resize(aspect) {
      camera.aspect = safeAspect(aspect);
      camera.updateProjectionMatrix();
    },
    heightAt,
    toLocal,
    dispose() {
      post.dispose();
      terrain.dispose();
      water.dispose();
      skyDome.dispose();
      clouds.dispose();
      cloudSea.dispose();
      lights.dispose();
      scene.clear();
    },
  };
}
