import { describe, expect, it } from 'vitest';
import { routeGround } from '../../src/engine/scenery/RouteGround';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';

// The worker's sampler has no registry; the cliffs are the world's all the same.
const sampler = createWorldSampler(42);

const cutPoint = () => {
  const out = new Float64Array(5);
  for (let r = 0; r <= 600; r += 16)
    for (let a = 0; a < 32; a++) {
      const x = 3584 + Math.cos((a / 32) * Math.PI * 2) * r,
        z = -2992 + Math.sin((a / 32) * Math.PI * 2) * r;
      sampler.baseFields(x, z, out);
      if (sampler.cliffs.at(x, z, out[0]!, 1) < -20) return { x, z, b: out[0]! };
    }
  throw new Error('no cut near the cliff of seed 42');
};

describe('routeGround', () => {
  it('is the cut coast away from the ends of the route', () => {
    const { x, z, b } = cutPoint();
    const ground = routeGround(sampler, [{ x: x + 5000, z, radius: 300, feather: 300 }]);
    expect(ground(x, z)).toBe(b + sampler.cliffs.at(x, z, b, 1));
    expect(ground(x, z)).toBeLessThan(b - 20);
  });
  it('gives a settlement at either end its cove back, over its own feather', () => {
    const { x, z, b } = cutPoint();
    const full = b + sampler.cliffs.at(x, z, b, 1);
    expect(routeGround(sampler, [{ x, z, radius: 200, feather: 170 }])(x, z)).toBe(b);
    // 230 m past a town's radius is inside its 300 m feather: the cliffs are
    // still giving way there, as they are in the window. A feather of 150 for
    // everyone had them whole again 80 m before the town let go of the ground.
    const town = routeGround(sampler, [{ x: x + 400 + 230, z, radius: 400, feather: 300 }])(x, z);
    expect(town).toBeGreaterThan(full);
    expect(town).toBeLessThan(b);
    // and a village's 170 m is over at 170 m
    expect(routeGround(sampler, [{ x: x + 200 + 170, z, radius: 200, feather: 170 }])(x, z)).toBe(full);
  });
});
