import { Color, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { swatchColor, type LineSpec } from '../../library/contract';
import {
  LINE_KINDS,
  LINE_SAMPLE,
  LINE_SINK,
  LINE_TRIANGLES,
  buildLines,
} from '../../src/engine/scenery/LineKit';

/** The buffer is float32: seven digits in all, so five decimals is as tight as metres get. */
const PLACES = 5;

/** Ground with nothing in it, so everything but the sink is the kit's own doing. */
const FLAT = 12;
const flat = { heightAt: () => FLAT };

/** A line down a flat run of world metres: x, z, x, z. */
const line = (kind: string, xz: number[], height?: number): LineSpec => ({
  points: Array.from({ length: Math.floor(xz.length / 2) }, (_, i): [number, number] => [
    xz[2 * i]!,
    xz[2 * i + 1]!,
  ]),
  kind,
  ...(height === undefined ? {} : { height }),
});

/** Vertices one span costs: two faces for a ribbon, two faces and a top for a box. */
const RIBBON_SPAN = 12,
  BOX_SPAN = 18;
/** Vertices a box spends on its two ends, once per line. */
const ENDS = 12;

const triangles = (geometry: BufferGeometry) => geometry.getAttribute('position').count / 3;

/**
 * How far it is across the line at every sample, read straight out of the
 * buffer: a span is the face along the offset, the face against it and (for a
 * box) the top, in that order, and the first corner pushed of each face is its
 * near top. Measured flat, because the two faces of a line on a slope stand on
 * their own ground and are not at the same height.
 */
const across = (geometry: BufferGeometry, perSpan: number, spans: number): number[] => {
  const p = geometry.getAttribute('position');
  const span = (i: number, j: number) => Math.hypot(p.getX(i) - p.getX(j), p.getZ(i) - p.getZ(j));
  const out: number[] = [];
  for (let q = 0; q < spans; q++) out.push(span(q * perSpan, q * perSpan + 6));
  // the far pair of the last span: the second corner of one face, the last of the other
  out.push(span((spans - 1) * perSpan + 1, (spans - 1) * perSpan + 11));
  return out;
};

/**
 * Vertices whose triangle is wound against the normal they carry. A face
 * turned inside out is not a shading mistake -- the material culls backs, so it
 * is a hole in the wall -- and it is invisible to every other assertion here.
 */
const misfacing = (geometry: BufferGeometry): number => {
  const p = geometry.getAttribute('position'),
    n = geometry.getAttribute('normal');
  let bad = 0;
  for (let t = 0; t + 2 < p.count; t += 3) {
    const ux = p.getX(t + 1) - p.getX(t),
      uy = p.getY(t + 1) - p.getY(t),
      uz = p.getZ(t + 1) - p.getZ(t);
    const vx = p.getX(t + 2) - p.getX(t),
      vy = p.getY(t + 2) - p.getY(t),
      vz = p.getZ(t + 2) - p.getZ(t);
    const cx = uy * vz - uz * vy,
      cy = uz * vx - ux * vz,
      cz = ux * vy - uy * vx;
    for (let k = 0; k < 3; k++) if (cx * n.getX(t + k) + cy * n.getY(t + k) + cz * n.getZ(t + k) <= 0) bad++;
  }
  return bad;
};

describe('buildLines', () => {
  it('samples a fence every four metres and paints the one ribbon on both sides', () => {
    expect(LINE_SAMPLE).toBe(4);
    expect(LINE_SINK).toBe(0.2);
    expect(LINE_KINDS.fence!.thickness).toBe(0);
    const geometry = buildLines([line('fence', [0, 0, 100, 0])], flat)!;
    expect(geometry).not.toBeNull();
    const p = geometry.getAttribute('position');
    // 100 m at 4 m is 25 spans, and a span of a ribbon is two quads: one triangle a metre
    expect(p.count).toBe(25 * RIBBON_SPAN);
    expect(triangles(geometry)).toBe(100);
    const xs = Array.from({ length: p.count }, (_, i) => p.getX(i));
    expect(Math.min(...xs)).toBeCloseTo(0, PLACES);
    expect(Math.max(...xs)).toBeCloseTo(100, PLACES);
    // a fence has no thickness at all: the two faces are one plane
    for (const width of across(geometry, RIBBON_SPAN, 25)) expect(width).toBeCloseTo(0, PLACES);
    // and the plane is seen from both sides, half the vertices facing each way
    const n = geometry.getAttribute('normal');
    const front = Array.from({ length: n.count }, (_, i) => n.getZ(i)).filter((z) => z < -0.99);
    expect(front).toHaveLength(p.count / 2);
    for (let i = 0; i < n.count; i++) expect(n.getY(i)).toBeCloseTo(0, PLACES);
    expect(misfacing(geometry)).toBe(0);
  });

  it('gives a wall and a hedge a box with a top and two ends', () => {
    for (const kind of ['wall', 'hedge']) {
      expect(LINE_KINDS[kind]!.thickness).toBeGreaterThan(0);
      const geometry = buildLines([line(kind, [0, 0, 100, 0])], flat)!;
      // 25 spans of three quads, and one pair of ends: 1.54 triangles a metre
      expect(geometry.getAttribute('position').count).toBe(25 * BOX_SPAN + ENDS);
      expect(triangles(geometry)).toBe(154);
      const thickness = LINE_KINDS[kind]!.thickness;
      for (const width of across(geometry, BOX_SPAN, 25)) expect(width).toBeCloseTo(thickness, PLACES);
      const n = geometry.getAttribute('normal');
      const ny = Array.from({ length: n.count }, (_, i) => n.getY(i));
      // the top faces the sky, and nothing faces the ground: a box has no floor
      expect(ny.filter((y) => y > 0.99)).toHaveLength(25 * 6);
      expect(ny.filter((y) => y < -0.99)).toHaveLength(0);
      // and the two ends face out along the line, or the box is seen through
      const nx = Array.from({ length: n.count }, (_, i) => n.getX(i));
      expect(nx.filter((x) => x < -0.99)).toHaveLength(6);
      expect(nx.filter((x) => x > 0.99)).toHaveLength(6);
      expect(misfacing(geometry)).toBe(0);
    }
  });

  it('stands on the ground at every sample, with a top that follows it', () => {
    // A plane tilted both ways: along the line, so the top cannot be level, and
    // across it, so the two faces of a box do not stand on the same ground.
    const ground = (x: number, z: number) => 3 + 0.08 * x + 0.05 * z;
    const height = 1.1;
    const geometry = buildLines([line('wall', [0, 0, 60, 0], height)], { heightAt: ground })!;
    const p = geometry.getAttribute('position');
    const tops: number[] = [];
    for (let i = 0; i < p.count; i++) {
      const above = p.getY(i) - ground(p.getX(i), p.getZ(i));
      // every vertex is either the foot, buried, or the head, its height up
      expect(Math.min(Math.abs(above - height), Math.abs(above + LINE_SINK))).toBeLessThan(1e-4);
      if (above > 0) tops.push(p.getY(i));
    }
    // The top follows the ground rather than levelling out over the slope: the
    // whole fall of the hillside, along the wall and across it, is in the top.
    const half = LINE_KINDS.wall!.thickness / 2;
    expect(Math.max(...tops) - Math.min(...tops)).toBeCloseTo(0.08 * 60 + 0.05 * 2 * half, 3);
    // and each face read the ground under itself: across 0.45 m of wall the
    // hillside falls 0.0225 m, and a foot that read the middle would not know
    const feet = new Map<number, number>();
    for (let i = 0; i < p.count; i++)
      if (p.getY(i) - ground(p.getX(i), p.getZ(i)) < 0 && Math.abs(p.getX(i) - 20) < 1e-6)
        feet.set(Math.round(p.getZ(i) * 1e6) / 1e6, p.getY(i));
    expect([...feet.keys()].sort((a, b) => a - b)).toEqual([-half, half]);
    expect(feet.get(half)! - feet.get(-half)!).toBeCloseTo(0.05 * 2 * half, PLACES);
  });

  it('carries the thickness around a ninety degree corner, without pinching', () => {
    const thickness = LINE_KINDS.wall!.thickness;
    const geometry = buildLines([line('wall', [0, 0, 48, 0, 48, 48])], flat)!;
    // 12 spans up the first leg, 12 up the second: the corner is a sample of both
    expect(geometry.getAttribute('position').count).toBe(24 * BOX_SPAN + ENDS);
    const widths = across(geometry, BOX_SPAN, 24);
    expect(widths).toHaveLength(25);
    for (const width of widths) expect(width).toBeGreaterThanOrEqual(thickness - 1e-4);
    // the mitre at the corner is the only sample wider than the wall
    expect(Math.max(...widths)).toBeCloseTo(thickness * Math.SQRT2, PLACES);
    expect(widths.filter((w) => w > thickness + 1e-4)).toHaveLength(1);
    // and it is wider because both faces stand where the two legs' own faces
    // cross: a half-thickness off the one, a half-thickness off the other
    const p = geometry.getAttribute('position');
    const q = widths.indexOf(Math.max(...widths)) * BOX_SPAN;
    const half = thickness / 2;
    expect(p.getX(q)).toBeCloseTo(48 + half, PLACES);
    expect(p.getZ(q)).toBeCloseTo(-half, PLACES);
    expect(p.getX(q + 6)).toBeCloseTo(48 - half, PLACES);
    expect(p.getZ(q + 6)).toBeCloseTo(half, PLACES);
    expect(misfacing(geometry)).toBe(0);
  });

  it('measures its vertices from where it is told, and still reads the ground in the world', () => {
    // The scene is in the local frame of a floating origin, so a line is built
    // around its own site and hung there; the ground under it is a world
    // question and stays one.
    const asked: Array<[number, number]> = [];
    const ramp = (x: number, z: number) => {
      asked.push([x, z]);
      return x / 100;
    };
    const fence = line('fence', [1000, 2000, 1040, 2000]);
    const there = buildLines([fence], { heightAt: ramp, at: [1000, 2000] })!;
    const here = buildLines([fence], { heightAt: ramp })!;
    const a = there.getAttribute('position'),
      b = here.getAttribute('position');
    expect(a.count).toBe(b.count);
    for (let i = 0; i < a.count; i++) {
      expect(a.getX(i)).toBeCloseTo(b.getX(i) - 1000, 4);
      expect(a.getZ(i)).toBeCloseTo(b.getZ(i) - 2000, 4);
      // the height is the same one: it was asked of the world either way
      expect(a.getY(i)).toBeCloseTo(b.getY(i), 6);
    }
    expect(asked.every(([x]) => x >= 900)).toBe(true);
  });

  it('paints each kind out of the swatch book, and merges a site into one geometry', () => {
    const wood = new Color(swatchColor(LINE_KINDS.fence!.color));
    const leaf = new Color(swatchColor(LINE_KINDS.hedge!.color));
    expect(wood.getHex()).not.toBe(leaf.getHex());
    const two = buildLines([line('fence', [0, 0, 40, 0]), line('hedge', [0, 20, 40, 20])], flat)!;
    // both lines of a site are one geometry: a fence of ten spans and a hedge
    expect(two.getAttribute('position').count).toBe(10 * RIBBON_SPAN + 10 * BOX_SPAN + ENDS);
    const c = two.getAttribute('color');
    expect(c.count).toBe(two.getAttribute('position').count);
    expect(c.getX(0)).toBeCloseTo(wood.r, PLACES);
    expect(c.getZ(0)).toBeCloseTo(wood.b, PLACES);
    expect(c.getX(c.count - 1)).toBeCloseTo(leaf.r, PLACES);
    expect(c.getZ(c.count - 1)).toBeCloseTo(leaf.b, PLACES);
  });

  it('refuses a site whose lines are over the triangle budget, by name', () => {
    expect(LINE_TRIANGLES).toBe(30000);
    const long = line('wall', [0, 0, 2000, 0]);
    // 500 spans of six triangles, and four for the ends
    expect(() => buildLines([long], { ...flat, triangles: 100, site: 'oakhollow' })).toThrow(
      /oakhollow.*3004 triangles.*line budget is 100/,
    );
    expect(() => buildLines([long], { ...flat, triangles: 100 })).toThrow(/triangles/);
    expect(() => buildLines([long], flat)).not.toThrow();
  });

  it('refuses a kind nobody has, and a height that stands nothing up, by name', () => {
    expect(() => buildLines([line('palisade', [0, 0, 40, 0])], { ...flat, site: 'oakhollow' })).toThrow(
      /oakhollow.*unknown line kind "palisade"/,
    );
    expect(() => buildLines([line('fence', [0, 0, 40, 0], 0)], { ...flat, site: 'oakhollow' })).toThrow(
      /oakhollow.*fence 0 m/,
    );
    // said before a float is allocated, so a line too short to draw is still refused
    expect(() => buildLines([line('palisade', [0, 0])], flat)).toThrow(/unknown line kind/);
  });

  it('builds nothing out of nothing', () => {
    expect(buildLines([], flat)).toBeNull();
    expect(buildLines([line('fence', [])], flat)).toBeNull();
    expect(buildLines([line('fence', [0, 0])], flat)).toBeNull();
    // a repeated point is no line, and neither is one shorter than a single sample
    expect(buildLines([line('fence', [10, 10, 10, 10])], flat)).toBeNull();
    expect(buildLines([line('fence', [0, 0, 3, 0])], flat)).toBeNull();
    // one line too short to sample does not take the next one's kind or paint
    const kept = buildLines([line('fence', [0, 0, 3, 0]), line('wall', [0, 0, 20, 0])], flat)!;
    expect(kept.getAttribute('position').count).toBe(5 * BOX_SPAN + ENDS);
    for (const width of across(kept, BOX_SPAN, 5))
      expect(width).toBeCloseTo(LINE_KINDS.wall!.thickness, PLACES);
    expect(kept.getAttribute('color').getX(0)).toBeCloseTo(
      new Color(swatchColor(LINE_KINDS.wall!.color)).r,
      PLACES,
    );
  });
});
