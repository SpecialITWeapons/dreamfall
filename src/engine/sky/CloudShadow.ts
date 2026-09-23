// The deck's field on the GPU, and what it does to the ground: the shadows of
// the clouds on the land and the water fall under the banks the sea draws from
// above and the puffs stand in near the deck, because all of them read the one
// field (sky/CloudCover.ts), moved by the one wind. The shadows used to come
// from a noise of their own, shaped like the painted clouds on the dome and
// under none of them.
import type { Node } from 'three/webgpu';
import { Fn, float, smoothstep, texture } from 'three/tsl';
import type { SkyUniforms } from './SkyUniforms';

export const CLOUD_SHADOW = { depth: 0.3 };

/**
 * How much cloud the deck has over a world point, 0..1, carried by the wind:
 * the texture of `CloudCover.data`, read where the CPU's `cover.at` reads it.
 */
export function cloudCoverAt(u: SkyUniforms, worldXZ: Node<'vec2'>): Node<'float'> {
  return texture(u.cloudCover, worldXZ.sub(u.uWind.mul(u.time)).div(u.uCoverPeriod)).r;
}

/**
 * Where a bank stands solid, 0..1: the field with its rim pulled in. The sea
 * and its fog read this one, so the fog under a bank ends where the bank does;
 * straight off the field their rims were a kilometre of haze over the ground.
 */
export function cloudBankAt(u: SkyUniforms, worldXZ: Node<'vec2'>): Node<'float'> {
  return smoothstep(0.15, 0.6, cloudCoverAt(u, worldXZ));
}

/** Light reaching a world point through the clouds, 1 - depth .. 1. */
export function createCloudShadow(u: SkyUniforms) {
  return Fn(([worldXZ]: [Node<'vec2'>]) => {
    const sunUp = smoothstep(-0.05, 0.1, u.uSunDir.y);
    return float(1).sub(cloudCoverAt(u, worldXZ).mul(CLOUD_SHADOW.depth).mul(sunUp));
  });
}
export type CloudShadow = ReturnType<typeof createCloudShadow>;
