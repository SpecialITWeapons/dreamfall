import { TimestampQuery, type Camera, type Scene } from 'three';
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

/** A copy of the renderer's GPU allocation counters, safe to keep past the next frame. */
export interface MemorySnapshot {
  geometries: number;
  textures: number;
  total: number;
}

/** A display chain that draws the scene in place of the renderer; the engine only calls it and disposes it. */
export interface PostLike {
  render(): void;
  dispose(): void;
}

export interface Engine {
  readonly renderer: WebGPURenderer;
  readonly backend: 'webgpu' | 'webgl2';
  resize(width: number, height: number, dpr: number): void;
  render(scene: Scene, camera: Camera): void;
  /** What the GPU spent on the last resolved frame, ms; zero unless `?profile=1` asked for it. */
  readonly gpuMs: number;
  /** Routes render() through a post chain; null restores the plain renderer. */
  attachPost(post: PostLike | null): void;
  setLoop(fn: ((now: number) => void) | null): void;
  /** Resolves once the GPU has finished its outstanding work and one browser frame has passed. */
  waitForGpu(): Promise<void>;
  onDeviceLost(cb: () => void): void;
  memory(): MemorySnapshot;
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
  const profiling = opts.profiling === true;
  const renderer = (deps.makeRenderer ?? defaultRenderer)(canvas, opts);
  const raf = deps.raf ?? ((cb: () => void) => requestAnimationFrame(() => cb()));
  await renderer.init();
  const backend = renderer.backend as unknown as BackendLike;
  const lostListeners: Array<() => void> = [];
  let gpuMs = 0;
  let resolving = false;
  const lost = () => {
    for (const cb of lostListeners) cb();
  };
  backend.device?.addEventListener('uncapturederror', lost);
  backend.device?.lost.then((info) => {
    if (info.reason !== 'destroyed') lost();
  });
  let post: PostLike | null = null;
  return {
    renderer,
    backend: backend.isWebGPUBackend ? 'webgpu' : 'webgl2',
    resize(width, height, dpr) {
      // A viewport can report 0×0 at start-up (embedded views, background tabs);
      // a 0×0 drawing buffer is a WebGPU validation error, so hold one pixel until the resize event arrives.
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      renderer.setPixelRatio(renderScale(dpr, w, h));
      renderer.setSize(w, h, false);
    },
    render(scene, camera) {
      if (post) post.render();
      else renderer.render(scene, camera);
      // Timestamps have to be collected, or the query pool fills and the
      // renderer starts warning about it: trackTimestamp without a resolve is
      // measurement nobody reads. One in flight at a time; the answer is a
      // frame or two old, which is what a frame time is for anyway.
      if (profiling && !resolving) {
        resolving = true;
        void renderer
          .resolveTimestampsAsync(TimestampQuery.RENDER)
          .then((ms) => {
            if (typeof ms === 'number') gpuMs = ms;
          })
          // WebGL2 has no timestamps to give; asking is not an error worth having
          .catch(() => {})
          .finally(() => {
            resolving = false;
          });
      }
    },
    get gpuMs() {
      return gpuMs;
    },
    attachPost(next) {
      post = next;
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
    memory() {
      const { geometries, textures, total } = renderer.info.memory;
      return { geometries, textures, total };
    },
    dispose() {
      renderer.setAnimationLoop(null);
      post?.dispose();
      post = null;
      renderer.dispose();
    },
  };
}
