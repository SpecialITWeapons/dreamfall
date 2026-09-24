import { describe, expect, it } from 'vitest';
import { MAX_EDGE, relativeNeighbours } from '../../src/engine/scenery/RoadNetwork';

const site = (id: string, x: number, z: number) => ({ id, x, z, radius: 150 });

describe('relativeNeighbours', () => {
  it('joins two places and not the long side of a triangle with a place between', () => {
    // a and c are 8 km apart with b half way: a road a-c would run beside a-b-c
    const a = site('a', 0, 0),
      b = site('b', 4000, 300),
      c = site('c', 8000, 0);
    const ids = relativeNeighbours([a, b, c]).map((e) => e.id);
    expect(ids.sort()).toEqual(['a|b', 'b|c']);
  });

  it('keeps a fair triangle whole, because no corner is nearer both others', () => {
    const ids = relativeNeighbours([site('a', 0, 0), site('b', 6000, 0), site('c', 3000, 5200)]).map(
      (e) => e.id,
    );
    expect(ids.sort()).toEqual(['a|b', 'a|c', 'b|c']);
  });

  it('builds no road longer than the limit', () => {
    expect(relativeNeighbours([site('a', 0, 0), site('b', MAX_EDGE + 1, 0)])).toEqual([]);
    expect(relativeNeighbours([site('a', 0, 0), site('b', MAX_EDGE - 1, 0)])).toHaveLength(1);
  });

  it('names an edge by its ends in one order, whichever order they came in', () => {
    const [edge] = relativeNeighbours([site('zeta', 0, 0), site('alpha', 5000, 0)]);
    expect(edge!.id).toBe('alpha|zeta');
    expect(edge!.a.id).toBe('alpha');
    expect(edge!.length).toBeCloseTo(5000, 6);
  });

  it('is the same graph from any list the same places are in', () => {
    const places = Array.from({ length: 30 }, (_, i) =>
      site(`s${i}`, Math.sin(i * 12.9898) * 20000, Math.cos(i * 78.233) * 20000),
    );
    const one = relativeNeighbours(places)
      .map((e) => e.id)
      .sort();
    const two = relativeNeighbours([...places].reverse())
      .map((e) => e.id)
      .sort();
    expect(two).toEqual(one);
    expect(one.length).toBeGreaterThan(10);
  });
});
