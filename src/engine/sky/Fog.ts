// One directional horizon owns both the sky boundary and every fogged
// surface: the sky dome, the fog, the cloud sea and the water all read
// horizonTint, which is the rule that keeps the world looking infinite.
import type { Scene } from 'three';
import type { Node } from 'three/webgpu';
import {
  Fn,
  If,
  cameraPosition,
  densityFogFactor,
  dot,
  exp,
  exponentialHeightFogFactor,
  float,
  fog,
  length,
  max,
  min,
  mix,
  normalize,
  positionWorld,
  pow,
  smoothstep,
} from 'three/tsl';
import { LOOK } from '../render/ColorGrade';
import { DECK } from './CloudCover';
import { seaSeenAt } from './CloudSea';

/**
 * How far one sees inside a cloud, m: the whiteout covers a thing this far off
 * by two thirds. It was the same at every distance, so in a cloud the figure a
 * few metres from the eye went as white as the ground a kilometre down, and
 * turning the camera showed a white silhouette on a blue sky.
 */
export const WHITEOUT = {
  visibility: 50,
  /**
   * How far a ray walks the bank field from the eye, m, and in how many steps:
   * past a few hundred metres of solid bank nothing is left to see anyway.
   */
  reach: 1600,
  steps: 8,
};
import { cloudBankAt, deckBaseAt } from './CloudShadow';
import type { SkyUniforms } from './SkyUniforms';

export function createHorizon(u: SkyUniforms) {
  /**
   * How white the cloud round the camera makes what lies `distance` along
   * `dir`, 0..1. A cluster is white every way out of it. A bank is as white as
   * the cloud the ray passes through before it leaves the bank: by the deck's
   * base or its top over the camera, or out of its side into a gap, which is
   * why the ray walks the bank field (`cloudBankAt`, the edge the sea is drawn
   * to) rather than asking how solid the bank is where the camera hangs. From
   * the edge of a bank the gap is clear and the bank is a white wall; from 30 m
   * over its base the ground is seen through 30 m of cloud. It was one number
   * for the whole picture, and at a bank's thin edge or its floor that was a
   * veil of milk over the ground a kilometre down with no cloud drawn in it.
   */
  const whiteAlong = Fn(([dir, distance]: [Node<'vec3'>, Node<'float'>]) => {
    const band = float(0).toVar();
    const inBand = u.uBandWhite.mul(u.uShowBandWhite);
    If(inBand.greaterThan(0.001), () => {
      const down = cameraPosition.y.sub(u.uBandBase).max(0).div(dir.y.negate().max(0.0001));
      const up = u.uBandTop.sub(cameraPosition.y).max(0).div(dir.y.max(0.0001));
      const reach = min(min(distance, WHITEOUT.reach), min(down, up));
      const from = cameraPosition.xz.add(u.uWorldOrigin);
      // Denser near the eye, where the white is decided: step i covers
      // (i/n)^2 to ((i+1)/n)^2 of the way and is read at its middle.
      const n = WHITEOUT.steps;
      const cloud = float(0).toVar();
      for (let i = 0; i < n; i++) {
        const at = (i * i + (i + 1) * (i + 1)) / (2 * n * n);
        cloud.addAssign(cloudBankAt(u, from.add(dir.xz.mul(reach.mul(at)))).mul((2 * i + 1) / (n * n)));
      }
      band.assign(inBand.mul(float(1).sub(exp(cloud.mul(reach).div(WHITEOUT.visibility).negate()))));
    });
    const cluster = u.uClusterWhite
      .mul(u.uShowClusterWhite)
      .mul(float(1).sub(exp(distance.div(WHITEOUT.visibility).negate())));
    return max(band, cluster);
  });
  /** How well a direction's azimuth matches a reference's, 0..1. */
  const azimuthAlign = Fn(([dir, ref]: [Node<'vec3'>, Node<'vec3'>]) =>
    max(dot(dir.xz, ref.xz).div(max(length(dir.xz).mul(length(ref.xz)), 0.0001)), 0),
  );
  // Above the deck the far cloud sea meets a bright haze rather than a flat
  // white: the horizon keeps the day's hue and its warmth toward the sun, so
  // the sun stands out against it and the sea's far edge still meets the sky.
  const airTint = Fn(([dir]: [Node<'vec3'>]) => {
    const align = pow(azimuthAlign(dir, u.uSunDir), 5);
    const base = mix(u.uHorizon, u.uHorizonWarm, align);
    const haze = mix(
      mix(u.uHorizon, u.uCloudWhite, 0.4),
      mix(u.uHorizonWarm, u.uGlow, u.uLowSun.mul(0.7)),
      align,
    );
    // Light scattered forward in the air: toward the sun the haze is brighter
    // and warmer, at noon as at dusk. Only the low sun had any of it, so by day
    // the air was one colour on every side and the sun was nowhere in it.
    const s = max(dot(dir, u.uSunDir), 0);
    const scatter = pow(s, 6)
      .mul(LOOK.daylight.scatter.broad)
      .add(pow(s, 28).mul(LOOK.daylight.scatter.tight))
      .mul(smoothstep(-0.02, 0.1, u.uSunDir.y));
    const sunCol = mix(u.uSunColor, u.uGlow, u.uLowSun.mul(0.6));
    return mix(base, haze, u.uAbove).add(sunCol.mul(scatter));
  });
  /** The horizon a direction ends on: the air's, gone white as far as the cloud round the camera lies that way. */
  const horizonTint = Fn(([dir]: [Node<'vec3'>]) =>
    mix(airTint(dir), u.uCloudWhite, whiteAlong(dir, float(1e5))),
  );
  return { azimuthAlign, airTint, horizonTint, whiteAlong };
}
export type Horizon = ReturnType<typeof createHorizon>;

/** Distance fog in the horizon color, a height fog that becomes the cloud sea from above, and the whiteout. */
export function installFog(scene: Scene, u: SkyUniforms, horizon: Horizon): void {
  const distance = length(positionWorld.sub(cameraPosition));
  const distF = densityFogFactor(u.uFogDensity.mul(u.uAir)).mul(
    mix(1, 0.55, smoothstep(100, 1000, positionWorld.y)),
  );
  const lowAir = distance
    .div(120)
    .clamp(0, 1)
    .mul(0.055)
    .mul(float(1).sub(smoothstep(200, 800, positionWorld.y)));
  // Gentle local air; only the far streamed edge needs complete cover. That
  // edge is the terrain's own -- the window ends 4.2 km from the flyer, a square
  // with the dome behind it -- and the cover hides it and nothing else. It began
  // at 2600 m, the scenery ring's edge, which the trees fade at by themselves,
  // and the owner read it as a wall of haze behind the land.
  const farCover = smoothstep(3600, 4200, distance);
  const air = float(1).sub(float(1).sub(distF).mul(float(1).sub(lowAir)).mul(float(1).sub(farCover)));
  // The typings leave the height fog factor untyped; it is a float. It is the
  // cloud sea's own fog, so it lies only where the deck has cloud -- over a gap
  // between the banks the ground is seen through the air and nothing else --
  // and only where the sea is drawn over it (`seaSeenAt`): from under the
  // sea's level a bank is the clusters' and the dome's, not a haze on the ground.
  const worldXZ = positionWorld.xz.add(u.uWorldOrigin);
  // It rises to the region's deck rather than one height for the world: to the
  // top of its thinnest bank, from the base, which moves only from one region
  // to the next. Read off each bank's own top it moved with every bank, and at
  // a grazing look from high up that was a curtain of streaks over the ground.
  const seaF = (
    exponentialHeightFogFactor(float(0.0000085), deckBaseAt(u, worldXZ).add(DECK.thin - 30)) as Node<'float'>
  )
    .mul(seaSeenAt(u, worldXZ))
    .mul(cloudBankAt(u, worldXZ))
    .mul(u.uSeaFog)
    .mul(u.uShowSeaFog);
  const view = normalize(positionWorld.sub(cameraPosition));
  const inCloud = horizon.whiteAlong(view, distance);
  const factor = max(max(air, seaF), inCloud);
  // The colour is the cloud's as much as the cloud is what fogs the point: the
  // ray's walk is paid once a fragment, not again for the colour.
  scene.fogNode = fog(mix(horizon.airTint(view), u.uCloudWhite, inCloud.div(max(factor, 0.0001))), factor);
}
