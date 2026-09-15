// The camera: World of Warcraft's third person, or the figure's own eye. The
// third-person view hangs rigidly at a yaw, pitch and distance from the
// figure, so the figure is the pivot of every orbit and holds its place on
// screen; ground and obstacles lift it quickly and let it settle back slowly.
// The first-person view sits in the eye, faces the course plus whatever the
// pilot looks at, rolls with a share of the bank and bobs with the wind.
// The pose is pure and tested in Node; applyCameraPose is the one place a
// Three.js camera is written.
import type { PerspectiveCamera } from 'three';
import type { FlightState } from './FlightController';
import type { Look, Orbit, View } from './Steering';

export const TPP = {
  fov: 55,
  near: 0.5,
  /** Aim just above the figure, so it sits a little below center. */
  lookRise: 0.4,
  /** Clearance the camera keeps over ground and obstacles, and the floor it never goes under. */
  clearance: 9,
  settle: 7,
};
export const FPP = {
  fov: 75,
  near: 0.1,
  /** How much of the bank the head follows. */
  bankShare: 0.4,
  /** Head bob with the wind, m. */
  bob: 0.02,
};

/** A camera pose in world coordinates. */
export interface CameraPose {
  x: number;
  y: number;
  z: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  /** Roll about the view axis, radians. */
  roll: number;
  fov: number;
  near: number;
}

export interface BodyPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * A point in the figure's frame (x left, y up, z ahead) to the world, through
 * its bank, pitch and heading: the same order as Object3D.rotation with
 * order 'YXZ' set to (-pitch, heading, bank).
 */
export function bodyToWorld(
  p: BodyPoint,
  state: { x: number; y: number; z: number; heading: number; pitch: number; bank: number },
  out: BodyPoint,
): BodyPoint {
  const cb = Math.cos(state.bank),
    sb = Math.sin(state.bank);
  const x1 = p.x * cb - p.y * sb,
    y1 = p.x * sb + p.y * cb,
    z1 = p.z;
  const cp = Math.cos(-state.pitch),
    sp = Math.sin(-state.pitch);
  const y2 = y1 * cp - z1 * sp,
    z2 = y1 * sp + z1 * cp;
  const ch = Math.cos(state.heading),
    sh = Math.sin(state.heading);
  out.x = state.x + x1 * ch + z2 * sh;
  out.y = state.y + y2;
  out.z = state.z - x1 * sh + z2 * ch;
  return out;
}

export interface ChaseInput {
  state: FlightState;
  view: View;
  orbit: Orbit;
  look: Look;
  /** The eye in the figure's frame (Avatar.eye). */
  eye: BodyPoint;
  /** Ground and obstacle tops under a world point. */
  floorAt: (x: number, z: number) => number;
  dt: number;
  reducedMotion?: boolean;
}

export interface ChaseCamera {
  readonly pose: CameraPose;
  /** Extra height that keeps the third-person camera out of ground and obstacles. */
  readonly lift: number;
  update(input: ChaseInput): CameraPose;
}

export function createChaseCamera(): ChaseCamera {
  let lift = 0;
  const pose: CameraPose = {
    x: 0,
    y: 0,
    z: 0,
    lookX: 0,
    lookY: 0,
    lookZ: 1,
    roll: 0,
    fov: TPP.fov,
    near: TPP.near,
  };
  const eyeWorld = { x: 0, y: 0, z: 0 };
  return {
    pose,
    get lift() {
      return lift;
    },
    update({ state, view, orbit, look, eye, floorAt, dt, reducedMotion = false }) {
      if (view === 'tpp') {
        const yaw = state.heading + Math.PI + orbit.yaw,
          cp = Math.cos(orbit.pitch);
        const x = state.x + Math.sin(yaw) * cp * orbit.dist,
          z = state.z + Math.cos(yaw) * cp * orbit.dist;
        let y = state.y + Math.sin(orbit.pitch) * orbit.dist;
        // Ground and obstacles lift the camera quickly and let it settle back slowly.
        const floor = floorAt(x, z);
        const want = Math.max(0, floor + TPP.clearance - y);
        lift += (want - lift) * Math.min(1, dt * (want > lift ? 10 : 1.5));
        y = Math.max(y + lift, floor + TPP.settle);
        pose.x = x;
        pose.y = y;
        pose.z = z;
        pose.lookX = state.x;
        pose.lookY = state.y + TPP.lookRise;
        pose.lookZ = state.z;
        pose.roll = 0;
        pose.fov = TPP.fov;
        pose.near = TPP.near;
        return pose;
      }
      bodyToWorld(eye, state, eyeWorld);
      const bob = reducedMotion ? 0 : Math.sin(state.windPhase) * FPP.bob;
      const yaw = state.heading + look.yaw,
        pitch = state.pitch + look.pitch,
        cp = Math.cos(pitch);
      pose.x = eyeWorld.x;
      pose.y = eyeWorld.y + bob;
      pose.z = eyeWorld.z;
      pose.lookX = pose.x + Math.sin(yaw) * cp * 10;
      pose.lookY = pose.y + Math.sin(pitch) * 10;
      pose.lookZ = pose.z + Math.cos(yaw) * cp * 10;
      pose.roll = -state.bank * FPP.bankShare;
      pose.fov = FPP.fov;
      pose.near = FPP.near;
      lift = 0;
      return pose;
    },
  };
}

/** Writes a world pose into a Three.js camera in the local frame; the only place the camera is moved. */
export function applyCameraPose(
  camera: PerspectiveCamera,
  pose: CameraPose,
  localX: (x: number) => number,
  localZ: (z: number) => number,
): void {
  camera.position.set(localX(pose.x), pose.y, localZ(pose.z));
  camera.up.set(0, 1, 0);
  camera.lookAt(localX(pose.lookX), pose.lookY, localZ(pose.lookZ));
  if (pose.roll !== 0) camera.rotateZ(pose.roll);
  if (camera.fov !== pose.fov || camera.near !== pose.near) {
    camera.fov = pose.fov;
    camera.near = pose.near;
    camera.updateProjectionMatrix();
  }
}
