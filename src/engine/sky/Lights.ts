// One directional light is the sun by day and the moon by night; it changes
// direction only while its intensity is zero, and it starts only once the disc
// reaches the horizon, or trees would throw shadows uphill from a sun below
// it. The shadow frame follows the flyer, but only in whole shadow-map texels
// across the light's plane, so the shadows drawn on the ground never crawl.
import { DirectionalLight, HemisphereLight, Matrix4, Vector3, type Scene } from 'three';
import { uniform } from 'three/tsl';
import { LOOK, type Look } from '../render/ColorGrade';
import type { Palette } from '../time/DayClock';

export const SHADOW_MAP = 2048;
export const SHADOW_HALF = 360;

export function createLights(scene: Scene, look: Look) {
  const sun = new DirectionalLight(0xffffff, 2.0);
  const hemi = new HemisphereLight(0xa9c8e6, 0x8a8f78, 1.0);
  scene.add(sun, sun.target, hemi);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  Object.assign(sun.shadow.camera, {
    left: -SHADOW_HALF,
    right: SHADOW_HALF,
    top: SHADOW_HALF,
    bottom: -SHADOW_HALF,
    near: 1,
    far: 2200,
  });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.5;
  sun.shadow.radius = 3;
  sun.shadow.intensity = 0.55 * LOOK.shadowI;
  const shadowMatrix = uniform(sun.shadow.matrix);
  const moonColor = look.moon.color;
  const m4 = new Matrix4(),
    zero = new Vector3(),
    right = new Vector3(),
    up = new Vector3();
  return {
    sun,
    hemi,
    shadowMatrix,
    update({
      palette,
      sunDir,
      moonDir,
      sunUp,
      moonLight,
      follow,
    }: {
      palette: Palette;
      sunDir: Vector3;
      moonDir: Vector3;
      sunUp: number;
      moonLight: number;
      follow: Vector3;
    }) {
      if (sunUp > 0) {
        sun.position.copy(sunDir);
        sun.color.copy(palette.sun);
        sun.intensity = palette.sunI * sunUp;
        sun.shadow.intensity = 0.55 * LOOK.shadowI;
      } else {
        sun.position.copy(moonDir);
        sun.color.setHex(moonColor);
        sun.intensity = look.moon.intensity * moonLight;
        sun.shadow.intensity = 0.4 * LOOK.shadowI;
      }
      m4.lookAt(sun.position, zero, sun.up);
      const texel = (SHADOW_HALF * 2) / SHADOW_MAP,
        e = m4.elements;
      right.set(e[0]!, e[1]!, e[2]!);
      up.set(e[4]!, e[5]!, e[6]!);
      const along = follow.dot(right),
        rise = follow.dot(up);
      sun.target.position
        .copy(follow)
        .addScaledVector(right, Math.round(along / texel) * texel - along)
        .addScaledVector(up, Math.round(rise / texel) * texel - rise);
      sun.position.multiplyScalar(1000).add(sun.target.position);
      hemi.color.copy(palette.hemiSky);
      hemi.groundColor.copy(palette.hemiGround);
      hemi.intensity = palette.hemiI;
    },
    dispose() {
      sun.shadow.dispose();
    },
  };
}
export type Lights = ReturnType<typeof createLights>;
