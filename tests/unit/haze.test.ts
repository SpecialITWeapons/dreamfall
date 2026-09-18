import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { MAX_HAZE, hazeAt } from '../../src/engine/sky/Haze';

describe('hazeAt', () => {
  const green = { color: new Color(0x2f6b3a), amount: 0.3 },
    ochre = { color: new Color(0xb08a4a), amount: 0.2 };
  const specs = [green, ochre, undefined];
  const out = new Color();

  it('weighs a tint by how much of the biome is under the flyer', () => {
    expect(hazeAt([0, 1, 2], [1, 0, 0], specs, 0, 1, out)).toBeCloseTo(0.3, 6);
    expect(out.getHex()).toBe(green.color.getHex());
    // and none of it at midnight: haze is lit air, and unlit air is not hazy
    expect(hazeAt([0, 1, 2], [1, 0, 0], specs, 0, 0, out)).toBe(0);
    expect(hazeAt([0, 1, 2], [1, 0, 0], specs, 0, 0.5, out)).toBeCloseTo(0.15, 6);
    expect(hazeAt([0, 1, 2], [0.5, 0, 0], specs, 0, 1, out)).toBeCloseTo(0.15, 6);
    // and a biome that asked for nothing tints nothing
    expect(hazeAt([2, 2, 2], [1, 0, 0], specs, 0, 1, out)).toBe(0);
  });

  it('averages two tints instead of adding them up', () => {
    // Half and half: the air is the colour between, not twice as thick.
    const amount = hazeAt([0, 1, 2], [0.5, 0.5, 0], specs, 0, 1, out);
    expect(amount).toBeCloseTo(0.25, 6);
    const share = 0.15 / 0.25;
    expect(out.r).toBeCloseTo(green.color.r * share + ochre.color.r * (1 - share), 5);
  });

  it('is low air: gone from over it, and never more than a tint', () => {
    expect(hazeAt([0, 1, 2], [1, 0, 0], specs, 300, 1, out)).toBeCloseTo(0.3, 6);
    expect(hazeAt([0, 1, 2], [1, 0, 0], specs, 900, 1, out)).toBeLessThan(0.2);
    expect(hazeAt([0, 1, 2], [1, 0, 0], specs, 1600, 1, out)).toBe(0);
    // A biome may colour the horizon and never repaint it: three slots of a
    // biome asking for everything still cannot take the sky.
    const greedy = [{ color: new Color(0xff0000), amount: 1 }];
    expect(hazeAt([0, 0, 0], [1, 1, 1], greedy, 0, 1, out)).toBeCloseTo(MAX_HAZE, 6);
  });
});
