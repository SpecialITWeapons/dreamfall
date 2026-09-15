import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  RESUME_KEY,
  SETTINGS_KEY,
  createMemory,
  finite,
  rememberedSeed,
  validateResume,
  validateSettings,
} from '../../src/page/Memory';
import type { ResumeState } from '../../src/engine/sim/Simulation';

const mapStorage = () => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
};
const flight = (): ResumeState => ({
  seed: 42,
  x: 1000,
  y: 200,
  z: -500,
  t: 300,
  heading: 1.2,
  vy: 2,
  bank: 0.1,
  pitch: 0.05,
  yawRate: 0.01,
  dayPhase: 0.4,
  cloudSchedule: 0.3,
  cloudOrigin: 100,
  low: { on: true, next: 500, until: 320, amount: 0.5 },
  released: true,
});

describe('finite', () => {
  it('accepts finite numbers inside the range only', () => {
    expect(finite(1)).toBe(1);
    expect(finite(1, 0, 1)).toBe(1);
    expect(finite(2, 0, 1)).toBe(null);
    expect(finite(NaN)).toBe(null);
    expect(finite('1')).toBe(null);
    expect(finite(Infinity)).toBe(null);
    expect(finite(undefined)).toBe(null);
  });
});

describe('validateSettings', () => {
  it('fills defaults, clamps the camera and keeps only known views', () => {
    expect(validateSettings(null)).toEqual(DEFAULT_SETTINGS);
    const s = validateSettings({
      volume: 2,
      muted: 'yes',
      camera: { yaw: 9, pitch: 0.5, dist: 20 },
      view: 'fpp',
      outfit: 'x',
      pattern: 3,
    });
    expect(s.volume).toBe(DEFAULT_SETTINGS.volume);
    expect(s.muted).toBe(false);
    expect(s.camera).toEqual({ yaw: 0, pitch: 0.5, dist: 20 });
    expect(s.view).toBe('fpp');
    expect(s.outfit).toBe('x');
    expect(s.pattern).toBe('plain');
    expect(validateSettings({ view: 'side', muted: true }).view).toBe('tpp');
    expect(validateSettings({ muted: true }).muted).toBe(true);
  });
});

describe('validateResume', () => {
  it('round-trips a flight of the same seed and rejects another seed or a broken record', () => {
    const f = flight();
    expect(validateResume(f, 42)).toEqual(f);
    expect(validateResume(f, 43)).toBe(null);
    expect(validateResume({ ...f, y: NaN }, 42)).toBe(null);
    expect(validateResume({ ...f, heading: undefined }, 42)).toBe(null);
    expect(validateResume({ ...f, dayPhase: 1.5 }, 42)).toBe(null);
    expect(validateResume(null, 42)).toBe(null);
    expect(validateResume('42', 42)).toBe(null);
    expect(rememberedSeed(f)).toBe(42);
    expect(rememberedSeed(null)).toBe(null);
    expect(rememberedSeed({ seed: -1 })).toBe(null);
  });
  it('fills the optional fields with safe defaults', () => {
    const r = validateResume({ seed: 1, x: 0, y: 100, z: 0, t: 50, heading: 0, dayPhase: 0.5 }, 1)!;
    expect(r.vy).toBe(0);
    expect(r.cloudOrigin).toBe(-150);
    expect(r.low).toEqual({ on: false, next: 210, until: 0, amount: 0 });
    expect(r.released).toBe(false);
    expect(r.dayPhase).toBe(0.5);
  });
});

describe('createMemory', () => {
  it('reads and writes JSON records, and treats damage or absence as a fresh visit', () => {
    const storage = mapStorage();
    const memory = createMemory(storage);
    expect(memory.readSettings()).toEqual(DEFAULT_SETTINGS);
    memory.writeSettings({ ...DEFAULT_SETTINGS, volume: 0.2 });
    expect(JSON.parse(storage.map.get(SETTINGS_KEY)!).volume).toBe(0.2);
    expect(memory.readSettings().volume).toBe(0.2);
    storage.map.set(RESUME_KEY, '{not json');
    expect(memory.readResume()).toBe(null);
    storage.map.set(RESUME_KEY, '"a string"');
    expect(memory.readResume()).toBe(null);
    memory.writeResume(flight());
    expect(validateResume(memory.readResume(), 42)).toEqual(flight());
  });
  it('works without storage and when storage throws', () => {
    const none = createMemory(null);
    none.writeSettings(DEFAULT_SETTINGS);
    expect(none.readResume()).toBe(null);
    expect(none.readSettings()).toEqual(DEFAULT_SETTINGS);
    const broken = createMemory({
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('full');
      },
    });
    expect(() => broken.writeResume(flight())).not.toThrow();
    expect(broken.readSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
