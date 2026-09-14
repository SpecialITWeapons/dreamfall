import type { FlightState } from './Simulation';

export interface CameraPose {
  x: number;
  y: number;
  z: number;
  lookX: number;
  lookY: number;
  lookZ: number;
}

/** Camera rigidly behind the figure: no spring, so nothing reads as lag. */
export function cameraPoseFor(
  state: FlightState,
  offsets: { back: number; up: number; ahead: number } = { back: 12, up: 4, ahead: 30 },
): CameraPose {
  const fx = Math.sin(state.heading);
  const fz = Math.cos(state.heading);
  return {
    x: state.x - fx * offsets.back,
    y: state.y + offsets.up,
    z: state.z - fz * offsets.back,
    lookX: state.x + fx * offsets.ahead,
    lookY: state.y,
    lookZ: state.z + fz * offsets.ahead,
  };
}
