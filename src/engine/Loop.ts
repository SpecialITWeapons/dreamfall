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
    stop() {
      stopped = true;
      running = false;
      deps.setLoop(null);
    },
  };
}
