import { describe, expect, it } from 'vitest';
import { SNOW_LINE, snowLineAt } from '../../library/standard/snowLine.js';

describe('snowLineAt', () => {
  it('draws the line of the original, and rises with the base temperature', () => {
    expect(SNOW_LINE).toEqual({ base: 200, slope: 380 });
    expect(snowLineAt(0)).toBe(200);
    expect(snowLineAt(1)).toBe(580);
    expect(snowLineAt(0.9)).toBeGreaterThan(snowLineAt(0.1));
    expect(snowLineAt(-0.2)).toBeLessThan(snowLineAt(0));
  });
  it('is straight, so an offset from it is the same offset everywhere', () => {
    const step = (a: number, b: number) => snowLineAt(b) - snowLineAt(a);
    expect(step(0.2, 0.3)).toBeCloseTo(step(0.7, 0.8), 9);
    expect(snowLineAt(0.5)).toBeCloseTo((snowLineAt(0) + snowLineAt(1)) / 2, 9);
  });
});
