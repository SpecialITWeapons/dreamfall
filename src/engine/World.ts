// The world: one CPU heightfield, one horizon, one day, one wind; streamed
// terrain and water, the sky and its clouds, the display chain; the flight,
// the figure that flies it, the camera that watches, the sound of it all.
// Everything hangs off this object; the only module-level values are
// constants. Coordinates: the simulation lives in world space in double
// precision; the scene is in the local frame of a floating origin, and the
// figure and the camera get their poses converted through it.
import { Color, PerspectiveCamera, Scene, Vector3 } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { swatchColor, validateLibrary, type Library } from '../../library/contract';
import { createLibrary } from '../../library/index.js';
import { createAmbience, type Ambience } from './audio/Ambience';
import { emptyMix, layerMix } from './audio/AmbienceModel';
import { OPENING, createOpening, type OpeningFrame } from './sim/Opening';
import { hazeAt } from './sky/Haze';
import { HUMAN_BOUNDS, type Avatar, type FlightPose } from './avatar/Avatar';
import { TPP, applyCameraPose, createChaseCamera, type ChaseCamera } from './flight/ChaseCamera';
import { MAX_STEP, MIN_CLEARANCE, SPEED } from './flight/FlightController';
import { createSteering, type Orbit, type Steering, type View } from './flight/Steering';
import { createLayers, type Hideable, type Layers } from './render/Layers';
import { createPost, type Post } from './render/Post';
import { createLitMaterial, createSoftShadow } from './render/SoftLighting';
import { createGroundShade } from './scenery/GroundShade';
import { createObstacles, type Obstacles } from './scenery/Obstacles';
import { createScenery, type Scenery } from './scenery/Scenery';
import { createOrigin, type Origin } from './sim/Origin';
import { createSimulation, type ResumeState, type Simulation } from './sim/Simulation';
import { createAtmosphere, type Atmosphere } from './sky/Atmosphere';
import { createCloudSea } from './sky/CloudSea';
import { createClouds } from './sky/Clouds';
import { createHorizon, installFog } from './sky/Fog';
import { createLights } from './sky/Lights';
import { createMilkyWay } from './sky/MilkyWay';
import { createSkyDome } from './sky/SkyDome';
import { createSkyUniforms } from './sky/SkyUniforms';
import { windFromSeed, type Wind } from './sky/Wind';
import { createHeightfield, type Heightfield } from './terrain/Heightfield';
import { measureHeightHooks, type HookCosts } from './terrain/HookCost';
import { WATER_CELL, createTerrain, createTerrainPalette } from './terrain/TerrainMesh';
import { CELL, createWorldSampler } from './terrain/WorldSampler';
import { solar, type DayClock } from './time/DayClock';
import { createWater } from './water/Water';

export interface WorldOptions {
  seed: number;
  aspect: number;
  renderer: WebGPURenderer;
  /** The registry; the built-in one by default. It is validated before anything is built. */
  library?: Library;
  /** A remembered flight of this seed to continue. */
  resume?: ResumeState | null;
  /**
   * Leave the scenery unbaked until plant() is called. The page does this so
   * that baking -- most of a second of species, props and painted textures --
   * gets its own line on the veil instead of hiding inside the ground's.
   */
  deferScenery?: boolean;
  view?: View;
  orbit?: Partial<Orbit>;
  volume?: number;
  muted?: boolean;
  reducedMotion?: boolean;
  /**
   * The figure to fly. It is a file, and it has to be fetched before the world
   * is built; what the page fetches is the page's business.
   */
  avatar: Avatar;
}

export interface World {
  readonly seed: number;
  readonly library: Library;
  /**
   * The fog, the background and the dome's horizon, which are one colour here.
   * Exposed so a test can read what the shader reads: the biome's haze goes on
   * this after the atmosphere has written the palette into it.
   */
  readonly horizon: { r: number; g: number; b: number };
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly sim: Simulation;
  readonly clock: DayClock;
  readonly steering: Steering;
  readonly chase: ChaseCamera;
  readonly avatar: Avatar;
  readonly audio: Ambience;
  readonly obstacles: Obstacles;
  readonly scenery: Scenery | null;
  readonly origin: Origin;
  readonly heightfield: Heightfield;
  readonly atmosphere: Atmosphere;
  readonly post: Post;
  /**
   * What the scene is allowed to draw, by layer. The dev panel's switches, and
   * the only honest way to ask what a layer is costing: turn it off and read
   * the frame again.
   */
  readonly layers: Layers;
  readonly wind: Wind;
  /** Whether the Milky Way's atlas has arrived off the worker, and what it cost. */
  readonly galaxy: { baked: boolean; bakeMs: number };
  /** Head bob and the like stay off while the viewer prefers reduced motion. */
  reducedMotion: boolean;
  /** Bakes and plants the scenery; idempotent, and already done unless deferScenery was set. */
  plant(): void;
  /**
   * What the registry's presence and height hooks cost a texel of the window,
   * measured over the ground under the flyer against a sampler with no
   * registry at all. The budget is soft and the answer is a measurement, which
   * is the only kind there is for a function somebody wrote.
   */
  measureHeightHooks(samples?: number): HookCosts;
  update(dt: number): void;
  /**
   * What the opening is asking for this frame, so the page can put its title
   * card at the opacity the script wants. `done` once the flight is the
   * autopilot's again.
   */
  readonly opening: Readonly<OpeningFrame>;
  /** Any input at all ends the opening; the flight and the camera come back at once. */
  skipOpening(): void;
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
  // The library is checked before the world is built, and a bad entry stops the
  // page rather than painting something wrong: the failure hook in index.html
  // shows what the console already says, by entry name.
  const library = opts.library ?? createLibrary();
  const problems = validateLibrary(library);
  if (problems.length > 0) throw new Error(`library:\n${problems.join('\n')}`);
  const scene = new Scene();
  const camera = new PerspectiveCamera(TPP.fov, safeAspect(opts.aspect), TPP.near, 14_000);
  const sampler = createWorldSampler(opts.seed, { biomes: library.biomes });
  const heightfield = createHeightfield(sampler);
  const heightAt = (x: number, z: number) => heightfield.heightAt(x, z);
  const obstacles = createObstacles();
  const origin = createOrigin({ cell: CELL });
  const wind = windFromSeed(opts.seed);
  const resume = opts.resume ?? null;
  // The window fills around the start before the flight reads the ground (about 300 ms, behind the veil).
  heightfield.fillAll(Math.round((resume?.x ?? 0) / CELL), Math.round((resume?.z ?? 0) / CELL));
  // Before the simulation, because the flight asks for the core's bearing on its
  // first step. The dust and that bearing are 93 ms here; the light atlas is
  // forty times dearer and is baked off the main thread, so the start pays
  // nothing for a sky nobody can see until nightfall.
  const galaxy = createMilkyWay();
  // The opening plays for a first flight and never for a continued one: a
  // remembered flight is somebody coming back, and thirty seconds of titles is
  // not what they came back for. A page that asked for less motion skips it too.
  const opening = createOpening(!resume && !(opts.reducedMotion ?? false));
  const sim = createSimulation({
    seed: opts.seed,
    groundAt: heightAt,
    obstacles,
    below: HUMAN_BOUNDS.below,
    resume,
    // High enough that the climb has a deck to go through. Nothing else about
    // the start moves: the flight's own clearance still owns the first frame.
    startY: opening.live ? OPENING.startY : undefined,
  });
  const { state } = sim;
  // a remembered flight never resumes inside the ground it may have been saved over
  state.y = Math.max(state.y, sim.flight.floorAt(state.x, state.z) + MIN_CLEARANCE + HUMAN_BOUNDS.below);
  const clock = sim.clock;
  // The sun a little under the rim, so the first act has something to rise.
  if (opening.live) {
    clock.phase = OPENING.dawn;
    clock.evalPalette();
  }
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
  // The shade under the trees is built before the terrain, because the ground
  // material takes its node at composition and cannot be handed one later.
  const shade = createGroundShade();
  const terrain = createTerrain({
    heightfield,
    uniforms,
    litMaterial,
    palette,
    biomes: library.biomes,
    shade,
  });
  scene.add(terrain.mesh);
  const water = createWater({ uniforms, horizon, litMaterial, palette, loadCell: terrain.loadCell });
  scene.add(water.mesh);
  const skyDome = createSkyDome(uniforms, horizon, { galaxy: (dir) => galaxy.radiance(dir) });
  scene.add(skyDome.mesh);
  const clouds = createClouds(opts.seed, uniforms);
  scene.add(clouds.mesh);
  const cloudSea = createCloudSea(uniforms, horizon);
  scene.add(cloudSea.mesh);
  // The figure is the one thing the world takes ready-made: it is a file, and
  // fetching is the page's business, not the world's. `Avatar` is the whole of
  // what the flight and the camera ask of it.
  const avatar = opts.avatar;
  scene.add(avatar.object);
  // The layer switches. The scenery's arrays are filled when it is planted --
  // which is after this, when the page defers the bake for its own veil -- and
  // they are the same arrays either way, so the switches are made once. Their
  // order here is the order the dev panel lists them in.
  const sceneryGroups: Record<string, Hideable[]> = {
    grass: [],
    trees: [],
    props: [],
    buildings: [],
    roads: [],
  };
  const layers = createLayers({
    terrain: [terrain.mesh],
    water: [water.mesh],
    ...sceneryGroups,
    clouds: [clouds.mesh],
    deck: [cloudSea.mesh],
    sky: [skyDome.mesh],
    figure: [avatar.object],
  });
  const steering = createSteering(sim.flight, { view: opts.view, orbit: opts.orbit });
  /**
   * The script's own camera, kept apart from the person's: the chase camera is
   * handed this one while the opening runs and the steering's orbit is never
   * written, so nothing that reads the steering -- the settings a wheel or a
   * focused control saves -- can mistake the script's framing for a choice.
   * The first draft wrote the script into `steering.orbit` and restored it at
   * the end, and one scroll in the first half minute saved the beam as the
   * person's camera for every world after.
   */
  const scriptOrbit: Orbit = { yaw: Math.PI / 2, pitch: 0.14, dist: 11 };
  /** Everything the opening was holding, handed back in one place. */
  const endOpening = () => {
    clock.rate = 1;
    steering.setAutopilot(true);
  };
  /** What the script last asked of the stick, so `fly` is called on a change and not a frame. */
  const asked = { yaw: 0, climb: 0 };
  // The flight holds its course and its height while the script is level: with
  // the autopilot on it would wander off on its own errands mid-shot, and
  // `fly(0, 0)` is not enough to take it away, by design -- an arrow key that
  // asks for nothing should not take the flight from anyone.
  if (opening.live) steering.setAutopilot(false);

  const chase = createChaseCamera();
  const audio = createAmbience({ volume: opts.volume ?? 0.5, muted: opts.muted ?? false });
  const post = createPost(opts.renderer, scene, camera);
  let reducedMotion = opts.reducedMotion ?? false;
  let scenery: Scenery | null = null;
  const plant = () => {
    if (scenery) return;
    scenery = createScenery({
      seed: opts.seed,
      library,
      sampler,
      heightfield,
      obstacles,
      origin,
      scene,
      shade,
      litMaterial,
      uniforms,
    });
    for (const [name, objects] of Object.entries(scenery.groups)) sceneryGroups[name]?.push(...objects);
  };

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
  // What the country under the flyer sounds like. The slots are the height
  // window's own -- the same three the ground shader paints with -- so the
  // sound and the picture never disagree about which biome this is.
  const slotIds = new Uint8Array(3),
    slotWeights = new Float32Array(3);
  const ambienceSpecs = library.biomes.map((biome) =>
    biome.ambience ? { layers: biome.ambience.layers, inherit: biome.ambience.inherit } : undefined,
  );
  const mix = emptyMix();
  const mixInput = { ids: slotIds, weights: slotWeights, specs: ambienceSpecs, solar: 0, altitude: 0 };
  // The haze a country puts in its own air, resolved once: a swatch name is a
  // colour the library knows and the sky does not. An entry that inherits the
  // country's air is kept even with no tint of its own, because the slot it
  // holds has to hand its weight on.
  const hazeSpecs = library.biomes.map((biome) =>
    biome.ambience === undefined || (biome.ambience.fogTint === undefined && !biome.ambience.inherit)
      ? undefined
      : {
          color: new Color(biome.ambience.fogTint === undefined ? 0 : swatchColor(biome.ambience.fogTint)),
          amount: biome.ambience.fogTint === undefined ? 0 : (biome.ambience.fogTintAmount ?? 0.2),
          inherit: biome.ambience.inherit,
        },
  );
  const haze = new Color();
  const toLocal = (v: Vector3) => v.set(origin.localX(v.x), v.y, origin.localZ(v.z));
  const place = (dt: number) => {
    // An origin jump moves the whole scene under the scenery, whose instances
    // were written against the origin that has just gone; both the ring and the
    // grass rebuild on it.
    const moved = origin.shiftFor(state.x, state.z);
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
      orbit: opening.live ? scriptOrbit : steering.orbit,
      look: steering.look,
      eye: avatar.eye,
      floorAt: sim.flight.floorAt,
      dt,
      reducedMotion,
    });
    applyCameraPose(camera, chase.pose, origin.localX, origin.localZ);
    scenery?.update(state.x, state.z, camera.position.y, moved);
    uniforms.time.value = state.t;
    uniforms.uWorldOrigin.value.set(origin.x, origin.z);
    clouds.update(state.x, state.z, state.t, camera.position, origin.x, origin.z, wind);
    cloudSea.update(origin.localX(state.x), origin.localZ(state.z));
    skyDome.follow(camera.position);
    follow.set(origin.localX(state.x), state.y, origin.localZ(state.z));
    atmosphere.update(camera.position.y, follow);
    // The biome's own air, over the palette's. It goes on after the atmosphere
    // because the atmosphere copies the palette every frame, so this is a tint
    // and never an accumulation -- and it goes on `uHorizon`, which in this
    // engine is the fog, the background and the dome's horizon at once.
    heightfield.weightsAt(state.x, state.z, slotIds, slotWeights);
    // One height over the ground for the haze and the sound alike -- over the
    // sea it is the height over the water, because that is what the air and
    // the ear are over. Read once: it is a triangle interpolation of the window.
    sample.altitude = state.y - Math.max(0, heightAt(state.x, state.z));
    const hazed = hazeAt(slotIds, slotWeights, hazeSpecs, sample.altitude, 1 - uniforms.uNight.value, haze);
    if (hazed > 0) {
      uniforms.uHorizon.value.lerp(haze, hazed);
      uniforms.uHorizonWarm.value.lerp(haze, hazed * 0.6);
    }
    post.setExposure(atmosphere.exposure);
    cloudSea.mesh.visible = uniforms.uAbove.value > 0.001;
    clouds.mesh.visible = uniforms.uCloudBodies.value > 0.001;
    sample.vy = state.vy;
    sample.gust = state.gust;
    sample.rush = state.speed / SPEED;
    sample.t = state.t;
    sample.x = state.x;
    sample.z = state.z;
    mixInput.solar = solar(clock.phase);
    mixInput.altitude = sample.altitude;
    audio.update(dt, sample, heightAt, layerMix(mixInput, mix));
    // Last, after everything that decides visibility for its own reasons: a
    // switch may only take away.
    layers.apply();
  };
  if (!opts.deferScenery) plant();
  place(0);
  return {
    seed: opts.seed,
    library,
    get horizon() {
      const c = uniforms.uHorizon.value;
      return { r: c.r, g: c.g, b: c.b };
    },
    scene,
    camera,
    sim,
    clock,
    steering,
    chase,
    avatar,
    audio,
    obstacles,
    get scenery() {
      return scenery;
    },
    origin,
    heightfield,
    atmosphere,
    post,
    wind,
    get galaxy() {
      return { baked: galaxy.baked, bakeMs: galaxy.bakeMs };
    },
    get reducedMotion() {
      return reducedMotion;
    },
    set reducedMotion(value: boolean) {
      reducedMotion = value;
    },
    plant() {
      plant();
      place(0);
    },
    /** A key, a click, a finger: the script lets go of everything at once. */
    skipOpening() {
      if (!opening.live) return;
      opening.skip();
      endOpening();
    },
    get opening() {
      return opening.frame;
    },
    update(dt) {
      // The first frame of actual flight is where the galaxy's bake belongs:
      // the veil is up, the terrain is filled and the shaders are compiled, so
      // the core it burns for a few seconds is a core nothing else wants.
      galaxy.begin();
      // The opening drives the flight with the verbs a pilot has and owns the
      // camera and the pace of the day outright. It runs before the steering,
      // so a hand on the stick is the thing that ends it rather than the thing
      // that fights it.
      if (opening.live) {
        // Stepped by what the flight will accept: a step the flight refuses
        // (`MAX_STEP`) must not move the script either, or the two drift apart.
        const script = opening.step(Number.isFinite(dt) && dt <= MAX_STEP ? dt : 0);
        // `fly` is an arrow key: pressed on a change, not held down every frame.
        // Called every frame, `fly(0, 0)` re-reads the held height off the
        // present one and the hold act coasts instead of holding.
        if (script.yaw !== asked.yaw || script.climb !== asked.climb) {
          asked.yaw = script.yaw;
          asked.climb = script.climb;
          sim.flight.fly(script.yaw, script.climb);
        }
        scriptOrbit.yaw = script.cameraYaw;
        scriptOrbit.pitch = script.cameraPitch;
        scriptOrbit.dist = script.cameraDist;
        clock.rate = script.dayRate;
        if (!opening.live) endOpening();
      }
      steering.update(dt);
      sim.step(dt);
      place(dt);
    },
    layers,
    measureHeightHooks: (samples) =>
      measureHeightHooks({
        seed: opts.seed,
        biomes: library.biomes,
        x: state.x,
        z: state.z,
        samples,
      }),
    resize(aspect) {
      camera.aspect = safeAspect(aspect);
      camera.updateProjectionMatrix();
    },
    heightAt,
    toLocal,
    snapshot: () => sim.snapshot(),
    dispose() {
      post.dispose();
      scenery?.dispose();
      shade.dispose();
      terrain.dispose();
      water.dispose();
      skyDome.dispose();
      galaxy.dispose();
      clouds.dispose();
      cloudSea.dispose();
      avatar.dispose();
      lights.dispose();
      scene.clear();
      void audio.dispose();
    },
  };
}
