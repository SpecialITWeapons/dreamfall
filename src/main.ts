// Start: address parameters, page, engine, world, loop, lifecycle. A thin
// file: every decision has its own module; this just wires them together.
import { createEngine } from './engine/Engine';
import { createLoop } from './engine/Loop';
import { createWorld } from './engine/World';
import { installDebug } from './page/Debug';
import { createGate } from './page/Gate';
import { createHud } from './page/Hud';
import { addressWithSeed, resolveParams, shareAddress } from './page/Params';
import { createVeil } from './page/Veil';

const params = resolveParams(location.search);
history.replaceState(null, '', addressWithSeed(location.href, params.seed));

const veil = createVeil(document);
const gate = createGate(document);
const hud = createHud(document);
hud.setShare(shareAddress(location.href, params.seed));

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = await createEngine(canvas, { forceWebGL: params.forceWebGL, profiling: params.profiling });
hud.setBackend(engine.backend);
engine.resize(innerWidth, innerHeight, devicePixelRatio);

const world = createWorld({ seed: params.seed, aspect: innerWidth / innerHeight });
const loop = createLoop({
  setLoop: (fn) => engine.setLoop(fn),
  update: (dt) => world.update(dt),
  render: () => engine.render(world.scene, world.camera),
});

let ready = false;
let disposed = false;
// The veil lifts only once the first frame is really on screen.
loop.onFirstFrame(async () => {
  await engine.waitForGpu();
  if (disposed) return;
  ready = true;
  veil.lift();
  gate.enable();
});

const begin = () => {
  if (!ready || disposed || loop.running) return;
  loop.begin();
  hud.enable();
  hud.setPaused(false);
  canvas.removeAttribute('inert');
  canvas.focus({ preventScroll: true });
};
gate.onBegin(begin);

const togglePause = () => {
  if (!loop.running || disposed) return;
  loop.togglePause();
  hud.setPaused(loop.paused);
};
hud.onPause(togglePause);
addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement)
    return;
  e.preventDefault();
  togglePause();
});

addEventListener('resize', () => {
  if (disposed) return;
  engine.resize(innerWidth, innerHeight, devicePixelRatio);
  world.resize(innerWidth / innerHeight);
  loop.renderOnce();
});
document.addEventListener('visibilitychange', () => loop.suspend(document.hidden));

async function dispose() {
  if (disposed) return;
  disposed = true;
  loop.stop();
  world.dispose();
  engine.dispose();
}
addEventListener('pagehide', (e) => {
  if (e.persisted) loop.suspend(true);
  else void dispose();
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
  memoryTotal: () => engine.memoryTotal(),
});
