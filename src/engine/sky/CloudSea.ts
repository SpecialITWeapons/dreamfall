// The cloud sea: the deck's top seen from over it, and only where the deck has
// cloud. It was a sheet over the whole world at 94 per cent, so from above
// there was nothing but overcast however few clouds the flyer had just climbed
// past; now it reads the deck's one field (`cloudCoverAt`), and between its
// banks the ground shows through, far below and moving at its own pace.
//
// It stands where the deck stands: on the top of the bank under each vertex
// (`deckTopAt`, whose reads it shares), which is a region's base plus the bank's own depth, so the
// sea over a high region is higher than the sea over a low one. Where a bank
// thins, the surface goes down its side to the base rather than sinking a few
// metres, so a bank is a body with a flank the sun can light and not a stain
// on a plane.
//
// The surface is atmosphere, not land inside its own height fog, so its light
// is painted directly: a normal from the slope of the whole surface -- the
// bank and the folds on it -- wraps the light round the sunward flanks, warm
// while the sun is low, blushing opposite it; the flanks darken toward the
// base, the hollows keep the sky's blue, an edge against the sun is lined with
// silver, and the moon lights it all at night. The far sea fades into the same
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
  clamp,
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
import { COVER, DECK } from './CloudCover';
import { cloudCoverAt, deckBaseAt } from './CloudShadow';
import type { Horizon } from './Fog';
import type { SkyUniforms } from './SkyUniforms';

const VENUS = vec3(0.86, 0.46, 0.52);
/** How far the top of the sea sits under the deck's top, m: the folds reach up into it. */
export const CLOUD_SEA_DROP = 55;
/**
 * The grid: `core` metres a step out to `coreReach` from the flyer, then steps
 * that open out evenly to `reach`, `steps` of them from one side to the other.
 */
export const SEA_GRID = { core: 30, coreReach: 1200, reach: 4500, steps: 160 };

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
   * The surface over a world point, m. Where the field is cloud the top of the
   * bank with its folds on it; down the bank's flank to its base as the field
   * thins, steeply, so the flank is a wall and not a ramp.
   */
  const shoulder = (cover: Node<'float'>) => smoothstep(0.02, COVER.bank[1], cover);
  /** The top of the bank over a base, for a field this solid: `deckTopAt`, sharing its reads. */
  const topOver = (base: Node<'float'>, cover: Node<'float'>) =>
    base.add(DECK.thin).add(smoothstep(COVER.bank[0], COVER.bank[1], cover).mul(DECK.thick - DECK.thin));
  const surfaceAt = (p: Node<'vec2'>) => {
    const cover = cloudCoverAt(u, p),
      base = deckBaseAt(u, p);
    const top = topOver(base, cover)
      .sub(CLOUD_SEA_DROP)
      .add(heapAt(p).mul(cover))
      .add(
        sin(p.x.mul(0.006).add(u.time.mul(0.2)))
          .mul(4.0)
          .mul(cover),
      );
    return mix(base, top, shoulder(cover));
  };
  const cover = cloudCoverAt(u, worldXZ);
  const heap = heapAt(worldXZ);
  const base = deckBaseAt(u, worldXZ),
    top = topOver(base, cover);
  // The normal from the whole surface's slope: a bank's flank faces out of the
  // bank, a fold's face out of the fold.
  // Wider than the grid's core, so the normal is the bank's and not a crease
  // where the flank meets the top.
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
  // How far up its own bank a point is: a flank darkens toward the base, where
  // the bank's own body stands between it and the sky.
  const up = clamp(positionWorld.y.sub(base).div(max(top.sub(base), 1)), 0, 1);
  const hollow = smoothstep(26, -32, heap).mul(cover);
  const shade = mix(u.uUpper.mul(0.6), u.uCloudWhite, 0.25)
    .mul(float(1).sub(hollow.mul(0.3)))
    .mul(mix(0.72, 1, up));
  // A flank seen against the sun is lined with light: it faces away from the
  // eye and the sun is behind it.
  const rim = pow(s, 6).mul(float(1).sub(n.y)).mul(1.6).clamp(0, 1);
  const surface = Fn(() => {
    const light = mix(u.uCloudWhite, sunCol, u.uLowSun.mul(0.7).add(pow(s, 4).mul(0.3))).toVar();
    light.assign(mix(light, u.uGlow, u.uLowSun.mul(pow(align, 1.5)).mul(0.65)));
    light.assign(mix(light, mix(light, VENUS, 0.5), u.uVenusI.mul(pow(anti, 1.5)).mul(0.45)));
    const tops = mix(shade, light, lit.mul(float(1).sub(hollow.mul(0.55))));
    return tops.add(sunCol.mul(rim).mul(0.35)).add(vec3(0.42, 0.5, 0.72).mul(moonlit).mul(0.1));
  })();
  const far = max(u.uWhiteout, smoothstep(2000, 4300, length(positionWorld.sub(cameraPosition))));
  material.colorNode = mix(surface, horizon.horizonTint(view), far);
  // Seen only from over it: a stretch of the sea above the camera -- a higher
  // region's bank, or its flank -- is the dome's and the puffs' to draw. The
  // flank stays solid down to near its base and fades there, into the gap.
  // The far edge goes as the far fog has: a flank out there is a coarse wall
  // of the grid, and in the haze it reads as a streak rather than a bank.
  material.opacityNode = smoothstep(-60, 10, cameraPosition.y.sub(positionWorld.y))
    .mul(smoothstep(0.02, 0.2, cover))
    .mul(float(1).sub(smoothstep(3400, 4400, length(positionWorld.sub(cameraPosition)))))
    .mul(0.94);
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
