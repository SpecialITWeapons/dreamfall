import { describe, expect, it } from 'vitest';
import { END_FEATHER, routeGround } from '../../src/engine/scenery/RouteGround';
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
    const ground = routeGround(sampler, [{ x: x + 5000, z, radius: 300 }]);
    expect(ground(x, z)).toBe(b + sampler.cliffs.at(x, z, b, 1));
    expect(ground(x, z)).toBeLessThan(b - 20);
  });
  it('gives a settlement at either end its cove back, over its feather', () => {
    const { x, z, b } = cutPoint();
    expect(routeGround(sampler, [{ x, z, radius: 200 }])(x, z)).toBe(b);
    const edge = routeGround(sampler, [{ x: x + 200 + END_FEATHER / 2, z, radius: 200 }])(x, z);
    expect(edge).toBeGreaterThan(b + sampler.cliffs.at(x, z, b, 1));
    expect(edge).toBeLessThan(b);
  });
});
