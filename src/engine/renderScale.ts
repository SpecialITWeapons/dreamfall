/** Upper bound on drawing-buffer pixels; frame cost grows almost linearly with their count. */
export const PIXEL_BUDGET = 2_000_000;
/** Upper bound on device pixels per CSS pixel. */
export const MAX_DPR = 1.5;

/** Renderer scale for the window: the smallest of DPR, MAX_DPR, and the scale that fits the window in the budget. */
export function renderScale(dpr: number, width: number, height: number): number {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  return Math.min(dpr || 1, MAX_DPR, Math.sqrt(PIXEL_BUDGET / (w * h)));
}
