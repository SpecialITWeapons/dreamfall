// The display chain: the scene pass with four samples (the only multisampling
// anywhere), bloom, ACES tone mapping, then everything display-referred in
// eight bits: the approved soft reconstruction and FXAA. Ported from
// fly-with-me; docs/perf-notes.md there says why the intermediates are 8-bit.
import {
  ACESFilmicToneMapping,
  FloatType,
  NoToneMapping,
  RenderTarget,
  UnsignedByteType,
  type Camera,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu';
import {
  Fn,
  convertToTexture,
  dot,
  exp,
  float,
  mix,
  pass,
  renderOutput,
  saturation,
  screenUV,
  vec2,
  vec3,
  vec4,
  viewportSize,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { LOOK } from './ColorGrade';

export interface Capture {
  width: number;
  height: number;
  /** RGBA floats, rows top first on both backends. */
  data: Float32Array;
}

export function createPost(renderer: WebGPURenderer, scene: Scene, camera: Camera) {
  // Four samples here and nowhere else; the renderer is created with antialias off.
  const scenePass = pass(scene, camera, { samples: 4 });
  const col = scenePass.getTextureNode();
  const glow = bloom(col, LOOK.bloom.strength, LOOK.bloom.radius, LOOK.bloom.threshold);
  const pipeline = new RenderPipeline(renderer);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = LOOK.exposure;
  pipeline.outputColorTransform = false;
  const LDR = { type: UnsignedByteType, depthBuffer: false };
  const display = convertToTexture(renderOutput(vec4(col.rgb.add(glow.rgb), 1)), null, null, LDR);
  const softened = Fn(() => {
    const center = display.sample(screenUV),
      sum = center.rgb.mul(4).toVar(),
      weights = float(4).toVar();
    for (const [x, y, spatial] of [
      [-1, 0, 2],
      [1, 0, 2],
      [0, -1, 2],
      [0, 1, 2],
      [-1, -1, 1],
      [1, -1, 1],
      [-1, 1, 1],
      [1, 1, 1],
    ] as const) {
      const neighbor = display.sample(screenUV.add(vec2(x, y).div(viewportSize))).rgb;
      const delta = neighbor.sub(center.rgb),
        weight = exp(dot(delta, delta).mul(-40)).mul(spatial);
      sum.addAssign(neighbor.mul(weight));
      weights.addAssign(weight);
    }
    const rgb = mix(center.rgb, sum.div(weights), 0.65)
      .mul(LOOK.post.mul)
      .add(vec3(LOOK.post.lift[0], LOOK.post.lift[1], LOOK.post.lift[2]))
      .toVar();
    rgb.assign(saturation(rgb, float(LOOK.post.sat)));
    rgb.assign(mix(vec3(0.5), rgb, float(LOOK.post.contrast)));
    return vec4(rgb, center.a);
  })();
  const softDisplay = convertToTexture(softened, null, null, LDR);
  pipeline.outputNode = fxaa(softDisplay);
  let captureTask: Promise<unknown> = Promise.resolve();
  let disposed = false;
  return {
    render() {
      pipeline.render();
    },
    setExposure(v: number) {
      renderer.toneMappingExposure = v;
    },
    /** A small linear picture of the scene as it stands, before the display chain; for checks that must see what is drawn. */
    capture(width = 192, height = 108): Promise<Capture | null> {
      if (disposed) return Promise.resolve(null);
      const task = captureTask.then(async () => {
        if (disposed) return null;
        const target = new RenderTarget(width, height, { type: FloatType, depthBuffer: true });
        const persp = camera as PerspectiveCamera;
        const aspect = persp.aspect;
        const toneMapping = renderer.toneMapping;
        persp.aspect = width / height;
        persp.updateProjectionMatrix();
        renderer.toneMapping = NoToneMapping;
        renderer.setRenderTarget(target);
        try {
          await renderer.renderAsync(scene, camera);
          const read = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
          const data = new Float32Array(read.length),
            row = width * 4,
            flip = !(renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend;
          for (let y = 0; y < height; y++)
            data.set(read.subarray(y * row, (y + 1) * row), (flip ? height - 1 - y : y) * row);
          return { width, height, data };
        } finally {
          renderer.setRenderTarget(null);
          renderer.toneMapping = toneMapping;
          persp.aspect = aspect;
          persp.updateProjectionMatrix();
          target.dispose();
        }
      });
      captureTask = task.catch(() => null);
      return task;
    },
    dispose() {
      // Idempotent: the world disposes its post chain and the engine disposes whatever is attached.
      if (disposed) return;
      disposed = true;
      // Pending readbacks must finish before their buffers are destroyed; dispose is
      // called from the page's dispose, which awaits nothing else, so chain here.
      void captureTask.then(() => {
        scenePass.dispose();
        glow.dispose();
        display.dispose();
        softDisplay.dispose();
        pipeline.dispose();
      });
    },
  };
}
export type Post = ReturnType<typeof createPost>;
