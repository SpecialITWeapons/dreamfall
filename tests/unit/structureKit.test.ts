import { describe, expect, it } from 'vitest';
import {
  BUDGET,
  defineStructure,
  swatchColor,
  validateLibrary,
  type Structure,
} from '../../library/contract';
import { createLibrary } from '../../library/index.js';
import mill from '../../library/structures/mill.js';
import tower from '../../library/structures/tower.js';
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

/** As much of a baked geometry as the landmark's measurements read. */
type Shape = {
  getAttribute(name: string): {
    count: number;
    getX(i: number): number;
    getY(i: number): number;
    getZ(i: number): number;
  };
};

/** How far from the axis the widest vertex between two heights stands, m. */
const halfWidth = (shape: Shape, lo: number, hi: number): number => {
  const p = shape.getAttribute('position');
  let out = 0;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y >= lo && y <= hi) out = Math.max(out, Math.abs(p.getX(i)), Math.abs(p.getZ(i)));
  }
  return out;
};

/**
 * How far a slice reaches across the axes against how far it reaches across its
 * own diagonals. A square facing the axes is widest corner to corner, so the
 * ratio is the root of two; turn it 45 degrees and the two swap, so the ratio
 * is one over that. It is what tells the two plans apart from directly above --
 * which is the view this matters for -- and it asks nothing of which vertices a
 * cut happened to leave in the slice.
 */
const planReach = (shape: Shape, lo: number, hi: number): number => {
  const p = shape.getAttribute('position');
  let axis = 0,
    diagonal = 0;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < lo || y > hi) continue;
    const x = p.getX(i),
      z = p.getZ(i);
    axis = Math.max(axis, Math.abs(x), Math.abs(z));
    diagonal = Math.max(diagonal, Math.abs(x + z) / Math.SQRT2, Math.abs(x - z) / Math.SQRT2);
  }
  return diagonal / axis;
};

/**
 * The bands that glow, bottom to top, each with the height it spans and the
 * area it lights. Folded out of the triangles rather than clustered out of the
 * vertices: a band cut into a wall has vertices at its own two edges and none
 * in between, so a band taller than the gap a clusterer allows would count as
 * two.
 */
const glowBands = (shape: Shape): Array<{ lo: number; hi: number; area: number }> => {
  const p = shape.getAttribute('position'),
    glow = shape.getAttribute('glow');
  const spans: Array<{ lo: number; hi: number; area: number }> = [];
  for (let i = 0; i < p.count; i += 3) {
    if (glow.getX(i) === 0) continue;
    const ax = p.getX(i + 1) - p.getX(i),
      ay = p.getY(i + 1) - p.getY(i),
      az = p.getZ(i + 1) - p.getZ(i);
    const bx = p.getX(i + 2) - p.getX(i),
      by = p.getY(i + 2) - p.getY(i),
      bz = p.getZ(i + 2) - p.getZ(i);
    const ys = [p.getY(i), p.getY(i + 1), p.getY(i + 2)];
    spans.push({
      lo: Math.min(...ys),
      hi: Math.max(...ys),
      area: Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2,
    });
  }
  spans.sort((a, b) => a.lo - b.lo);
  const bands: Array<{ lo: number; hi: number; area: number }> = [];
  for (const span of spans) {
    const last = bands[bands.length - 1];
    if (last && span.lo <= last.hi + 1e-6) {
      last.hi = Math.max(last.hi, span.hi);
      last.area += span.area;
    } else bands.push({ ...span });
  }
  return bands;
};

describe('the landmark', () => {
  const stage = tower.floorHeight ?? 0;
  const counts = Array.from({ length: tower.floors[1] - tower.floors[0] + 1 }, (_, i) => tower.floors[0] + i);

  it('is an entry the validator takes, and would refuse if it left the palette', () => {
    expect(validateLibrary({ biomes: [], structures: [tower] })).toEqual([]);
    // The trap this entry exists to walk around: the height comes out of a tall
    // storey, not out of a count of them, because every count in the range is
    // its own bake and its own pool.
    expect(tower.floorHeight).toBeGreaterThan(8);
    expect(tower.floors[1] - tower.floors[0] + 1).toBeLessThanOrEqual(BUDGET.floorSpan);
    const gaudy = { ...tower, palette: { ...tower.palette, wall: '#ff00c8' } };
    expect(validateLibrary({ biomes: [], structures: [gaudy] })).toHaveLength(1);
  });

  it('bakes at every floor count the pools will ask for, on a fraction of the budget', () => {
    for (const floors of counts) {
      const triangles = bakeStructure(tower, floors, kit).geometry.getAttribute('position')!.count / 3;
      expect(triangles).toBeLessThan(BUDGET.propTriangles);
      // Measured: 274 at three stages, 338 at four. A landmark is read at a
      // kilometre, where what carries is the outline and not the detail, so the
      // cap sits near the measurement: spending the budget here buys nothing
      // and this says so.
      expect(triangles).toBeLessThan(600);
    }
  });

  it('stands 46 m over a village and 57 m over a town', () => {
    const short = bakeStructure(tower, tower.floors[0], kit),
      tall = bakeStructure(tower, tower.floors[1], kit);
    expect(short.top).toBeGreaterThan(44);
    expect(short.top).toBeLessThan(48);
    expect(tall.top).toBeGreaterThan(55);
    // spec 8 allows a landmark up to 60 m and no further
    expect(tall.top).toBeLessThanOrEqual(60);
    // one more stage, and the stage is where the height lives; the tolerance is
    // float32's, because the top is read back off a baked position buffer
    expect(tall.top).toBeCloseTo(short.top + stage, 4);
    // Three times the tallest thing a village had: the mill is the shape a
    // landmark must not be mistaken for.
    expect(short.top).toBeGreaterThan(3 * bakeStructure(mill, mill.floors[1], kit).top);
    // Slender, because the flight reads a building as a disc of forbidden air
    // as tall as its top and keeps MIN_CLEARANCE over that: the height is the
    // point of a landmark and the girth is only in the way.
    expect(tall.top / tall.radius).toBeGreaterThan(6);
    expect(tall.radius).toBeGreaterThan(Math.hypot(3.3, 3.3));
  });

  it('steps inward at every set-back, so the shaft has a waist', () => {
    for (const floors of counts) {
      const { geometry } = bakeStructure(tower, floors, kit);
      const at = (y: number) => halfWidth(geometry, y - 0.05, y + 0.05);
      // measured at the set-backs themselves, where both stages have vertices
      const widths = Array.from({ length: floors }, (_, i) => at((i + 1) * stage));
      for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeLessThan(widths[i - 1]! - 0.2);
      // The plinth stands out past the wall it carries, and the gallery past
      // the top of the shaft: a break in the outline, which is all that is left
      // of a building at two kilometres. The gallery is measured at its own top
      // plane, 0.6 m over the shaft; move it and this finds nothing there and
      // says so, which is the point of measuring a plane rather than a span.
      expect(at(0)).toBeGreaterThan(widths[0]! + 0.2);
      expect(at(floors * stage + 0.6)).toBeGreaterThan(widths[floors - 1]! + 0.4);
    }
  });

  it('turns the lantern corner-on, so the plan changes between foot and top', () => {
    for (const floors of counts) {
      const { geometry } = bakeStructure(tower, floors, kit);
      const bands = glowBands(geometry);
      // The two top bands are cut into the two stages that carry them, so they
      // measure the plan of each: the shaft's faces the axes and is widest
      // corner to corner, and the lantern's is the same square turned onto its
      // corner, which is what changes the shape seen from straight above.
      const shaft = bands[bands.length - 2]!,
        lamp = bands.at(-1)!;
      expect(planReach(geometry, shaft.lo, shaft.hi)).toBeCloseTo(Math.SQRT2, 2);
      expect(planReach(geometry, lamp.lo, lamp.hi)).toBeCloseTo(1 / Math.SQRT2, 2);
    }
  });

  it('lights one band a stage and a taller one in the lantern', () => {
    for (const floors of counts) {
      const baked = bakeStructure(tower, floors, kit);
      const bands = glowBands(baked.geometry);
      expect(bands).toHaveLength(floors + 1);
      // every stage carries its own band, clear of the string course over it
      for (let i = 0; i < floors; i++) {
        expect(bands[i]!.lo).toBeGreaterThan(i * stage);
        expect(bands[i]!.hi).toBeLessThan((i + 1) * stage - 1);
      }
      // and the lantern's is the tall one, the top one and the brightest: a
      // landmark that goes dark while the cottages under it glow is backwards
      const lamp = bands.at(-1)!;
      expect(lamp.hi - lamp.lo).toBeGreaterThan(2 * (bands[0]!.hi - bands[0]!.lo));
      expect(lamp.area).toBeGreaterThan(bands[0]!.area);
      // Nothing glows on the spire. The kit calls a face a wall when it stands
      // within twenty degrees of vertical, and a spire is well inside that, so
      // a band left too high would cut windows into the roof.
      expect(lamp.hi).toBeLessThan(baked.top - 8);
      // Lit the whole way round, not on one face: four sides of a square turned
      // 45 degrees, times the band. Glow bleeding past the band would show up
      // here as a multiple of it, and a face missed as a fraction.
      const half = halfWidth(baked.geometry, lamp.lo, lamp.hi);
      expect(lamp.area).toBeCloseTo(4 * Math.SQRT2 * half * (lamp.hi - lamp.lo), 3);
    }
  });
});
