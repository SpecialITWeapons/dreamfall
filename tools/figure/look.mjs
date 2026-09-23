// Fly the figure somewhere and photograph it from four sides.
//
//     npm run build && npm run preview       # in another shell
//     node tools/figure/look.mjs OUT_DIR [dive|climb|turn|level] [glb|grown]
//
// A number can say a foot is wrung and cannot say whether it looks like a
// foot; this is the other half. It opens the page on seed 42 under WebGL2,
// begins, skips the opening, pauses the loop and flies the controller by hand
// -- `step` rather than waiting on frames, so a dive that takes the real loop
// fifteen seconds of SwiftShader takes this a fraction of one -- and stops the
// moment the flight reaches the corner of its envelope that was asked for. The
// camera is then orbited round the figure with the same drag a player makes,
// and each side is drawn once with `frame(0)` before it is photographed.
//
// Under SwiftShader the whole of it is half a minute. Set `CHROMIUM` to the
// browser that is actually installed when Playwright's own idea of one is a
// version the machine does not have: that fails at launch, before any page.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [out, shape = 'dive', body = 'glb'] = process.argv.slice(2);
if (!out) {
  console.error('usage: node tools/figure/look.mjs OUT_DIR [dive|climb|turn|level] [glb|grown]');
  process.exit(2);
}

/**
 * Which arrow flies each shape. The vertical is a stick's, so `ArrowUp` is the
 * nose going down. Where each one stops is in the page below, and is the
 * controller's own corner as `Posture.ts` measured it: pitch -0.42 at 1.48 of
 * the nominal airspeed, +0.56 at 0.75, and a bank of 0.47.
 * @type {Record<string, string | null>}
 */
const KEYS = { dive: 'ArrowUp', climb: 'ArrowDown', turn: 'ArrowLeft', level: null };
if (!(shape in KEYS)) throw new Error(`no shape called ${shape}; try ${Object.keys(KEYS).join(', ')}`);

/**
 * The four sides, as the drag that gets the camera there from behind: pixels
 * across and down, at `TURN_PER_PIXEL` (0.004 rad) a pixel.
 * @type {Array<[string, number, number]>}
 */
const SIDES = [
  ['behind', 0, 0],
  ['side', -393, 0],
  ['below', -393, -200],
  ['above', 0, 200],
];

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('console:', m.text());
});
// Close in and nearly level, silent: the remembered framing is read at load.
await page.addInitScript(() => {
  const camera = { yaw: 0, pitch: 0.15, dist: 3 };
  localStorage.setItem('dreamfall-settings', JSON.stringify({ volume: 0, muted: true, camera, view: 'tpp' }));
});
await page.goto(`http://localhost:4173/?seed=42&webgl=1${body === 'glb' ? '&figure=glb' : ''}`);
await page.waitForFunction(() => window.__world?.ready === true, null, { timeout: 600_000 });
await page.click('#beginBtn');
const flown = await page.evaluate(
  ({ key, shape }) => {
    const w = /** @type {NonNullable<Window['__world']>} */ (window.__world);
    w.skipOpening();
    w.setPaused(true);
    // A climb from where the flight begins goes up into the cloud deck and
    // photographs fog; from low down it runs out of pitch long before that.
    if (shape === 'climb') w.jump(w.state.x, w.state.z, 120);
    if (key) w.key(key);
    /** @param {{ pitch: number, speed: number, bank: number }} s */
    const there = (s) =>
      shape === 'dive'
        ? s.pitch < -0.41 && s.speed > 58
        : shape === 'climb'
          ? s.pitch > 0.54
          : shape === 'turn' && Math.abs(s.bank) > 0.46;
    // Up to twenty seconds of flight, and no further than the corner asked for:
    // held any longer, a dive meets the ground and pulls out of itself.
    let reached = false;
    for (let i = 0; i < 1200 && !reached; i++) {
      w.step(1 / 60);
      reached = there(w.state);
    }
    const s = w.state;
    return { reached, pitch: s.pitch, rush: s.speed / 40, bank: s.bank, clearance: w.clearance };
  },
  { key: KEYS[shape] ?? null, shape },
);
console.log(shape, JSON.stringify(flown));
if (shape !== 'level' && !flown.reached)
  console.log(`never reached the ${shape}; these are of wherever it got to`);

for (const [name, dx, dy] of SIDES) {
  /** @param {number} x @param {number} y */
  const drag = (x, y) =>
    page.evaluate(
      (by) => {
        const w = /** @type {NonNullable<Window['__world']>} */ (window.__world);
        w.pointer.down(0, 300, 300);
        w.pointer.move(300 + by.x, 300 + by.y);
        w.pointer.up();
      },
      { x, y },
    );
  await drag(dx, dy);
  await page.evaluate(() => window.__world?.frame(0));
  await page.screenshot({ path: `${out}/${shape}-${name}.png` });
  // And back, so every side is reached from behind rather than from the last.
  await drag(-dx, -dy);
}
await browser.close();
console.log(`${SIDES.length} pictures in ${out}`);
