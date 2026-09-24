// One directional horizon owns both the sky boundary and every fogged
// surface: the sky dome, the fog, the cloud sea and the water all read
// horizonTint, which is the rule that keeps the world looking infinite.
import type { Scene } from 'three';
import type { Node } from 'three/webgpu';
import {
  Fn,
  cameraPosition,
  densityFogFactor,
  dot,
  exponentialHeightFogFactor,
  float,
  fog,
  length,
  max,
  mix,
  normalize,
  positionWorld,
  pow,
  smoothstep,
} from 'three/tsl';
import { cloudBankAt, deckTopAt } from './CloudShadow';
import type { SkyUniforms } from './SkyUniforms';

export function createHorizon(u: SkyUniforms) {
  /** How well a direction's azimuth matches a reference's, 0..1. */
  const azimuthAlign = Fn(([dir, ref]: [Node<'vec3'>, Node<'vec3'>]) =>
    max(dot(dir.xz, ref.xz).div(max(length(dir.xz).mul(length(ref.xz)), 0.0001)), 0),
  );
  // Above the deck the far cloud sea meets a bright haze rather than a flat
  // white: the horizon keeps the day's hue and its warmth toward the sun, so
  // the sun stands out against it and the sea's far edge still meets the sky.
  const horizonTint = Fn(([dir]: [Node<'vec3'>]) => {
    const align = pow(azimuthAlign(dir, u.uSunDir), 5);
    const base = mix(u.uHorizon, u.uHorizonWarm, align);
    const haze = mix(
      mix(u.uHorizon, u.uCloudWhite, 0.4),
      mix(u.uHorizonWarm, u.uGlow, u.uLowSun.mul(0.7)),
      align,
    );
    return mix(mix(base, haze, u.uAbove), u.uCloudWhite, u.uWhiteout);
  });
  return { azimuthAlign, horizonTint };
}
export type Horizon = ReturnType<typeof createHorizon>;

/** Distance fog in the horizon color, a height fog that becomes the cloud sea from above, and the whiteout. */
export function installFog(scene: Scene, u: SkyUniforms, horizon: Horizon): void {
  const distance = length(positionWorld.sub(cameraPosition));
  const distF = densityFogFactor(u.uFogDensity).mul(mix(1, 0.55, smoothstep(100, 1000, positionWorld.y)));
  const lowAir = distance
    .div(120)
    .clamp(0, 1)
    .mul(0.055)
    .mul(float(1).sub(smoothstep(200, 800, positionWorld.y)));
  // Gentle local air; only the far streamed edge needs complete cover.
  const farCover = smoothstep(2600, 4100, distance);
  const air = float(1).sub(float(1).sub(distF).mul(float(1).sub(lowAir)).mul(float(1).sub(farCover)));
  // The typings leave the height fog factor untyped; it is a float. It is the
  // cloud sea's own fog, so it lies only where the deck has cloud: over a gap
  // between the banks the ground is seen through the air and nothing else.
  const worldXZ = positionWorld.xz.add(u.uWorldOrigin);
  // It rises to just under the sea's own surface, which is the top of the bank
  // over the fragment and not one height for the world.
  const seaF = (exponentialHeightFogFactor(float(0.0000085), deckTopAt(u, worldXZ).sub(85)) as Node<'float'>)
    .mul(u.uAbove)
    .mul(cloudBankAt(u, worldXZ));
  const factor = max(max(air, seaF), u.uWhiteout);
  scene.fogNode = fog(horizon.horizonTint(normalize(positionWorld.sub(cameraPosition))), factor);
}
