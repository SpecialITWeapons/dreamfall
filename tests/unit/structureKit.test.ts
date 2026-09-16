import { describe, expect, it } from 'vitest';
import { defineStructure, swatchColor, type Structure } from '../../library/contract';
import { createLibrary } from '../../library/index.js';
import { bakeStructure, createStructureKit } from '../../src/engine/scenery/StructureKit';

const kit = createStructureKit();
const cottage = (over: Partial<Structure> = {}): Structure =>
  defineStructure({
    id: 'test',
    name: 'test',
    footprint: [7, 5.5],
    floors: [1, 2],
    roof: 'gable',
    palette: { wall: 'sandPale', roof: 'terracotta', window: 'amber' },
    ...over,
  });

/** Every vertex of the geometry, with its height and whether it glows. */
const vertices = (geometry: {
  getAttribute(name: string): { count: number; getX(i: number): number; getY(i: number): number };
}) => {
  const position = geometry.getAttribute('position'),
    glow = geometry.getAttribute('glow');
  return Array.from({ length: position.count }, (_, i) => ({ y: position.getY(i), glow: glow.getX(i) }));
};

/**
 * How much surface glows, in square metres. Area is the invariant worth testing:
 * the vertex count moves with however finely the cutter happens to split a wall,
 * but a band of windows is perimeter times band height times floors, and a bug
 * that bleeds the glow into its neighbours shows up here as a multiple of it.
 */
const glowingArea = (geometry: {
  getAttribute(name: string): {
    count: number;
    getX(i: number): number;
    getY(i: number): number;
    getZ(i: number): number;
  };
}) => {
  const p = geometry.getAttribute('position'),
    glow = geometry.getAttribute('glow');
  let area = 0;
  for (let i = 0; i < p.count; i += 3) {
    if (glow.getX(i) === 0) continue;
    const ax = p.getX(i + 1) - p.getX(i),
      ay = p.getY(i + 1) - p.getY(i),
      az = p.getZ(i + 1) - p.getZ(i);
    const bx = p.getX(i + 2) - p.getX(i),
      by = p.getY(i + 2) - p.getY(i),
      bz = p.getZ(i + 2) - p.getZ(i);
    area += Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2;
  }
  return area;
};

describe('bakeStructure', () => {
  it('measures its own size rather than believing the entry', () => {
    const baked = bakeStructure(cottage(), 2, kit);
    // two storeys of 2.8 plus a gable: taller than the walls, and wide enough
    // to cover a yawed rectangle, because the obstacle the flight reads is a disc
    expect(baked.top).toBeGreaterThan(5.6);
    expect(baked.radius).toBeGreaterThan(Math.hypot(3.5, 2.75));
    expect(bakeStructure(cottage(), 1, kit).top).toBeLessThan(baked.top);
  });
  it('lets an entry ask for more sky than it fills, never less', () => {
    const modest = bakeStructure(cottage({ obstacle: { radius: 1, height: 1 } }), 1, kit);
    const plain = bakeStructure(cottage(), 1, kit);
    expect(modest.radius).toBeCloseTo(plain.radius, 6);
    const greedy = bakeStructure(cottage({ obstacle: { radius: 40, height: 40 } }), 1, kit);
    expect(greedy.radius).toBe(40);
    expect(greedy.top).toBe(40);
  });
  it('glows in the window bands and nowhere else', () => {
    // The bug this pins: a splitter whose pieces share vertex rows paints the
    // glow into its neighbours, and half a cottage lights up from the ground to
    // the eaves. Measured, not eyeballed.
    for (const floors of [1, 2, 3]) {
      const lit = vertices(bakeStructure(cottage(), floors, kit).geometry).filter((v) => v.glow > 0);
      expect(lit.length).toBeGreaterThan(0);
      for (const v of lit) {
        const storey = Math.floor(v.y / 2.8);
        const withinFloor = v.y - storey * 2.8;
        expect(storey).toBeLessThan(floors);
        expect(withinFloor).toBeGreaterThan(0.2);
        expect(withinFloor).toBeLessThan(2.6);
      }
      // One band per floor and no more: the lit area is the wall's perimeter
      // times the band, times the storeys. The bug this pins turned half a
      // cottage into a window, which reads here as several times the area.
      const one = glowingArea(bakeStructure(cottage(), 1, kit).geometry);
      expect(glowingArea(bakeStructure(cottage(), floors, kit).geometry)).toBeCloseTo(one * floors, 3);
    }
  });
  it('gives a windowless building a glow attribute of its own, all zero', () => {
    const shed = bakeStructure(cottage({ palette: { wall: 'sandPale', roof: 'terracotta' } }), 1, kit);
    const glow = shed.geometry.getAttribute('glow');
    expect(glow).toBeTruthy();
    for (let i = 0; i < glow.count; i++) expect(glow.getX(i)).toBe(0);
  });
  it('never mixes glow across one triangle, so a window has an edge', () => {
    const all = vertices(bakeStructure(cottage(), 2, kit).geometry);
    for (let i = 0; i < all.length; i += 3) {
      const [a, b, c] = [all[i]!.glow, all[i + 1]!.glow, all[i + 2]!.glow];
      expect(new Set([a, b, c]).size).toBe(1);
    }
  });
  it('bakes every village recipe at both of its floor counts, inside the budget', () => {
    const structures = createLibrary().structures ?? [];
    expect(structures.length).toBeGreaterThanOrEqual(3);
    for (const spec of structures)
      for (const floors of spec.floors) {
        const baked = bakeStructure(spec, floors, kit);
        const position = baked.geometry.getAttribute('position')!;
        expect(position.count / 3).toBeLessThan(6000);
        expect(baked.top).toBeGreaterThan(floors * 2);
        expect(baked.radius).toBeGreaterThan(1);
      }
  });
  it('paints the colours the entry named, out of the swatch book', () => {
    const baked = bakeStructure(cottage(), 1, kit);
    const color = baked.geometry.getAttribute('color')!;
    const wall = swatchColor('sandPale');
    const seen = new Set<string>();
    for (let i = 0; i < color.count; i++)
      seen.add(`${color.getX(i).toFixed(3)},${color.getY(i).toFixed(3)},${color.getZ(i).toFixed(3)}`);
    // three colours at most: wall, roof, window -- and the wall is one of them
    expect(seen.size).toBeLessThanOrEqual(3);
    expect(wall).toBe(0xd2c99a);
  });
});
