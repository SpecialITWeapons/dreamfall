// Pointer input follows the conventions of World of Warcraft's camera: the
// left button orbits the camera and leaves it where you put it, the right
// button steers, and the wheel zooms. Touch steers, since it has only one
// button. Headings grow counter-clockwise seen from above, which is a left
// turn, so rightward input subtracts. Steering is both ways: sideways it
// turns the figure, up and down it lowers or raises the view and aims the
// nose the same way at the same time, so the figure flies where the pilot is
// looking. In the first-person view the left button looks around instead,
// and the look eases back to the course once released. Pure CPU: the page
// feeds it pointer positions and key codes.
import { wrapAngle } from './angles';
import type { FlightController } from './FlightController';

export const TURN_PER_PIXEL = 0.004;
export const ORBIT = { dist: 10, minDist: 5, maxDist: 30, pitch: 0.3, minPitch: -0.5, maxPitch: 1.2 };
export const LOOK = { yaw: (110 * Math.PI) / 180, pitch: (60 * Math.PI) / 180, returnSeconds: 1.5 };

export type View = 'tpp' | 'fpp';
export interface Orbit {
  /** Orbit around the figure, relative to its heading; 0 is behind. */
  yaw: number;
  /** Elevation above the figure, radians. */
  pitch: number;
  dist: number;
}
export interface Look {
  yaw: number;
  pitch: number;
}
export type KeyAction = 'pause' | 'view' | 'fly' | null;
/** Arrow keys, inverted in the vertical the way a stick is: pulling back raises the nose. */
export const FLIGHT_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const;

export interface Steering {
  view: View;
  readonly orbit: Orbit;
  /** First-person look offsets from the course. */
  readonly look: Look;
  readonly dragging: boolean;
  /** -1 none, 0 orbits the camera, 2 steers the figure. */
  readonly dragButton: -1 | 0 | 2;
  /** The pilot holds the stick. */
  readonly held: boolean;
  /** The flight flies itself; an arrow key takes it away, the HUD hands it back. */
  readonly autopilot: boolean;
  setAutopilot(on: boolean): void;
  /** A press; false when the button is not one this page uses. */
  pointerDown(button: number, x: number, y: number, touch?: boolean): boolean;
  pointerMove(x: number, y: number): void;
  /** Ends a drag; true when the framing may have changed and is worth remembering. */
  pointerUp(): boolean;
  wheel(deltaY: number): void;
  /** A key going down. */
  key(code: string): KeyAction;
  /** A key coming up; true when it was one of the flight keys. */
  keyUp(code: string): boolean;
  /** Everything let go at once: a blur, a pause, a lost focus. */
  releaseKeys(): void;
  toggleView(): View;
  /** Per frame, before the simulation step: steering from the camera's point of view, and the look's return. */
  update(dt: number): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function createSteering(
  flight: FlightController,
  opts: { view?: View; orbit?: Partial<Orbit> } = {},
): Steering {
  let view: View = opts.view ?? 'tpp';
  const orbit: Orbit = {
    yaw: wrapAngle(opts.orbit?.yaw ?? 0),
    pitch: clamp(opts.orbit?.pitch ?? ORBIT.pitch, ORBIT.minPitch, ORBIT.maxPitch),
    dist: clamp(opts.orbit?.dist ?? ORBIT.dist, ORBIT.minDist, ORBIT.maxDist),
  };
  const look: Look = { yaw: 0, pitch: 0 };
  /** Arrow keys currently down. */
  const keys = new Set<string>();
  // Left turns the figure left (headings grow counter-clockwise from above),
  // and the vertical is inverted the way an aircraft's stick is: pulling back
  // -- ArrowDown -- raises the nose. Holding nothing holds the course and the
  // height, which is what the flight does with the autopilot off.
  const flyKeys = () =>
    flight.fly(
      (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0),
      (keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0),
    );
  let dragging = false;
  let dragButton: -1 | 0 | 2 = -1;
  let lastX = 0,
    lastY = 0;
  const toggleView = () => {
    view = view === 'tpp' ? 'fpp' : 'tpp';
    look.yaw = 0;
    look.pitch = 0;
    return view;
  };
  return {
    get view() {
      return view;
    },
    set view(next: View) {
      if (next !== view) toggleView();
    },
    orbit,
    look,
    get dragging() {
      return dragging;
    },
    get dragButton() {
      return dragButton;
    },
    get held() {
      return dragButton === 2;
    },
    pointerDown(button, x, y, touch = false) {
      if (button !== 0 && button !== 2 && !touch) return false;
      dragging = true;
      dragButton = touch || button === 2 ? 2 : 0;
      lastX = x;
      lastY = y;
      if (dragButton === 2) {
        flight.setSteering(true);
        flight.release();
      }
      return true;
    },
    pointerMove(x, y) {
      if (!dragging) return;
      const dx = x - lastX,
        dy = y - lastY;
      lastX = x;
      lastY = y;
      if (dragButton === 0) {
        if (view === 'tpp') {
          orbit.yaw = wrapAngle(orbit.yaw - dx * TURN_PER_PIXEL);
          orbit.pitch = clamp(orbit.pitch + dy * TURN_PER_PIXEL, ORBIT.minPitch, ORBIT.maxPitch);
        } else {
          look.yaw = clamp(look.yaw - dx * TURN_PER_PIXEL, -LOOK.yaw, LOOK.yaw);
          look.pitch = clamp(look.pitch - dy * TURN_PER_PIXEL, -LOOK.pitch, LOOK.pitch);
        }
        return;
      }
      // Either button lowers and raises the view the same way; the right one
      // turns the figure and, with the view, aims its nose.
      if (dy && view === 'tpp')
        orbit.pitch = clamp(orbit.pitch + dy * TURN_PER_PIXEL, ORBIT.minPitch, ORBIT.maxPitch);
      if (dx) flight.steerBy(-dx * TURN_PER_PIXEL);
      if (dy) flight.aimBy(-dy * TURN_PER_PIXEL);
    },
    pointerUp() {
      const changed = dragButton >= 0;
      if (dragButton === 2) flight.setSteering(false);
      dragging = false;
      dragButton = -1;
      return changed;
    },
    wheel(deltaY) {
      orbit.dist = clamp(orbit.dist * Math.exp(deltaY * 0.0012), ORBIT.minDist, ORBIT.maxDist);
    },
    get autopilot() {
      return flight.autopilot;
    },
    setAutopilot(on) {
      if (on) keys.clear();
      flight.setAutopilot(on);
      if (!on) flyKeys();
    },
    key(code) {
      if (code === 'Space') return 'pause';
      if (code === 'KeyV') {
        toggleView();
        return 'view';
      }
      if (!(FLIGHT_KEYS as readonly string[]).includes(code)) return null;
      keys.add(code);
      flyKeys();
      return 'fly';
    },
    keyUp(code) {
      if (!keys.delete(code)) return false;
      flyKeys();
      return true;
    },
    releaseKeys() {
      if (keys.size === 0) return;
      keys.clear();
      flyKeys();
    },
    toggleView,
    update(dt) {
      // Steering from the camera's point of view: the figure turns to face the
      // way the camera looks, while the camera itself holds still in the world.
      if (dragButton === 2 && view === 'tpp' && orbit.yaw !== 0) {
        const give = orbit.yaw * Math.min(1, dt * 4);
        orbit.yaw -= give;
        flight.steerBy(give);
      }
      // the look eases back to the course once the pilot lets go
      if (view === 'fpp' && !(dragging && dragButton === 0)) {
        const k = Math.min(1, (dt * 3) / LOOK.returnSeconds);
        look.yaw -= look.yaw * k;
        look.pitch -= look.pitch * k;
        if (Math.abs(look.yaw) < 1e-3) look.yaw = 0;
        if (Math.abs(look.pitch) < 1e-3) look.pitch = 0;
      }
    },
  };
}
