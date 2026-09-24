// The vantages, shared by the bench and by parity, because a cost and a picture
// have to be of the same place or neither can explain the other.
import { expect, type Page } from '@playwright/test';
import { MAX_ALTITUDE } from '../src/engine/flight/FlightController';
import { DECK, createCloudCover } from '../src/engine/sky/CloudCover';
import type { WorldDebug } from '../src/page/Debug';

declare global {
  interface Window {
    __world?: WorldDebug;
  }
}

/** The village of seed 42: houses, a road, and windows to light after dark. */
export const VILLAGE = { x: 1525, z: 1588 };

/**
 * The deck over the origin of seed 42: its base is the region's, so the deck
 * vantage stands over the deepest bank that region can hold, as a crossing does.
 */
const DECK_TOP = createCloudCover(42).baseAt(0, 0) + DECK.thick;

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
  // As high as the flight can be: the ceiling is MAX_ALTITUDE above the sea,
  // and the ground here is 44 m, so 1 500 would have been clamped to 1 356 on
  // the next step, with the escape turn armed.
  { name: 'far', x: 0, z: 0, above: MAX_ALTITUDE - 100, phase: 0.5 },
  // Over the deck, where the cloud sea is drawn and the ground is behind it.
  { name: 'deck', x: 0, z: 0, above: Math.round(DECK_TOP) + 180, phase: 0.5 },
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
  // Four, not twenty. Each of these is a real frame -- a separate task, so the
  // node graph's frame id has moved and the scene is drawn again -- and a real
  // frame on a software rasteriser is the better part of a second. The queue
  // above is what actually settles the place; these are for the grass window's
  // last rim.
  // Each waits for an animation frame first: on a machine with a GPU two of
  // these fit inside one vsync, and the second would redraw the display chain
  // over a scene pass nobody refilled (AGENTS.md, the loop).
  for (let i = 0; i < 4; i++)
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => {
            window.__world!.frame(1 / 60);
            done();
          }),
        ),
    );
};
