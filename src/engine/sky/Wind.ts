// One wind for the world: the painted clouds, the puffs, the cloud sea and
// the cloud shadows all drift with it, so the sky reads as one weather. Its
// bearing and strength come from the seed.
import { wrapAngle } from '../flight/angles';
import { hash2 } from '../terrain/noise';

/** Wind speed at cloud level, m/s. */
export const WIND_SPEED = { min: 10, max: 15 };

export interface Wind {
  x: number;
  z: number;
  speed: number;
  /** The heading the wind blows toward, wrapped like every other heading in the codebase. */
  heading: number;
}

export function windFromSeed(seed: number): Wind {
  const s = seed >>> 0;
  const u = hash2(s, 7, 0x77) / 4294967296,
    v = hash2(s, 8, 0x77) / 4294967296;
  const heading = wrapAngle(u * Math.PI * 2),
    speed = WIND_SPEED.min + (WIND_SPEED.max - WIND_SPEED.min) * v;
  return { x: Math.sin(heading) * speed, z: Math.cos(heading) * speed, speed, heading };
}
