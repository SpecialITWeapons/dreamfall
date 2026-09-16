import { Color, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { SWATCH, swatchColor, type RoadSpec, type SceneryColor } from '../../library/contract';
import { ROAD_LIFT, ROAD_SAMPLE, ROAD_TRIANGLES, buildRoads } from '../../src/engine/scenery/RoadKit';

/** The buffer is float32: seven digits in all, so five decimals is as tight as metres get. */
const PLACES = 5;

/** Ground with nothing in it, so everything but the lift is the kit's own doing. */
const FLAT = 12;
const flat = { heightAt: () => FLAT };

/** A road down a flat run of world metres: x, z, x, z. */
const road = (width: number, xz: number[], color?: SceneryColor): RoadSpec => ({
  points: Array.from({ length: Math.floor(xz.length / 2) }, (_, i): [number, number] => [
    xz[2 * i]!,
    xz[2 * i + 1]!,
  ]),
  width,
  ...(color === undefined ? {} : { color }),
});

/**
 * The width of the ribbon at every sample, read straight out of the buffer: a
 * quad is six vertices whose first two are the rim pair at the near sample,
 * and the last quad carries the far pair in its fifth and sixth.
 */
const widths = (geometry: BufferGeometry): number[] => {
  const p = geometry.getAttribute('position');
  const quads = p.count / 6;
  const span = (i: number, j: number) =>
    Math.hypot(p.getX(i) - p.getX(j), p.getY(i) - p.getY(j), p.getZ(i) - p.getZ(j));
  const out: number[] = [];
  for (let q = 0; q < quads; q++) out.push(span(q * 6, q * 6 + 1));
  out.push(span((quads - 1) * 6 + 4, (quads - 1) * 6 + 5));
  return out;
};

describe('buildRoads', () => {
  it('measures its vertices from where it is told, and still reads the ground in the world', () => {
    // The scene is in the local frame of a floating origin, so a road is built
    // around its own site and hung there; the ground under it is a world
    // question and stays one.
    const asked: Array<[number, number]> = [];
    const ramp = (x: number, z: number) => {
      asked.push([x, z]);
      return x / 100;
    };
    const road: RoadSpec = {
      points: [
        [1000, 2000],
        [1040, 2000],
      ],
      width: 8,
    };
    const there = buildRoads([road], { heightAt: ramp, at: [1000, 2000] })!;
    const here = buildRoads([road], { heightAt: ramp })!;
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
  it('samples a straight road every four metres and lays it exactly above the ground', () => {
    expect(ROAD_SAMPLE).toBe(4);
    expect(ROAD_LIFT).toBe(0.15);
    const geometry = buildRoads([road(6, [0, 0, 100, 0])], flat);
    expect(geometry).not.toBeNull();
    const p = geometry!.getAttribute('position');
    // 100 m at 4 m is 25 quads, and a quad is two triangles of three vertices
    expect(p.count).toBe(25 * 6);
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeCloseTo(FLAT + ROAD_LIFT, PLACES);
    const xs = Array.from({ length: p.count }, (_, i) => p.getX(i));
    const zs = Array.from({ length: p.count }, (_, i) => p.getZ(i));
    expect(Math.min(...xs)).toBeCloseTo(0, PLACES);
    expect(Math.max(...xs)).toBeCloseTo(100, PLACES);
    // the width is spent either side of the polyline, and no corner bends it
    expect(Math.min(...zs)).toBeCloseTo(-3, PLACES);
    expect(Math.max(...zs)).toBeCloseTo(3, PLACES);
    for (const w of widths(geometry!)) expect(w).toBeCloseTo(6, PLACES);
    const n = geometry!.getAttribute('normal');
    for (let i = 0; i < n.count; i++) expect(n.getY(i)).toBeCloseTo(1, PLACES);
  });

  it('paints packed earth unless the road asks for a colour, and merges a site into one geometry', () => {
    expect(swatchColor('clay')).toBe(SWATCH.clay);
    const earth = new Color(swatchColor('clay'));
    const one = buildRoads([road(6, [0, 0, 100, 0])], flat)!;
    const c = one.getAttribute('color');
    expect(c.count).toBe(one.getAttribute('position').count);
    for (let i = 0; i < c.count; i += 7) {
      expect(c.getX(i)).toBeCloseTo(earth.r, PLACES);
      expect(c.getY(i)).toBeCloseTo(earth.g, PLACES);
      expect(c.getZ(i)).toBeCloseTo(earth.b, PLACES);
    }
    const stone = new Color(swatchColor('stoneWarm'));
    const two = buildRoads([road(6, [0, 0, 100, 0]), road(4, [0, 40, 60, 40], 'stoneWarm')], flat)!;
    // both roads of a site are one geometry: 25 quads and 15 more
    expect(two.getAttribute('position').count).toBe((25 + 15) * 6);
    const paint = two.getAttribute('color');
    expect(paint.getX(0)).toBeCloseTo(earth.r, PLACES);
    expect(paint.getX(paint.count - 1)).toBeCloseTo(stone.r, PLACES);
    expect(paint.getZ(paint.count - 1)).toBeCloseTo(stone.b, PLACES);
  });

  it('carries the width around a ninety degree corner on the bisector, without pinching', () => {
    const width = 6;
    const geometry = buildRoads([road(width, [0, 0, 48, 0, 48, 48])], flat)!;
    // 12 quads up the first leg, 12 up the second: the corner is one sample of both
    expect(geometry.getAttribute('position').count).toBe(24 * 6);
    const spans = widths(geometry);
    expect(spans).toHaveLength(25);
    for (const span of spans) expect(span).toBeGreaterThanOrEqual(width - 1e-4);
    // the mitre at the corner is the only sample wider than the road
    expect(Math.max(...spans)).toBeCloseTo(width * Math.SQRT2, PLACES);
    expect(spans.filter((s) => s > width + 1e-4)).toHaveLength(1);
    // and it is wider because both rims stand where the two legs' own edges
    // cross: three metres off the one, three off the other
    const p = geometry.getAttribute('position');
    const q = spans.indexOf(Math.max(...spans)) * 6;
    expect([p.getX(q), p.getZ(q)]).toEqual([51, -3]);
    expect([p.getX(q + 1), p.getZ(q + 1)]).toEqual([45, 3]);
  });

  it('follows a slope, in the height and in the normal', () => {
    const slope = 0.2;
    const ground = { heightAt: (x: number) => slope * x + 5 };
    const geometry = buildRoads([road(8, [0, 0, 40, 0])], ground)!;
    const p = geometry.getAttribute('position'),
      n = geometry.getAttribute('normal');
    for (let i = 0; i < p.count; i++)
      expect(p.getY(i)).toBeCloseTo(slope * p.getX(i) + 5 + ROAD_LIFT, PLACES);
    // the terrain's own normal: (-dh/dx, 1, -dh/dz) made a unit vector
    const len = Math.hypot(slope, 1);
    for (let i = 0; i < n.count; i++) {
      expect(n.getX(i)).toBeCloseTo(-slope / len, PLACES);
      expect(n.getY(i)).toBeCloseTo(1 / len, PLACES);
      expect(n.getZ(i)).toBeCloseTo(0, PLACES);
    }
  });

  it('honours a lift of its own', () => {
    const geometry = buildRoads([road(6, [0, 0, 20, 0])], { ...flat, lift: 1 })!;
    const p = geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeCloseTo(FLAT + 1, PLACES);
  });

  it('refuses a site whose roads are over the triangle budget, by name', () => {
    expect(ROAD_TRIANGLES).toBe(60000);
    const long = road(6, [0, 0, 2000, 0]);
    expect(() => buildRoads([long], { ...flat, triangles: 100, site: 'oakhollow' })).toThrow(
      /oakhollow.*1000 triangles.*budget is 100/,
    );
    expect(() => buildRoads([long], { ...flat, triangles: 100 })).toThrow(/triangles/);
    expect(() => buildRoads([long], flat)).not.toThrow();
  });

  it('builds nothing out of nothing', () => {
    expect(buildRoads([], flat)).toBeNull();
    expect(buildRoads([road(6, [])], flat)).toBeNull();
    expect(buildRoads([road(6, [0, 0])], flat)).toBeNull();
    // a repeated point is no road, and neither is one shorter than a single sample
    expect(buildRoads([road(6, [10, 10, 10, 10])], flat)).toBeNull();
    expect(buildRoads([road(6, [0, 0, 3, 0])], flat)).toBeNull();
    // one road too short to sample does not take the next one's width or paint with it
    const kept = buildRoads([road(6, [0, 0, 3, 0]), road(10, [0, 0, 20, 0], 'stoneWarm')], flat)!;
    expect(kept.getAttribute('position').count).toBe(5 * 6);
    for (const w of widths(kept)) expect(w).toBeCloseTo(10, PLACES);
    expect(kept.getAttribute('color').getX(0)).toBeCloseTo(new Color(swatchColor('stoneWarm')).r, PLACES);
  });
});
