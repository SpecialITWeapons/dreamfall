import { describe, expect, it } from 'vitest';
import {
  CARD_ATTRIBUTES,
  cardBand,
  decodeCard,
  packCard,
  treeLimitOf,
} from '../../src/engine/scenery/cardPack';
import { cardGeometry } from '../../src/engine/scenery/Cards';

const out = () => ({ a: new Float32Array(8), b: new Float32Array(8), c: new Float32Array(6) });
const local = { x: (v: number) => v - 1000, z: (v: number) => v + 500 };
const shape = { width: 6, height: 14, bottom: -1 };

describe('packCard', () => {
  it('writes a tree where the scene has it, its tile and its size', () => {
    const o = out();
    packCard(
      o,
      1,
      { x: 1200, y: 40, z: -300, scale: 2, tall: 1.5, yaw: 0.5, tint: [0.1, 0.2, 0.3] },
      local,
      7,
      shape,
    );
    expect([...o.a.slice(4, 8)]).toEqual([200, 40, 200, 14]);
    expect([...o.b.slice(4, 8)]).toEqual([12, 21, 12, -1.5]);
    expect([...o.c.slice(3, 6)].map((v) => +v.toFixed(3))).toEqual([0.1, 0.2, 0.3]);
  });

  it('mirrors half the trees of a species, by their own yaw', () => {
    const tileAndMirror = (yaw: number) => {
      const o = out();
      packCard(o, 0, { x: 0, y: 0, z: 0, scale: 1, tall: 1, yaw, tint: [1, 1, 1] }, local, 3, shape);
      return o.a[3];
    };
    expect(tileAndMirror(1)).toBe(6);
    expect(tileAndMirror(4)).toBe(7);
  });

  it('takes a colour as well as three numbers', () => {
    const o = out();
    packCard(
      o,
      0,
      { x: 0, y: 0, z: 0, scale: 1, tall: 1, yaw: 0, tint: { r: 0.5, g: 0.25, b: 1 } },
      local,
      0,
      shape,
    );
    expect([...o.c.slice(0, 3)]).toEqual([0.5, 0.25, 1]);
  });
});

describe('treeLimitOf', () => {
  it('is the ring’s own band on the ground and shrinks to nothing, never to a band of no width', () => {
    expect(treeLimitOf(2300, 2560, 1)).toEqual([2300, 2560]);
    expect(treeLimitOf(2300, 2560, 0.5)).toEqual([1150, 1280]);
    const gone = treeLimitOf(2300, 2560, 0);
    expect(gone[0]).toBe(0);
    expect(gone[1]).toBeGreaterThanOrEqual(gone[0] + 1);
  });
});

describe('cardBand', () => {
  it('brings the card in before the full tree starts to go, so the two never both thin out', () => {
    // Alpha-to-coverage draws nested masks: a tree at 1 - s over a card at s
    // covers max(s, 1 - s), half the pixels at the middle of the band.
    expect(cardBand([2300, 2560])).toEqual([2040, 2300]);
    const [a, b] = cardBand([0, 1]);
    expect(b).toBe(0);
    expect(b).toBeGreaterThanOrEqual(a + 1);
  });
});

describe('decodeCard', () => {
  it('reads the tile and the mirror back, however the interpolation rounds', () => {
    for (const tile of [0, 3, 8, 15])
      for (const mirror of [0, 1])
        for (const wobble of [-1e-4, 0, 1e-4])
          expect(decodeCard(tile * 2 + mirror + wobble)).toEqual({ tile, mirror });
  });
});

describe('cardGeometry', () => {
  it('binds no more than eight vertex buffers', () => {
    const geometry = cardGeometry(16);
    expect(Object.keys(geometry.attributes).length).toBeLessThanOrEqual(8);
    for (const name of Object.keys(CARD_ATTRIBUTES)) expect(geometry.getAttribute(name)).toBeDefined();
    expect(geometry.index!.count).toBe(6);
  });
});
