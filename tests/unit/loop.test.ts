import { describe, expect, it, vi } from 'vitest';
import { createLoop } from '../../src/engine/Loop';
import { MAX_STEP } from '../../src/engine/sim/Simulation';

function harness() {
  let fn: ((now: number) => void) | null = null;
  let clock = 0;
  const deps = {
    setLoop: vi.fn((f: ((now: number) => void) | null) => {
      fn = f;
    }),
    update: vi.fn(),
    render: vi.fn(),
    now: () => clock,
  };
  const tick = (at: number) => {
    clock = at;
    fn?.(at);
  };
  return { deps, tick, scheduled: () => fn !== null };
}

describe('createLoop', () => {
  it('draws one still frame behind the gate and then stops', () => {
    const h = harness();
    const first = vi.fn();
    const loop = createLoop(h.deps);
    loop.onFirstFrame(first);
    expect(h.scheduled()).toBe(true);
    h.tick(16);
    expect(h.deps.render).toHaveBeenCalledTimes(1);
    expect(h.deps.update).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledTimes(1);
    expect(loop.frames).toBe(1);
    expect(h.scheduled()).toBe(false);
    h.tick(32);
    expect(h.deps.render).toHaveBeenCalledTimes(1);
  });
  it('advances the world after begin, with the frame time clamped', () => {
    const h = harness();
    const loop = createLoop(h.deps);
    h.tick(0);
    h.tick(1000);
    loop.begin();
    expect(loop.running).toBe(true);
    expect(h.scheduled()).toBe(true);
    h.tick(1016);
    expect(h.deps.update).toHaveBeenLastCalledWith(0.016);
    h.tick(2016);
    expect(h.deps.update).toHaveBeenLastCalledWith(MAX_STEP);
    expect(h.scheduled()).toBe(true);
  });
  it('pause and a hidden tab stop the loop; resuming restarts it', () => {
    const h = harness();
    const loop = createLoop(h.deps);
    h.tick(0);
    loop.begin();
    loop.togglePause();
    expect(loop.paused).toBe(true);
    expect(h.scheduled()).toBe(false);
    loop.togglePause();
    expect(h.scheduled()).toBe(true);
    loop.suspend(true);
    expect(h.scheduled()).toBe(false);
    loop.suspend(false);
    expect(h.scheduled()).toBe(true);
    h.tick(16);
    expect(h.deps.update).toHaveBeenCalledTimes(1);
  });
  it('renderOnce draws a single frame while paused', () => {
    const h = harness();
    const loop = createLoop(h.deps);
    h.tick(0);
    loop.begin();
    loop.setPaused(true);
    loop.renderOnce();
    h.tick(16);
    expect(h.deps.render).toHaveBeenCalledTimes(2);
    expect(h.deps.update).not.toHaveBeenCalled();
    expect(h.scheduled()).toBe(false);
  });
  it('renderNow draws on the spot, and asks the browser for nothing', () => {
    const h = harness();
    const loop = createLoop(h.deps);
    h.tick(0);
    loop.begin();
    loop.setPaused(true);
    const drawn = h.deps.render.mock.calls.length;
    loop.renderNow();
    // Drawn already, before any tick: whoever called this is about to read what
    // it drew, and a frame that lands later is a picture of the state they left.
    expect(h.deps.render).toHaveBeenCalledTimes(drawn + 1);
    expect(loop.frames).toBeGreaterThan(0);
    expect(h.scheduled()).toBe(false);
    expect(h.deps.update).not.toHaveBeenCalled();
  });
  it('stop is final', () => {
    const h = harness();
    const loop = createLoop(h.deps);
    loop.begin();
    loop.stop();
    expect(h.scheduled()).toBe(false);
    loop.begin();
    loop.renderOnce();
    const drawn = h.deps.render.mock.calls.length;
    loop.renderNow();
    expect(h.deps.render).toHaveBeenCalledTimes(drawn);
    expect(h.scheduled()).toBe(false);
    expect(loop.running).toBe(false);
  });
});
