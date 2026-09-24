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
  // The deck's base, which stays where it is while the cover drifts: the GPU's
  // `deckBaseAt` and the CPU's `cover.baseAt` read these same bytes.
  const deckBase = new DataTexture(cover.base, cover.texels, cover.texels, RedFormat, UnsignedByteType);
  deckBase.wrapS = deckBase.wrapT = RepeatWrapping;
  deckBase.magFilter = deckBase.minFilter = LinearFilter;
  deckBase.generateMipmaps = false;
  deckBase.needsUpdate = true;
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
    /** The sun stands well clear of the horizon: a clear day's light, 0..1. */
    uDaylight: uniform(0),
    /** The sun-side horizon band. */
    uGlow: uniform(new Color(0)),
    uGlowI: uniform(0),
    /** The rose belt opposite a low sun. */
    uVenusI: uniform(0),
    uFogDensity: uniform(look.fogDensity),
    /** 1 when the camera is above the cloud deck's top where it flies. */
    uAbove: uniform(0),
    /** 1 while crossing the deck. */
    uWhiteout: uniform(0),
    uCloudWhite: uniform(cloudWhite.clone()),
    uCloudBodies: uniform(0),
    /** How much of the high layer there is, 0..1 (sky/HighCloud.ts): weather, moved by the CPU. */
    uHighCover: uniform(0),
    /**
     * Layer switches over shader terms rather than objects, 1 on and 0 off: the
     * high layer, the cloud sea's fog over the ground, and the deck's underside
     * on the dome. Only the dev panel writes them (render/Layers.ts `uniformGate`).
     */
    uShowHigh: uniform(1),
    uShowSeaFog: uniform(1),
    uShowUnderside: uniform(1),
    /** World position of the local frame's origin (the floating origin), for shaders that read the world. */
    uWorldOrigin: uniform(new Vector2(0, 0)),
    /** The world's wind, m/s; every cloud layer drifts with it. */
    uWind: uniform(new Vector2(0, 0)),
    /** Where the deck has cloud, 0..1, repeating every `uCoverPeriod` metres (sky/CloudCover.ts). */
    cloudCover,
    uCoverPeriod: uniform(cover.period),
    /** The deck's base over the same square, 0..1 of `DECK.base` (sky/CloudCover.ts). */
    deckBase,
    cloudWhite,
    moonColor: new Color(look.moon.color),
    fogDensity: look.fogDensity,
  };
}
export type SkyUniforms = ReturnType<typeof createSkyUniforms>;
