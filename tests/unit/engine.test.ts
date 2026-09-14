import { describe, expect, it, vi } from 'vitest';
import type { WebGPURenderer } from 'three/webgpu';
import { createEngine } from '../../src/engine/Engine';
import { renderScale } from '../../src/engine/renderScale';

function fakeRenderer(backend: Record<string, unknown>) {
  const r = {
    init: vi.fn(async () => {}),
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(),
    setAnimationLoop: vi.fn(),
    dispose: vi.fn(),
    backend,
    info: { memory: { total: 3 } },
  };
  return r as unknown as WebGPURenderer & typeof r;
}
const canvas = {} as HTMLCanvasElement;
const raf = (cb: () => void) => cb();

describe('createEngine', () => {
  it('initializes the renderer once and names the backend', async () => {
    const r = fakeRenderer({ isWebGPUBackend: true });
    const engine = await createEngine(canvas, {}, { makeRenderer: () => r, raf });
    expect(r.init).toHaveBeenCalledTimes(1);
    expect(engine.backend).toBe('webgpu');
    const gl = fakeRenderer({ isWebGPUBackend: false });
    expect((await createEngine(canvas, { forceWebGL: true }, { makeRenderer: () => gl, raf })).backend).toBe(
      'webgl2',
    );
  });
  it('sizes the drawing buffer inside the pixel budget', async () => {
    const r = fakeRenderer({ isWebGPUBackend: true });
    const engine = await createEngine(canvas, {}, { makeRenderer: () => r, raf });
    engine.resize(2560, 1440, 2);
    expect(r.setPixelRatio).toHaveBeenLastCalledWith(renderScale(2, 2560, 1440));
    expect(r.setSize).toHaveBeenLastCalledWith(2560, 1440, false);
  });
  it('waits for submitted GPU work and one browser frame before unveiling', async () => {
    const onSubmittedWorkDone = vi.fn(async () => {});
    const lost = new Promise<{ reason: string }>(() => {});
    const r = fakeRenderer({
      isWebGPUBackend: true,
      device: { queue: { onSubmittedWorkDone }, lost, addEventListener() {} },
    });
    const frames = vi.fn((cb: () => void) => cb());
    const engine = await createEngine(canvas, {}, { makeRenderer: () => r, raf: frames });
    await engine.waitForGpu();
    expect(onSubmittedWorkDone).toHaveBeenCalledTimes(1);
    expect(frames).toHaveBeenCalledTimes(1);
  });
  it('forwards the loop and releases the renderer on dispose', async () => {
    const r = fakeRenderer({ isWebGPUBackend: true });
    const engine = await createEngine(canvas, {}, { makeRenderer: () => r, raf });
    const fn = () => {};
    engine.setLoop(fn);
    expect(r.setAnimationLoop).toHaveBeenLastCalledWith(fn);
    expect(engine.memoryTotal()).toBe(3);
    engine.dispose();
    expect(r.setAnimationLoop).toHaveBeenLastCalledWith(null);
    expect(r.dispose).toHaveBeenCalledTimes(1);
  });
  it('notifies device loss from uncapturederror and from a lost device, but not when destroyed', async () => {
    let resolveLost1!: (info: { reason: string }) => void;
    const lost1 = new Promise<{ reason: string }>((resolve) => {
      resolveLost1 = resolve;
    });
    let uncapturedHandler: (() => void) | undefined;
    const device1 = {
      queue: { onSubmittedWorkDone: vi.fn(async () => {}) },
      lost: lost1,
      addEventListener(_type: 'uncapturederror', cb: () => void) {
        uncapturedHandler = cb;
      },
    };
    const r1 = fakeRenderer({ isWebGPUBackend: true, device: device1 });
    const engine1 = await createEngine(canvas, {}, { makeRenderer: () => r1, raf });
    const cb = vi.fn();
    engine1.onDeviceLost(cb);
    uncapturedHandler?.();
    expect(cb).toHaveBeenCalledTimes(1);
    resolveLost1({ reason: 'unknown' });
    await Promise.resolve();
    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(2);

    let resolveLost2!: (info: { reason: string }) => void;
    const lost2 = new Promise<{ reason: string }>((resolve) => {
      resolveLost2 = resolve;
    });
    const device2 = {
      queue: { onSubmittedWorkDone: vi.fn(async () => {}) },
      lost: lost2,
      addEventListener() {},
    };
    const r2 = fakeRenderer({ isWebGPUBackend: true, device: device2 });
    const engine2 = await createEngine(canvas, {}, { makeRenderer: () => r2, raf });
    const cb2 = vi.fn();
    engine2.onDeviceLost(cb2);
    resolveLost2({ reason: 'destroyed' });
    await Promise.resolve();
    await Promise.resolve();
    expect(cb2).not.toHaveBeenCalled();
  });
  it('waits on a WebGL2 fence before the browser frame', async () => {
    const gl = {
      SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
      SYNC_STATUS: 0x9114,
      SIGNALED: 0x9119,
      fenceSync: vi.fn(() => ({})),
      flush: vi.fn(),
      getSyncParameter: vi.fn(() => 0x9119),
      deleteSync: vi.fn(),
    };
    const r = fakeRenderer({ isWebGPUBackend: false, gl: gl as unknown as WebGL2RenderingContext });
    const frames = vi.fn((cb: () => void) => cb());
    const engine = await createEngine(canvas, {}, { makeRenderer: () => r, raf: frames });
    await engine.waitForGpu();
    expect(gl.fenceSync).toHaveBeenCalledTimes(1);
    expect(gl.flush).toHaveBeenCalledTimes(1);
    expect(gl.getSyncParameter).toHaveBeenCalledTimes(1);
    expect(gl.deleteSync).toHaveBeenCalledTimes(1);
    expect(frames).toHaveBeenCalledTimes(1);
  });
});
