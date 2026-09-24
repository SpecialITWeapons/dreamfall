// The display chain: the scene pass with four samples (the only multisampling
// anywhere), bloom, ACES tone mapping, then everything display-referred in
// eight bits: the approved soft reconstruction and FXAA. Ported from
// fly-with-me; docs/perf-notes.md there says why the intermediates are 8-bit.
import {
  ACESFilmicToneMapping,
  Color,
  FloatType,
  HalfFloatType,
  NoToneMapping,
  RenderTarget,
  UnsignedByteType,
  Vector2,
  Vector3,
  type Camera,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  convertToTexture,
  dot,
  exp,
  float,
  interleavedGradientNoise,
  luminance,
  max,
  mix,
  pass,
  renderOutput,
  saturation,
  screenCoordinate,
  screenUV,
  step,
  uniform,
  vec2,
  vec3,
  vec4,
  viewportSize,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { LOOK } from './ColorGrade';

/**
 * The sun's shafts: what counts as the sun on the screen (luminance over the
 * halo), how far from the disc a source may be (screen heights), how far back
 * toward the sun each pixel looks (share of the way), in how many steps, how
 * each step weighs against the last, and the whole of it.
 */
export const SHAFTS = { threshold: 1.2, reach: 0.22, length: 0.9, samples: 40, decay: 0.965, strength: 0.6 };

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
  // Shafts of sunlight: what is brighter than the sun's own halo, near the sun
  // on the screen, smeared back toward it, so whatever stands in front of the
  // sun -- a ridge, a tree, the figure, the dense middle of a cloud -- leaves a
  // dark wedge in the light. Screen space and half resolution: no depth is read,
  // because anything in front of the disc is darker than it, and the scene pass
  // is multisampled, which a depth read would have to resolve first.
  const uSunUV = uniform(new Vector2(0.5, 0.5)),
    uShafts = uniform(0),
    uShaftColor = uniform(new Color(1, 1, 1));
  const aspect = vec2(viewportSize.x.div(viewportSize.y), 1);
  const HDR = { type: HalfFloatType, depthBuffer: false };
  const shaftSource = convertToTexture(
    Fn(() => {
      const d = screenUV.sub(uSunUV).mul(aspect);
      const near = exp(
        dot(d, d)
          .div(SHAFTS.reach * SHAFTS.reach)
          .negate(),
      );
      return vec4(max(luminance(col.sample(screenUV).rgb).sub(SHAFTS.threshold), 0).mul(near), 0, 0, 1);
    })(),
    null,
    null,
    HDR,
  );
  shaftSource.setResolutionScale(0.5);
  const shafts = convertToTexture(
    Fn(() => {
      const sum = float(0).toVar();
      If(uShafts.greaterThan(0.001), () => {
        const stride = uSunUV
          .sub(screenUV)
          .mul(SHAFTS.length / SHAFTS.samples)
          .toVar();
        const at = screenUV.add(stride.mul(interleavedGradientNoise(screenCoordinate))).toVar();
        const weight = float(1).toVar();
        Loop(SHAFTS.samples, () => {
          at.addAssign(stride);
          // Clamped to the edge the texture would smear its last row into streaks.
          const inside = step(0, at.x).mul(step(at.x, 1)).mul(step(0, at.y)).mul(step(at.y, 1));
          sum.addAssign(shaftSource.sample(at).r.mul(inside).mul(weight));
          weight.mulAssign(SHAFTS.decay);
        });
      });
      return vec4(vec3(sum.mul(uShafts).div(SHAFTS.samples)), 1);
    })(),
    null,
    null,
    HDR,
  );
  shafts.setResolutionScale(0.5);
  const sunAt = new Vector3(),
    facing = new Vector3();
  const pipeline = new RenderPipeline(renderer);
  // The renderer's own tone mapping stays off and the display chain asks for
  // ACES by name. A node material's compiled program is keyed on the renderer's
  // tone mapping, so the global setting is not a setting: flipping it -- as
  // capture() used to, twice a call -- recompiles every material in the scene,
  // which went from a moment to tens of seconds when the ground grew a branch
  // per biome. Exposure is a uniform and stays cheap; the atmosphere moves it
  // every frame.
  renderer.toneMapping = NoToneMapping;
  renderer.toneMappingExposure = LOOK.exposure;
  pipeline.outputColorTransform = false;
  const LDR = { type: UnsignedByteType, depthBuffer: false };
  const display = convertToTexture(
    renderOutput(vec4(col.rgb.add(glow.rgb).add(shafts.r.mul(uShaftColor)), 1), ACESFilmicToneMapping),
    null,
    null,
    LDR,
  );
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
  // One target per size, kept between captures. A render target is a pipeline:
  // building a new one makes the renderer compile the scene's materials for it,
  // which is seconds rather than milliseconds now that the ground carries a
  // branch per biome -- and it was paid again on every single capture.
  const captureTargets = new Map<string, RenderTarget>();
  return {
    render() {
      pipeline.render();
    },
    setExposure(v: number) {
      renderer.toneMappingExposure = v;
    },
    /**
     * The sun for the shafts: its direction in the world, its colour and how
     * strong the shafts are (zero skips them). They fade as the sun leaves the
     * screen and are gone once it is behind the camera.
     */
    setSun(dir: Vector3, color: Color, strength: number) {
      camera.getWorldDirection(facing);
      sunAt.copy(camera.position).addScaledVector(dir, 1000).project(camera);
      const ahead = facing.dot(dir);
      const off = Math.max(Math.abs(sunAt.x), Math.abs(sunAt.y));
      const fade = Math.min(1, Math.max(0, ahead / 0.2)) * Math.min(1, Math.max(0, (1.6 - off) / 0.5));
      uSunUV.value.set(sunAt.x * 0.5 + 0.5, 0.5 - sunAt.y * 0.5);
      uShaftColor.value.copy(color);
      uShafts.value = strength * fade * SHAFTS.strength;
    },
    /** A small linear picture of the scene as it stands, before the display chain; for checks that must see what is drawn. */
    capture(width = 192, height = 108): Promise<Capture | null> {
      if (disposed) return Promise.resolve(null);
      const task = captureTask.then(async () => {
        if (disposed) return null;
        const key = `${width}x${height}`;
        let target = captureTargets.get(key);
        if (!target) {
          target = new RenderTarget(width, height, { type: FloatType, depthBuffer: true });
          captureTargets.set(key, target);
        }
        const persp = camera as PerspectiveCamera;
        const aspect = persp.aspect;
        persp.aspect = width / height;
        persp.updateProjectionMatrix();
        // no tone mapping to switch off: the renderer never had it on
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
          persp.aspect = aspect;
          persp.updateProjectionMatrix();
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
        for (const target of captureTargets.values()) target.dispose();
        captureTargets.clear();
        scenePass.dispose();
        glow.dispose();
        shaftSource.dispose();
        shafts.dispose();
        display.dispose();
        softDisplay.dispose();
        pipeline.dispose();
      });
    },
  };
}
export type Post = ReturnType<typeof createPost>;
