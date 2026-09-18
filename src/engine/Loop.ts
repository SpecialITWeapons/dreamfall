import { MAX_STEP } from './sim/Simulation';

export interface LoopDeps {
  setLoop(fn: ((now: number) => void) | null): void;
  update(dt: number): void;
  render(): void;
  now?: () => number;
}

export interface Loop {
  readonly running: boolean;
  readonly paused: boolean;
  readonly frames: number;
  onFirstFrame(cb: () => void): void;
  begin(): void;
  setPaused(paused: boolean): void;
  togglePause(): void;
  suspend(hidden: boolean): void;
  renderOnce(): void;
  /**
   * One frame, drawn **now**, on the caller's own stack. `renderOnce` asks the
   * browser for a frame and returns before it happens, which is right for a
   * page reacting to a click and wrong for anything about to look at what it
   * drew: the dev panel redrawing a stopped world, a jump, a test reading a
   * counter.
   *
   * One-off, not a loop. Three advances the node graph's frame id only inside
   * the renderer's own animation tick, and the display chain's scene pass is a
   * node that updates once per frame id: call this twice inside one animation
   * frame and the second call redraws the chain over a scene texture nobody
   * refilled. Measured: 3 draw calls and 3 triangles, where the frame has a
   * million. Anything that wants a hundred real frames has to let the browser
   * have its animation frames -- which is what the loop is.
   */
  renderNow(): void;
  stop(): void;
}

/**
 * Frame loop. One still frame behind the gate, then nothing until Begin; in
 * flight the loop runs only while the world is neither paused nor hidden,
 * and switches itself off as soon as either stops being true.
 */
export function createLoop(deps: LoopDeps): Loop {
  const now = deps.now ?? (() => performance.now());
  let running = false;
  let paused = false;
  let hidden = false;
  let stopped = false;
  let frames = 0;
  let last = now();
  const firstFrame: Array<() => void> = [];
  const live = () => running && !paused && !hidden && !stopped;
  const frame = (at: number) => {
    if (stopped) return;
    const dt = Math.min(MAX_STEP, Math.max(0, (at - last) / 1000));
    last = at;
    if (live()) deps.update(dt);
    deps.render();
    frames++;
    if (frames === 1) for (const cb of firstFrame) cb();
    if (!live()) deps.setLoop(null);
  };
  const sync = () => {
    if (stopped) return;
    last = now();
    deps.setLoop(live() ? frame : null);
  };
  deps.setLoop(frame);
  return {
    get running() {
      return running;
    },
    get paused() {
      return paused;
    },
    get frames() {
      return frames;
    },
    onFirstFrame(cb) {
      if (frames > 0) cb();
      else firstFrame.push(cb);
    },
    begin() {
      if (stopped || running) return;
      running = true;
      sync();
    },
    setPaused(value) {
      paused = value;
      sync();
    },
    togglePause() {
      paused = !paused;
      sync();
    },
    suspend(value) {
      hidden = value;
      sync();
    },
    renderOnce() {
      if (stopped) return;
      last = now();
      deps.setLoop(frame);
    },
    renderNow() {
      if (stopped) return;
      last = now();
      deps.render();
      frames++;
      if (frames === 1) for (const cb of firstFrame) cb();
    },
    stop() {
      stopped = true;
      running = false;
      deps.setLoop(null);
    },
  };
}
