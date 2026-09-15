import { describe, expect, it } from 'vitest';
import { MAX_DPR, PIXEL_BUDGET, renderScale } from '../../src/engine/renderScale';

describe('renderScale', () => {
  it('keeps a 1080p window at one device pixel when the budget allows it', () => {
    // 1920 * 1080 = 2,073,600 pixels, just above the budget: scale just under 1
    expect(renderScale(1, 1920, 1080)).toBeCloseTo(Math.sqrt(PIXEL_BUDGET / (1920 * 1080)), 6);
    expect(renderScale(1, 1600, 900)).toBe(1);
  });
  it('caps a retina display at MAX_DPR', () => {
    expect(renderScale(2, 800, 600)).toBe(MAX_DPR);
  });
  it('never exceeds the pixel budget', () => {
    const scale = renderScale(3, 2560, 1440);
    expect(2560 * scale * (1440 * scale)).toBeLessThanOrEqual(PIXEL_BUDGET + 1);
  });
  it('treats a missing pixel ratio and a zero-sized window as one', () => {
    expect(renderScale(0, 0, 0)).toBe(1);
  });
});
