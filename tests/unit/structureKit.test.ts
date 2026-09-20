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
  it('gives a windowless building glow and pane attributes of its own, all zero', () => {
    // The one material reads both for every building; a barn without either
    // would warn in the console and compile a program of its own.
    const shed = bakeStructure(cottage({ palette: { wall: 'sandPale', roof: 'terracotta' } }), 1, kit);
    for (const name of ['glow', 'pane']) {
      const attribute = shed.geometry.getAttribute(name);
      expect(attribute, name).toBeTruthy();
      for (let i = 0; i < attribute.count; i++) expect(attribute.getX(i)).toBe(0);
    }
  });
  it('never mixes glow across one triangle, so a window has an edge', () => {
    const all = vertices(bakeStructure(cottage(), 2, kit).geometry);
    for (let i = 0; i < all.length; i += 3) {
      const [a, b, c] = [all[i]!.glow, all[i + 1]!.glow, all[i + 2]!.glow];
      expect(new Set([a, b, c]).size).toBe(1);
    }
  });
  it('cuts the band into windows with wall between them, and not one belt of paint', () => {
    // What this pins, in the owner's words: the houses had stripes instead of
    // windows. A band painted round a whole storey is one lit run the length of
    // the wall; windows are several, with unlit wall between them, and they
    // stop short of both corners.
    // A house wide enough to have something to say: the fixture above is 7 by
    // 5.5 and its short wall fits one window, which is correct and proves
    // nothing.
    const { geometry } = bakeStructure(cottage({ footprint: [13, 10] }), 1, kit);
    const p = geometry.getAttribute('position'),
      glow = geometry.getAttribute('glow');
    // The wall plane, taken off the windows themselves: the roof overhangs its
    // walls by an eave, so the widest thing on the building is not a wall.
    let far = 0;
    for (let i = 0; i < p.count; i++) if (glow.getX(i) > 0) far = Math.max(far, Math.abs(p.getX(i)));
    // One wall: the one facing +x. Its length is measured in z.
    const lit: Array<[number, number]> = [];
    let span = 0;
    for (let i = 0; i < p.count; i += 3) {
      const onWall = [0, 1, 2].every((k) => Math.abs(p.getX(i + k) - far) < 1e-3);
      if (!onWall) continue;
      const zs = [0, 1, 2].map((k) => p.getZ(i + k));
      span = Math.max(span, Math.max(...zs) - Math.min(...zs));
      if (glow.getX(i) > 0) lit.push([Math.min(...zs), Math.max(...zs)]);
    }
    expect(lit.length).toBeGreaterThan(0);
    // Merge the lit pieces into runs: a belt is one run, windows are several.
    lit.sort((a, b) => a[0] - b[0]);
    const runs: Array<[number, number]> = [];
    for (const [lo, hi] of lit) {
      const last = runs[runs.length - 1];
      if (last && lo <= last[1] + 1e-3) last[1] = Math.max(last[1], hi);
      else runs.push([lo, hi]);
    }
    expect(runs.length).toBeGreaterThanOrEqual(3);
    // and between them is wall, not more window
    const wide = runs.reduce((n, [lo, hi]) => n + (hi - lo), 0);
    expect(wide).toBeLessThan(span * 0.7);
    expect(wide).toBeGreaterThan(span * 0.2);
  });
  it('gives every window a number of its own, so the night can light one and not the next', () => {
    const { geometry } = bakeStructure(cottage(), 2, kit);
    const glow = geometry.getAttribute('glow'),
      pane = geometry.getAttribute('pane');
    const rolls = new Set<number>();
    for (let i = 0; i < glow.count; i += 3) {
      // one number per triangle, as the glow is: a window with two of them
      // would light up in halves
      expect(new Set([0, 1, 2].map((k) => pane.getX(i + k))).size).toBe(1);
      if (glow.getX(i) > 0) rolls.add(pane.getX(i));
      else expect(pane.getX(i)).toBe(0);
    }
    // A cottage at two storeys has four walls of windows twice over, and they
    // do not share a roll: this is what lets one house light its kitchen and
    // the house next door -- the same instanced geometry -- light its landing.
    expect(rolls.size).toBeGreaterThanOrEqual(8);
    for (const roll of rolls) {
      expect(roll).toBeGreaterThan(0);
      expect(roll).toBeLessThan(1);
    }
    // and the same house baked twice is the same house
    const again = bakeStructure(cottage(), 2, kit).geometry.getAttribute('pane');
    for (let i = 0; i < pane.count; i++) expect(again.getX(i)).toBe(pane.getX(i));
  });
  it('lays the panes inside the wall the band cuts, not the widest thing baked', () => {
    // The tower's shaft steps inward stage by stage while its plinth stays the
    // width it is: a pattern laid over the whole geometry's extent put the
    // outer pane past the wall on every stage above the first, and the corner
    // sliced it. Every pane here is as wide as every other, which a pane cut by
    // a corner is not.
    // (The shaft only: the lantern over it stands at forty-five degrees, and
    // the kit cuts along x and z, so its panes are parallelograms of their own.)
    const { geometry } = bakeStructure(tower, tower.floors[1], kit);
    const shaftTop = tower.floors[1] * (tower.floorHeight ?? 0);
    const position = geometry.getAttribute('position'),
      glow = geometry.getAttribute('glow'),
      pane = geometry.getAttribute('pane');
    const widths = new Map<number, { x: [number, number]; z: [number, number] }>();
    for (let i = 0; i < glow.count; i += 3) {
      if (glow.getX(i) <= 0 || position.getY(i) >= shaftTop) continue;
      const box = widths.get(pane.getX(i)) ?? { x: [Infinity, -Infinity], z: [Infinity, -Infinity] };
      for (let k = 0; k < 3; k++) {
        box.x = [Math.min(box.x[0], position.getX(i + k)), Math.max(box.x[1], position.getX(i + k))];
        box.z = [Math.min(box.z[0], position.getZ(i + k)), Math.max(box.z[1], position.getZ(i + k))];
      }
      widths.set(pane.getX(i), box);
    }
    expect(widths.size).toBeGreaterThan(8);
    // a pane on a wall along x is thin in z and wide in x, and the other way
    // about; the wide side is the pane's width and every pane has the same one
    const wide = [...widths.values()].map(({ x, z }) => Math.max(x[1] - x[0], z[1] - z[0]));
    const width = Math.max(...wide);
    for (const w of wide) expect(w).toBeCloseTo(width, 3);
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
      // Measured: 718 at three stages, 922 at four. It was 274 and 338 while a
      // floor's windows were one belt of paint round the whole storey; cutting
      // that belt into panes is what the rest costs, and it is the cheapest cut
      // there is -- slicing the band into its cells rather than splitting it at
      // each of a dozen planes in turn, which came to 1076 for the same tower.
      // A landmark is read at a kilometre, where what carries is the outline
      // and not the detail, so the cap still sits near the measurement.
      expect(triangles).toBeLessThan(1100);
    }
  });

  it('stands 49 m over a village and 60 m over a town', () => {
    const short = bakeStructure(tower, tower.floors[0], kit),
      tall = bakeStructure(tower, tower.floors[1], kit);
    // It was 46 and 57 until the buildings around it grew and it widened with
    // them: the spire and the gallery are fractions of the footprint, so a
    // broader tower is a taller one even at the same stages.
    expect(short.top).toBeGreaterThan(47);
    expect(short.top).toBeLessThan(51);
    expect(tall.top).toBeGreaterThan(57);
    // spec 8 allows a landmark up to 60 m and no further, and this is now hard
    // against that ceiling: the next thing to widen the tower has to lower a
    // stage, or the flight -- which reads only 70 m ahead -- starts to care.
    expect(tall.top).toBeLessThanOrEqual(60);
    // one more stage, and the stage is where the height lives; the tolerance is
    // float32's, because the top is read back off a baked position buffer
    expect(tall.top).toBeCloseTo(short.top + stage, 4);
    // Twice the tallest thing a village has: the mill is the shape a landmark
    // must not be mistaken for. It was three times before the mill grew with
    // everything else, and two and a quarter is still a tower and not a silo.
    expect(short.top).toBeGreaterThan(2 * bakeStructure(mill, mill.floors[1], kit).top);
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
      // Lit on every face, and on none of them the whole way along: four sides
      // of a square turned 45 degrees times the band is what a *belt* of paint
      // would measure, and windows are a fraction of that -- panes of
      // PANE_WIDTH every PANE_PITCH, with a pier left in each corner. Glow
      // bleeding past the band still shows up here as a multiple, a face missed
      // as a fraction of the fraction, and a belt coming back as the whole of
      // it.
      const half = halfWidth(baked.geometry, lamp.lo, lamp.hi);
      const belt = 4 * Math.SQRT2 * half * (lamp.hi - lamp.lo);
      expect(lamp.area).toBeGreaterThan(belt * 0.2);
      expect(lamp.area).toBeLessThan(belt * 0.75);
    }
  });
});
