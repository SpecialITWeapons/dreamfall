// Day cycle and atmosphere per frame: the clock has been advanced by the
// simulation; the palette is read, the sky bodies are placed, every shared
// uniform is written, the one directional light becomes the sun or the moon,
// and the cloud sea, whiteout and exposure follow the camera's altitude
// relative to the deck where the camera is -- its base and its top, which
// differ from one region to the next.
import { Vector3 } from 'three';
import { LOOK } from '../render/ColorGrade';
import { sstep } from '../terrain/noise';
import type { DayClock } from '../time/DayClock';
import type { DeckAt } from './CloudCover';
import type { Lights } from './Lights';
import type { SkyUniforms } from './SkyUniforms';

export function createAtmosphere(deps: { clock: DayClock; uniforms: SkyUniforms; lights: Lights }) {
  const { clock, uniforms: u, lights } = deps;
  const sunDir = new Vector3(),
    moonDir = new Vector3();
  let night = 0,
    above = 0,
    glare = 0,
    exposure = LOOK.exposure;
  return {
    sunDir,
    moonDir,
    get night() {
      return night;
    },
    get above() {
      return above;
    },
    /** Tone-mapping exposure for this frame: the eye stops down at night and over the bright sea. */
    get exposure() {
      return exposure;
    },
    /** How far the eye has stopped down against the sun, 0..1. */
    get glare() {
      return glare;
    },
    /**
     * `deck` is where the deck stands over the camera (`deckAt`); `cluster` is
     * how far the camera is inside one of the near clouds (`Clouds.inside`);
     * `look` is the way the camera faces, and the eye follows it over `dt`
     * seconds (`dt <= 0` is there now).
     */
    update(cameraY: number, follow: Vector3, deck: DeckAt, cluster = 0, look?: Vector3, dt = 0) {
      const pal = clock.palette;
      clock.skyBodies(clock.phase, sunDir, moonDir);
      const sy = sunDir.y;
      night = sstep(-0.02, -0.2, sy);
      const sunUp = sstep(-0.025, 0.06, sy);
      const moonAbove = sstep(-0.02, 0.12, moonDir.y);
      const moonLight = sstep(-0.09, -0.2, sy) * moonAbove;
      u.uNight.value = night;
      u.uSunDir.value.copy(sunDir);
      u.uMoonDir.value.copy(moonDir);
      u.uMoonUp.value = moonAbove;
      u.uMoonLight.value = moonLight;
      u.uLowSun.value = Math.exp(-((sy / 0.14) ** 2));
      u.uDaylight.value = sstep(0.06, 0.3, sy);
      u.uGlowI.value = sstep(-0.22, -0.04, sy) * (1 - sstep(0.12, 0.32, sy));
      u.uVenusI.value = Math.exp(-(((sy + 0.03) / 0.09) ** 2));
      u.uZenith.value.copy(pal.zenith);
      u.uUpper.value.copy(pal.upper);
      u.uHorizon.value.copy(pal.horizon);
      u.uHorizonWarm.value.copy(pal.horizonWarm);
      u.uUpperWarm.value.copy(pal.upperWarm);
      u.uGlow.value.copy(pal.glow);
      u.uCloudWhite.value
        .copy(u.cloudWhite)
        .lerp(pal.glow, u.uLowSun.value * 0.45)
        .lerp(pal.horizon, night * 0.97);
      u.uSunColor.value.copy(pal.sun);
      lights.update({ palette: pal, sunDir, moonDir, sunUp, moonLight, follow });
      // The sea is the deck's top seen from over it, so "above" is read against
      // the top; the puffs hang from its base, so they are read against that.
      const rel = cameraY - deck.top;
      above = sstep(-90, 30, rel);
      u.uAbove.value = above;
      // Looking into a high sun the eye stops down, so the land goes a little
      // darker under the glare; it opens again as slowly as an eye does.
      const into = look ? sstep(0.5, 0.95, look.dot(sunDir)) * u.uDaylight.value : 0;
      glare = dt > 0 ? glare + (into - glare) * Math.min(1, dt * LOOK.daylight.glare.rate) : into;
      exposure =
        LOOK.exposure *
        (1 + (LOOK.daylight.exposure - 1) * u.uDaylight.value) *
        (1 - 0.25 * night) *
        (1 - 0.12 * above) *
        (1 - LOOK.daylight.glare.stop * glare);
      u.uFogDensity.value = u.fogDensity * (1 - 0.28 * sstep(0.1, 0.65, sy)) * (1 + 0.35 * night);
      // The clusters are seen from well under the deck, because their flat
      // bases are what a cumulus is known by from below; further down the
      // dome's painting of the underside has them.
      u.uCloudBodies.value = sstep(-800, -400, cameraY - deck.base);
      // Inside the deck is white only where the deck has cloud: the band is the
      // deck from its base to its top, the cloud is the field's over the camera.
      // It was the band alone, so a climb through a clear sky met a wall of fog
      // and came out over the deck into a white haze on every side.
      const inside =
        sstep(deck.base - 40, deck.base + 30, cameraY) * (1 - sstep(deck.top - 70, deck.top, cameraY));
      // A cluster flown into is white too, wherever it stands: a tower over
      // the bank, or a cloud met at its edge, is not in the band. The two are
      // handed over apart, with the bank's floor and ceiling, because a ray
      // leaves a bank by them: the white of a bank is how much of it lies along
      // the ray (`whiteAlong`), not one veil over everything the camera sees.
      u.uBandWhite.value = inside * 0.996;
      u.uClusterWhite.value = cluster * 0.996;
      u.uBandBase.value = deck.base;
      u.uBandTop.value = deck.top;
      u.uWhiteout.value = Math.max(u.uBandWhite.value * deck.bank, u.uClusterWhite.value);
    },
  };
}
export type Atmosphere = ReturnType<typeof createAtmosphere>;
