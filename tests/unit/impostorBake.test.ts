import { describe, expect, it } from 'vitest';
import {
  ATLAS_COLUMNS,
  ATLAS_ROWS,
  LEAF_CUTOFF,
  TILE,
  bakeView,
  buildAtlas,
  shapeOf,
  tileOf,
  type BakeSource,
  type Mesh3,
  type Picture,
} from '../../src/engine/scenery/ImpostorBake';

/** Two triangles of an axis-aligned rectangle, facing +z, from (x0, y0) to (x1, y1) at depth z. */
const wall = (x0: number, y0: number, x1: number, y1: number, z: number): Mesh3 => ({
  position: [x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z],
  normal: Array.from({ length: 6 }, () => [0, 0, 1]).flat(),
  uv: [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1],
});
const join = (...meshes: Mesh3[]): Mesh3 => ({
  position: meshes.flatMap((m) => Array.from(m.position)),
  normal: meshes.flatMap((m) => Array.from(m.normal)),
  uv: meshes.flatMap((m) => Array.from(m.uv)),
});
/** A picture of one colour, transparent where `clear` says so. */
const picture = (
  rgba: [number, number, number, number],
  clear?: (u: number, v: number) => boolean,
): Picture => {
  const width = 16,
    height = 16,
    data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      // canvas rows run from the top; v runs from the bottom
      const u = (x + 0.5) / width,
        v = 1 - (y + 0.5) / height;
      data.set(clear?.(u, v) ? [0, 0, 0, 0] : rgba, (y * width + x) * 4);
    }
  return { width, height, data };
};
const source = (wood: Mesh3, crown: Mesh3 | null = null, leaf: Picture | null = null): BakeSource => ({
  wood,
  crown,
  barkColor: [0.2, 0.1, 0.05],
  leaf,
});
const texelAt = (view: ReturnType<typeof bakeView>, size: number, u: number, v: number) => {
  const i = Math.floor(v * size) * size + Math.floor(u * size);
  return {
    rgba: [...view.color.slice(i * 4, i * 4 + 4)],
    normal: [...view.normal.slice(i * 3, i * 3 + 3)],
  };
};

describe('ImpostorBake', () => {
  it('frames the whole tree: its foot, its top and its widest reach', () => {
    const shape = shapeOf(source(join(wall(-1, -1, 1, 3, 0), wall(-3, 2, 2, 6, 0.5))));
    expect(shape.bottom).toBe(-1);
    expect(shape.height).toBeCloseTo(7, 5);
    // the widest reach is 3 m, either side, with the frame's margin on top
    expect(shape.width).toBeGreaterThanOrEqual(6);
    expect(shape.width).toBeLessThan(6.5);
  });

  it('sees a wall from the side as a wall and from above as a line', () => {
    const src = source(wall(-1, 0, 1, 4, 0));
    const side = bakeView(src, 'side', 32),
      top = bakeView(src, 'top', 32);
    // the wall is the whole height of the frame and a third or so of its width
    expect(side.coverage).toBeGreaterThan(0.25);
    expect(top.coverage).toBeLessThan(0.05);
    const middle = texelAt(side, 32, 0.5, 0.5);
    expect(middle.rgba[3]).toBe(1);
    expect(middle.normal[2]).toBeCloseTo(1, 5);
  });

  it('keeps the nearer of two surfaces', () => {
    const near = wall(-1, 0, 1, 4, 1),
      far = { ...wall(-1, 0, 1, 4, -1), normal: Array.from({ length: 6 }, () => [1, 0, 0]).flat() };
    const side = bakeView(source(join(far, near)), 'side', 32);
    // the +z wall is nearer the side camera, whatever order it was drawn in
    expect(texelAt(side, 32, 0.5, 0.5).normal[2]).toBeCloseTo(1, 5);
  });

  it('cuts a leaf card out where its painting is clear', () => {
    const card = wall(-1, 0, 1, 2, 0);
    const leaf = picture([0, 255, 0, 255], (u) => u < 0.5);
    const src = source(wall(0, 0, 0, 0, 0), card, leaf);
    const side = bakeView(src, 'side', 32);
    expect(texelAt(side, 32, 0.3, 0.5).rgba[3]).toBeLessThan(LEAF_CUTOFF);
    const kept = texelAt(side, 32, 0.7, 0.5);
    expect(kept.rgba[3]).toBe(1);
    expect(kept.rgba[1]).toBeGreaterThan(kept.rgba[0]!);
  });

  it('lays the atlas out as species by columns, side over top', () => {
    const a = tileOf(0, 'side'),
      b = tileOf(3, 'top');
    expect(a).toEqual({ u: 0, v: 0, w: 1 / ATLAS_COLUMNS, h: 1 / ATLAS_ROWS });
    expect(b.u).toBeCloseTo(3 / ATLAS_COLUMNS, 9);
    expect(b.v).toBeCloseTo(1 / ATLAS_ROWS, 9);
  });

  it('builds every level down to one texel, keeps each tile coloured where clear, and keeps its coverage', () => {
    const src = source(join(wall(-0.3, -1, 0.3, 5, 0), wall(-2, 2, 2, 6, 0.4)));
    const tiles = [0, 1, 2].map(() => ({
      side: bakeView(src, 'side', TILE),
      top: bakeView(src, 'top', TILE),
    }));
    const atlas = buildAtlas(tiles);
    expect(atlas.width).toBe(TILE * ATLAS_COLUMNS);
    expect(atlas.height).toBe(TILE * ATLAS_ROWS);
    expect(atlas.color.length).toBe(Math.log2(atlas.width) + 1);
    expect(atlas.color.at(-1)!.length).toBe(4);
    // a clear texel beside the trunk carries the trunk's colour, not black
    const level0 = atlas.color[0]!;
    const row = Math.floor(TILE * 0.1),
      col = Math.floor(TILE * 0.5 + TILE * 0.2);
    const i = (row * atlas.width + col) * 4;
    expect(level0[i + 3]).toBe(0);
    expect(level0[i]! + level0[i + 1]! + level0[i + 2]!).toBeGreaterThan(0);
    // the mean alpha of the first tile holds from level to level, which is what
    // alpha-to-coverage draws as coverage
    const meanAlpha = (level: number) => {
      const size = TILE >> level,
        width = atlas.width >> level,
        data = atlas.color[level]!;
      let sum = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) sum += data[(y * width + x) * 4 + 3]!;
      return sum / (size * size * 255);
    };
    const base = meanAlpha(0);
    expect(base).toBeGreaterThan(0.1);
    for (let level = 1; level <= 5; level++) expect(meanAlpha(level)).toBeCloseTo(base, 1);
  });
});
