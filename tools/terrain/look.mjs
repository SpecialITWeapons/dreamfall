// Photograph the far terrain of seed 42 from high up, where a biome border or
// the snow line on its 64 m cells is seen whole.
//
//     npm run build && npm run preview       # in another shell
//     node tools/terrain/look.mjs OUT_DIR [X Z]
//
// From (X, Z) -- (5000, -3000) by default, where the far grid's seams were
// first photographed -- at 1800 m over the ground (`HEIGHTS`, a comma list),
// toward the four points of the compass, with the clouds and the far trees off
// so the ground is what is seen. Each picture is a capture, the scene before
// the display chain, at 1920 x 1080: the bloom and the blur of the page itself
// soften a 64 m step into nothing. `GPU=1` asks for this machine's GPU (ANGLE
// on D3D11) instead of SwiftShader, `PHASE` moves the hour, and `CHROMIUM`
// names the browser and `PAGE` the preview's address.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [out, cx = '5000', cz = '-3000'] = process.argv.slice(2);
if (!out) {
  console.error('usage: node tools/terrain/look.mjs OUT_DIR [X Z]');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const C = { x: Number(cx), z: Number(cz) };
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: process.env.GPU
    ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('console:', m.text());
});
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(() => {
  localStorage.setItem(
    'dreamfall-settings',
    JSON.stringify({ volume: 0, muted: true, camera: { yaw: 0, pitch: 0.08, dist: 9 }, view: 'fpp' }),
  );
});
await page.goto(`${process.env.PAGE ?? 'http://localhost:4173'}/?seed=42&webgl=1`);
await page.waitForFunction(() => window.__world?.ready === true, null, { timeout: 600_000 });
await page.click('#beginBtn');
await page.evaluate(
  (phase) => {
    const w = /** @type {NonNullable<Window['__world']>} */ (window.__world);
    w.skipOpening();
    w.setPaused(true);
    w.dayPhase = phase;
    for (const name of ['clouds', 'deck', 'deck fog', 'underside', 'high', 'far trees'])
      w.layers.set(name, false);
  },
  Number(process.env.PHASE ?? 0.42),
);
// A jump reads the ground under the new place from the window it leaves, so
// the first one only brings the window there.
await page.evaluate(({ x, z }) => window.__world?.jump(x, z, 400), C);

for (const above of (process.env.HEIGHTS ?? '1800').split(',').map(Number))
  for (const [name, heading] of /** @type {const} */ ([
    ['n', 0],
    ['w', Math.PI / 2],
    ['s', Math.PI],
    ['e', -Math.PI / 2],
  ])) {
    const info = await page.evaluate(
      ({ x, z, above, heading }) => {
        const w = /** @type {NonNullable<Window['__world']>} */ (window.__world);
        w.jump(x, z, above);
        w.state.heading = heading;
        w.state.pitch = 0;
        for (let i = 0; i < 3; i++) w.step(1 / 60);
        w.settleScenery();
        return { y: Math.round(w.state.y), ground: Math.round(w.heightAt(x, z)) };
      },
      { ...C, above, heading },
    );
    // A capture advances the frame id itself (AGENTS.md), and the loop is
    // paused, so the scene compiles for its target once and not every time.
    const png = await page.evaluate(async () => {
      const shot = await window.__world?.capture(1920, 1080);
      if (!shot) return null;
      const canvas = document.createElement('canvas');
      canvas.width = shot.width;
      canvas.height = shot.height;
      const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
      const image = ctx.createImageData(shot.width, shot.height);
      // linear to a plain 2.2 gamma: enough to see a step, not the page's grade
      for (let i = 0; i < shot.data.length; i++)
        image.data[i] =
          i % 4 === 3 ? 255 : Math.round(255 * Math.min(1, Math.max(0, shot.data[i] ?? 0)) ** (1 / 2.2));
      ctx.putImageData(image, 0, 0);
      return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
    });
    if (png) writeFileSync(`${out}/${above}-${name}.png`, Buffer.from(png, 'base64'));
    console.log(`${above}-${name}`, JSON.stringify(info));
  }
await browser.close();
