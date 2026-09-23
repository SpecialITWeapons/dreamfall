// The cloud sea: a heaped plane just under the deck, seen only from above, and
// only where the deck has cloud. It was a sheet over the whole world at 94 per
// cent, so from above there was nothing but overcast however few clouds the
// flyer had just climbed past; now it reads the deck's one field
// (`cloudCoverAt`), and between its banks the ground shows through, far below
// and moving at its own pace under them.
// The surface is atmosphere, not land inside its own height fog, so its folds
// are painted directly: a normal from the heap's slope turns the sunward
// flanks to the sun, warm while it is low, blushing opposite it, and leaves
// the hollows to the sky's blue; the moon lights them at night. The far sea
// fades into the same horizon the sky draws.
import { DoubleSide, Mesh, PlaneGeometry } from 'three';
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import {
  Fn,
  cameraPosition,
  dot,
  float,
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
  vec2,
  vec3,
} from 'three/tsl';
import { DECK_Y } from '../terrain/WorldSampler';
import { cloudBankAt, cloudCoverAt } from './CloudShadow';
import type { Horizon } from './Fog';
import type { SkyUniforms } from './SkyUniforms';

const VENUS = vec3(0.86, 0.46, 0.52);
export const CLOUD_SEA_SIZE = 9000;
export const CLOUD_SEA_DROP = 55;

export function createCloudSea(u: SkyUniforms, horizon: Horizon) {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });
  // World-space folds: the local frame moves with the floating origin, the
  // heap must not; the wind carries it, and its two scales boil at their own pace.
  const worldXZ = positionWorld.xz.add(u.uWorldOrigin);
  const cloud = cloudCoverAt(u, worldXZ);
  material.opacityNode = u.uAbove.mul(0.94).mul(cloudBankAt(u, worldXZ));
  const advected = worldXZ.sub(u.uWind.mul(u.time));
  const heapAt = (p: Node<'vec2'>) =>
    mx_noise_float(p.mul(0.0016).add(u.time.mul(0.009)))
      .mul(38.0)
      .add(mx_noise_float(p.mul(0.006).sub(u.time.mul(0.012))).mul(14.0));
  const heap = heapAt(advected);
  const STEP = 10;
  const slopeX = heapAt(advected.add(vec2(STEP, 0)))
      .sub(heap)
      .div(STEP),
    slopeZ = heapAt(advected.add(vec2(0, STEP)))
      .sub(heap)
      .div(STEP);
  const n = normalize(vec3(slopeX.negate().mul(3.5), 1, slopeZ.negate().mul(3.5)));
  const view = normalize(positionWorld.sub(cameraPosition));
  const sunUp = smoothstep(-0.04, 0.06, u.uSunDir.y);
  const s = max(dot(view, u.uSunDir), 0.0).mul(sunUp);
  const align = horizon.azimuthAlign(view, u.uSunDir),
    anti = horizon.azimuthAlign(view, u.uSunDir.negate());
  const sunCol = mix(u.uSunColor, u.uGlow, u.uLowSun.mul(0.6));
  // the ramp follows the sun's height, so the tops stay sculpted at noon
  const lit = smoothstep(u.uSunDir.y.sub(0.6), u.uSunDir.y.add(0.3), dot(n, u.uSunDir)).mul(sunUp);
  const moonlit = smoothstep(u.uMoonDir.y.sub(0.6), u.uMoonDir.y.add(0.3), dot(n, u.uMoonDir)).mul(
    u.uMoonLight,
  );
  const hollow = smoothstep(26, -32, heap);
  const shade = mix(u.uUpper.mul(0.6), u.uCloudWhite, 0.2).mul(float(1).sub(hollow.mul(0.3)));
  const folds = Fn(() => {
    const light = mix(u.uCloudWhite, sunCol, u.uLowSun.mul(0.7).add(pow(s, 4).mul(0.3))).toVar();
    light.assign(mix(light, u.uGlow, u.uLowSun.mul(pow(align, 1.5)).mul(0.65)));
    light.assign(mix(light, mix(light, VENUS, 0.5), u.uVenusI.mul(pow(anti, 1.5)).mul(0.45)));
    const tops = mix(shade, light, lit.mul(float(1).sub(hollow.mul(0.55))));
    return tops.add(vec3(0.42, 0.5, 0.72).mul(moonlit).mul(0.1));
  })();
  const cover = max(u.uWhiteout, smoothstep(2000, 4300, length(positionWorld.sub(cameraPosition))));
  material.colorNode = mix(folds, horizon.horizonTint(view), cover);
  // A bank's edge sinks as it thins, so the sea ends in a slope and not in a
  // cut: the heap is worn as much as there is cloud, and a clear place sits
  // under the banks around it.
  material.positionNode = vec3(
    positionLocal.x,
    heap
      .add(sin(worldXZ.x.mul(0.006).add(u.time.mul(0.2))).mul(4.0))
      .mul(cloud)
      .sub(float(1).sub(cloud).mul(30)),
    positionLocal.z,
  );
  const geometry = new PlaneGeometry(CLOUD_SEA_SIZE, CLOUD_SEA_SIZE, 96, 96);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.position.y = DECK_Y - CLOUD_SEA_DROP;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return {
    mesh,
    update(flyerLocalX: number, flyerLocalZ: number) {
      mesh.position.set(flyerLocalX, DECK_Y - CLOUD_SEA_DROP, flyerLocalZ);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
export type CloudSea = ReturnType<typeof createCloudSea>;
