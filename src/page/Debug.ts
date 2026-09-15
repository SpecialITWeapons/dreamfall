import type { MemorySnapshot } from '../engine/Engine';
import type { KeyAction, Orbit, View } from '../engine/flight/Steering';
import type { Capture } from '../engine/render/Post';
import type { FlightState, ResumeState } from '../engine/sim/Simulation';
import type { Wind } from '../engine/sky/Wind';

/** GPU counters taken right before and right after `world.dispose()`, to prove dispose actually frees things. */
export interface DisposeReport {
  before: MemorySnapshot;
  afterWorld: MemorySnapshot;
}

/** What browser tests and tools read from the running page. */
export interface WorldDebug {
  readonly ready: boolean;
  readonly running: boolean;
  readonly paused: boolean;
  readonly frames: number;
  readonly seed: number;
  readonly backend: string;
  readonly state: FlightState;
  step(dt: number): void;
  begin(): void;
  dispose(): Promise<DisposeReport>;
  memory(): MemorySnapshot;
  heightAt(x: number, z: number): number;
  /** Day-clock phase; setting it re-evaluates the palette and draws one frame. */
  dayPhase: number;
  readonly origin: { x: number; z: number };
  /** Height of the flyer over the terrain under it, m. */
  readonly clearance: number;
  capture(width?: number, height?: number): Promise<Capture | null>;
  readonly view: View;
  setView(view: View): void;
  readonly cameraFov: number;
  readonly orbit: Orbit;
  readonly wind: Wind;
  readonly audio: { available: boolean; state: string; gain: number; muted: boolean; volume: number };
  /** The page continued a remembered flight. */
  readonly resumed: boolean;
  snapshot(): ResumeState;
  saveFlight(): void;
  key(code: string): KeyAction;
  readonly pointer: {
    down(button: number, x: number, y: number, touch?: boolean): boolean;
    move(x: number, y: number): void;
    up(): boolean;
  };
}

declare global {
  interface Window {
    __world?: WorldDebug;
    dreamfallFailure: () => void;
    dreamfallFailed?: boolean;
  }
}

export function installDebug(target: Window, api: WorldDebug): void {
  target.__world = api;
}
