// Photograph the sky from four heights against the deck where the flight is.
//
//     npm run build && npm run preview       # in another shell
//     node tools/sky/look.mjs OUT_DIR [PHASE] [X] [Z]
//
// The deck stands at a different height in every region, so the heights are
// read off the deck at the point rather than written down: 200 m under its
// base, half way up the bank, 500 m over its base (over the deepest bank the
// region can hold, as a crossing is) and at the ceiling. It opens seed 42
// under WebGL2, begins, skips the opening and pauses the loop, and each
// picture is two real frames after the jump.
//
// `PITCH=0.3` tips the camera down (the remembered orbit's pitch), `OFF=deck,clouds`
// switches layers off to see what draws what, `WEBGPU=1` asks for the other
// backend, and `CHROMIUM` names the browser when Playwright's own is not the
// one installed (see tools/figure/look.mjs, which this follows).
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [out, phase = '0.5', x = '0', z = '0'] = process.argv.slice(2);
if (!out) {
  console.error('usage: node tools/sky/look.mjs OUT_DIR [PHASE] [X] [Z]');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: [
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
// This container's Chromium rejects the `swizzle` member three puts in a
// texture view's descriptor; tools/figure/look.mjs has the story.
if (process.env.WEBGPU)
  await page.addInitScript(() => {
    const proto = /** @type {any} */ (globalThis).GPUTexture?.prototype;
    if (!proto) return;
    const createView = proto.createView;
    proto.createView = function (/** @type {any} */ descriptor) {
      if (descriptor && 'swizzle' in descriptor) {
        const rest = { ...descriptor };
        delete rest.swizzle;
        return createView.call(this, rest);
      }
      return createView.call(this, descriptor);
    };
  });
// Behind the figure, a little further back than play, silent.
await page.addInitScript(
  (pitch) => {
    const camera = { yaw: 0, pitch, dist: 9 };
    localStorage.setItem(
      'dreamfall-settings',
      JSON.stringify({ volume: 0, muted: true, camera, view: 'tpp' }),
    );
  },
  Number(process.env.PITCH ?? 0.05),
);
await page.goto(`http://localhost:4173/?seed=42${process.env.WEBGPU ? '' : '&webgl=1'}`);
await page.waitForFunction(() => window.__world?.ready === true, null, { timeout: 600_000 });
await page.click('#beginBtn');
await page.evaluate(() => {
  const w = /** @type {NonNullable<Window['__world']>} */ (window.__world);
  w.skipOpening();
  w.setPaused(true);
});
for (const name of (process.env.OFF ?? '').split(',').filter(Boolean))
  await page.evaluate((n) => window.__world?.layers.set(n, false), name);

for (const shot of ['under', 'inside', 'over', 'high']) {
  const info = await page.evaluate(
    ({ shot, phase, x, z }) => {
      const w = /** @type {NonNullable<Window['__world']>} */ (window.__world);
      const d = w.deckAt(x, z);
      const y =
        shot === 'under'
          ? d.base - 200
          : shot === 'inside'
            ? (d.base + d.top) / 2
            : shot === 'over'
              ? d.base + 500
              : 1950;
      w.jump(x, z, y - w.heightAt(x, z));
      w.dayPhase = phase;
      for (let i = 0; i < 3; i++) w.step(1 / 60);
      return { base: Math.round(d.base), top: Math.round(d.top), bank: d.bank, y: Math.round(w.state.y) };
    },
    { shot, phase: Number(phase), x: Number(x), z: Number(z) },
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
  await page.screenshot({ path: `${out}/${shot}.png` });
  console.log(shot, JSON.stringify(info));
}
await browser.close();
