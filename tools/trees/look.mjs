// Photograph the trees out to the far terrain from four heights over the land.
//
//     npm run build && npm run preview       # in another shell
//     node tools/trees/look.mjs OUT_DIR [X] [Z] [HEADING]
//
// Seed 42, noon, the camera behind the figure and tipped down a little, at
// 150, 500, 900 and 1300 m over the ground under the flight: low, where the
// full trees give way to their cards at 2.3 to 2.6 km, and high, where the
// cards are most of what is seen. Each picture is two real frames after the
// jump and the far land settled, and the scenery's numbers are printed beside
// it. The default place is the woods of seed 42 (-48000, -42000).
//
// `OFF=far trees` switches the cards off to see what they add, `PITCH=0.2`
// tips the camera further down, `GPU=1` asks for this machine's GPU (ANGLE on
// D3D11, as `npm run test:e2e:gpu` does) instead of SwiftShader, `WEBGPU=1`
// for the other backend, and `CHROMIUM` names the browser (tools/figure/look.mjs).
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [out, x = '-48000', z = '-42000', heading = ''] = process.argv.slice(2);
if (!out) {
  console.error('usage: node tools/trees/look.mjs OUT_DIR [X] [Z] [HEADING]');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: process.env.GPU
    ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu']
    : [
        ...(process.env.WEBGPU ? ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] : []),
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
      ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('console:', m.text());
});
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(
  (pitch) => {
    const camera = { yaw: 0, pitch, dist: 9 };
    localStorage.setItem(
      'dreamfall-settings',
      JSON.stringify({ volume: 0, muted: true, camera, view: 'tpp' }),
    );
  },
  Number(process.env.PITCH ?? 0.08),
);
await page.goto(`http://localhost:4173/?seed=42${process.env.WEBGPU ? '' : '&webgl=1'}`);
await page.waitForFunction(() => window.__world?.ready === true, null, { timeout: 600_000 });
console.log('timings', JSON.stringify(await page.evaluate(() => window.__world?.timings)));
await page.click('#beginBtn');
await page.evaluate(() => {
  const w = /** @type {NonNullable<Window['__world']>} */ (window.__world);
  w.skipOpening();
  w.setPaused(true);
  w.dayPhase = 0.5;
});
// A jump reads the ground under the new place from the window it leaves, so
// the first one only brings the window there; the heights below are the land's.
await page.evaluate(({ x, z }) => window.__world?.jump(x, z, 400), { x: Number(x), z: Number(z) });
for (const name of (process.env.OFF ?? '').split(',').filter(Boolean))
  await page.evaluate((n) => window.__world?.layers.set(n, false), name);

for (const above of [150, 500, 900, 1300]) {
  const info = await page.evaluate(
    ({ above, x, z, heading }) => {
      const w = /** @type {NonNullable<Window['__world']>} */ (window.__world);
      w.jump(x, z, above);
      if (heading !== '') w.state.heading = Number(heading);
      for (let i = 0; i < 3; i++) w.step(1 / 60);
      w.settleScenery();
      const s = /** @type {NonNullable<typeof w.scenery>} */ (w.scenery);
      return {
        above: Math.round(w.state.y - w.heightAt(w.state.x, w.state.z)),
        trees: s.trees,
        farTrees: s.farTrees,
        cards: s.cards,
        cardsRefused: s.cardsRefused,
      };
    },
    { above, x: Number(x), z: Number(z), heading },
  );
  // Real frames, each in an animation frame of its own (AGENTS.md, the loop).
  for (let i = 0; i < 2; i++)
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => {
            window.__world?.frame(1 / 60);
            done(null);
          }),
        ),
    );
  await page.screenshot({ path: `${out}/${above}.png` });
  console.log(above, JSON.stringify(info));
}
await browser.close();
