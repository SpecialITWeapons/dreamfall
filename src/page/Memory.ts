// Memory. The page remembers the viewer's settings, and per world where the
// flight was, so reopening the tab resumes instead of restarting. Storage can
// be missing, full or damaged; any of those makes this a fresh visit. Pure:
// the storage is handed in, so Node tests use a Map.
import { ORBIT, type View } from '../engine/flight/Steering';
import type { ResumeState } from '../engine/sim/Simulation';

export const SETTINGS_KEY = 'dreamfall-settings';
export const RESUME_KEY = 'dreamfall-resume';

/** A finite number inside [min, max], or null: the one gate every remembered field passes. */
export const finite = (v: unknown, min = -Infinity, max = Infinity): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface Settings {
  volume: number;
  muted: boolean;
  /** The third-person framing: yaw, pitch and distance. */
  camera: { yaw: number; pitch: number; dist: number };
  view: View;
  outfit: string;
  pattern: string;
}

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.5,
  muted: false,
  camera: { yaw: 0, pitch: ORBIT.pitch, dist: ORBIT.dist },
  view: 'tpp',
  outfit: 'dusk',
  pattern: 'plain',
};

type Raw = Record<string, unknown>;
const record = (v: unknown): Raw | null => (v && typeof v === 'object' ? (v as Raw) : null);

export function validateSettings(raw: unknown): Settings {
  const r = record(raw) ?? {};
  const cam = record(r.camera) ?? {};
  return {
    volume: finite(r.volume, 0, 1) ?? DEFAULT_SETTINGS.volume,
    muted: r.muted === true,
    camera: {
      yaw: finite(cam.yaw, -Math.PI, Math.PI) ?? DEFAULT_SETTINGS.camera.yaw,
      pitch: finite(cam.pitch, ORBIT.minPitch, ORBIT.maxPitch) ?? DEFAULT_SETTINGS.camera.pitch,
      dist: finite(cam.dist, ORBIT.minDist, ORBIT.maxDist) ?? DEFAULT_SETTINGS.camera.dist,
    },
    view: r.view === 'fpp' ? 'fpp' : 'tpp',
    outfit: typeof r.outfit === 'string' ? r.outfit : DEFAULT_SETTINGS.outfit,
    pattern: typeof r.pattern === 'string' ? r.pattern : DEFAULT_SETTINGS.pattern,
  };
}

/** The seed of a remembered flight, for an address without one. */
export function rememberedSeed(raw: unknown): number | null {
  return finite(record(raw)?.seed, 0, 0xffffffff);
}

/** A remembered flight of this seed, every field checked; null starts fresh. */
export function validateResume(raw: unknown, seed: number): ResumeState | null {
  const r = record(raw);
  if (!r || r.seed !== seed) return null;
  const n = (key: string, min?: number, max?: number) => finite(r[key], min, max);
  const x = n('x'),
    z = n('z'),
    y = n('y', -200, 6000),
    heading = n('heading'),
    t = n('t', 0),
    dayPhase = n('dayPhase', 0, 1);
  if (x === null || z === null || y === null || heading === null || t === null || dayPhase === null)
    return null;
  const low = record(r.low) ?? {};
  return {
    seed,
    x,
    y,
    z,
    t,
    heading,
    vy: n('vy', -40, 40) ?? 0,
    bank: n('bank', -1, 1) ?? 0,
    pitch: n('pitch', -1, 1) ?? 0,
    yawRate: n('yawRate', -1, 1) ?? 0,
    dayPhase,
    cloudSchedule: n('cloudSchedule', 0, 1) ?? 0,
    cloudOrigin: n('cloudOrigin') ?? -150,
    low: {
      on: low.on === true,
      next: finite(low.next, 0) ?? t + 160,
      until: finite(low.until, 0) ?? 0,
      amount: finite(low.amount, 0, 1) ?? 0,
    },
    released: r.released === true,
  };
}

export interface Memory {
  read(key: string): unknown;
  write(key: string, value: unknown): void;
  readSettings(): Settings;
  writeSettings(settings: Settings): void;
  readResume(): unknown;
  writeResume(state: ResumeState): void;
}

export function createMemory(storage: StorageLike | null): Memory {
  const read = (key: string): unknown => {
    if (!storage) return null;
    try {
      const value: unknown = JSON.parse(storage.getItem(key) ?? 'null');
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  };
  const write = (key: string, value: unknown) => {
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch {
      // nothing to remember with; the page still works
    }
  };
  return {
    read,
    write,
    readSettings: () => validateSettings(read(SETTINGS_KEY)),
    writeSettings: (settings) => write(SETTINGS_KEY, settings),
    readResume: () => read(RESUME_KEY),
    writeResume: (state) => write(RESUME_KEY, state),
  };
}

/** localStorage when the browser allows it; some contexts throw on the access itself. */
export function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
