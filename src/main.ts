// Start: address parameters, memory, page, engine, world, input, loop,
// lifecycle. A thin file: every decision has its own module; this just
// wires them together.
import { createEngine } from './engine/Engine';
import type { View } from './engine/flight/Steering';
import { createLoop } from './engine/Loop';
import { createWorld } from './engine/World';
import { installDebug, type DisposeReport } from './page/Debug';
import { createGate } from './page/Gate';
import { createHud } from './page/Hud';
import { browserStorage, createMemory, rememberedSeed, validateResume } from './page/Memory';
import { addressWithSeed, resolveParams, shareAddress } from './page/Params';
import { createVeil } from './page/Veil';

const memory = createMemory(browserStorage());
const settings = memory.readSettings();
const storedFlight = memory.readResume();
const params = resolveParams(location.search, Math.random, rememberedSeed(storedFlight));
history.replaceState(null, '', addressWithSeed(location.href, params.seed));
const resume = validateResume(storedFlight, params.seed);
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');

const veil = createVeil(document);
// What the start spends its time on, in milliseconds from the module's first
// line. The veil covers all of it, so nobody watches a blank page -- but how
// long each step takes is worth knowing, and guessing at it from the outside is
// how people end up optimising the wrong one. `?profile=1` prints them.
const started = performance.now();
const timings: Record<string, number> = {};
const mark = (step: string) => (timings[step] = Math.round(performance.now() - started));
const gate = createGate(document);
const hud = createHud(document);
hud.setShare(shareAddress(location.href, params.seed));

const canvas = document.getElementById('c') as HTMLCanvasElement;
await veil.stage('graphics');
const engine = await createEngine(canvas, { forceWebGL: params.forceWebGL, profiling: params.profiling });
mark('graphics');
hud.setBackend(engine.backend);
engine.resize(innerWidth, innerHeight, devicePixelRatio);

await veil.stage('ground');
// the window of ground fills here, and the materials are assembled: half a
// second of blocking work, which is why the line above waits for a paint
const world = createWorld({
  seed: params.seed,
  aspect: innerWidth / innerHeight,
  renderer: engine.renderer,
  resume,
  view: settings.view,
  orbit: settings.camera,
  outfit: settings.outfit,
  pattern: settings.pattern,
  volume: settings.volume,
  muted: settings.muted,
  reducedMotion: motionPreference.matches,
  deferScenery: true,
});
mark('ground');
// The species, the props and their painted textures: most of a second of
// baking, and the first thing anyone would blame the ground for.
await veil.stage('scenery');
world.plant();
mark('scenery');
// Said before the loop starts, because the frame it explains is the one that
// compiles every shader in the scene, and nothing paints while it does.
await veil.stage('sky');
engine.attachPost(world.post);
const { steering, audio } = world;
hud.setView(steering.view);
hud.setVolume(audio.volume);
hud.setMuted(audio.muted, audio.available);

let lastSave = -Infinity;
const loop = createLoop({
  setLoop: (fn) => engine.setLoop(fn),
  update: (dt) => {
    world.update(dt);
    // a couple of times a minute while flying; never before Begin, when nothing has changed
    if (performance.now() - lastSave > 2000) saveFlight();
  },
  render: () => engine.render(world.scene, world.camera),
});

let ready = false;
let disposed = false;
// The veil lifts only once the first frame is really on screen.
loop.onFirstFrame(async () => {
  await engine.waitForGpu();
  if (disposed) return;
  mark('sky'); // the first frame, and with it every shader the scene compiles
  ready = true;
  veil.lift();
  gate.enable();
  if (params.profiling) console.info('dreamfall start, ms:', { ...timings }, '· frame cost: __world.gpuMs');
});

const saveSettings = () =>
  memory.writeSettings({
    volume: audio.volume,
    muted: audio.muted,
    camera: { yaw: steering.orbit.yaw, pitch: steering.orbit.pitch, dist: steering.orbit.dist },
    view: steering.view,
    outfit: world.avatar.outfit.id,
    pattern: world.avatar.pattern.id,
  });
function saveFlight() {
  if (!loop.running || disposed) return;
  lastSave = performance.now();
  memory.writeResume(world.snapshot());
}

const begin = () => {
  if (!ready || disposed || loop.running) return;
  loop.begin();
  // sound starts on the first gesture, and never before
  audio.start();
  hud.setMuted(audio.muted, audio.available);
  hud.enable();
  // the preference for reduced motion starts the flight paused, with the audio
  // context suspended right along with it -- same as pausing by hand does
  if (motionPreference.matches) {
    loop.setPaused(true);
    audio.suspend(true);
  }
  hud.setPaused(loop.paused);
  hud.setAutopilot(steering.autopilot);
  canvas.removeAttribute('inert');
  canvas.focus({ preventScroll: true });
};
gate.onBegin(begin);

const togglePause = () => {
  if (!loop.running || disposed) return;
  // whatever was held is not held through a pause
  steering.releaseKeys();
  loop.togglePause();
  hud.setPaused(loop.paused);
  audio.suspend(loop.paused);
  saveFlight();
};
hud.onPause(togglePause);
hud.onMute(() => {
  hud.setMuted(audio.toggleMute(), audio.available);
  saveSettings();
});
hud.onVolume((v) => {
  audio.setVolume(v);
  hud.setMuted(audio.muted, audio.available);
  saveSettings();
});
const setView = (view: View) => {
  steering.view = view;
  hud.setView(steering.view);
  saveSettings();
  if (loop.running) loop.renderOnce();
};
hud.onView(() => setView(steering.view === 'tpp' ? 'fpp' : 'tpp'));
const showAutopilot = () => hud.setAutopilot(steering.autopilot);
hud.onAutopilot(() => {
  steering.setAutopilot(true);
  showAutopilot();
});

// Pointer input follows the steering's conventions; the canvas captures the pointer so a drag may leave it.
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// The pointer/button pair actually driving the current drag (-1 when none), so an
// overlapping button's -- or finger's -- own release can't end someone else's drag.
let activePointerId = -1;
let activeButton = -1;
canvas.addEventListener('pointerdown', (e) => {
  if (!loop.running || disposed) return;
  // a drag already owns the stick: a second button going down (e.g. the left
  // button while the right one steers) must not steal dragButton out from under
  // it, or the drag it interrupted never gets its matching pointerUp -- and with
  // it, `flight.setSteering(false)` never fires, so the flight controller holds
  // the stick forever (bug found in review of Task 4's Steering.pointerDown).
  if (steering.dragging) return;
  if (!steering.pointerDown(e.button, e.clientX, e.clientY, e.pointerType === 'touch')) return;
  activePointerId = e.pointerId;
  activeButton = e.button;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // synthetic pointers have nothing to capture
  }
});
canvas.addEventListener('pointermove', (e) => steering.pointerMove(e.clientX, e.clientY));
const endDrag = () => {
  activePointerId = -1;
  activeButton = -1;
  if (steering.pointerUp()) saveSettings();
};
canvas.addEventListener('pointerup', (e) => {
  // the overlapping button ignored above fires its own pointerup too, once released;
  // only the pointer/button that is actually driving the drag may end it
  if (e.pointerId !== activePointerId || e.button !== activeButton) return;
  endDrag();
});
for (const type of ['pointercancel', 'lostpointercapture'] as const) canvas.addEventListener(type, endDrag);
addEventListener('blur', () => {
  endDrag();
  // a key held while the window goes away never sends its keyup
  steering.releaseKeys();
});
canvas.addEventListener(
  'wheel',
  (e) => {
    if (!loop.running) return;
    e.preventDefault();
    steering.wheel(e.deltaY);
    saveSettings();
  },
  { passive: false },
);
addEventListener('keydown', (e) => {
  if (
    e.target instanceof HTMLButtonElement ||
    e.target instanceof HTMLAnchorElement ||
    e.target instanceof HTMLInputElement
  )
    return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePause();
    return;
  }
  if (!loop.running) return;
  if (e.key.startsWith('Arrow')) e.preventDefault();
  if (loop.paused) return;
  const action = steering.key(e.code);
  if (action === 'view') {
    hud.setView(steering.view);
    saveSettings();
  } else if (action === 'fly') showAutopilot();
});
addEventListener('keyup', (e) => {
  if (e.key.startsWith('Arrow')) e.preventDefault();
  steering.keyUp(e.code);
});
motionPreference.addEventListener('change', (e) => {
  world.reducedMotion = e.matches;
  if (e.matches && loop.running && !loop.paused) togglePause();
});

addEventListener('resize', () => {
  if (disposed) return;
  engine.resize(innerWidth, innerHeight, devicePixelRatio);
  world.resize(innerWidth / innerHeight);
  loop.renderOnce();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) steering.releaseKeys();
  loop.suspend(document.hidden);
  audio.suspend(document.hidden || loop.paused);
  if (document.hidden) saveFlight();
});

// Idempotent: the first call computes the report and every later call returns the same one.
let disposeReport: DisposeReport | undefined;
async function dispose(): Promise<DisposeReport> {
  if (!disposeReport) {
    saveFlight();
    disposed = true;
    const before = engine.memory();
    loop.stop();
    world.dispose();
    const afterWorld = engine.memory();
    engine.dispose();
    disposeReport = { before, afterWorld };
  }
  return disposeReport;
}
addEventListener('pagehide', (e) => {
  if (e.persisted) {
    loop.suspend(true);
    saveFlight();
  } else void dispose();
});
addEventListener('pageshow', (e) => {
  if (e.persisted) loop.suspend(document.hidden);
});
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  if (!disposed) window.dreamfallFailure();
});
engine.onDeviceLost(() => {
  if (!disposed) window.dreamfallFailure();
});

installDebug(window, {
  get ready() {
    return ready;
  },
  get running() {
    return loop.running;
  },
  get paused() {
    return loop.paused;
  },
  get frames() {
    return loop.frames;
  },
  seed: params.seed,
  backend: engine.backend,
  state: world.sim.state,
  step(dt) {
    world.update(dt);
    loop.renderOnce();
  },
  begin,
  dispose,
  memory: () => engine.memory(),
  heightAt: (x, z) => world.heightAt(x, z),
  get dayPhase() {
    return world.clock.phase;
  },
  set dayPhase(v: number) {
    world.clock.phase = v;
    world.clock.evalPalette();
    world.update(0.000001);
    loop.renderOnce();
  },
  get origin() {
    return { x: world.origin.x, z: world.origin.z };
  },
  get clearance() {
    return world.sim.state.y - world.heightAt(world.sim.state.x, world.sim.state.z);
  },
  capture: (w, h) => world.post.capture(w, h),
  get view() {
    return steering.view;
  },
  setView,
  get cameraFov() {
    return world.camera.fov;
  },
  get orbit() {
    return { ...steering.orbit };
  },
  get wind() {
    return world.wind;
  },
  get audio() {
    return {
      available: audio.available,
      state: audio.state,
      gain: audio.gain,
      muted: audio.muted,
      volume: audio.volume,
    };
  },
  resumed: resume !== null,
  snapshot: () => world.snapshot(),
  saveFlight,
  get timings() {
    return { ...timings };
  },
  get gpuMs() {
    return engine.gpuMs;
  },
  get biomes() {
    return world.library.biomes.map((b) => b.id);
  },
  get scenery() {
    return world.scenery?.stats ?? null;
  },
  scenerySample: (i: number) => world.scenery?.sample(i) ?? null,
  get obstacles() {
    return world.obstacles.size;
  },
  floorAt: (x: number, z: number) => world.sim.flight.floorAt(x, z),
  weightsAt(x: number, z: number) {
    const ids = new Uint8Array(3),
      weights = new Float32Array(3);
    world.heightfield.weightsAt(x, z, ids, weights);
    return [...ids].map((id, k) => ({
      id: world.library.biomes[id]?.id ?? String(id),
      weight: weights[k]!,
    }));
  },
  key: (code) => steering.key(code),
  keyUp: (code) => steering.keyUp(code),
  get autopilot() {
    return steering.autopilot;
  },
  setAutopilot(on: boolean) {
    steering.setAutopilot(on);
    showAutopilot();
  },
  pointer: {
    down: (button, x, y, touch = false) => steering.pointerDown(button, x, y, touch),
    move: (x, y) => steering.pointerMove(x, y),
    up: () => steering.pointerUp(),
  },
});
