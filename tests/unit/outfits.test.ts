import { Color, SRGBColorSpace } from 'three';
import { describe, expect, it } from 'vitest';
import { colorProblem, ENVELOPE } from '../../library/contract';
import {
  DEFAULT_OUTFIT,
  DEFAULT_PATTERN,
  OUTFITS,
  PATTERNS,
  outfitById,
  patternById,
  patternForSeed,
  type Swatch,
} from '../../src/engine/avatar/Outfits';

const hsl = { h: 0, s: 0, l: 0 };
const lightness = (hex: number) => {
  new Color(hex).getHSL(hsl, SRGBColorSpace);
  return hsl;
};
/** What a figure is mostly made of: the swatches that cover it. */
const BROAD: Swatch[] = ['suit', 'trim', 'helmet', 'skin'];
/** The dark parts, which are dark on purpose and live under the palette's floor. */
const DARK: Swatch[] = ['goggles', 'boots', 'gloves'];

describe('the outfits', () => {
  it('names every one of them, once', () => {
    expect(new Set(OUTFITS.map((o) => o.id)).size).toBe(OUTFITS.length);
    for (const outfit of OUTFITS) {
      expect(outfit.id).toMatch(/^[a-z]+$/);
      expect(outfit.name.length).toBeGreaterThan(0);
    }
    expect(OUTFITS.length).toBeGreaterThanOrEqual(4);
  });

  it("keeps what covers the figure inside the world's own palette envelope", () => {
    // The figure is lit by the sun the ground is lit by, so a shirt outside the
    // envelope reads as a hole in the picture rather than as a bright shirt.
    for (const outfit of OUTFITS)
      for (const swatch of BROAD) expect(colorProblem(outfit[swatch]), `${outfit.id}.${swatch}`).toBeNull();
  });

  it('lets the goggles and the boots be darker than the ground may be, but never black', () => {
    // The envelope's floor is about ground nobody wants pitch black. A visor is
    // not ground: it is the one place on the figure that has to read as dark
    // from a hundred metres, and it sits under that floor on purpose.
    for (const outfit of OUTFITS)
      for (const swatch of DARK) {
        const { s, l } = lightness(outfit[swatch]);
        expect(l, `${outfit.id}.${swatch} lightness`).toBeGreaterThan(0.08);
        expect(l, `${outfit.id}.${swatch} lightness`).toBeLessThan(ENVELOPE.minLightness + 0.12);
        expect(s, `${outfit.id}.${swatch} saturation`).toBeLessThanOrEqual(ENVELOPE.maxSaturation);
      }
  });

  it('falls back to the first of each when asked for something it has not got', () => {
    expect(outfitById('dusk').id).toBe('dusk');
    expect(outfitById('nothing')).toBe(DEFAULT_OUTFIT);
    expect(patternById('plain')).toBe(DEFAULT_PATTERN);
    expect(patternById('')).toBe(DEFAULT_PATTERN);
  });
});

describe('the markings', () => {
  it("only ever repaints the suit, and only in the outfit's own trim", () => {
    // A marking that could paint a visor is a marking that will, on the day
    // somebody adds one in a hurry.
    const swatches: Swatch[] = ['suit', 'trim', 'helmet', 'goggles', 'boots', 'gloves', 'skin'];
    for (const pattern of PATTERNS)
      for (const swatch of swatches)
        for (let along = 0; along <= 1.0001; along += 0.05)
          for (let around = 0; around < Math.PI * 2; around += Math.PI / 12) {
            const marked = pattern.mark(swatch, along, around);
            if (marked === null) continue;
            expect(marked, `${pattern.id} on ${swatch}`).toBe('trim');
            expect(swatch, `${pattern.id} repainted ${swatch}`).toBe('suit');
          }
  });

  it('marks some of the suit and leaves some of it, which is what makes a marking', () => {
    for (const pattern of PATTERNS) {
      let marked = 0,
        seen = 0;
      for (let along = 0; along <= 1.0001; along += 0.02)
        for (let around = 0; around < Math.PI * 2; around += Math.PI / 24) {
          seen++;
          if (pattern.mark('suit', along, around) === 'trim') marked++;
        }
      const share = marked / seen;
      if (pattern.id === 'plain') expect(share).toBe(0);
      else {
        expect(share, `${pattern.id} covers nothing`).toBeGreaterThan(0.05);
        expect(share, `${pattern.id} covers everything`).toBeLessThan(0.6);
      }
    }
  });

  it('gives a world the same marking every time it is opened, and spreads them across seeds', () => {
    expect(patternForSeed(42)).toBe(patternForSeed(42));
    expect(patternForSeed(0)).toBe(patternForSeed(0));
    const seen = new Set<string>();
    for (let seed = 0; seed < 400; seed++) seen.add(patternForSeed(seed).id);
    // Every marking in the catalogue turns up, and none of them takes the world.
    expect(seen.size).toBe(PATTERNS.length);
  });
});
