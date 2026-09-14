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
});
