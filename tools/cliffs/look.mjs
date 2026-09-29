// Photograph a sea cliff of seed 42 from the sea.
//
//     npm run build && npm run preview       # in another shell
//     node tools/cliffs/look.mjs OUT_DIR [X Z UX UZ]
//
// (X, Z) is a point on the cliff and (UX, UZ) the way inland from it; the
// default is the cliff at (3584, -2992). Five pictures at noon: from the sea
// 450 m out at 45 m, close (230 m out, 35 m), from the side at 70 m, from
// 300 m and from 1000 m -- the last one where the face goes over into the far
// grid. `GPU=1` asks for this machine's GPU (ANGLE on D3D11) instead of
// SwiftShader, `PHASE` moves the hour, and `CHROMIUM` names the browser.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [out, cx = '3584', cz = '-2992', ux = '0.697', uz = '0.718'] = process.argv.slice(2);
if (!out) {
  console.error('usage: node tools/cliffs/look.mjs OUT_DIR [X Z UX UZ]');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const C = { x: Number(cx), z: Number(cz) },
  U = { x: Number(ux), z: Number(uz) },
  V = { x: U.z, z: -U.x };
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
    JSON.stringify({ volume: 0, muted: true, camera: { yaw: 0, pitch: 0.08, dist: 9 }, view: 'tpp' }),
  );
});
await page.goto('http://localhost:4173/?seed=42&webgl=1');
await page.waitForFunction(() => window.__world?.ready === true, null, { timeout: 600_000 });
await page.click('#beginBtn');
await page.evaluate(
  (phase) => {
    const w = /** @type {NonNullable<Window['__world']>} */ (window.__world);
    w.skipOpening();
    w.setPaused(true);
    w.dayPhase = phase;
  },
  Number(process.env.PHASE ?? 0.42),
);
// A jump reads the ground under the new place from the window it leaves, so
// the first one only brings the window there.
await page.evaluate(({ x, z }) => window.__world?.jump(x, z, 400), C);

/** A vantage `back` metres out to sea from the cliff, `side` along it, at `y` over the sea. */
const at = (/** @type {number} */ back, /** @type {number} */ side, /** @type {number} */ y) => {
  const x = C.x - U.x * back + V.x * side,
    z = C.z - U.z * back + V.z * side;
  return { x, z, y, heading: Math.atan2(C.x - x, C.z - z) };
};
const shots = {
  low: at(450, 0, 45),
  near: at(230, 140, 35),
  side: at(260, 900, 70),
  mid: at(900, 250, 300),
  high: at(1800, 0, 1000),
};
for (const [name, s] of Object.entries(shots)) {
  const info = await page.evaluate((s) => {
    const w = /** @type {NonNullable<Window['__world']>} */ (window.__world);
    w.jump(s.x, s.z, 50);
    w.jump(s.x, s.z, s.y - w.heightAt(s.x, s.z));
    w.state.heading = s.heading;
    for (let i = 0; i < 3; i++) w.step(1 / 60);
    w.settleScenery();
    return { y: Math.round(w.state.y), ground: Math.round(w.heightAt(s.x, s.z)) };
  }, s);
  // Real frames, each in an animation frame of its own (AGENTS.md, the loop).
  for (let i = 0; i < 3; i++)
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => {
            window.__world?.frame(1 / 60);
            done(null);
          }),
        ),
    );
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name, JSON.stringify(info));
}
await browser.close();
