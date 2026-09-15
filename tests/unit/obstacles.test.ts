import { describe, expect, it } from 'vitest';
import { OBSTACLE_CELL, createObstacles, type Obstacle } from '../../src/engine/scenery/Obstacles';

const tree = (x: number, z: number, top: number, radius = 6): Obstacle => ({
  x,
  z,
  ground: top - 20,
  top,
  radius,
});

describe('createObstacles', () => {
  it('reports the highest top under a point, widened by the pad, and nothing elsewhere', () => {
    const o = createObstacles();
    o.add(tree(100, 100, 40, 6));
    o.add(tree(104, 100, 55, 3));
    expect(o.size).toBe(2);
    expect(o.floorAt(100, 100)).toBe(55);
    expect(o.floorAt(112, 100, 5)).toBe(55); // 104 + 3 + 5 = 112 is exactly the boundary — included, since discs are inclusive; 111.9 is comfortably inside
    expect(o.floorAt(111.9, 100, 5)).toBe(55);
    expect(o.floorAt(100, 111, 5)).toBe(40);
    expect(o.floorAt(200, 200)).toBe(-Infinity);
    expect(o.floorAt(100, 100, 0)).toBe(40);
  });
  it('finds records across cell borders and at negative coordinates', () => {
    const o = createObstacles({ cell: 64 });
    o.add(tree(-1, -1, 30, 10));
    o.add(tree(63.5, 0, 31, 2));
    o.add(tree(-300, 500, 32, 40));
    expect(o.floorAt(2, 2)).toBe(30);
    expect(o.floorAt(66, 0)).toBe(31);
    expect(o.floorAt(-262, 500, 0)).toBe(32);
    const out: Obstacle[] = [];
    expect(o.near(0, 0, 70, out)).toBe(out);
    expect(out.map((t) => t.top).sort()).toEqual([30, 31]);
    expect(o.near(-255, 500, 5, out).map((t) => t.top)).toEqual([32]);
    expect(o.near(1000, 1000, 100, out)).toEqual([]);
  });
  it('clears everything and keeps the default cell', () => {
    const o = createObstacles();
    o.add(tree(0, 0, 10));
    o.clear();
    expect(o.size).toBe(0);
    expect(o.floorAt(0, 0)).toBe(-Infinity);
    expect(o.cell).toBe(OBSTACLE_CELL);
    expect(OBSTACLE_CELL).toBe(64);
  });
});
