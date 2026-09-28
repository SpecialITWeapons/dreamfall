import { describe, expect, it } from 'vitest';
import {
  AO_SIZE,
  AO_SPAN,
  SHADE_RADIUS,
  createShadeSheet,
  spotAt,
} from '../../src/engine/scenery/ShadeSheet';

/** Metres a texel is across. */
const TEXEL = AO_SPAN / AO_SIZE;
/** A record whose spot is `texels` across in radius, standing on the middle of texel (i, j) of a sheet centred on 0, 0. */
const onTexel = (i: number, j: number, texels: number) => ({
  x: (i + 0.5 - AO_SIZE / 2) * TEXEL,
  z: (j + 0.5 - AO_SIZE / 2) * TEXEL,
  radius: (texels * TEXEL) / SHADE_RADIUS,
});
/** A byte is the light left, rounded: a hair of float either way may round it to the next one. */
const bytes = (light: number) => {
  const v = light * 255;
  return [Math.floor(v), Math.ceil(v)];
};
const darkest = (data: Uint8Array) => {
  let at = -1;
  for (let k = 0; k < data.length; k++) if (at < 0 || data[k]! < data[at]!) at = k;
  return { i: at % AO_SIZE, j: Math.floor(at / AO_SIZE), value: data[at]! };
};

describe('the shade sheet', () => {
  it('draws the canvas gradient: 0.4 at the middle, 0x44 at three tenths, nothing at the rim', () => {
    expect(spotAt(0)).toBeCloseTo(0x66 / 255, 6);
    expect(spotAt(0.3)).toBeCloseTo(0x44 / 255, 6);
    expect(spotAt(1)).toBe(0);
    expect(spotAt(2)).toBe(0);
    for (let t = 0; t < 1; t += 0.05) expect(spotAt(t + 0.05)).toBeLessThanOrEqual(spotAt(t));
  });

  it('is open ground where no tree stands', () => {
    const sheet = createShadeSheet();
    sheet.paint([], 0, 0);
    expect(sheet.data.every((v) => v === 255)).toBe(true);
  });

  it('puts a tree where it stands in the world: x along a row, z down the rows', () => {
    const sheet = createShadeSheet();
    const cx = 1000,
      cz = -2000;
    const tree = onTexel(300, 120, 4);
    sheet.paint([{ ...tree, x: tree.x + cx, z: tree.z + cz }], cx, cz);
    const d = darkest(sheet.data);
    expect([d.i, d.j]).toEqual([300, 120]);
    // the middle texel is read at the spot's centre and covered whole
    expect(bytes(1 - spotAt(0))).toContain(d.value);
  });

  it('darkens overlapping trees one over the other, as source-over did', () => {
    const sheet = createShadeSheet();
    const tree = onTexel(200, 200, 3);
    sheet.paint([tree, tree], 0, 0);
    expect(bytes((1 - spotAt(0)) ** 2)).toContain(sheet.data[200 * AO_SIZE + 200]);
  });

  it('gives a spot under a texel across only its share of the texel, as the canvas did', () => {
    const sheet = createShadeSheet();
    // a quarter of a texel in radius: half a texel square, a quarter of the texel's area
    sheet.paint([onTexel(10, 20, 0.25)], 0, 0);
    expect(bytes(1 - spotAt(0) * 0.25)).toContain(sheet.data[20 * AO_SIZE + 10]);
    expect(sheet.data.filter((v) => v < 255).length).toBe(1);
  });

  it('starts from open ground at every repaint, and ignores what falls off the sheet', () => {
    const sheet = createShadeSheet();
    sheet.paint([onTexel(40, 40, 6), onTexel(41, 43, 5)], 0, 0);
    expect(darkest(sheet.data).value).toBeLessThan(255);
    sheet.paint(
      [
        { x: AO_SPAN, z: 0, radius: 50 },
        { x: 0, z: -AO_SPAN, radius: 50 },
      ],
      0,
      0,
    );
    expect(sheet.data.every((v) => v === 255)).toBe(true);
  });

  it('keeps every spot of a crowded wood, however many texels they touch', () => {
    const sheet = createShadeSheet();
    const wood = [];
    for (let j = 0; j < 100; j++)
      for (let i = 0; i < 100; i++) wood.push(onTexel(100 + i * 3, 100 + j * 3, 2));
    sheet.paint(wood, 0, 0);
    for (let j = 0; j < 100; j++)
      for (let i = 0; i < 100; i++)
        expect(sheet.data[(100 + j * 3) * AO_SIZE + 100 + i * 3]).toBeLessThanOrEqual(
          Math.ceil((1 - spotAt(0)) * 255),
        );
  });
});
