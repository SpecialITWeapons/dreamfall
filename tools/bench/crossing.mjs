// What a ring cell crossing costs the frames around it, on this machine's GPU.
//
//     npm run build && npm run preview       # in another shell
//     node tools/bench/crossing.mjs [SECONDS] [TRACE.json]
//
// Seed 42, the woods at (-48000, -42000), the autopilot 150 m over the ground,
// ANGLE on D3D11 with vsync and the frame-rate limit off, so a frame is its
// own length. Every frame's interval is taken in the page with the scenery's
// counters beside it; a frame in which `rebuilds` moved is a crossing, and it
// and the three after it are reported on their own, because the work a
// crossing owes is paid over those. With a second argument the run is also a
// Chrome trace. `URL` points it at another server: a build to compare against.
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const seconds = Number(process.argv[2] ?? 20);
const tracePath = process.argv[3];
const browser = await chromium.launch({
  args: [
    '--use-angle=d3d11',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--force_high_performance_gpu',
    '--disable-gpu-vsync',
    '--disable-frame-rate-limit',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('console:', m.text());
});
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(() =>
  localStorage.setItem('dreamfall-settings', JSON.stringify({ volume: 0, muted: true })),
);
await page.goto(`${process.env.URL ?? 'http://localhost:4173'}/?seed=42&webgl=1`);
await page.waitForFunction(() => window.__world?.ready === true, null, { timeout: 600_000 });
await page.click('#beginBtn');
await page.waitForFunction(() => window.__world?.running === true, null, { timeout: 60_000 });
await page.evaluate(() => {
  const w = /** @type {NonNullable<Window['__world']>} */ (window.__world);
  w.skipOpening();
  w.setPaused(true);
  w.dayPhase = 0.5;
  // a jump reads the ground from the window it leaves: the second one is over the land
  w.jump(-48000, -42000, 150);
  w.jump(-48000, -42000, 150);
  w.settleScenery();
  w.setAutopilot(true);
  w.setPaused(false);
});
// let the plan queue and the grass settle before anything is counted
await page.waitForTimeout(3000);

const session = tracePath ? await page.context().newCDPSession(page) : null;
/** @type {unknown[]} */
const events = [];
if (session) {
  session.on('Tracing.dataCollected', (e) => events.push(...e.value));
  await session.send('Tracing.start', {
    transferMode: 'ReportEvents',
    traceConfig: {
      includedCategories: [
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-devtools.timeline.frame',
        'v8',
        'v8.execute',
        'disabled-by-default-v8.cpu_profiler',
        'blink.user_timing',
        'gpu',
        'viz',
        'cc',
      ],
    },
  });
}

const frames = await page.evaluate(async (ms) => {
  const w = /** @type {NonNullable<Window['__world']>} */ (window.__world);
  /** @type {Array<{ t: number; dt: number; drew: number; rebuilds: number; ringMs: number; grassMs: number; farMs: number; farQueued: number; cards: number }>} */
  const out = [];
  await new Promise((resolve) => {
    let seen = w.frames;
    let last = performance.now();
    const end = last + ms;
    const tick = () => {
      const now = performance.now();
      const drew = w.frames - seen;
      if (drew > 0) {
        const s = /** @type {NonNullable<typeof w.scenery>} */ (w.scenery);
        out.push({
          t: now,
          dt: now - last,
          drew,
          rebuilds: s.rebuilds,
          ringMs: s.ringMs,
          grassMs: s.grassMs,
          farMs: s.farMs,
          farQueued: s.farQueued,
          cards: s.cards,
        });
        seen = w.frames;
        last = now;
      }
      if (now < end) requestAnimationFrame(tick);
      else resolve(undefined);
    };
    requestAnimationFrame(tick);
  });
  return out;
}, seconds * 1000);

if (session && tracePath) {
  const done = new Promise((resolve) => session.once('Tracing.tracingComplete', resolve));
  await session.send('Tracing.end');
  await done;
  writeFileSync(tracePath, JSON.stringify({ traceEvents: events }));
  console.log(`trace: ${events.length} events -> ${tracePath}`);
}
await browser.close();

const median = (/** @type {number[]} */ xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? NaN;
};
const r1 = (/** @type {number} */ v) => Math.round(v * 10) / 10;
/** The frames a crossing is, by their index: the one it happened in and the three after it. */
const AROUND = 4;
/** @type {number[]} */
const crossing = [];
for (let i = 1; i < frames.length; i++) if (frames[i]?.rebuilds !== frames[i - 1]?.rebuilds) crossing.push(i);
const dtOf = (/** @type {number} */ i) => frames[i]?.dt ?? NaN;
const marked = new Set(crossing.flatMap((i) => [...Array(AROUND).keys()].map((k) => i + k)));
const ordinary = [...frames.keys()].filter((i) => i > 0 && !marked.has(i));
console.log(`${frames.length} frames over ${seconds} s, ${crossing.length} crossings`);
console.log(`ordinary frame: median ${r1(median(ordinary.map(dtOf)))} ms`);
for (let k = 0; k < AROUND; k++) {
  const dts = crossing.map((i) => dtOf(i + k)).filter((v) => !Number.isNaN(v));
  const name = k === 0 ? 'crossing frame:' : `frame +${k}:`;
  console.log(`${name.padEnd(16)}median ${r1(median(dts))} ms  [${dts.map(r1).join(', ')}]`);
}
console.log(`ring ms:        [${crossing.map((i) => frames[i]?.ringMs).join(', ')}]`);
console.log(`grass ms:       [${crossing.map((i) => frames[i]?.grassMs).join(', ')}]`);
const slowest = ordinary.sort((a, b) => dtOf(b) - dtOf(a)).slice(0, 5);
console.log(`slowest others: [${slowest.map((i) => r1(dtOf(i))).join(', ')}]`);
if (process.env.FRAMES) writeFileSync(process.env.FRAMES, JSON.stringify(frames));
