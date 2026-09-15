// The figure seen from the flight's side: whatever flies gets a pose every
// frame and reports where its eye is and how far it hangs under its center.
// A procedural body implements it now; a skinned model can later, without a
// change to the engine.
import type { Object3D, Vector3 } from 'three';
import type { View } from '../flight/Steering';
import type { Outfit, Pattern } from './Outfits';

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

export interface Avatar {
  object: Object3D;
  update(pose: FlightPose, dt: number): void;
  /** The eye in the figure's frame: x left, y up, z ahead. */
  readonly eye: Vector3;
  /** How far the figure hangs under its center, and how far it reaches sideways, m. */
  readonly bounds: { below: number; radius: number };
  setOutfit(outfit: Outfit, pattern: Pattern): void;
  dispose(): void;
}
