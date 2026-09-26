// Approved jade water: one opaque draw on the engine's bounded grid. The CPU
// heightfield owns the shore. No reflection camera, depth pass, new textures
// or CPU animation; the rough sky uses the world's own day palette. Ported
// from fly-with-me's water.js; world-space patterns add the floating origin.
//
// The sheet wears two looks, a lake's and the sea's (`WaterLook.ts`), mixed by
// how much deep water lies round each vertex: sixteen taps of the window in
// the vertex stage, because the grid is 64 m and the field it reads is
// hundreds of metres wide, so a fragment would pay sixteen reads for nothing.
import { Color, Mesh, Vector2 } from 'three';
import type { Node } from 'three/webgpu';
import {
  Fn,
  cameraPosition,
  clamp,
  dot,
  float,
  fract,
  fwidth,
  length,
  max,
  mix,
  mx_noise_float,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  step,
  transformNormalToView,
  uniform,
  varying,
  vec2,
  vec3,
} from 'three/tsl';
import { LOOK, adjustColor } from '../render/ColorGrade';
import type { LitMaterial } from '../render/SoftLighting';
import { CLOUD_SHADOW, createCloudShadow } from '../sky/CloudShadow';
import type { Horizon } from '../sky/Fog';
import { CLOUD_DRIFT, HIGH_CLOUD_SKY, highCloudBand } from '../sky/SkyDome';
import type { SkyUniforms } from '../sky/SkyUniforms';
import type { Heightfield } from '../terrain/Heightfield';
import {
  WATER_CELL,
  WATER_CELLS,
  buildGrid,
  type LoadCell,
  type TerrainPalette,
} from '../terrain/TerrainMesh';
import { CELL, SEA_LEVEL } from '../terrain/WorldSampler';
import {
  OPENNESS,
  OPENNESS_TAPS,
  WATER_COLORS,
  WATER_LOOK,
  opennessOf,
  reachAt,
  waterLookStart,
  type WaterColors,
  type WaterLook,
} from './WaterLook';

const floatUniform = (value: number) => uniform(value);
type FloatUniform = ReturnType<typeof floatUniform>;
const colorUniform = (value: Color) => uniform(value);
type ColorUniform = ReturnType<typeof colorUniform>;
/** A water colour as the GPU takes it: graded as the ground's are. */
const graded = (hex: number) => adjustColor(new Color(hex), LOOK.terrain, 1);

export function createWater(deps: {
  uniforms: SkyUniforms;
  horizon: Horizon;
  litMaterial: LitMaterial;
  palette: TerrainPalette;
  loadCell: LoadCell;
  /** The window the taps read: where it stands and how wide it is, so no tap reads round the torus. */
  heightfield: Pick<Heightfield, 'center' | 'size' | 'heightAt'>;
}) {
  const { uniforms: u, horizon, litMaterial, palette, loadCell, heightfield: hf } = deps;
  const form = waterLookStart();
  const look = Object.fromEntries(
    (Object.keys(WATER_LOOK) as Array<keyof WaterLook>).map((key) => [key, floatUniform(form[key])]),
  ) as Record<keyof WaterLook, FloatUniform>;
  const colors: WaterColors = { ...WATER_COLORS };
  const tint = Object.fromEntries(
    (Object.keys(WATER_COLORS) as Array<keyof WaterColors>).map((key) => [
      key,
      colorUniform(graded(colors[key])),
    ]),
  ) as Record<keyof WaterColors, ColorUniform>;
  const uAnchor = uniform(new Vector2(0, 0));
  /** The window's centre, in cells. */
  const uWindow = uniform(new Vector2(0, 0));
  const worldVertex = positionLocal.xz.add(uAnchor);
  const wave = sin(worldVertex.x.mul(0.021).add(u.time.mul(0.55)))
    .mul(0.7)
    .add(sin(worldVertex.y.mul(0.017).sub(u.time.mul(0.42))).mul(0.6))
    .add(sin(worldVertex.x.add(worldVertex.y).mul(0.009).add(u.time.mul(0.3))).mul(0.5));
  const view = normalize(cameraPosition.sub(positionWorld));
  const p = positionWorld.xz.add(u.uWorldOrigin);

  // `reachAt` in nodes: the mean depth of the taps, each read from the nearest
  // texel and held inside the window -- the texture wraps, and a tap past the
  // edge would read the other side of it.
  const half = hf.size / 2;
  const lowCell = uWindow.sub(half),
    highCell = uWindow.add(half - 1);
  let depthSum: Node<'float'> = float(0);
  for (const [dx, dz] of OPENNESS_TAPS) {
    const cell = clamp(worldVertex.add(vec2(dx, dz)).div(CELL).add(0.5).floor(), lowCell, highCell);
    depthSum = depthSum.add(clamp(loadCell(cell.x, cell.y).x.negate(), 0, OPENNESS.full));
  }
  const reach = depthSum.div(OPENNESS.full * OPENNESS_TAPS.length);
  // Thresholds that meet would be a smoothstep of nothing; the panel can ask for that.
  const open = varying(
    smoothstep(look.openFrom, max(look.openTo, look.openFrom.add(0.001)), reach),
    'vWaterOpen',
  );
  /** The lake's number where the water is a lake, the sea's where it is open. */
  const byOpen = (lake: Node<'float'>, sea: Node<'float'>) => mix(lake, sea, open);

  // Barycentric height on the exact terrain triangle, also at negative world
  // coordinates. Bilinear interpolation would draw a different shoreline.
  const groundAt = Fn(([pt]: [Node<'vec2'>]) => {
    const cell = pt.div(CELL),
      base = cell.floor(),
      f = fract(cell);
    const upperTriangle = step(1, f.x.add(f.y));
    const a = loadCell(base.x.add(upperTriangle), base.y.add(upperTriangle)).x;
    const b = loadCell(base.x.add(1), base.y).x;
    const c = loadCell(base.x, base.y.add(1)).x;
    return a
      .add(b.sub(a).mul(mix(f.x, float(1).sub(f.y), upperTriangle)))
      .add(c.sub(a).mul(mix(f.y, float(1).sub(f.x), upperTriangle)));
  });
  const depth = max(float(SEA_LEVEL).sub(groundAt(p)), 0);

  // Two scales of advected slopes, each filtered by its pixel footprint; a
  // lake's are gentler than the sea's.
  const ripple = byOpen(look.lakeRipple, look.seaRipple);
  const n = Fn(() => {
    const q = vec2(p.x.mul(0.94).add(p.y.mul(0.34)), p.y.mul(0.94).sub(p.x.mul(0.34))).mul(vec2(0.055, 0.19));
    const drift = vec2(u.time.mul(0.055), u.time.mul(-0.04));
    const sx = mx_noise_float(q.add(drift));
    const sz = mx_noise_float(q.mul(0.83).add(vec2(17.8, 9.2)).sub(drift));
    const visible = float(1).sub(smoothstep(0.45, 1.8, length(fwidth(q))));
    const coarseQ = p.mul(vec2(0.018, 0.026));
    const coarseVisible = float(1).sub(smoothstep(0.45, 1.8, length(fwidth(coarseQ))));
    const broadX = mx_noise_float(coarseQ.add(drift.mul(0.35)));
    const broadZ = mx_noise_float(coarseQ.mul(0.87).add(23).sub(drift.mul(0.3)));
    const slope = vec2(sx, sz)
      .mul(visible)
      .mul(0.75)
      .add(vec2(broadX, broadZ).mul(coarseVisible).mul(0.55))
      .mul(ripple.mul(0.07));
    return normalize(vec3(slope.x, 1, slope.y));
  })();

  // Rough painted reflection, not another complete sky shader per water pixel.
  const high = highCloudBand(u);
  const reflectedSky = Fn(([r]: [Node<'vec3'>]) => {
    const alignment = pow(horizon.azimuthAlign(r, u.uSunDir), 3.5);
    const warm = mix(u.uUpper, u.uUpperWarm, alignment.mul(0.8));
    const top = mix(warm, u.uZenith, smoothstep(0.1, 0.85, r.y));
    const color = mix(horizon.horizonTint(r), top, smoothstep(0, 0.4, r.y)).toVar();
    const q = r.xz.div(r.y.max(0.025).add(0.19)).mul(vec2(2.8, 6)).sub(u.uWind.mul(u.time).mul(CLOUD_DRIFT));
    const mass = mx_noise_float(q.mul(0.3).add(vec2(3, 12)))
      .mul(0.28)
      .add(mx_noise_float(q).mul(0.6));
    // The dome's high layer, cut where the dome cuts it, so the water reflects the weather the sky has.
    const cloud = smoothstep(high.cut, high.cut.add(HIGH_CLOUD_SKY.soft), mass)
      .mul(high.present)
      .mul(smoothstep(0.014, 0.15, r.y));
    color.assign(mix(color, mix(u.uUpper, horizon.horizonTint(r), 0.65), cloud.mul(0.32)));
    return color;
  });
  const reflected = normalize(n.mul(dot(n, view).mul(2)).sub(view));
  const fresnel = pow(float(1).sub(dot(n, view).max(0)), 5)
    .mul(0.75)
    .add(0.055);
  const reflection = reflectedSky(reflected);
  const halfSun = normalize(view.add(u.uSunDir));
  const halfMoon = normalize(view.add(u.uMoonDir));
  const sunlight = smoothstep(-0.015, 0.04, u.uSunDir.y);
  const glint = pow(max(dot(n, halfSun), 0), 220).mul(sunlight);
  const moonGlint = pow(max(dot(n, halfMoon), 0), 300).mul(u.uMoonLight);
  const lightColor = mix(u.uSunColor, u.uGlow, u.uLowSun.mul(0.6));

  // Shelves deepen into the deep colour, a lake's sooner than the sea's; the
  // narrow shore wash is diffuse.
  const shallow = mix(tint.lakeShallow, tint.seaShallow, open),
    deep = mix(tint.lakeDeep, tint.seaDeep, open);
  const body = mix(shallow, deep, smoothstep(0.5, byOpen(look.lakeDeepAt, look.seaDeepAt), depth));
  const shore = mix(mix(palette.sand, shallow, 0.7), body, smoothstep(0, 3, depth));
  // The wash runs out to `surfReach` and back at `surfSpeed`. Each look keeps a
  // pulse of its own and the pulses are mixed, never the speeds: a speed that
  // changed across the water would multiply the flight's clock into stripes.
  const reachOut = byOpen(look.lakeSurfReach, look.seaSurfReach);
  const along = p.x.mul(0.014).add(p.y.mul(0.018));
  const pulseOf = (speed: Node<'float'>, phase: number) => sin(u.time.mul(speed).add(along).add(phase));
  const pulse = byOpen(pulseOf(look.lakeSurfSpeed, 0), pulseOf(look.seaSurfSpeed, 0));
  const shorePulse = pulse.mul(0.43).add(1).mul(reachOut);
  const sharp = float(1).sub(smoothstep(1, 4, fwidth(depth)));
  const wash = smoothstep(0.05, 0.35, depth)
    .mul(float(1).sub(smoothstep(shorePulse, shorePulse.add(reachOut.mul(0.62)), depth)))
    .mul(sharp);
  // The breakers: a thin line further out, coming in on its own beat and torn
  // by a slow noise, so it never draws the depth's contour whole.
  const beat = byOpen(pulseOf(look.lakeSurfSpeed.mul(0.8), 1.7), pulseOf(look.seaSurfSpeed.mul(0.8), 1.7));
  const line = reachOut.mul(beat.mul(0.35).add(2.1));
  const width = reachOut.mul(0.3);
  const torn = smoothstep(
    -0.1,
    0.45,
    mx_noise_float(p.mul(vec2(0.035, 0.05)).add(vec2(u.time.mul(0.04), u.time.mul(-0.03)))),
  );
  const breakers = smoothstep(line.sub(width), line, depth)
    .mul(float(1).sub(smoothstep(line, line.add(width), depth)))
    .mul(torn)
    .mul(sharp)
    .mul(byOpen(look.lakeBreakers, look.seaBreakers));
  const foam = wash.mul(byOpen(look.lakeSurf, look.seaSurf)).add(breakers.mul(0.6)).min(1);
  const base = mix(shore, palette.snow, foam);
  // A few elongated highlights, not a carpet of specular flecks.
  const strokePhase = p.y.mul(0.48).add(p.x.mul(0.14)).add(n.x.mul(95)).sub(u.time.mul(0.55));
  const strokeVisible = float(1).sub(smoothstep(0.8, 2.8, fwidth(strokePhase)));
  const strokes = mix(0.38, smoothstep(0.1, 0.8, sin(strokePhase)), strokeVisible);
  const cloudShadow = createCloudShadow(u);
  // The sun's glints go out under a bank with the sun itself.
  const sheen = smoothstep(0.28, 0.88, glint)
    .mul(strokes)
    .mul(0.32)
    .add(glint.mul(0.065))
    .mul(createCloudShadow(u, CLOUD_SHADOW.sun)(p));
  const material = litMaterial(base.mul(cloudShadow(p)));
  material.positionNode = vec3(positionLocal.x, wave.mul(0.18).add(SEA_LEVEL), positionLocal.z);
  material.normalNode = transformNormalToView(n);
  material.emissiveNode = reflection
    .mul(fresnel.mul(0.42).add(0.02).mul(byOpen(look.lakeGloss, look.seaGloss)))
    .add(lightColor.mul(sheen))
    .add(vec3(0.55, 0.65, 0.85).mul(moonGlint).mul(0.24));
  const mesh = new Mesh(buildGrid(WATER_CELLS, WATER_CELL), material);
  mesh.frustumCulled = false;
  return {
    mesh,
    update(anchorWorldX: number, anchorWorldZ: number, originX: number, originZ: number) {
      uAnchor.value.set(anchorWorldX, anchorWorldZ);
      uWindow.value.set(hf.center.cx, hf.center.cz);
      mesh.position.set(anchorWorldX - originX, 0, anchorWorldZ - originZ);
    },
    /** A copy of the look now. */
    get form(): WaterLook {
      return { ...form };
    },
    /** Changes what it names, each number clamped to its range. */
    setForm(change: Partial<WaterLook>) {
      for (const key of Object.keys(WATER_LOOK) as Array<keyof WaterLook>) {
        const v = change[key];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        form[key] = Math.min(WATER_LOOK[key][1], Math.max(WATER_LOOK[key][0], v));
        look[key].value = form[key];
      }
    },
    /** The colours before the grade. */
    get colors(): WaterColors {
      return { ...colors };
    },
    setColor(key: keyof WaterColors, hex: number) {
      if (!(key in WATER_COLORS) || !Number.isInteger(hex) || hex < 0 || hex > 0xffffff) return;
      colors[key] = hex;
      tint[key].value.copy(graded(hex));
    },
    /** How much of the sea's look the water wears at a world point, as the vertex stage reckons it. */
    openAt(x: number, z: number) {
      return opennessOf(
        reachAt((tx, tz) => SEA_LEVEL - hf.heightAt(tx, tz), x, z),
        form.openFrom,
        Math.max(form.openTo, form.openFrom + 0.001),
      );
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
export type Water = ReturnType<typeof createWater>;
