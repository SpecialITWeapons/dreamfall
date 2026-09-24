import { describe, expect, it } from 'vitest';
import type { LotSpec, SitePlan } from '../../library/contract';
import {
  GRASS_ROAD_MARGIN,
  GRASS_WALL_MARGIN,
  PROP_CLAIM,
  ROUTE_CLEARING,
  TREE_MARGIN,
  createClaims,
  type ClaimShapes,
} from '../../src/engine/scenery/Claims';

const shapes: ClaimShapes = {
  building: (id) => (id === 'cottage' ? { radius: 9, footprint: [14, 10] } : null),
};
const lot = (over: Partial<LotSpec> = {}): LotSpec => ({
  x: 100,
  z: 50,
  yaw: 0,
  structure: 'cottage',
  floors: 1,
  ...over,
});
const plan = (over: Partial<SitePlan> = {}): SitePlan => ({
  id: 'village:0,0',
  x: 0,
  z: 0,
  radius: 250,
  roads: [],
  lines: [],
  lots: [],
  reservations: [],
  ...over,
});

describe('createClaims', () => {
  it('claims nothing, and answers so for free, before a plan is added', () => {
    const claims = createClaims();
    expect(claims.trees(0, 0)).toBe(false);
    expect(claims.grass(0, 0)).toBe(false);
    expect(claims.plans).toEqual([]);
  });

  it("keeps a tree off a house by the house's own reach and a margin, and no further", () => {
    const claims = createClaims();
    claims.add(plan({ lots: [lot()] }), shapes);
    const edge = 9 + TREE_MARGIN;
    expect(claims.trees(100 + edge - 0.1, 50)).toBe(true);
    expect(claims.trees(100 + edge + 0.1, 50)).toBe(false);
  });

  it('keeps grass off the walls and eaves only, turned with the house', () => {
    const claims = createClaims();
    // turned a quarter: the 14 m side now runs along z
    claims.add(plan({ lots: [lot({ yaw: Math.PI / 2 })] }), shapes);
    const long = 7 + GRASS_WALL_MARGIN,
      short = 5 + GRASS_WALL_MARGIN;
    expect(claims.grass(100, 50 + long - 0.1)).toBe(true);
    expect(claims.grass(100, 50 + long + 0.1)).toBe(false);
    expect(claims.grass(100 + short - 0.1, 50)).toBe(true);
    expect(claims.grass(100 + short + 0.1, 50)).toBe(false);
    // just past the corner of the walls is garden to the grass, and still the
    // house's reach to a tree
    expect(claims.grass(100 + short + 1, 50 + long + 1)).toBe(false);
    expect(claims.trees(100 + short + 1, 50 + long + 1)).toBe(true);
  });

  it('keeps both off a road, the grass right up to its edge', () => {
    const claims = createClaims();
    claims.add(
      plan({
        roads: [
          {
            points: [
              [-100, 0],
              [100, 0],
            ],
            width: 6,
          },
        ],
      }),
      shapes,
    );
    expect(claims.trees(0, 2.9)).toBe(true);
    expect(claims.trees(0, 3.1)).toBe(false);
    expect(claims.grass(0, 3 + GRASS_ROAD_MARGIN - 0.1)).toBe(true);
    expect(claims.grass(0, 3 + GRASS_ROAD_MARGIN + 0.1)).toBe(false);
    // a road ends where its last point does
    expect(claims.trees(110, 0)).toBe(false);
  });

  it('keeps a square the plan reserved clear of trees, and a prop the plan asked for clear of both', () => {
    const claims = createClaims();
    claims.add(
      plan({
        reservations: [{ x: -50, z: -50, radius: 30 }],
        lots: [lot({ x: 40, z: -40, floors: 0, structure: 'well' })],
      }),
      shapes,
    );
    expect(claims.trees(-50, -21)).toBe(true);
    expect(claims.grass(-50, -21)).toBe(false);
    expect(claims.trees(40 + PROP_CLAIM - 0.1, -40)).toBe(true);
    expect(claims.grass(40 + PROP_CLAIM - 0.1, -40)).toBe(true);
  });

  it('claims nothing for a building nobody baked, since nothing will stand there', () => {
    const claims = createClaims();
    claims.add(plan({ lots: [lot({ structure: 'castle' })] }), shapes);
    expect(claims.trees(100, 50)).toBe(false);
  });

  it('reports each plan with the box its claims cover, and forgets all of it on clear', () => {
    const claims = createClaims();
    claims.add(plan({ lots: [lot()] }), shapes);
    const [bounds] = claims.plans;
    expect(bounds!.id).toBe('village:0,0');
    expect(bounds!.x0).toBeLessThanOrEqual(100 - 9 - TREE_MARGIN);
    expect(bounds!.x1).toBeGreaterThanOrEqual(100 + 9 + TREE_MARGIN);
    claims.clear();
    expect(claims.plans).toEqual([]);
    expect(claims.trees(100, 50)).toBe(false);
  });

  it('cuts a ride through the trees along a road between settlements, and keeps the grass off the road', () => {
    const claims = createClaims();
    claims.addRoute(
      'a|b',
      [
        [0, 0],
        [1000, 0],
      ],
      5,
    );
    expect(claims.trees(500, 2.5 + ROUTE_CLEARING - 0.1)).toBe(true);
    expect(claims.trees(500, 2.5 + ROUTE_CLEARING + 0.1)).toBe(false);
    expect(claims.grass(500, 2.9)).toBe(true);
    expect(claims.grass(500, 3.1)).toBe(false);
    expect(claims.plans.map((p) => p.id)).toEqual(['a|b']);
  });
});
