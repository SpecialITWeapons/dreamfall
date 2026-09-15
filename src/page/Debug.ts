import type { MemorySnapshot } from '../engine/Engine';
import type { FlightState } from '../engine/sim/Simulation';

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
