// Clouds: soft volumes as the flyer approaches the deck. Forty instanced
// puffs, each seven merged spheres, drift through a field that wraps around
// the flyer; they shrink as the camera nears them so nothing pops. Positions
// are computed in world coordinates and written in local ones.
import { InstancedMesh, Matrix4, Quaternion, SphereGeometry, Vector3, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  abs,
  cameraPosition,
  dot,
  float,
  length,
  mix,
  normalLocal,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  smoothstep,
} from 'three/tsl';
import { mulberry32, sstep } from '../terrain/noise';
import { DECK_Y } from '../terrain/WorldSampler';
import type { SkyUniforms } from './SkyUniforms';

export const CLOUDS = 40;
export const CLOUD_FIELD = 6400;

function puffGeometry(seed: number): BufferGeometry {
  const r = mulberry32(seed ^ 0x51ed);
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const s = 0.55 + r() * 0.75;
    const g = new SphereGeometry(1, 20, 12);
    g.applyMatrix4(
      new Matrix4().compose(
        new Vector3((r() - 0.5) * 2.6, (r() - 0.5) * 0.7, (r() - 0.5) * 1.6),
        new Quaternion(),
        new Vector3(s * 1.25, s * 0.7, s),
      ),
    );
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (!merged) throw new Error('cloud puff geometry did not merge');
  return merged;
}

export function createClouds(seed: number, u: SkyUniforms) {
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  material.colorNode = mix(
    u.uHorizon,
    u.uCloudWhite,
    smoothstep(-0.7, 0.8, normalLocal.y).mul(0.7).add(0.15),
  );
  material.opacityNode = pow(abs(dot(normalWorld, normalize(cameraPosition.sub(positionWorld)))), 0.7)
    .mul(0.8)
    .mul(u.uCloudBodies)
    .mul(float(1).sub(smoothstep(2300, 2900, length(positionWorld.sub(cameraPosition)))));
  const mesh = new InstancedMesh(puffGeometry(seed), material, CLOUDS);
  mesh.frustumCulled = false;
  const base: Array<{ x: number; z: number; y: number; s: number; rot: number; drift: number }> = [];
  const r = mulberry32(seed ^ 0xc10d);
  for (let i = 0; i < CLOUDS; i++)
    base.push({
      x: r() * CLOUD_FIELD,
      z: r() * CLOUD_FIELD,
      y: DECK_Y + (r() - 0.5) * 90,
      s: 55 + r() * 95,
      rot: r() * 6.283,
      drift: 0.6 + r() * 0.8,
    });
  const m4 = new Matrix4(),
    q = new Quaternion(),
    v = new Vector3(),
    s3 = new Vector3();
  return {
    mesh,
    update(bx: number, bz: number, t: number, cameraLocal: Vector3, originX: number, originZ: number) {
      const cx = cameraLocal.x + originX,
        cy = cameraLocal.y,
        cz = cameraLocal.z + originZ;
      for (let i = 0; i < CLOUDS; i++) {
        const c = base[i]!;
        let x = c.x + t * 4.0 * c.drift - bx,
          z = c.z - bz;
        x = (((x % CLOUD_FIELD) + CLOUD_FIELD * 1.5) % CLOUD_FIELD) - CLOUD_FIELD / 2;
        z = (((z % CLOUD_FIELD) + CLOUD_FIELD * 1.5) % CLOUD_FIELD) - CLOUD_FIELD / 2;
        const px = bx + x,
          pz = bz + z;
        const d = Math.hypot(px - cx, c.y - cy, pz - cz);
        const shrink = sstep(c.s * 1.6, c.s * 3.6, d);
        q.setFromAxisAngle(v.set(0, 1, 0), c.rot);
        m4.compose(
          v.set(px - originX, c.y, pz - originZ),
          q,
          s3.set(c.s * shrink, c.s * 0.6 * shrink, c.s * shrink),
        );
        mesh.setMatrixAt(i, m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
export type Clouds = ReturnType<typeof createClouds>;
