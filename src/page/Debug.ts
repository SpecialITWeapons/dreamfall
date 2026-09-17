import type { MemorySnapshot } from '../engine/Engine';
import type { KeyAction, Orbit, View } from '../engine/flight/Steering';
import type { Capture } from '../engine/render/Post';
import type { SceneryStats } from '../engine/scenery/Scenery';
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
  /** The Milky Way's atlas is baked off the main thread; this says whether it has arrived. */
  readonly galaxy: { baked: boolean; bakeMs: number };
  readonly audio: { available: boolean; state: string; gain: number; muted: boolean; volume: number };
  /** The page continued a remembered flight. */
  readonly resumed: boolean;
  snapshot(): ResumeState;
  saveFlight(): void;
  /** What each step of the start cost, ms from the module's first line. */
  readonly timings: Record<string, number>;
  /** GPU milliseconds of the last resolved frame; zero unless `?profile=1` asked for them. */
  readonly gpuMs: number;
  /** The registry, in the order the window's slot indices point into. */
  readonly biomes: string[];
  /** The three biome slots of the cell a world point falls in, by name. */
  weightsAt(x: number, z: number): Array<{ id: string; weight: number }>;
  /** What the ring and the grass window hold, and what they cost. */
  readonly scenery: SceneryStats | null;
  /** The i-th tree of the last rebuild, in the world and in the scene. */
  scenerySample(i: number): { world: [number, number]; local: [number, number] } | null;
  /** The settlement nearest a world point, with its plan's size, or null. */
  siteNear(x: number, z: number): { id: string; x: number; z: number; radius: number; lots: number } | null;
  /** How many things the flight has to fly around. */
  readonly obstacles: number;
  /** The ground or the top of whatever stands on it, m: what the flight keeps its clearance over. */
  floorAt(x: number, z: number): number;
  key(code: string): KeyAction;
  keyUp(code: string): boolean;
  /** The flight flies itself; an arrow key takes it off and this hands it back. */
  readonly autopilot: boolean;
  setAutopilot(on: boolean): void;
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
