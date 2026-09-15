// The shadows of the clouds on the ground and the water: a field with the
// statistics of the painted clouds, advected by the wind, darkening the lit
// surfaces while the sun stands. The dome is drawn in direction space, so
// this is not its exact projection; the shape, the scale and the drift match,
// which is what reads as clouds passing over.
import type { Node } from 'three/webgpu';
import { Fn, float, mx_noise_float, smoothstep, vec2 } from 'three/tsl';
import type { SkyUniforms } from './SkyUniforms';

export const CLOUD_SHADOW = { scale: 0.0009, depth: 0.3 };

/** Light reaching a world point through the clouds, 1 - depth .. 1. */
export function createCloudShadow(u: SkyUniforms) {
  return Fn(([worldXZ]: [Node<'vec2'>]) => {
    const q = worldXZ.sub(u.uWind.mul(u.time)).mul(CLOUD_SHADOW.scale);
    const mass = mx_noise_float(q.mul(0.3).add(vec2(3, 12)))
      .mul(0.28)
      .add(mx_noise_float(q).mul(0.6))
      .add(mx_noise_float(q.mul(2.1).add(8)).mul(0.3));
    const cover = smoothstep(0.05, 0.4, mass);
    const sunUp = smoothstep(-0.05, 0.1, u.uSunDir.y);
    return float(1).sub(cover.mul(CLOUD_SHADOW.depth).mul(sunUp));
  });
}
export type CloudShadow = ReturnType<typeof createCloudShadow>;
