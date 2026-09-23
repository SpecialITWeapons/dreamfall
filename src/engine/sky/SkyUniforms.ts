// Every uniform the sky, the fog, the lights, the water and the clouds share.
// One directional horizon owns both the sky boundary and every fogged
// surface, so all of them read these and nothing else.
import {
  Color,
  DataTexture,
  LinearFilter,
  RedFormat,
  RepeatWrapping,
  UnsignedByteType,
  Vector2,
  Vector3,
} from 'three';
import { uniform } from 'three/tsl';
import type { Look } from '../render/ColorGrade';
import { DECK_Y } from '../terrain/WorldSampler';
import type { CloudCover } from './CloudCover';

export function createSkyUniforms(look: Look, cover: CloudCover) {
  const cloudWhite = new Color(look.cloud.white);
  // The deck's one field, as the GPU reads it: every layer of the deck samples
  // this (`cloudCoverAt`), the CPU reads the same bytes (`cover.at`).
  const cloudCover = new DataTexture(cover.data, cover.texels, cover.texels, RedFormat, UnsignedByteType);
  cloudCover.wrapS = cloudCover.wrapT = RepeatWrapping;
  cloudCover.magFilter = cloudCover.minFilter = LinearFilter;
  cloudCover.generateMipmaps = false;
  cloudCover.needsUpdate = true;
  return {
    /** Shader motion follows simulation time, including pause and hidden tabs. */
    time: uniform(0),
    uZenith: uniform(new Color(0)),
    uUpper: uniform(new Color(0)),
    uHorizon: uniform(new Color(0)),
    uHorizonWarm: uniform(new Color(0)),
    uUpperWarm: uniform(new Color(0)),
    uSunColor: uniform(new Color(0)),
    /** The true sun, even below the horizon. */
    uSunDir: uniform(new Vector3(0, 1, 0)),
    uMoonDir: uniform(new Vector3(0, 1, 0)),
    /** The moon is above the horizon. */
    uMoonUp: uniform(0),
    /** Moonlight strength: night, moon up. */
    uMoonLight: uniform(0),
    uNight: uniform(0),
    /** The sun sits on the horizon. */
    uLowSun: uniform(0),
    /** The sun-side horizon band. */
    uGlow: uniform(new Color(0)),
    uGlowI: uniform(0),
    /** The rose belt opposite a low sun. */
    uVenusI: uniform(0),
    uFogDensity: uniform(look.fogDensity),
    /** 1 when the camera is above the cloud deck. */
    uAbove: uniform(0),
    /** 1 while crossing the deck. */
    uWhiteout: uniform(0),
    uDeck: uniform(DECK_Y),
    uCloudWhite: uniform(cloudWhite.clone()),
    uCloudBodies: uniform(0),
    /** World position of the local frame's origin (the floating origin), for shaders that read the world. */
    uWorldOrigin: uniform(new Vector2(0, 0)),
    /** The world's wind, m/s; every cloud layer drifts with it. */
    uWind: uniform(new Vector2(0, 0)),
    /** Where the deck has cloud, 0..1, repeating every `uCoverPeriod` metres (sky/CloudCover.ts). */
    cloudCover,
    uCoverPeriod: uniform(cover.period),
    cloudWhite,
    moonColor: new Color(look.moon.color),
    fogDensity: look.fogDensity,
  };
}
export type SkyUniforms = ReturnType<typeof createSkyUniforms>;
