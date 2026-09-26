// The sky: a painted gradient keyed by time of day, dawn and dusk bands, a
// sun, a moon with its own face, hashed stars and painted clouds. The dome
// only ever reads a direction, so its radius is free; it sits beyond the far
// corner of the streamed terrain and draws last among the opaque objects, so
// the depth test throws away every fragment the world already covers. The
// Milky Way plugs in through `galaxy`; `MilkyWay.ts` is what fills it.
// Ported from fly-with-me.
import { BackSide, Mesh, SphereGeometry, type Vector3 } from 'three';
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import {
  Fn,
  abs,
  acos,
  cameraPosition,
  clamp,
  cross,
  dot,
  exp,
  float,
  fract,
  fwidth,
  hash,
  length,
  max,
  mix,
  mx_noise_float,
  normalize,
  positionWorld,
  pow,
  select,
  sign,
  sin,
  smoothstep,
  sqrt,
  step,
  vec2,
  vec3,
} from 'three/tsl';
import { LOOK } from '../render/ColorGrade';
import { cloudCoverAt, deckBaseAt } from './CloudShadow';
import type { Horizon } from './Fog';
import type { SkyUniforms } from './SkyUniforms';

const VENUS = vec3(0.86, 0.46, 0.52);
const SPARSE_STAR_AXIS = normalize(vec3(0.36, 0.5, -0.79));
export const SKY_RADIUS = 12_000;
/** Units of the sky projection per meter the wind carries the field. */
export const CLOUD_DRIFT = 0.0012;
/**
 * The deck's underside as the dome paints it, m along the ray: its banks read
 * whole out to `near[0]` and close up by `near[1]` -- seen that flat, the gaps
 * between banks hide behind the banks in front of them, and a texel of the
 * field is smaller than a pixel and would only shimmer -- and the air takes
 * them into the horizon between `far[0]` and `far[1]`. How solid they close,
 * how opaque they are and how mottled are the dev panel's (`SKY_LOOK`).
 *
 * The mottle is two slow noises carried with the wind, `mottle` metres to a
 * feature: a belly is lighter or darker by up to `shade` of itself, and where
 * the noise is low the bank thins by up to `thin`, so far off, where the field
 * has closed, the underside still has holes and weather in it.
 */
export const DECK_UNDERSIDE = {
  near: [4000, 11000],
  far: [3000, 15000],
  /** The height over the horizon, as the view's y, under which the deck thins away. */
  horizon: 0.26,
  mottle: [900, 260] as const,
  shade: 0.35,
  thin: 1.6,
} as const;

/**
 * Where the dome cuts the high layer's field, as the field's value: `cut[0]`
 * over a clear sky, `cut[1]` at the most cover the weather brings
 * (`uHighCover`, sky/HighCloud.ts). The field is noise of a few tenths either
 * side of zero; it was cut at -0.14 by day, which put some cloud over four
 * fifths of the sky and a solid half of it. `soft` is how far past the cut a
 * cloud goes solid.
 */
export const HIGH_CLOUD_SKY = { cut: [0.46, 0.12] as const, soft: 0.24 };

/** The high layer's cut and whether it is there at all, for the dome and the water's reflection of it. */
export function highCloudBand(u: SkyUniforms) {
  return {
    cut: mix(HIGH_CLOUD_SKY.cut[0], HIGH_CLOUD_SKY.cut[1], u.uHighCover),
    /** 0 over a clear sky and while the layer is switched off: nothing of it is drawn, not even an edge. */
    present: smoothstep(0, 0.05, u.uHighCover).mul(u.uShowHigh),
  };
}

export function createSkyDome(
  u: SkyUniforms,
  horizon: Horizon,
  opts: { galaxy?: (dir: Node<'vec3'>) => Node<'vec3'> } = {},
) {
  const galaxy = opts.galaxy ?? (() => vec3(0));
  // Shared by the dome and (in M5) the star catalog: clouds occlude all celestial detail once, with the same shape.
  // Returns the field over its cut (0 is the cloud's outer edge) and how much cloud a direction shows.
  const high = highCloudBand(u);
  const paintedClouds = Fn(([dir]: [Node<'vec3'>]) => {
    const p0 = dir.xz.div(dir.y.max(0.025).add(0.19)).mul(vec2(2.8, 6));
    // The wind carries the field across the sky; a slow warp boils the shapes
    // as they go, and the finer octave drifts at its own pace, so nothing
    // merely slides.
    const drift = u.uWind.mul(u.time).mul(CLOUD_DRIFT);
    const p = p0.sub(drift).add(mx_noise_float(p0.mul(0.5).add(u.time.mul(0.02))).mul(0.15));
    const mass = mx_noise_float(p.mul(0.3).add(vec2(3, 12)))
      .mul(0.28)
      .add(mx_noise_float(p).mul(0.6))
      .add(mx_noise_float(p.mul(2.1).add(8).sub(drift.mul(0.35))).mul(0.3))
      .add(mx_noise_float(p.mul(5.8)).mul(0.16))
      .add(mx_noise_float(p.mul(15)).mul(0.06));
    // The night ceiling opens into clear windows, while the low cloud banks keep their opacity.
    const opening = smoothstep(0.045, 0.22, dir.y).mul(u.uNight).mul(0.35);
    const rel = mass.sub(high.cut).sub(opening);
    const mask = smoothstep(0, u.uNight.mul(0.06).add(HIGH_CLOUD_SKY.soft), rel)
      .mul(high.present)
      // Thinning over the lowest fifteen degrees: ending closer in, the layer
      // and the deck under it ruled a line along the horizon.
      .mul(smoothstep(0.0, 0.26, dir.y));
    return vec2(rel, mask);
  });
  const celestialVisibility = Fn(([dir]: [Node<'vec3'>]) =>
    u.uNight
      .mul(float(1).sub(u.uMoonLight.mul(0.45)))
      .mul(smoothstep(0.0, 0.15, dir.y))
      .mul(float(1).sub(u.uWhiteout)),
  );
  // Sparse hashed stars: one cell grid per layer, brightness and tint per star.
  const starField = Fn(([dir, scale, threshold]: [Node<'vec3'>, Node<'float'>, Node<'float'>]) => {
    const sc = dir.mul(scale);
    const cellId = sc.floor(),
      cf = fract(sc);
    const seedA = dot(cellId, vec3(1.0, 57.0, 113.0));
    const center = vec3(hash(seedA), hash(seedA.add(11.0)), hash(seedA.add(29.0)));
    const dd = length(cf.sub(center));
    const isStar = step(threshold, hash(seedA.add(3.0)));
    const bright = hash(seedA.add(17.0));
    const dotv = smoothstep(0.2, 0.02, dd)
      .mul(isStar)
      .mul(mix(0.45, 1.7, bright.mul(bright)));
    const twinkle = sin(u.time.mul(1.3).add(hash(seedA.add(5.0)).mul(40.0)))
      .mul(0.3)
      .add(0.7);
    const tint = mix(vec3(0.76, 0.83, 1.0), vec3(1.0, 0.9, 0.78), hash(seedA.add(41.0)));
    return tint.mul(dotv).mul(twinkle);
  });
  const skyColor = Fn(([dir]: [Node<'vec3'>]) => {
    const y = dir.y;
    const sunUp = smoothstep(-0.14, 0.02, u.uSunDir.y);
    const s = max(dot(dir, u.uSunDir), 0.0).mul(sunUp);
    const align = horizon.azimuthAlign(dir, u.uSunDir);
    const anti = horizon.azimuthAlign(dir, u.uSunDir.negate());
    const horizonColor = horizon.horizonTint(dir);
    // sun-side warmth climbs higher the closer to the sun's azimuth
    const warmUpper = mix(u.uUpper, u.uUpperWarm, pow(align, 3.5).mul(0.8).add(pow(s, 5).mul(0.2)));
    const skyUp = mix(warmUpper, u.uZenith, smoothstep(0.1, 0.85, y));
    const aboveH = mix(horizonColor, skyUp, smoothstep(0.0, 0.4, y));
    // Under the horizon the dome is only ever seen past the edge of the terrain
    // window, where the fog has already covered the ground whole, so it is the
    // fog's colour and nothing else. It was a colour of its own a quarter of the
    // way down, which nobody saw while a cloud sea covered the whole world; with
    // gaps in the sea, from over the deck, the window's edge stood out as a pale
    // square on it.
    const col = select(y.greaterThan(0.0), aboveH, horizonColor).toVar();
    // dawn and dusk: a thin saturated band along the sun-side horizon
    const band = pow(align, 3)
      .mul(exp(abs(y).div(0.07).negate()))
      .mul(u.uGlowI);
    col.assign(mix(col, u.uGlow, band.mul(0.8)));
    // the belt of Venus: a rose band opposite a low sun, over the earth's blue shadow
    const venusShape = exp(y.sub(0.07).div(0.06).pow(2).negate());
    const venus = pow(anti, 2).mul(venusShape).mul(u.uVenusI);
    col.assign(mix(col, VENUS, venus.mul(0.35)));
    const earthShadow = pow(anti, 2)
      .mul(smoothstep(0.06, 0.0, y))
      .mul(smoothstep(-0.05, 0.01, y))
      .mul(u.uVenusI);
    col.assign(mix(col, col.mul(vec3(0.78, 0.84, 1.0)), earthShadow.mul(0.5)));
    // the sun: a disc, a tight glow, a bright aureole by day and a broad warm
    // halo when it sits low
    const ang = acos(clamp(s, 0.0, 1.0));
    const disc = smoothstep(0.03, 0.024, ang);
    const sunCol = mix(u.uSunColor, u.uGlow, u.uLowSun.mul(0.6));
    const glow = pow(s, 30)
      .mul(0.12)
      .add(pow(s, 500).mul(mix(0.6, 1.4, u.uDaylight)))
      .add(pow(s, 4).mul(u.uLowSun).mul(0.35))
      .add(pow(s, 12).mul(u.uDaylight).mul(0.16));
    // By day the disc is far over white, so the bloom spreads it into a glare
    // rather than leaving a pale coin on the blue.
    const discI = mix(1.2, 0.8, u.uLowSun).mul(mix(1, LOOK.daylight.disc, u.uDaylight));
    col.addAssign(sunCol.mul(glow.add(disc.mul(discI))).mul(smoothstep(-0.02, 0.0, y)));
    // the moon: a lit gibbous face with maria and limb darkening, a soft halo
    const m = max(dot(dir, u.uMoonDir), 0.0);
    const moonRight = normalize(cross(u.uMoonDir, vec3(0, 1, 0)));
    const moonUpV = cross(moonRight, u.uMoonDir);
    const MOON_R = 0.025;
    const mu = dot(dir, moonRight).div(MOON_R),
      mv = dot(dir, moonUpV).div(MOON_R);
    const rr = length(vec2(mu, mv));
    const discM = smoothstep(1.0, 0.9, rr).mul(step(0.0, m));
    const maria = mx_noise_float(vec2(mu, mv).mul(2.2).add(vec2(5.3, 1.7)))
      .mul(0.5)
      .add(mx_noise_float(vec2(mu, mv).mul(5.5).add(vec2(9.0, 3.0))).mul(0.3));
    const albedo = float(1).sub(smoothstep(0.05, 0.45, maria).mul(0.32));
    const limb = float(1).sub(rr.mul(rr).mul(0.25));
    const chord = sqrt(max(float(1).sub(mv.mul(mv)), 0.0001));
    const litSide = sign(dot(u.uSunDir, moonRight).add(0.0001));
    const lit = smoothstep(-0.8, -0.55, mu.mul(litSide).div(chord));
    const moonSurface = albedo.mul(limb).mul(mix(0.06, 1.0, lit));
    const moonNight = vec3(0.98, 0.97, 0.92).mul(moonSurface).mul(1.35);
    const moonDay = col
      .mul(1.12)
      .add(vec3(0.05))
      .mul(mix(0.55, 1.0, moonSurface));
    col.assign(mix(col, mix(moonDay, moonNight, u.uNight), discM.mul(u.uMoonUp)));
    const halo = pow(m, 250).mul(0.35).add(pow(m, 30).mul(0.06));
    col.addAssign(vec3(0.75, 0.8, 0.95).mul(halo).mul(u.uNight).mul(u.uMoonUp).mul(float(1).sub(discM)));
    // painted clouds: their mass and mask come first so stars can hide behind them
    const cloud = paintedClouds(dir),
      rel = cloud.x,
      mask = cloud.y;
    // stars (and the Milky Way when plugged in), only at night, fading into the horizon haze
    const sparseBand = exp(dot(dir, SPARSE_STAR_AXIS).div(0.15).pow(2).negate());
    const stars = starField(dir, float(90.0), float(0.955))
      .add(starField(dir, float(200.0), float(0.975).sub(sparseBand.mul(0.05))).mul(0.5))
      .add(galaxy(dir));
    col.addAssign(stars.mul(celestialVisibility(dir)));
    // clouds: lit toward the sun, on fire at sunset, blushing opposite it, moonlit at night
    const shade = mix(u.uUpper.mul(0.85), horizonColor, 0.28);
    const light = mix(u.uCloudWhite, sunCol, pow(s, 4).mul(0.75)).toVar();
    light.assign(mix(light, u.uGlow, u.uLowSun.mul(pow(align, 1.5)).mul(0.7)));
    light.assign(mix(light, mix(light, VENUS, 0.5), u.uVenusI.mul(pow(anti, 1.5)).mul(0.6)));
    light.addAssign(vec3(0.5, 0.55, 0.7).mul(pow(m, 6)).mul(u.uMoonLight).mul(0.35));
    const sunlit = light.mul(mix(1, LOOK.daylight.cloudSun, u.uDaylight));
    col.assign(mix(col, mix(sunlit, shade, smoothstep(0.16, 0.5, rel)), mask.mul(mix(0.6, 0.94, u.uNight))));
    // The deck from under it. The painted clouds above are a layer of their
    // own and higher; the deck is the one field the sea, its fog, the puffs and
    // the shadows read, so a flyer under it sees the banks and the gaps it will
    // look down on once it has climbed through -- in parallax, because this is
    // where the view ray meets the sea's own plane and not a direction.
    // The deck's base is a region's and tilts no more than a fifth, so the ray
    // meets it where it meets the plane of the base under the camera, moved
    // once to the plane of the base at that first guess.
    const eye = cameraPosition.xz.add(u.uWorldOrigin);
    const guess = eye.add(dir.xz.mul(deckBaseAt(u, eye).sub(cameraPosition.y).div(y.max(0.0005))));
    const rise = deckBaseAt(u, guess).sub(cameraPosition.y);
    const along = rise.div(y.max(0.0005));
    const hit = eye.add(dir.xz.mul(along));
    // The field is 80 m a texel and its banks a kilometre across, which from
    // under them is a soft stain; a finer noise carried with them rags their
    // edges and breaks up their bellies, and a narrower edge than the sea's
    // makes them read as cloud rather than as haze.
    const closing = smoothstep(DECK_UNDERSIDE.near[0], DECK_UNDERSIDE.near[1], along);
    const drift = hit.sub(u.uWind.mul(u.time));
    const rag = mx_noise_float(drift.mul(0.006))
      .mul(0.35)
      .add(mx_noise_float(drift.mul(0.019)).mul(0.15));
    // The mottle: kilometre patches and a finer grain in them, the grain let go
    // once a pixel spans a good part of it, or the far lid shimmers.
    const grain = drift.div(DECK_UNDERSIDE.mottle[1]);
    const grainSeen = float(1).sub(smoothstep(0.35, 1.2, length(fwidth(grain))));
    const blotch = mx_noise_float(drift.div(DECK_UNDERSIDE.mottle[0]))
      .mul(0.65)
      .add(mx_noise_float(grain).mul(0.35).mul(grainSeen))
      .mul(u.uUndersideMottle);
    const bank = mix(
      smoothstep(0.3, 0.55, cloudCoverAt(u, hit).add(rag.mul(float(1).sub(closing)))),
      u.uUndersideClosed,
      closing,
    )
      .mul(float(1).sub(max(blotch.negate(), 0).mul(DECK_UNDERSIDE.thin)).clamp(0, 1))
      .mul(step(0.0, rise))
      .mul(u.uShowUnderside)
      // Thinning into the air over the last few degrees above the horizon
      // rather than ending on it: cut at the horizon, the deck was a ruled
      // line with the whole ceiling above it and clear sky below.
      .mul(smoothstep(0.0, DECK_UNDERSIDE.horizon, y));
    // Flat grey bellies, lighter where a bank thins to its edge, and the air in
    // front of them as they go further off. A belly is the cloud's own white in
    // its own shadow: the sky's blue in it read as haze rather than as cloud.
    // The mottle lightens and darkens it, so a closed deck far off is weather
    // and not one grey.
    const belly = mix(
      light,
      mix(u.uCloudWhite.mul(0.74), horizonColor, 0.2),
      smoothstep(0.25, 0.9, bank),
    ).mul(blotch.mul(DECK_UNDERSIDE.shade).add(1));
    col.assign(
      mix(
        col,
        mix(belly, horizonColor, smoothstep(DECK_UNDERSIDE.far[0], DECK_UNDERSIDE.far[1], along)),
        bank.mul(u.uUnderside),
      ),
    );
    // The sun behind a bank still shows: a bright place in the cloud, strongest
    // where it thins, so an overcast sky has a sun in it and not a grey lid.
    const behind = pow(s, 8)
      .mul(0.3)
      .add(pow(s, 90).mul(1.1))
      .mul(float(1).sub(smoothstep(0.5, 1, bank).mul(0.55)));
    col.addAssign(sunCol.mul(behind).mul(bank).mul(u.uUnderside).mul(float(1).sub(u.uWhiteout)));
    const edge = smoothstep(-0.04, 0.22, rel)
      .mul(float(1).sub(smoothstep(0.22, 0.38, rel)))
      .mul(high.present);
    col.addAssign(
      sunCol
        .mul(edge)
        .mul(pow(s, 15))
        .mul(0.7)
        .mul(smoothstep(0.025, 0.12, y)),
    );
    // Inside a cloud there is no sky: the dome is the cloud's white, whatever
    // way the camera turns. Only the horizon went white before, so looking up
    // out of a cloud showed a clear blue sky with painted clouds on it. Near a
    // bank's top the way up is a short one, and the blue comes through it.
    col.assign(mix(col, horizonColor, horizon.whiteAlong(dir, float(1e5))));
    return col;
  });
  const material = new MeshBasicNodeMaterial();
  material.side = BackSide;
  material.depthWrite = false;
  material.fog = false;
  material.colorNode = skyColor(normalize(positionWorld.sub(cameraPosition)));
  const mesh = new Mesh(new SphereGeometry(SKY_RADIUS, 48, 24), material);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  return {
    mesh,
    paintedClouds,
    celestialVisibility,
    /** The dome rides on the camera, so its far corner is always beyond the streamed terrain. */
    follow(cameraLocal: Vector3) {
      mesh.position.copy(cameraLocal);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
export type SkyDome = ReturnType<typeof createSkyDome>;
