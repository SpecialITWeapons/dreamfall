// The Milky Way, as the sky dome's `galaxy` hook: a baked atlas of stellar
// light in galactic coordinates, plus the wide diffuse band the disc makes
// either side of it. Ported from fly-with-me's `milky-way.js`; the matter it is
// made of is `GalaxyMatter.ts`, which is the CPU and knows nothing about this.
//
// The galaxy is fixed over the world rather than turning with the day, so a
// place in the field always keeps the same bearing -- which is what lets the
// flight turn toward its core once a night and find it there.
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, Vector3 } from 'three';
import type { Node } from 'three/webgpu';
import { Fn, abs, asin, atan, clamp, dot, exp, float, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import { DUST, brightestMatter, makeDust } from './GalaxyMatter';
import type { GalaxyBake } from './galaxy.worker';

/**
 * Where the galactic plane lies over this world. The normal is the pole of the
 * disc; the other two axes are any pair square to it, and which pair does not
 * matter as long as the bake and the lookup use the same one -- they both read
 * these.
 */
const NORMAL = new Vector3(0.568, -0.458, -0.683).normalize();
const RIGHT = new Vector3().crossVectors(new Vector3(0, 1, 0), NORMAL).normalize();
const UP = new Vector3().crossVectors(NORMAL, RIGHT);

/** A galactic longitude and latitude as a direction in the world. */
export function galacticDirection(longitude: number, latitude: number, out: Vector3): Vector3 {
  return out
    .copy(RIGHT)
    .multiplyScalar(Math.cos(longitude) * Math.cos(latitude))
    .addScaledVector(UP, Math.sin(longitude) * Math.cos(latitude))
    .addScaledVector(NORMAL, Math.sin(latitude));
}

export interface MilkyWay {
  /** What the dome adds to its own stars, in linear light, for a direction. */
  radiance: (dir: Node<'vec3'>) => Node<'vec3'>;
  /**
   * Begins the bake, once and only once. It is not begun in the constructor
   * because the constructor runs **behind the veil**, beside the terrain fill,
   * the scenery build and the shader compile -- and a worker burning a core
   * there is a core the start does not have. On a two-core runner that showed
   * up as the start itself timing out. The world calls this on its first frame
   * instead, when the veil is up and the flight is already flying.
   */
  begin(): void;
  /** The bearing of the brightest place in the field: the core, as a world direction. */
  readonly brightest: Vector3;
  /** Milliseconds the atlas took to bake, or zero until it arrives. */
  readonly bakeMs: number;
  /** Whether the atlas has arrived; until it does the hook draws the band alone. */
  readonly baked: boolean;
  dispose(): void;
}

export interface MilkyWayDeps {
  /**
   * Starts the bake. The default runs it in a worker, which is the whole point:
   * two million texels of `photographicMatter` is 3.5 s, and a start that pays
   * that for something invisible until nightfall is a start nobody waits out.
   * A test hands in its own, or none at all.
   */
  bake?: (done: (result: GalaxyBake) => void) => () => void;
}

const workerBake = (done: (result: GalaxyBake) => void) => {
  const worker = new Worker(new URL('./galaxy.worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event: MessageEvent<GalaxyBake>) => {
    done(event.data);
    worker.terminate();
  });
  worker.postMessage('bake');
  return () => worker.terminate();
};

export function createMilkyWay(deps: MilkyWayDeps = {}): MilkyWay {
  // The dust and the core bearing are the main thread's: together they are 93 ms
  // and the flight asks for the bearing before the first frame, so they cannot
  // wait for a worker. The atlas, which is forty times dearer, can.
  const core = brightestMatter(makeDust());
  const brightest = galacticDirection(core.longitude, core.latitude, new Vector3());

  // Allocated at full size and zero, so the material is built once and the bake
  // is a fill rather than a new texture: an empty atlas is simply no galaxy.
  const map = new DataTexture(new Uint8Array(DUST.width * DUST.height * 4), DUST.width, DUST.height);
  map.wrapS = RepeatWrapping;
  map.magFilter = LinearFilter;
  map.minFilter = LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;

  let bakeMs = 0,
    baked = false,
    stop: (() => void) | null = null,
    begun = false;
  const begin = () => {
    if (begun) return;
    begun = true;
    stop = (deps.bake ?? workerBake)((result) => {
      (map.image.data as Uint8Array).set(result.data);
      map.needsUpdate = true;
      bakeMs = result.ms;
      baked = true;
    });
  };

  const radiance = Fn(([dir]: [Node<'vec3'>]) => {
    const longitude = atan(dot(dir, vec3(UP)), dot(dir, vec3(RIGHT)))
      .div(Math.PI * 2)
      .add(0.5);
    const latitude = asin(clamp(dot(dir, vec3(NORMAL)), -1, 1));
    // The atlas is written over 0.84 radians of latitude and faded out before
    // its own edge, so the band ends in the sky rather than at a seam.
    const starlight = texture(map, vec2(longitude, latitude.div(DUST.latitudeSpan).add(0.5)))
      .rgb.mul(2)
      .mul(float(1).sub(smoothstep(0.35, 0.42, abs(latitude))));
    // The disc's own glow, wider and fainter than anything in the atlas: it is
    // what makes the sky away from the band still belong to a galaxy.
    return starlight.add(vec3(0.016, 0.04, 0.105).mul(exp(latitude.sub(0.14).div(0.43).pow(2).negate())));
  });

  return {
    radiance: (dir) => radiance(dir) as Node<'vec3'>,
    begin,
    brightest,
    get bakeMs() {
      return bakeMs;
    },
    get baked() {
      return baked;
    },
    dispose() {
      stop?.();
      map.dispose();
    },
  };
}
