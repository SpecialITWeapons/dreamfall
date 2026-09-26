// The cloud sea: the deck's top seen from over it, and only where the deck has
// cloud. It was a sheet over the whole world at 94 per cent, so from above
// there was nothing but overcast however few clouds the flyer had just climbed
// past; now it reads the deck's one field (`cloudCoverAt`), and between its
// banks the ground shows through, far below and moving at its own pace.
//
// It lies at one level for a region, `DECK.sea` over the deck's base, so the
// sea over a high region is higher than the sea over a low one, and where a
// bank thins it thins with it into the gap rather than stepping down. It had
// sides once -- the surface followed each bank's own top and went down its
// flank to the base -- and the owner read the result as cliffs of cloud: a
// bank's depth and its towers are the clusters' to show (`Clouds.ts`), and
// the sea is what they stand in.
//
// The surface is atmosphere, not land inside its own height fog, so its light
// is painted directly: a normal from the slope of the surface and the folds on
// it wraps the light round the sunward faces, warm while the sun is low,
// blushing opposite it; the hollows keep the sky's blue, a fold against the
// sun is lined with silver, and the moon lights it all at night. The far sea fades into the same
// horizon the sky draws.
//
// The grid is dense under the flyer and opens out with distance, and it moves
// in whole steps of its core so the near vertices stand still in the world
// while the flyer crosses them.
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh } from 'three';
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
import { LOOK } from '../render/ColorGrade';
import { DECK } from './CloudCover';
import { cloudCoverAt, deckBaseAt } from './CloudShadow';
import type { Horizon } from './Fog';
import type { SkyUniforms } from './SkyUniforms';

const VENUS = vec3(0.86, 0.46, 0.52);
/** How far the top of the sea sits under the deck's top, m: the folds reach up into it. */
export const CLOUD_SEA_DROP = 55;
/**
 * How far over the sea's level the camera has to be to see the sea, m: from
 * none of it at `[0]` to all of it at `[1]`. Under it the sea is the dome's
 * and the clusters' to draw, and its fog on the ground is not drawn either.
 */
export const SEA_SEEN = [-60, 10] as const;

/**
 * How much the camera sees the sea over a world point from above, 0..1: the
 * sea's own opacity by height and the fog's under it, so the fog lies on the
 * ground only where the sea is drawn over it. The fog read whether the camera
 * was over the top of the bank under the camera instead -- 120 m over the
 * base in a gap -- and the sea lies 180 m over it: in between, a bank a
 * kilometre off was a sheet of haze on the ground with no cloud over it.
 */
export const seaSeenAt = (u: SkyUniforms, p: Node<'vec2'>) =>
  smoothstep(SEA_SEEN[0], SEA_SEEN[1], cameraPosition.y.sub(deckBaseAt(u, p).add(DECK.sea - CLOUD_SEA_DROP)));

/**
 * The grid: `core` metres a step out to `coreReach` from the flyer, then steps
 * that open out evenly to `reach`, `steps` of them from one side to the other.
 */
export const SEA_GRID = { core: 30, coreReach: 1200, reach: 8200, steps: 200 };

/**
 * The grid's lines along one axis, m from the flyer, symmetric about it: `core`
 * apart near the middle, and apart by a step that grows in proportion to the
 * distance past `coreReach`, so the last one lands on `reach`.
 */
export function seaAxis(grid = SEA_GRID): Float32Array {
  const half = grid.steps / 2;
  const coreSteps = Math.round(grid.coreReach / grid.core);
  const outer = half - coreSteps;
  if (outer <= 0) throw new Error('the sea grid has no room past its core');
  // Past the core the step grows linearly: step(k) = core + g * k for k = 1..outer,
  // whose sum is the distance the outer steps have to cover.
  const rest = grid.reach - coreSteps * grid.core;
  const g = (rest - outer * grid.core) / ((outer * (outer + 1)) / 2);
  const side = [0];
  let at = 0;
  for (let k = 1; k <= half; k++) {
    at += k <= coreSteps ? grid.core : grid.core + g * (k - coreSteps);
    side.push(at);
  }
  const axis = new Float32Array(grid.steps + 1);
  for (let i = 0; i <= grid.steps; i++) axis[i] = i < half ? -side[half - i]! : side[i - half]!;
  return axis;
}

function seaGeometry(): BufferGeometry {
  const axis = seaAxis();
  const n = axis.length;
  const position = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 3;
      position[k] = axis[i]!;
      position[k + 2] = axis[j]!;
    }
  const index = new Uint32Array((n - 1) * (n - 1) * 6);
  let w = 0;
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i,
        b = a + 1,
        c = a + n,
        d = c + 1;
      index.set([a, c, b, b, c, d], w);
      w += 6;
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}

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
  const heapAt = (p: Node<'vec2'>) => {
    const q = p.sub(u.uWind.mul(u.time));
    return mx_noise_float(q.mul(0.0016).add(u.time.mul(0.009)))
      .mul(38.0)
      .add(mx_noise_float(q.mul(0.006).sub(u.time.mul(0.012))).mul(14.0));
  };
  /**
   * The surface over a world point, m: the region's sea level with the folds
   * on it, worn as much as there is cloud, and a thinning bank sagging a
   * little as it goes -- a slope of tens of metres, never a wall.
   */
  const surfaceAt = (p: Node<'vec2'>) => {
    const cover = cloudCoverAt(u, p);
    return deckBaseAt(u, p)
      .add(DECK.sea - CLOUD_SEA_DROP)
      .add(heapAt(p).mul(cover))
      .add(
        sin(p.x.mul(0.006).add(u.time.mul(0.2)))
          .mul(4.0)
          .mul(cover),
      )
      .sub(float(1).sub(cover).mul(30));
  };
  const cover = cloudCoverAt(u, worldXZ);
  const heap = heapAt(worldXZ);
  // The normal from the surface's slope, over a step wider than the grid's
  // core so it is the fold's and not the grid's.
  const STEP = 36;
  const here = surfaceAt(worldXZ);
  const slopeX = surfaceAt(worldXZ.add(vec2(STEP, 0)))
      .sub(here)
      .div(STEP),
    slopeZ = surfaceAt(worldXZ.add(vec2(0, STEP)))
      .sub(here)
      .div(STEP);
  const n = normalize(vec3(slopeX.negate().mul(2.2), 1, slopeZ.negate().mul(2.2)));
  const view = normalize(positionWorld.sub(cameraPosition));
  const sunUp = smoothstep(-0.04, 0.06, u.uSunDir.y);
  const s = max(dot(view, u.uSunDir), 0.0).mul(sunUp);
  const align = horizon.azimuthAlign(view, u.uSunDir),
    anti = horizon.azimuthAlign(view, u.uSunDir.negate());
  const sunCol = mix(u.uSunColor, u.uGlow, u.uLowSun.mul(0.6));
  // Wrapped light, its ramp following the sun's height so the tops stay
  // sculpted at noon and a flank facing away is still half lit through the cloud.
  const lit = smoothstep(u.uSunDir.y.sub(0.7), u.uSunDir.y.add(0.25), dot(n, u.uSunDir)).mul(sunUp);
  const moonlit = smoothstep(u.uMoonDir.y.sub(0.6), u.uMoonDir.y.add(0.3), dot(n, u.uMoonDir)).mul(
    u.uMoonLight,
  );
  const hollow = smoothstep(26, -32, heap).mul(cover);
  const shade = mix(u.uUpper.mul(0.6), u.uCloudWhite, 0.25).mul(float(1).sub(hollow.mul(0.3)));
  // A fold seen against the sun is lined with light: it faces away from the
  // eye and the sun is behind it.
  const rim = pow(s, 6).mul(float(1).sub(n.y)).mul(1.6).clamp(0, 1);
  const surface = Fn(() => {
    const light = mix(u.uCloudWhite, sunCol, u.uLowSun.mul(0.7).add(pow(s, 4).mul(0.3))).toVar();
    light.assign(mix(light, u.uGlow, u.uLowSun.mul(pow(align, 1.5)).mul(0.65)));
    light.assign(mix(light, mix(light, VENUS, 0.5), u.uVenusI.mul(pow(anti, 1.5)).mul(0.45)));
    light.mulAssign(mix(1, LOOK.daylight.cloudSun, u.uDaylight));
    const tops = mix(shade, light, lit.mul(float(1).sub(hollow.mul(0.55))));
    return tops.add(sunCol.mul(rim).mul(0.35)).add(vec3(0.42, 0.5, 0.72).mul(moonlit).mul(0.1));
  })();
  const far = max(u.uWhiteout, smoothstep(2000, 4300, length(positionWorld.sub(cameraPosition))));
  material.colorNode = mix(surface, horizon.horizonTint(view), far);
  // Seen only from over it: a stretch of the sea above the camera -- a higher
  // region's -- is the dome's and the clusters' to draw. A bank's edge
  // dissolves into the gap, and the far edge goes as the far fog has.
  material.opacityNode = smoothstep(SEA_SEEN[0], SEA_SEEN[1], cameraPosition.y.sub(positionWorld.y))
    .mul(smoothstep(0.1, 0.5, cover))
    .mul(float(1).sub(smoothstep(7400, 8200, length(positionWorld.sub(cameraPosition)))))
    .mul(u.uSeaOpacity);
  material.positionNode = vec3(positionLocal.x, surfaceAt(worldXZ), positionLocal.z);
  const geometry = seaGeometry();
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return {
    mesh,
    /** Rides with the flyer in whole steps of the grid's core, so the near vertices stand still in the world. */
    update(flyerLocalX: number, flyerLocalZ: number, originX: number, originZ: number) {
      const step = SEA_GRID.core;
      const wx = Math.round((flyerLocalX + originX) / step) * step,
        wz = Math.round((flyerLocalZ + originZ) / step) * step;
      mesh.position.set(wx - originX, 0, wz - originZ);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
export type CloudSea = ReturnType<typeof createCloudSea>;
