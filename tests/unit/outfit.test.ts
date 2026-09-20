import { describe, expect, it } from 'vitest';
import { ENVELOPE, colorProblem } from '../../library/contract';
import { DARK, OUTFIT, type Swatch } from '../../src/engine/avatar/Outfit';

const lightness = (hex: number) => {
  const r = ((hex >> 16) & 255) / 255,
    g = ((hex >> 8) & 255) / 255,
    b = (hex & 255) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (l > 0.5 ? 2 - max - min : max + min);
  return { l, s };
};

describe('the outfit', () => {
  it('keeps what covers the figure inside the palette envelope, and the dark parts under its floor', () => {
    // The figure is lit by the sun the ground is lit by: a suit outside the
    // envelope reads as a hole in the picture. The goggles, boots and gloves
    // sit under the floor on purpose, and not so far under that they are black.
    for (const swatch of Object.keys(OUTFIT) as Swatch[]) {
      const hex = OUTFIT[swatch];
      if (DARK.includes(swatch)) {
        const { l, s } = lightness(hex);
        expect(l, `${swatch} lightness`).toBeGreaterThan(0.08);
        expect(l, `${swatch} lightness`).toBeLessThan(ENVELOPE.minLightness);
        expect(s, `${swatch} saturation`).toBeLessThanOrEqual(ENVELOPE.maxSaturation);
      } else expect(colorProblem(hex), swatch).toBeNull();
    }
  });
});
