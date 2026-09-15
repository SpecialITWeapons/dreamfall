// The world: one CPU heightfield, one horizon, one day, one wind; streamed
// terrain and water, the sky and its clouds, the display chain; the flight,
// the figure that flies it, the camera that watches, the sound of it all.
// Everything hangs off this object; the only module-level values are
// constants. Coordinates: the simulation lives in world space in double
// precision; the scene is in the local frame of a floating origin, and the
// figure and the camera get their poses converted through it.
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { createAmbience, type Ambience } from './audio/Ambience';
import type { FlightPose } from './avatar/Avatar';
import { outfitById, patternById } from './avatar/Outfits';
import { HUMAN_BOUNDS, createProceduralHuman, type ProceduralHuman } from './avatar/ProceduralHuman';
import { TPP, applyCameraPose, createChaseCamera, type ChaseCamera } from './flight/ChaseCamera';
import { MIN_CLEARANCE, SPEED } from './flight/FlightController';
import { createSteering, type Orbit, type Steering, type View } from './flight/Steering';
import { createPost, type Post } from './render/Post';
import { createLitMaterial, createSoftShadow } from './render/SoftLighting';
import { createObstacles, type Obstacles } from './scenery/Obstacles';
import { createOrigin, type Origin } from './sim/Origin';
import { createSimulation, type ResumeState, type Simulation } from './sim/Simulation';
import { createAtmosphere, type Atmosphere } from './sky/Atmosphere';
import { createCloudSea } from './sky/CloudSea';
import { createClouds } from './sky/Clouds';
import { createHorizon, installFog } from './sky/Fog';
import { createLights } from './sky/Lights';
import { createSkyDome } from './sky/SkyDome';
import { createSkyUniforms } from './sky/SkyUniforms';
import { windFromSeed, type Wind } from './sky/Wind';
import { createHeightfield, type Heightfield } from './terrain/Heightfield';
import { WATER_CELL, createTerrain, createTerrainPalette } from './terrain/TerrainMesh';
import { CELL, createWorldSampler } from './terrain/WorldSampler';
import type { DayClock } from './time/DayClock';
import { createWater } from './water/Water';

export interface WorldOptions {
  seed: number;
  aspect: number;
  renderer: WebGPURenderer;
  /** A remembered flight of this seed to continue. */
  resume?: ResumeState | null;
  view?: View;
  orbit?: Partial<Orbit>;
  outfit?: string;
  pattern?: string;
  volume?: number;
  muted?: boolean;
  reducedMotion?: boolean;
}

export interface World {
  readonly seed: number;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly sim: Simulation;
  readonly clock: DayClock;
  readonly steering: Steering;
  readonly chase: ChaseCamera;
  readonly avatar: ProceduralHuman;
  readonly audio: Ambience;
  readonly obstacles: Obstacles;
  readonly origin: Origin;
  readonly heightfield: Heightfield;
  readonly atmosphere: Atmosphere;
  readonly post: Post;
  readonly wind: Wind;
  /** Head bob and the like stay off while the viewer prefers reduced motion. */
  reducedMotion: boolean;
  update(dt: number): void;
  resize(aspect: number): void;
  heightAt(x: number, z: number): number;
  /** World to local, in place. */
  toLocal(v: Vector3): Vector3;
  /** Everything a later visit needs to continue this flight. */
  snapshot(): ResumeState;
  dispose(): void;
}

/** A 0x0 viewport at start-up (or any other degenerate size) yields a NaN aspect; hold 1 instead. */
const safeAspect = (aspect: number) => (Number.isFinite(aspect) && aspect > 0 ? aspect : 1);

export function createWorld(opts: WorldOptions): World {
  const scene = new Scene();
  const camera = new PerspectiveCamera(TPP.fov, safeAspect(opts.aspect), TPP.near, 14_000);
  const sampler = createWorldSampler(opts.seed);
  const heightfield = createHeightfield(sampler);
  const heightAt = (x: number, z: number) => heightfield.heightAt(x, z);
  const obstacles = createObstacles();
  const origin = createOrigin({ cell: CELL });
  const wind = windFromSeed(opts.seed);
  const resume = opts.resume ?? null;
  // The window fills around the start before the flight reads the ground (about 300 ms, behind the veil).
  heightfield.fillAll(Math.round((resume?.x ?? 0) / CELL), Math.round((resume?.z ?? 0) / CELL));
  const sim = createSimulation({
    seed: opts.seed,
    groundAt: heightAt,
    obstacles,
    below: HUMAN_BOUNDS.below,
    resume,
  });
  const { state } = sim;
  // a remembered flight never resumes inside the ground it may have been saved over
  state.y = Math.max(state.y, sim.flight.floorAt(state.x, state.z) + MIN_CLEARANCE + HUMAN_BOUNDS.below);
  const clock = sim.clock;
  const look = clock.look;
  const uniforms = createSkyUniforms(look);
  uniforms.uWind.value.set(wind.x, wind.z);
  const horizon = createHorizon(uniforms);
  // The dome covers the whole background; the clear color only matters for the frame before the dome compiles.
  scene.backgroundNode = uniforms.uHorizon;
  installFog(scene, uniforms, horizon);
  const lights = createLights(scene, look);
  const litMaterial = createLitMaterial(createSoftShadow(lights.shadowMatrix));
  const atmosphere = createAtmosphere({ clock, uniforms, lights });
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
  const avatar = createProceduralHuman(litMaterial, {
    outfit: outfitById(opts.outfit ?? 'dusk'),
    pattern: patternById(opts.pattern ?? 'plain'),
  });
  scene.add(avatar.object);
  const steering = createSteering(sim.flight, { view: opts.view, orbit: opts.orbit });
  const chase = createChaseCamera();
  const audio = createAmbience({ volume: opts.volume ?? 0.5, muted: opts.muted ?? false });
  const post = createPost(opts.renderer, scene, camera);
  let reducedMotion = opts.reducedMotion ?? false;

  const follow = new Vector3();
  const pose: FlightPose = {
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    bank: 0,
    pitch: 0,
    vy: 0,
    speed: sim.speed,
    windPhase: 0,
    gust: 0,
    view: steering.view,
  };
  const sample = { altitude: 0, vy: 0, gust: 0, rush: 1, t: 0, x: 0, z: 0 };
  const toLocal = (v: Vector3) => v.set(origin.localX(v.x), v.y, origin.localZ(v.z));
  const place = (dt: number) => {
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
    // the figure, in the local frame
    pose.x = origin.localX(state.x);
    pose.y = state.y;
    pose.z = origin.localZ(state.z);
    pose.heading = state.heading;
    pose.bank = state.bank;
    pose.pitch = state.pitch;
    pose.vy = state.vy;
    pose.speed = state.speed;
    pose.windPhase = state.windPhase;
    pose.gust = state.gust;
    pose.view = steering.view;
    avatar.update(pose, dt);
    // the camera: a world pose, written through the origin
    chase.update({
      state,
      view: steering.view,
      orbit: steering.orbit,
      look: steering.look,
      eye: avatar.eye,
      floorAt: sim.flight.floorAt,
      dt,
      reducedMotion,
    });
    applyCameraPose(camera, chase.pose, origin.localX, origin.localZ);
    uniforms.time.value = state.t;
    uniforms.uWorldOrigin.value.set(origin.x, origin.z);
    clouds.update(state.x, state.z, state.t, camera.position, origin.x, origin.z, wind);
    cloudSea.update(origin.localX(state.x), origin.localZ(state.z));
    skyDome.follow(camera.position);
    follow.set(origin.localX(state.x), state.y, origin.localZ(state.z));
    atmosphere.update(camera.position.y, follow);
    post.setExposure(atmosphere.exposure);
    cloudSea.mesh.visible = uniforms.uAbove.value > 0.001;
    clouds.mesh.visible = uniforms.uCloudBodies.value > 0.001;
    sample.altitude = state.y - Math.max(0, heightAt(state.x, state.z));
    sample.vy = state.vy;
    sample.gust = state.gust;
    sample.rush = state.speed / SPEED;
    sample.t = state.t;
    sample.x = state.x;
    sample.z = state.z;
    audio.update(dt, sample, heightAt);
  };
  place(0);
  return {
    seed: opts.seed,
    scene,
    camera,
    sim,
    clock,
    steering,
    chase,
    avatar,
    audio,
    obstacles,
    origin,
    heightfield,
    atmosphere,
    post,
    wind,
    get reducedMotion() {
      return reducedMotion;
    },
    set reducedMotion(value: boolean) {
      reducedMotion = value;
    },
    update(dt) {
      steering.update(dt);
      sim.step(dt);
      place(dt);
    },
    resize(aspect) {
      camera.aspect = safeAspect(aspect);
      camera.updateProjectionMatrix();
    },
    heightAt,
    toLocal,
    snapshot: () => sim.snapshot(),
    dispose() {
      post.dispose();
      terrain.dispose();
      water.dispose();
      skyDome.dispose();
      clouds.dispose();
      cloudSea.dispose();
      avatar.dispose();
      lights.dispose();
      scene.clear();
      void audio.dispose();
    },
  };
}
