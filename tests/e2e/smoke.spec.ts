import { expect, test, type Page } from '@playwright/test';
import type { WorldDebug } from '../../src/page/Debug';

declare global {
  interface Window {
    __world?: WorldDebug;
  }
}

async function openWorld(page: Page, query: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.__world?.ready === true, null, { timeout: 60_000 });
  return errors;
}

test('the veil holds until the first frame, then Begin starts the flight', async ({ page }) => {
  const errors = await openWorld(page, 'seed=42&webgl=1');
  await expect(page.locator('#loading')).toHaveClass(/gone/);
  await expect(page.locator('#beginBtn')).toBeEnabled();
  expect(page.url()).toContain('seed=42');
  expect(await page.evaluate(() => window.__world!.running)).toBe(false);
  const idle = await page.evaluate(() => window.__world!.frames);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__world!.frames)).toBe(idle);
  await page.click('#beginBtn');
  await expect.poll(() => page.evaluate(() => window.__world!.running), { timeout: 15_000 }).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__world!.frames), { timeout: 15_000 })
    .toBeGreaterThan(idle);
  await expect
    .poll(() => page.evaluate(() => window.__world!.state.t), { timeout: 15_000 })
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__world!.backend)).toBe('webgl2');
  await expect(page.locator('#hud')).not.toHaveAttribute('inert', '');
  expect(errors).toEqual([]);
});

test('space pauses the flight and dispose releases the GPU', async ({ page }) => {
  const errors = await openWorld(page, 'seed=7&webgl=1');
  await page.click('#beginBtn');
  await expect.poll(() => page.evaluate(() => window.__world!.running), { timeout: 15_000 }).toBe(true);
  const baseline = await page.evaluate(() => window.__world!.memory());
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__world!.paused), { timeout: 15_000 }).toBe(true);
  await expect(page.locator('#pauseBtn')).toHaveText('resume');
  const frozen = await page.evaluate(() => window.__world!.frames);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__world!.frames)).toBe(frozen);
  const t = await page.evaluate(() => window.__world!.state.t);
  await page.evaluate(() => window.__world!.step(0.02));
  expect(await page.evaluate(() => window.__world!.state.t)).toBeCloseTo(t + 0.02, 6);
  const report = await page.evaluate(() => window.__world!.dispose());
  // The renderer counts only geometries it has drawn: terrain, water and the sky dome from the first frame
  // (the cloud puffs and the cloud sea stay hidden at cruise altitude); dispose must drop them and shrink total memory.
  expect(report.before.geometries).toBeGreaterThanOrEqual(baseline.geometries);
  expect(report.afterWorld.geometries).toBeLessThanOrEqual(report.before.geometries - 3);
  expect(report.afterWorld.total).toBeLessThan(report.before.total);
  expect(errors).toEqual([]);
});

test('an address without a seed gets one', async ({ page }) => {
  const errors = await openWorld(page, 'webgl=1');
  expect(page.url()).toMatch(/[?&]seed=\d+/);
  const share = await page.getAttribute('#shareLink', 'href');
  expect(share).toMatch(/^http:\/\/localhost:4173\/\?seed=\d+$/);
  expect(errors).toEqual([]);
});

test('the world stands on the heightfield: terrain under the flyer, clearance held, origin follows', async ({
  page,
}) => {
  const errors = await openWorld(page, 'seed=42&webgl=1');
  const start = await page.evaluate(() => {
    const w = window.__world!;
    return { h: w.heightAt(w.state.x, w.state.z), y: w.state.y, clearance: w.clearance, origin: w.origin };
  });
  // seed 42 starts at (0, 0), where fly-with-me's sampleWorld puts the ground at about 43.9 m
  expect(start.h).toBeCloseTo(43.886, 1);
  expect(start.clearance).toBeGreaterThanOrEqual(30);
  expect(start.origin).toEqual({ x: 0, z: 0 });
  await page.click('#beginBtn');
  await expect.poll(() => page.evaluate(() => window.__world!.running), { timeout: 15_000 }).toBe(true);
  // fly 4.5 km in simulated time: the origin must have shifted and clearance must hold everywhere
  const flown = await page.evaluate(() => {
    const w = window.__world!;
    let minClearance = Infinity;
    for (let i = 0; i < 2250; i++) {
      w.step(0.05);
      minClearance = Math.min(minClearance, w.clearance);
    }
    return { minClearance, origin: w.origin, x: w.state.x, z: w.state.z, t: w.state.t };
  });
  expect(flown.minClearance).toBeGreaterThanOrEqual(30 - 1e-6);
  expect(Math.hypot(flown.x, flown.z)).toBeGreaterThan(4400);
  expect(Math.hypot(flown.origin.x, flown.origin.z)).toBeGreaterThan(0);
  // Math.abs: a negative multiple of 16 gives -0, which toBe(0) rejects
  expect(Math.abs(flown.origin.x % 16)).toBe(0);
  expect(Math.abs(flown.origin.z % 16)).toBe(0);
  expect(errors).toEqual([]);
});

test('the day turns: the sky is bright at noon and dark at midnight, and the sun draws over the sea', async ({
  page,
}) => {
  const errors = await openWorld(page, 'seed=42&webgl=1');
  await page.click('#beginBtn');
  await expect.poll(() => page.evaluate(() => window.__world!.running), { timeout: 15_000 }).toBe(true);
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__world!.paused), { timeout: 15_000 }).toBe(true);
  const luminance = async (phase: number) =>
    page.evaluate(async (p) => {
      const w = window.__world!;
      w.dayPhase = p;
      const shot = await w.capture(96, 54);
      if (!shot) return null;
      // mean luminance of the top third of the picture: sky, above the horizon
      let sum = 0,
        n = 0;
      for (let y = 0; y < 18; y++)
        for (let x = 0; x < 96; x++) {
          const i = (y * 96 + x) * 4;
          sum += shot.data[i]! * 0.2126 + shot.data[i + 1]! * 0.7152 + shot.data[i + 2]! * 0.0722;
          n++;
        }
      return { mean: sum / n, finite: shot.data.every(Number.isFinite) };
    }, phase);
  const noon = await luminance(0.5);
  const midnight = await luminance(0.0);
  expect(noon!.finite).toBe(true);
  expect(midnight!.finite).toBe(true);
  expect(noon!.mean).toBeGreaterThan(0.15);
  expect(midnight!.mean).toBeLessThan(noon!.mean * 0.2);
  // the day clock ran: after the pause the phase is what we set
  expect(await page.evaluate(() => window.__world!.dayPhase)).toBeCloseTo(0.0, 3);
  expect(errors).toEqual([]);
});
