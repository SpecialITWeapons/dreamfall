// The figure seen from the flight's side: whatever flies gets a pose every
// frame and reports where its eye is and how far it hangs under its center.
// A procedural body implements it now; a skinned model can later, without a
// change to the engine.
import type { Object3D, Vector3 } from 'three';
import type { View } from '../flight/Steering';

/** What the flight hands the figure every frame; the position is already in the local frame of the scene. */
export interface FlightPose {
  x: number;
  y: number;
  z: number;
  heading: number;
  bank: number;
  pitch: number;
  vy: number;
  speed: number;
  windPhase: number;
  /** A burst of stronger flutter, 0..1. */
  gust: number;
  view: View;
}

/**
 * How far a human figure hangs under the flight's centre and how far it
 * reaches sideways, in metres. It lives here rather than with the grown body
 * because the flight reads it to keep the ground clear, and that has to mean
 * the same thing whichever figure is flying -- and because a value imported
 * from `ProceduralHuman` by the authored figure, which is behind a dynamic
 * import, splits 38 kB of body-growing out of the main bundle and charges
 * every player a second request for it.
 */
export const HUMAN_BOUNDS = { below: 0.3, radius: 1.1 } as const;

export interface Avatar {
  object: Object3D;
  update(pose: FlightPose, dt: number): void;
  /** The eye in the figure's frame: x left, y up, z ahead. */
  readonly eye: Vector3;
  /** How far the figure hangs under its center, and how far it reaches sideways, m. */
  readonly bounds: { below: number; radius: number };
  dispose(): void;
}
