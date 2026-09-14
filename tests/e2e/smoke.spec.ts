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
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({
    running: window.__world!.running,
    frames: window.__world!.frames,
    t: window.__world!.state.t,
    backend: window.__world!.backend,
  }));
  expect(after.running).toBe(true);
  expect(after.frames).toBeGreaterThan(idle);
  expect(after.t).toBeGreaterThan(0);
  expect(after.backend).toBe('webgl2');
  await expect(page.locator('#hud')).not.toHaveAttribute('inert', '');
  expect(errors).toEqual([]);
});

test('space pauses the flight and dispose releases the GPU', async ({ page }) => {
  await openWorld(page, 'seed=7&webgl=1');
  await page.click('#beginBtn');
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.__world!.paused)).toBe(true);
  await expect(page.locator('#pauseBtn')).toHaveText('resume');
  const frozen = await page.evaluate(() => window.__world!.frames);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__world!.frames)).toBe(frozen);
  const t = await page.evaluate(() => window.__world!.state.t);
  await page.evaluate(() => window.__world!.step(0.02));
  expect(await page.evaluate(() => window.__world!.state.t)).toBeCloseTo(t + 0.02, 6);
  await page.evaluate(() => window.__world!.dispose());
  expect(await page.evaluate(() => window.__world!.memoryTotal())).toBe(0);
});

test('an address without a seed gets one', async ({ page }) => {
  await openWorld(page, 'webgl=1');
  expect(page.url()).toMatch(/[?&]seed=\d+/);
  const share = await page.getAttribute('#shareLink', 'href');
  expect(share).toMatch(/^http:\/\/localhost:4173\/\?seed=\d+$/);
});
