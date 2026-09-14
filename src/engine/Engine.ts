import type { Camera, Scene } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { renderScale } from './renderScale';

export interface EngineOptions {
  forceWebGL?: boolean;
  profiling?: boolean;
}

export interface EngineDeps {
  makeRenderer?: (canvas: HTMLCanvasElement, opts: EngineOptions) => WebGPURenderer;
  raf?: (cb: () => void) => void;
}

export interface Engine {
  readonly renderer: WebGPURenderer;
  readonly backend: 'webgpu' | 'webgl2';
  resize(width: number, height: number, dpr: number): void;
  render(scene: Scene, camera: Camera): void;
  setLoop(fn: ((now: number) => void) | null): void;
  /** Resolves once the GPU has finished its outstanding work and one browser frame has passed. */
  waitForGpu(): Promise<void>;
  onDeviceLost(cb: () => void): void;
  memoryTotal(): number;
  dispose(): void;
}

// Minimal shape of the backend the engine uses; WebGPU types aren't in lib.dom.
interface BackendLike {
  isWebGPUBackend?: boolean;
  device?: {
    queue: { onSubmittedWorkDone(): Promise<void> };
    lost: Promise<{ reason: string }>;
    addEventListener(type: 'uncapturederror', cb: () => void): void;
  };
  gl?: WebGL2RenderingContext;
}

const defaultRenderer = (canvas: HTMLCanvasElement, opts: EngineOptions) =>
  // Multisampling belongs to the scene pass (M1), not the canvas; antialias is always off here.
  new WebGPURenderer({
    canvas,
    antialias: false,
    forceWebGL: opts.forceWebGL === true,
    trackTimestamp: opts.profiling === true,
  });

export async function createEngine(
  canvas: HTMLCanvasElement,
  opts: EngineOptions = {},
  deps: EngineDeps = {},
): Promise<Engine> {
  const renderer = (deps.makeRenderer ?? defaultRenderer)(canvas, opts);
  const raf = deps.raf ?? ((cb: () => void) => requestAnimationFrame(() => cb()));
  await renderer.init();
  const backend = renderer.backend as unknown as BackendLike;
  const lostListeners: Array<() => void> = [];
  const lost = () => {
    for (const cb of lostListeners) cb();
  };
  backend.device?.addEventListener('uncapturederror', lost);
  backend.device?.lost.then((info) => {
    if (info.reason !== 'destroyed') lost();
  });
  return {
    renderer,
    backend: backend.isWebGPUBackend ? 'webgpu' : 'webgl2',
    resize(width, height, dpr) {
      renderer.setPixelRatio(renderScale(dpr, width, height));
      renderer.setSize(width, height, false);
    },
    render(scene, camera) {
      renderer.render(scene, camera);
    },
    setLoop(fn) {
      renderer.setAnimationLoop(fn);
    },
    async waitForGpu() {
      if (backend.isWebGPUBackend && backend.device) await backend.device.queue.onSubmittedWorkDone();
      else if (backend.gl) {
        const gl = backend.gl;
        const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        while (fence && gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED)
          await new Promise((r) => setTimeout(r, 16));
        if (fence) gl.deleteSync(fence);
      }
      await new Promise<void>((resolve) => raf(resolve));
    },
    onDeviceLost(cb) {
      lostListeners.push(cb);
    },
    memoryTotal() {
      return (renderer.info.memory as unknown as { total?: number }).total ?? 0;
    },
    dispose() {
      renderer.setAnimationLoop(null);
      renderer.dispose();
    },
  };
}
