import { describe, expect, it } from 'vitest';
import {
  CELL,
  DECK_Y,
  SEA_LEVEL,
  createWorldSampler,
  fieldSeeds,
} from '../../src/engine/terrain/WorldSampler';

// Golden values from fly-with-me's sampleWorld (src/main.js) run with its own
// noise.js at seed 42. A mismatch is a porting error.
const GOLDEN: Array<[number, number, number, number, number, number]> = [
  // x, z, h, temp, moist, region
  [0, 0, 43.885898831493286, 0.3389616602052784, 0.49133194565451077, 0.3811772964384371],
  [16, 0, 49.07800400732105, 0.33697770947417804, 0.4933500727317423, 0.3809034259185676],
  [0, 16, 47.45946268778542, 0.337558781461992, 0.49175971701949855, 0.38183201374524584],
  [1000, -2500, -45.45181355645342, 0.3671540356034785, 0.5600356371322719, 0.2993904957678658],
  [4200, -3100, 13.11192388506168, 0.4120613366837751, 0.4556548760146777, 0.3998149460073683],
  [-8000, 12000, -16.166510080761512, 0.6381905430566539, 0.7170232122681249, 0.6702442494103805],
  [25000, 25000, -45.45629351833121, 0.7271746177979209, 0.5925410485961038, 0.5138823517971657],
  [-50000, 3000, 3.5465412727481778, 0.5765930410463185, 0.5343973558915266, 0.44134310636810836],
  [123456, -98765, -46.00275420996339, 0.5488885846298275, 0.41766397933725585, 0.6594641465077112],
  [-7, 9, 43.55190882380836, 0.33907347863162784, 0.49068245157486357, 0.3816598744148363],
];

describe('createWorldSampler', () => {
  it('hashes the three field seeds from the seed like fly-with-me', () => {
    expect(fieldSeeds(42)).toEqual({ S1: 63244, S2: 59615, S3: 53122 });
    expect(fieldSeeds(43)).not.toEqual(fieldSeeds(42));
  });
  it('reproduces seed 42 of fly-with-me to six decimals', () => {
    const sampler = createWorldSampler(42);
    const out = new Float32Array(4);
    for (const [x, z, h, temp, moist, region] of GOLDEN) {
      sampler.sample(x, z, out);
      expect(out[0]).toBeCloseTo(h, 4);
      expect(out[1]).toBeCloseTo(temp, 6);
      expect(out[2]).toBeCloseTo(moist, 6);
      expect(out[3]).toBeCloseTo(region, 6);
    }
  });
  it('is deterministic and writes into a plain array too', () => {
    const a = createWorldSampler(7),
      b = createWorldSampler(7);
    const o1 = [0, 0, 0, 0],
      o2 = new Float32Array(4);
    a.sample(1234.5, -678.9, o1);
    b.sample(1234.5, -678.9, o2);
    expect(o1[0]).toBeCloseTo(o2[0]!, 4);
    expect(o1[3]).toBeCloseTo(o2[3]!, 6);
  });
  it('makes about half land and summits above the cloud deck over 80 km at seed 42', () => {
    const sampler = createWorldSampler(42);
    const out = [0, 0, 0, 0];
    let n = 0,
      land = 0,
      hmax = -Infinity,
      hmin = Infinity;
    for (let z = -40000; z < 40000; z += 400)
      for (let x = -40000; x < 40000; x += 400) {
        sampler.sample(x, z, out);
        n++;
        if (out[0]! > SEA_LEVEL) land++;
        hmax = Math.max(hmax, out[0]!);
        hmin = Math.min(hmin, out[0]!);
      }
    expect(n).toBe(40000);
    expect(land / n).toBeCloseTo(0.5043, 3);
    expect(hmax).toBeCloseTo(851.183640166237, 3);
    expect(hmin).toBeCloseTo(-48.14756826224149, 3);
    expect(hmax).toBeGreaterThan(DECK_Y);
  });
  it('exposes the world constants', () => {
    expect(CELL).toBe(16);
    expect(SEA_LEVEL).toBe(0);
    // 520 in fly-with-me and here until the owner raised it: the deck is where
    // the banks are, and from over it the ground shows between them, which
    // reads as height only if there is height between the two.
    expect(DECK_Y).toBe(800);
  });
});
