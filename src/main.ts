// Start: address parameters, memory, page, engine, world, input, loop,
// lifecycle. A thin file: every decision has its own module; this just
// wires them together.
import { swatchColor } from '../library/contract';
import { createEngine } from './engine/Engine';
import type { View } from './engine/flight/Steering';
import { createLoop } from './engine/Loop';
import { outfitById, patternById, patternForSeed } from './engine/avatar/Outfits';
import { createWorld } from './engine/World';
import type { DevPanel } from './dev/Panel';
import { installDebug, type DisposeReport, type WorldDebug } from './page/Debug';
import { createGate } from './page/Gate';
import { createHud } from './page/Hud';
import { createWardrobe } from './page/Wardrobe';
import { browserStorage, createMemory, rememberedSeed, validateResume } from './page/Memory';
import { addressWithSeed, resolveParams, shareAddress } from './page/Params';
import { createVeil } from './page/Veil';

const memory = createMemory(browserStorage());
const settings = memory.readSettings();
const storedFlight = memory.readResume();
const params = resolveParams(location.search, Math.random, rememberedSeed(storedFlight));
history.replaceState(null, '', addressWithSeed(location.href, params.seed));
const resume = validateResume(storedFlight, params.seed);
/**
 * The marking: the person's if they ever opened the wardrobe, and otherwise
 * the world's own, drawn from the seed. It is kept apart from the rest of the
 * settings for exactly that reason -- saving the resolved one would pin the
 * first world's marking to every world after it.
 */
let chosenPattern = settings.pattern;
const pattern = chosenPattern ? patternById(chosenPattern) : patternForSeed(params.seed);
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
  pattern: pattern.id,
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
/**
 * What the HUD has been told about the autopilot. It is written in one place
 * -- `showAutopilot` -- with the call that tells the HUD, because a flag that
 * says "already shown" while the pill shows the opposite is worse than no flag:
 * Begin used to set the pill straight from the steering and leave this at its
 * initial `true`, so the opening's hand-back found them equal, said nothing,
 * and left "autopilot off -- arrows fly the figure" over a flight flying
 * itself. CI caught it as a race: it needs a frame between Begin and the input
 * that ends the opening, and a slow runner does not always have one.
 */
let shownAutopilot = true;
const loop = createLoop({
  setLoop: (fn) => engine.setLoop(fn),
  update: (dt) => {
    world.update(dt);
    // The title card rides the opening's own fade; at zero the element goes
    // away rather than sitting invisible over the canvas for the whole flight.
    hud.setTitle(world.opening.card);
    hud.setOpening(!world.opening.done);
    // The opening flies with the autopilot off and hands it back at the end,
    // and the HUD has to hear about it: without this the banner still said
    // "autopilot off -- arrows fly the figure" over a flight flying itself, and
    // the button offered to resume what was already resumed.
    if (steering.autopilot !== shownAutopilot) showAutopilot();
    // a couple of times a minute while flying; never before Begin, when nothing has changed
    if (performance.now() - lastSave > 2000) saveFlight();
  },
  render: () => engine.render(world.scene, world.camera),
});

/**
 * One frame, driven by hand: the tests' `step`, the dev panel's redraws and the
 * jump all go through this, so none of them can advance the world in a way the
 * page itself never does.
 */
const stepByHand = (dt: number, drawNow = false) => {
  world.update(dt);
  // The card is the page's, not the world's, and a test stepping the world by
  // hand is still entitled to see it: without this the opening advances and the
  // title never appears, which is a difference between the tested page and the
  // real one.
  hud.setTitle(world.opening.card);
  hud.setOpening(!world.opening.done);
  // A step asks the browser for a frame and returns; a thousand of them in a
  // loop cost a thousand updates and whatever the browser found time to draw,
  // which is what a test simulating twenty minutes of wind wants. `frame` is
  // the other one: it draws before it returns, for a caller about to read what
  // it drew.
  if (drawNow) loop.renderNow();
  else loop.renderOnce();
};

let ready = false;
let disposed = false;
/** The dev panel, when the address asked for one: it polls the world, so dispose takes it down first. */
let devPanel: DevPanel | null = null;
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
    pattern: chosenPattern,
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
  showAutopilot();
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
/** The pill and the flag that remembers what the pill says, written together. */
// The wardrobe: the catalogue draws its own tiles, the page only has to say
// what is worn and hear what was picked.
const wardrobe = createWardrobe(document);
wardrobe.show(world.avatar.outfit.id, world.avatar.pattern.id);
hud.onWardrobe(() => {
  wardrobe.toggle();
  hud.setWardrobe(wardrobe.open);
});
wardrobe.onPick((outfitId, patternId) => {
  chosenPattern = patternId;
  world.avatar.setOutfit(outfitById(outfitId), patternById(patternId));
  saveSettings();
  // Drawn now: the flight may well be paused, and somebody is looking at the
  // figure they just dressed.
  if (loop.running) loop.renderNow();
});

const showAutopilot = () => {
  shownAutopilot = steering.autopilot;
  hud.setAutopilot(shownAutopilot);
};
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
  // A hand on the controls is the end of the opening, whatever it was going to
  // do next. It goes here rather than inside `Steering`, because a click that
  // starts no drag -- the left button on a page that only orbits with it -- is
  // still somebody saying they have seen enough.
  world.skipOpening();
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
  world.skipOpening();
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
  // Asking for less motion in the middle of a scripted flight is asking for
  // this one to stop.
  if (e.matches) world.skipOpening();
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
    devPanel?.dispose();
    devPanel = null;
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

const debug: WorldDebug = {
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
  step: (dt: number) => stepByHand(dt),
  frame: (dt: number) => stepByHand(dt, true),
  setPaused(on: boolean) {
    if (loop.running && !disposed && loop.paused !== on) togglePause();
  },
  jump(x: number, z: number, above = 120) {
    const { state } = world.sim;
    state.x = x;
    state.z = z;
    state.y = world.heightAt(x, z) + above;
    state.vy = 0;
    // A jump crosses cells, so the window refills, the ring rebuilds and the
    // origin may move: one frame is what puts the world where the flight is,
    // drawn now because a jump is somebody looking.
    stepByHand(0.05, true);
  },
  get layers() {
    return world.layers;
  },
  measureHeightHooks: (samples) => world.measureHeightHooks(samples),
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
    loop.renderNow();
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
  get galaxy() {
    return world.galaxy;
  },
  get wind() {
    return world.wind;
  },
  get audio() {
    return {
      available: audio.available,
      state: audio.state,
      gain: audio.gain,
      clock: audio.clock,
      layers: { ...audio.layers },
      muted: audio.muted,
      volume: audio.volume,
    };
  },
  get opening() {
    return { card: world.opening.card, done: world.opening.done };
  },
  skipOpening() {
    world.skipOpening();
    hud.setTitle(0);
    hud.setOpening(false);
  },
  get wearing() {
    return { outfit: world.avatar.outfit.id, pattern: world.avatar.pattern.id };
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
  siteNear: (x: number, z: number) => world.scenery?.siteNear(x, z) ?? null,
  get obstacles() {
    return world.obstacles.size;
  },
  floorAt: (x: number, z: number) => world.sim.flight.floorAt(x, z),
  get horizon() {
    return world.horizon;
  },
  hazeOf(id: string) {
    const biome = world.library.biomes.find((b) => b.id === id);
    if (biome?.ambience?.fogTint === undefined) return null;
    const hex = swatchColor(biome.ambience.fogTint);
    return { r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 };
  },
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
};
installDebug(window, debug);

// `?dev=1`, and only then: the panel is a separate chunk, so a page nobody
// asked it of never downloads a line of it.
if (params.dev) {
  const { createDevPanel } = await import('./dev/Panel');
  devPanel = createDevPanel(document, debug);
}
