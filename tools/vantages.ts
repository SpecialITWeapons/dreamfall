// The vantages, shared by the bench and by parity, because a cost and a picture
// have to be of the same place or neither can explain the other.
import { expect, type Page } from '@playwright/test';
import { DECK_Y } from '../src/engine/terrain/WorldSampler';
import type { WorldDebug } from '../src/page/Debug';

declare global {
  interface Window {
    __world?: WorldDebug;
  }
}

/** The village of seed 42: houses, a road, and windows to light after dark. */
export const VILLAGE = { x: 1525, z: 1588 };

export interface Vantage {
  name: string;
  x: number;
  z: number;
  /** Metres over the ground. */
  above: number;
  phase: number;
  /** The night vantage waits for the galaxy's atlas; nothing else does. */
  galaxy?: boolean;
}

export const VANTAGES: Vantage[] = [
  { name: 'dawn', x: 0, z: 0, above: 120, phase: 0.126 },
  { name: 'noon', x: 0, z: 0, above: 120, phase: 0.5 },
  { name: 'far', x: 0, z: 0, above: 1500, phase: 0.5 },
  // Over the deck, where the cloud sea is drawn and the ground is behind it.
  { name: 'deck', x: 0, z: 0, above: DECK_Y + 180, phase: 0.5 },
  // The village at midnight: lit panes, and the galaxy over them.
  { name: 'night', x: VILLAGE.x, z: VILLAGE.z, above: 120, phase: 0.0, galaxy: true },
];

/** The page, begun, the opening skipped and the loop stopped: frames are driven by hand from here. */
export const beginPaused = async (page: Page, query: string) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.__world?.ready === true, null, { timeout: 120_000 });
  await page.click('#beginBtn');
  await expect.poll(() => page.evaluate(() => window.__world!.running), { timeout: 30_000 }).toBe(true);
  // The opening flies the figure itself and runs the day at three times its
  // pace: nothing measured or photographed under it is a vantage.
  await page.evaluate(() => window.__world!.skipOpening());
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__world!.paused), { timeout: 30_000 }).toBe(true);
  return errors;
};

/** Puts the flight at a vantage and waits for the world to stop arriving. */
export const settle = async (page: Page, vantage: Vantage) => {
  await page.evaluate((v) => {
    window.__world!.jump(v.x, v.z, v.above);
    window.__world!.dayPhase = v.phase;
  }, vantage);
  if (vantage.galaxy)
    await expect
      .poll(() => page.evaluate(() => window.__world!.galaxy.baked), { timeout: 240_000 })
      .toBe(true);
  // The ring rebuilds and the plan queue works itself off at 4 ms a frame; a
  // vantage measured while a town is still being planned measures the queue.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const w = window.__world!;
          w.frame(1 / 60);
          return w.scenery?.sitesQueued ?? 0;
        }),
      { timeout: 120_000 },
    )
    .toBe(0);
  for (let i = 0; i < 20; i++) await page.evaluate(() => window.__world!.frame(1 / 60));
};
