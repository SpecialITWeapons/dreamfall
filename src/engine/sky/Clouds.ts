// Clouds: soft volumes as the flyer approaches the deck. Sixty-four instanced
// puffs, each seven merged spheres, drift through a field that wraps around
// the flyer; they shrink as the camera nears them so nothing pops. Positions
// are computed in world coordinates and written in local ones.
//
// They stand only where the deck has cloud: each reads the deck's one field
// (`CloudCover.at`, the same bytes the sea and the shadows sample on the GPU)
// and is worn as much as its place is under a bank, so the few clouds a flyer
// passes under the deck are the banks it looks down on from over it. They
// drift with the wind itself, as the field does, or they would slide out of
// their banks.
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
  mx_noise_float,
  normalLocal,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  smoothstep,
} from 'three/tsl';
import { mulberry32, sstep } from '../terrain/noise';
import type { CloudCover } from './CloudCover';
import type { SkyUniforms } from './SkyUniforms';

export const CLOUDS = 64;
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

export function createClouds(seed: number, u: SkyUniforms, cover: CloudCover) {
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
  // The puffs breathe: a slow noise pushes the surface in and out along its normal.
  material.positionNode = positionLocal.add(
    normalLocal.mul(mx_noise_float(positionLocal.mul(0.9).add(u.time.mul(0.12))).mul(0.08)),
  );
  const mesh = new InstancedMesh(puffGeometry(seed), material, CLOUDS);
  mesh.frustumCulled = false;
  const base: Array<{ x: number; z: number; y: number; s: number; rot: number; drift: number }> = [];
  const r = mulberry32(seed ^ 0xc10d);
  for (let i = 0; i < CLOUDS; i++)
    base.push({
      x: r() * CLOUD_FIELD,
      z: r() * CLOUD_FIELD,
      y: (r() - 0.5) * 90,
      s: 55 + r() * 95,
      rot: r() * 6.283,
      drift: 0.95 + r() * 0.1,
    });
  const m4 = new Matrix4(),
    q = new Quaternion(),
    v = new Vector3(),
    s3 = new Vector3();
  return {
    mesh,
    update(
      bx: number,
      bz: number,
      t: number,
      cameraLocal: Vector3,
      originX: number,
      originZ: number,
      wind: { x: number; z: number },
    ) {
      const cx = cameraLocal.x + originX,
        cy = cameraLocal.y,
        cz = cameraLocal.z + originZ;
      for (let i = 0; i < CLOUDS; i++) {
        const c = base[i]!;
        let x = c.x + t * wind.x * c.drift - bx,
          z = c.z + t * wind.z * c.drift - bz;
        x = (((x % CLOUD_FIELD) + CLOUD_FIELD * 1.5) % CLOUD_FIELD) - CLOUD_FIELD / 2;
        z = (((z % CLOUD_FIELD) + CLOUD_FIELD * 1.5) % CLOUD_FIELD) - CLOUD_FIELD / 2;
        const px = bx + x,
          pz = bz + z;
        // They hang from the deck's base where they are.
        const py = cover.baseAt(px, pz) + 45 + c.y;
        const d = Math.hypot(px - cx, py - cy, pz - cz);
        // Moved against the wind as the shader moves its point, so the CPU and
        // the GPU read the one field at one place.
        const bank = sstep(0.35, 0.8, cover.at(px - wind.x * t, pz - wind.z * t));
        const shrink = sstep(c.s * 1.6, c.s * 3.6, d) * bank;
        q.setFromAxisAngle(v.set(0, 1, 0), c.rot);
        m4.compose(
          v.set(px - originX, py, pz - originZ),
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
