// Approved jade water: one opaque draw on the engine's bounded grid. The CPU
// heightfield owns the shore. No reflection camera, depth pass, new textures
// or CPU animation; the rough sky uses the world's own day palette. Ported
// from fly-with-me's water.js; world-space patterns add the floating origin.
import { Mesh, Vector2 } from 'three';
import type { Node } from 'three/webgpu';
import {
  Fn,
  cameraPosition,
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
  vec2,
  vec3,
} from 'three/tsl';
import type { LitMaterial } from '../render/SoftLighting';
import { CLOUD_SHADOW, createCloudShadow } from '../sky/CloudShadow';
import type { Horizon } from '../sky/Fog';
import { CLOUD_DRIFT } from '../sky/SkyDome';
import type { SkyUniforms } from '../sky/SkyUniforms';
import {
  WATER_CELL,
  WATER_CELLS,
  buildGrid,
  type LoadCell,
  type TerrainPalette,
} from '../terrain/TerrainMesh';
import { CELL, SEA_LEVEL } from '../terrain/WorldSampler';

export function createWater(deps: {
  uniforms: SkyUniforms;
  horizon: Horizon;
  litMaterial: LitMaterial;
  palette: TerrainPalette;
  loadCell: LoadCell;
}) {
  const { uniforms: u, horizon, litMaterial, palette, loadCell } = deps;
  const uAnchor = uniform(new Vector2(0, 0));
  const worldVertex = positionLocal.xz.add(uAnchor);
  const wave = sin(worldVertex.x.mul(0.021).add(u.time.mul(0.55)))
    .mul(0.7)
    .add(sin(worldVertex.y.mul(0.017).sub(u.time.mul(0.42))).mul(0.6))
    .add(sin(worldVertex.x.add(worldVertex.y).mul(0.009).add(u.time.mul(0.3))).mul(0.5));
  const view = normalize(cameraPosition.sub(positionWorld));
  const p = positionWorld.xz.add(u.uWorldOrigin);

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

  // Two scales of advected slopes, each filtered by its pixel footprint.
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
      .mul(0.07);
    return normalize(vec3(slope.x, 1, slope.y));
  })();

  // Rough painted reflection, not another complete sky shader per water pixel.
  const reflectedSky = Fn(([r]: [Node<'vec3'>]) => {
    const alignment = pow(horizon.azimuthAlign(r, u.uSunDir), 3.5);
    const warm = mix(u.uUpper, u.uUpperWarm, alignment.mul(0.8));
    const top = mix(warm, u.uZenith, smoothstep(0.1, 0.85, r.y));
    const color = mix(horizon.horizonTint(r), top, smoothstep(0, 0.4, r.y)).toVar();
    const q = r.xz.div(r.y.max(0.025).add(0.19)).mul(vec2(2.8, 6)).sub(u.uWind.mul(u.time).mul(CLOUD_DRIFT));
    const mass = mx_noise_float(q.mul(0.3).add(vec2(3, 12)))
      .mul(0.28)
      .add(mx_noise_float(q).mul(0.6));
    const cloud = smoothstep(-0.14, 0.34, mass).mul(smoothstep(0.014, 0.15, r.y));
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

  // Mint shelves deepen into turquoise; the narrow shore wash is diffuse.
  const shallow = palette.waterShallow,
    deep = palette.waterDeep;
  const body = mix(shallow, deep, smoothstep(0.5, 34, depth));
  const shore = mix(mix(palette.sand, shallow, 0.7), body, smoothstep(0, 3, depth));
  const shorePulse = sin(u.time.mul(0.65).add(p.x.mul(0.014)).add(p.y.mul(0.018)))
    .mul(0.45)
    .add(1.05);
  const wash = smoothstep(0.05, 0.35, depth)
    .mul(float(1).sub(smoothstep(shorePulse, shorePulse.add(0.65), depth)))
    .mul(float(1).sub(smoothstep(1, 4, fwidth(depth))));
  const base = mix(shore, palette.snow, wash.mul(0.48));
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
    .mul(fresnel.mul(0.42).add(0.02))
    .add(lightColor.mul(sheen))
    .add(vec3(0.55, 0.65, 0.85).mul(moonGlint).mul(0.24));
  const mesh = new Mesh(buildGrid(WATER_CELLS, WATER_CELL), material);
  mesh.frustumCulled = false;
  return {
    mesh,
    update(anchorWorldX: number, anchorWorldZ: number, originX: number, originZ: number) {
      uAnchor.value.set(anchorWorldX, anchorWorldZ);
      mesh.position.set(anchorWorldX - originX, 0, anchorWorldZ - originZ);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
export type Water = ReturnType<typeof createWater>;
