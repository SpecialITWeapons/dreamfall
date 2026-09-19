import { expect, test, type Page } from '@playwright/test';
import { MIN_CLEARANCE } from '../../src/engine/flight/FlightController';
import { GALAXY_HEADING } from '../../src/engine/flight/SkyPulls';
import { ORBIT } from '../../src/engine/flight/Steering';
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
  await page.evaluate(() => window.__world!.skipOpening());
  await expect
    .poll(() => page.evaluate(() => window.__world!.frames), { timeout: 15_000 })
    .toBeGreaterThan(idle);
  await expect
    .poll(() => page.evaluate(() => window.__world!.state.t), { timeout: 15_000 })
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__world!.backend)).toBe('webgl2');
  await expect(page.locator('#hud')).not.toHaveAttribute('inert', '');
  // The dev panel is a separate chunk behind `?dev=1`: a page that did not ask
  // for it neither shows it nor downloads it.
  expect(await page.locator('#dev').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('the veil says what the start is doing, and the timings are readable after it', async ({ page }) => {
  const errors = await openWorld(page, 'seed=42&webgl=1&profile=1');
  // by the time the world is ready the veil has lifted; what it said on the way
  // is checked in Node (page.test.ts) -- here it only has to be gone
  await expect(page.locator('#loading')).toHaveClass(/gone/);
  const timings = await page.evaluate(() => window.__world!.timings);
  // every step of the start is measured, in order, and the last one is the frame
  expect(Object.keys(timings)).toEqual(['graphics', 'ground', 'scenery', 'sky']);
  expect(timings.graphics).toBeGreaterThan(0);
  expect(timings.ground).toBeGreaterThanOrEqual(timings.graphics!);
  expect(timings.scenery).toBeGreaterThanOrEqual(timings.ground!);
  expect(timings.sky).toBeGreaterThanOrEqual(timings.scenery!);
  expect(errors).toEqual([]);
});

test('space pauses the flight and dispose releases the GPU', async ({ page }) => {
  const errors = await openWorld(page, 'seed=7&webgl=1');
  await page.click('#beginBtn');
  await expect.poll(() => page.evaluate(() => window.__world!.running), { timeout: 15_000 }).toBe(true);
  await page.evaluate(() => window.__world!.skipOpening());
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
  await page.evaluate(() => window.__world!.skipOpening());
  // fly 400 simulated seconds: the clearance must hold everywhere along the way,
  // and every step must carry the figure its own airspeed forward.
  const flown = await page.evaluate(() => {
    const w = window.__world!;
    let minClearance = Infinity,
      path = 0,
      worstStep = 0;
    for (let i = 0; i < 8000; i++) {
      const x = w.state.x,
        z = w.state.z;
      w.step(0.05);
      const moved = Math.hypot(w.state.x - x, w.state.z - z);
      path += moved;
      worstStep = Math.max(worstStep, Math.abs(moved - w.state.speed * 0.05));
      minClearance = Math.min(minClearance, w.clearance);
    }
    return { minClearance, origin: w.origin, x: w.state.x, z: w.state.z, t: w.state.t, path, worstStep };
  });
  // MIN_CLEARANCE of the flight controller; the figure hangs 0.3 m under that
  expect(flown.minClearance).toBeGreaterThanOrEqual(25 - 1e-6);
  // Ground covered per step is the airspeed, whatever the dive did to it: this
  // holds for any seed and any path, unlike a net displacement, which depends on
  // how much the wander happened to curl this particular flight around itself.
  expect(flown.worstStep).toBeLessThan(0.01);
  expect(flown.path).toBeGreaterThan(400 * 30);
  expect(Math.hypot(flown.x, flown.z)).toBeGreaterThan(500);
  // The origin follows: proven directly and deterministically (push state.x past Origin's
  // 4000 m shift threshold, then take one step) rather than by waiting on the flight's own
  // stochastic wander to eventually cross it -- Origin's own shift/snap algorithm already
  // has its own unit test (tests/unit/origin.test.ts); this only needs to prove the
  // World -> Origin wiring, independent of seed 42's particular flight path.
  const shifted = await page.evaluate((origin) => {
    const w = window.__world!;
    w.state.x = origin.x + 6000;
    w.step(0.05);
    return w.origin;
  }, flown.origin);
  expect(shifted).not.toEqual(flown.origin);
  // Math.abs: a negative multiple of 16 gives -0, which toBe(0) rejects
  expect(Math.abs(shifted.x % 16)).toBe(0);
  expect(Math.abs(shifted.z % 16)).toBe(0);
  expect(errors).toEqual([]);
});

test('the day turns: the sky is bright at noon and dark at midnight, and the sun draws over the sea', async ({
  page,
}) => {
  // The first capture compiles the scene a second time for its own target, ten
  // seconds on a runner with no GPU, on top of a start that is slower there
  // too. Ninety seconds is what this ran out of on CI, twice.
  test.slow();
  const errors = await openWorld(page, 'seed=42&webgl=1');
  await page.click('#beginBtn');
  await expect.poll(() => page.evaluate(() => window.__world!.running), { timeout: 15_000 }).toBe(true);
  await page.evaluate(() => window.__world!.skipOpening());
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

test('the Milky Way bakes off the main thread and lights the sky toward its core', async ({ page }) => {
  test.slow();
  const errors = await openWorld(page, 'seed=42&webgl=1');
  await page.click('#beginBtn');
  await expect.poll(() => page.evaluate(() => window.__world!.running), { timeout: 15_000 }).toBe(true);
  await page.evaluate(() => window.__world!.skipOpening());
  // The atlas is two million texels of procedural matter and takes seconds. It
  // is baked in a worker precisely so the start does not wait for it, so what
  // this asserts is that the start did not: the page was ready and flying
  // before any of this, and the galaxy arrives afterwards.
  await expect.poll(() => page.evaluate(() => window.__world!.galaxy.baked), { timeout: 180_000 }).toBe(true);
  expect(await page.evaluate(() => window.__world!.galaxy.bakeMs)).toBeGreaterThan(0);
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__world!.paused), { timeout: 15_000 }).toBe(true);

  /**
   * Mean luminance of the sky above the horizon, at midnight, on a heading.
   *
   * The altitude is set and not inherited, because the flight's own is not the
   * test's business and one value of it is a trap: the cloud deck is at 520 m,
   * and from just under it the top third of the frame is deck rather than sky.
   * Measured at 450 m the core, the far side and the cross bearing all read
   * 0.039 -- the same number three times, because what was being photographed
   * was a ceiling. At 120 m they are 0.041, 0.028 and 0.022.
   */
  const sky = (heading: number) =>
    page.evaluate(async (h) => {
      const w = window.__world!;
      w.setAutopilot(false);
      w.state.heading = h;
      w.state.y = Math.max(0, w.heightAt(w.state.x, w.state.z)) + 120;
      w.dayPhase = 0.0;
      const shot = await w.capture(96, 54);
      if (!shot) return null;
      let sum = 0,
        n = 0;
      for (let y = 0; y < 18; y++)
        for (let x = 0; x < 96; x++) {
          const i = (y * 96 + x) * 4;
          sum += shot.data[i]! * 0.2126 + shot.data[i + 1]! * 0.7152 + shot.data[i + 2]! * 0.0722;
          n++;
        }
      return sum / n;
    }, heading);

  // The core is the brightest thing in a moonless sky, the far side of the
  // galaxy is a fainter band, and square to both there is only the disc's glow.
  // Measured at 0.041, 0.028 and 0.022; the margins are wide because this is a
  // software rasteriser and a tone curve, not a photometer.
  const core = await sky(GALAXY_HEADING);
  const away = await sky(GALAXY_HEADING + Math.PI);
  const across = await sky(GALAXY_HEADING + Math.PI / 2);
  expect(core).toBeGreaterThan(away! * 1.4);
  expect(away).toBeGreaterThan(across! * 1.1);
  expect(errors).toEqual([]);
});

test('the world turns white above the snow line, and bare rock where it is too steep to hold', async ({
  page,
}) => {
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page);
  // A summit of seed 42 in a biome that is not already pale: 834 m of ground
  // against a 346 m line, so the same mountain has both sides of it on it.
  const shades = await page.evaluate(async () => {
    const w = window.__world!;
    const peak = { x: 8500, z: 11000 };
    const read = async (y: number) => {
      w.state.x = peak.x;
      w.state.z = peak.z;
      w.state.y = y;
      w.dayPhase = 0.32;
      w.step(0.05);
      return w.heightAt(peak.x, peak.z);
    };
    const ground = await read(1400);
    // Straight down at the summit and straight down at the shore, from the
    // same altitude: what changes between them is the ground, not the light.
    const sample = async (x: number, z: number) => {
      w.state.x = x;
      w.state.z = z;
      w.state.y = w.heightAt(x, z) + 300;
      w.dayPhase = 0.32;
      w.step(0.05);
      const shot = await w.capture(64, 64);
      if (!shot) return null;
      let sum = 0,
        n = 0;
      // the lower half of the frame, which from here is ground and not sky
      for (let py = 32; py < 64; py++)
        for (let px = 0; px < 64; px++) {
          const i = (py * 64 + px) * 4;
          sum += shot.data[i]! * 0.2126 + shot.data[i + 1]! * 0.7152 + shot.data[i + 2]! * 0.0722;
          n++;
        }
      return sum / n;
    };
    return { ground, high: await sample(peak.x, peak.z), low: await sample(peak.x + 2600, peak.z + 2600) };
  });
  expect(shades.ground).toBeGreaterThan(700);
  // Ground over the line is markedly brighter than ground under it. The margin
  // is wide on purpose: this is a software rasteriser and a tone curve.
  expect(shades.high).toBeGreaterThan(shades.low! * 1.2);
  expect(errors).toEqual([]);
});

test('an overlapping button releasing first does not end the drag the other button still owns', async ({
  page,
}) => {
  // Real Chromium mouse input coalesces a second button pressed while the first
  // is still held into a plain pointermove with an updated `buttons` bitmask --
  // it never fires a second pointerdown/pointerup for the overlapping button
  // (verified empirically: page.mouse.down for a second button never produced a
  // pointerdown here). A second touch finger is not coalesced this way -- each
  // gets its own pointerId and its own genuine pointerdown/pointerup pair -- so
  // this dispatches the events by hand, at the exact shape a second finger (or,
  // per the plan brief's own framing of the bug, a second mouse button on a
  // browser that does fire it) would produce, to exercise the fix directly and
  // deterministically: down-right, down-left (ignored), up-left (must survive),
  // then up-right (must end it) -- exactly the sequence the review asked for.
  const errors = await openWorld(page, 'seed=11&webgl=1');
  await page.click('#beginBtn');
  await expect.poll(() => page.evaluate(() => window.__world!.running), { timeout: 15_000 }).toBe(true);
  await page.evaluate(() => window.__world!.skipOpening());
  const result = await page.evaluate(() => {
    const c = document.getElementById('c')!;
    const fire = (type: string, init: PointerEventInit) =>
      c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init }));
    const pitch = () => window.__world!.orbit.pitch;
    fire('pointerdown', { button: 2, clientX: 400, clientY: 300 }); // right button: starts steering
    fire('pointerdown', { button: 0, clientX: 400, clientY: 300 }); // overlapping left button: must be ignored
    fire('pointerup', { button: 0, clientX: 400, clientY: 300 }); // the OTHER button releases first
    const pitchBefore = pitch();
    fire('pointermove', { clientX: 400, clientY: 450 }); // dy=150: still steers if the drag survived
    const pitchDuring = pitch();
    fire('pointerup', { button: 2, clientX: 400, clientY: 450 }); // the button actually driving it releases
    const pitchAfterEnd = pitch();
    fire('pointermove', { clientX: 400, clientY: 600 }); // must now be a no-op: dragging has ended
    return { pitchBefore, pitchDuring, pitchAfterEnd, pitchAfterIgnored: pitch() };
  });
  // the right-button drag survived the left button's own release: the move still steered (orbit.pitch changed)
  expect(result.pitchDuring).not.toBeCloseTo(result.pitchBefore, 5);
  // releasing the button that actually drives the drag correctly ends it: the next move is ignored
  expect(result.pitchAfterIgnored).toBeCloseTo(result.pitchAfterEnd, 5);
  expect(errors).toEqual([]);
});

test('prefers-reduced-motion starts the flight paused with the audio context suspended', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await openWorld(page, 'seed=13&webgl=1');
  await page.click('#beginBtn');
  await expect.poll(() => page.evaluate(() => window.__world!.running), { timeout: 15_000 }).toBe(true);
  await page.evaluate(() => window.__world!.skipOpening());
  expect(await page.evaluate(() => window.__world!.paused)).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__world!.audio.state), { timeout: 5_000 })
    .toBe('suspended');
  expect(errors).toEqual([]);
});

/**
 * Begin, and skip the opening unless a test is there to watch it. Thirty
 * seconds of scripted flight in front of a measurement is thirty seconds of
 * something else being measured: the opening drives the stick, holds the
 * camera and runs the day at three times its pace, and every test that flies
 * somewhere and reads the sky was reading the opening instead.
 */
const begun = async (page: Page, query: string, opening = false) => {
  const errors = await openWorld(page, query);
  await page.click('#beginBtn');
  await expect.poll(() => page.evaluate(() => window.__world!.running), { timeout: 15_000 }).toBe(true);
  if (!opening) await page.evaluate(() => window.__world!.skipOpening());
  return errors;
};
const paused = async (page: Page) => {
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__world!.paused), { timeout: 15_000 }).toBe(true);
};
const turn = (a: number, b: number) => {
  const d = (((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2);
  return d - Math.PI;
};

test('V switches to the eye and back, the HUD and the memory follow', async ({ page }) => {
  const errors = await begun(page, 'seed=42&webgl=1');
  expect(await page.evaluate(() => window.__world!.view)).toBe('tpp');
  expect(await page.evaluate(() => window.__world!.cameraFov)).toBe(55);
  await page.keyboard.press('KeyV');
  // The same fifteen seconds the projection below is already given. A view is
  // switched on a frame, and a frame of this world on a software rasteriser
  // under a full suite can take longer than a default poll waits: this test
  // took 45 s on its own and timed out here at five when the machine was busy.
  await expect.poll(() => page.evaluate(() => window.__world!.view), { timeout: 15_000 }).toBe('fpp');
  await expect(page.locator('#viewBtn')).toHaveText('view: eyes');
  // the projection follows on the next frame
  await expect.poll(() => page.evaluate(() => window.__world!.cameraFov), { timeout: 15_000 }).toBe(75);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dreamfall-settings')!).view)).toBe('fpp');
  await page.click('#viewBtn');
  await expect.poll(() => page.evaluate(() => window.__world!.view), { timeout: 15_000 }).toBe('tpp');
  await expect.poll(() => page.evaluate(() => window.__world!.cameraFov), { timeout: 15_000 }).toBe(55);
  expect(errors).toEqual([]);
});

test('an arrow key takes the autopilot off, says so, and the HUD hands it back', async ({ page }) => {
  const errors = await begun(page, 'seed=42&webgl=1');
  expect(await page.evaluate(() => window.__world!.autopilot)).toBe(true);
  await expect(page.locator('#manual')).toBeHidden();
  await expect(page.locator('#autopilotBtn')).toHaveText('autopilot on');
  // hold the left arrow: the flight is the pilot's from the first key down
  await page.keyboard.down('ArrowLeft');
  await expect.poll(() => page.evaluate(() => window.__world!.autopilot)).toBe(false);
  await expect(page.locator('#manual')).toBeVisible();
  await expect(page.locator('#autopilotBtn')).toHaveText('resume autopilot');
  const turning = await page.evaluate(() => {
    const w = window.__world!;
    const before = w.state.heading;
    for (let i = 0; i < 80; i++) w.step(0.05);
    return { turned: w.state.heading - before, heading: w.state.heading };
  });
  expect(turning.turned).toBeGreaterThan(0.2);
  // key up: the turn stops and the course holds
  await page.keyboard.up('ArrowLeft');
  const held = await page.evaluate(() => {
    const w = window.__world!;
    for (let i = 0; i < 100; i++) w.step(0.05);
    const settled = w.state.heading;
    for (let i = 0; i < 400; i++) w.step(0.05);
    return { settled, after: w.state.heading, y: w.state.y };
  });
  expect(Math.abs(held.after - held.settled)).toBeLessThan(0.02);
  // the pill hands it back
  await page.click('#autopilotBtn');
  expect(await page.evaluate(() => window.__world!.autopilot)).toBe(true);
  await expect(page.locator('#manual')).toBeHidden();
  const wandered = await page.evaluate(() => {
    const w = window.__world!;
    for (let i = 0; i < 1200; i++) w.step(0.05);
    return w.state.heading;
  });
  expect(Math.abs(wandered - held.after)).toBeGreaterThan(0.01);
  expect(errors).toEqual([]);
});

test('the right button steers, the left button orbits, the wheel zooms, and the framing is remembered', async ({
  page,
}) => {
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page); // the flight's own wander must not move the numbers
  const heading0 = await page.evaluate(() => window.__world!.state.heading);
  await page.mouse.move(400, 300);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(500, 300, { steps: 4 });
  await page.mouse.up({ button: 'right' });
  // 100 px to the right is a 0.4 rad right turn, applied whole on the next step
  expect(await page.evaluate(() => window.__world!.state.steer)).toBeCloseTo(-0.4, 3);
  await page.evaluate(() => window.__world!.step(0.05));
  const heading1 = await page.evaluate(() => window.__world!.state.heading);
  expect(Math.abs(turn(heading0, heading1) + 0.4)).toBeLessThan(0.05);
  await page.mouse.move(400, 300);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(300, 300, { steps: 4 });
  await page.mouse.up({ button: 'left' });
  expect((await page.evaluate(() => window.__world!.orbit)).yaw).toBeCloseTo(0.4, 3);
  await page.mouse.wheel(0, 300);
  const orbit = await page.evaluate(() => window.__world!.orbit);
  expect(orbit.dist).toBeCloseTo(ORBIT.dist * Math.exp(300 * 0.0012), 3);
  const remembered = await page.evaluate(
    () => JSON.parse(localStorage.getItem('dreamfall-settings')!).camera,
  );
  expect(remembered.dist).toBeCloseTo(orbit.dist, 6);
  expect(remembered.yaw).toBeCloseTo(0.4, 3);
  expect(errors).toEqual([]);
});

test('the flight resumes on the same seed from the remembered place and time of day', async ({ page }) => {
  // Three page starts with a reload among them, and two hundred steps that each
  // render: more than ninety seconds on a software rasteriser having a bad day.
  test.slow();
  await begun(page, 'seed=42&webgl=1');
  await paused(page);
  const before = await page.evaluate(() => {
    const w = window.__world!;
    for (let i = 0; i < 200; i++) w.step(0.05);
    w.saveFlight();
    return { t: w.state.t, x: w.state.x, dayPhase: w.dayPhase, resumed: w.resumed };
  });
  expect(before.resumed).toBe(false);
  expect(before.t).toBeGreaterThan(9.9);
  await page.reload();
  await page.waitForFunction(() => window.__world?.ready === true, null, { timeout: 60_000 });
  const after = await page.evaluate(() => {
    const w = window.__world!;
    return { t: w.state.t, x: w.state.x, dayPhase: w.dayPhase, resumed: w.resumed, seed: w.seed };
  });
  expect(after.resumed).toBe(true);
  expect(after.seed).toBe(42);
  expect(after.t).toBeCloseTo(before.t, 3);
  expect(after.x).toBeCloseTo(before.x, 3);
  expect(after.dayPhase).toBeCloseTo(before.dayPhase, 6);
  // another seed starts fresh
  await openWorld(page, 'seed=7&webgl=1');
  expect(
    await page.evaluate(() => ({ resumed: window.__world!.resumed, t: window.__world!.state.t })),
  ).toEqual({
    resumed: false,
    t: 0,
  });
});

test('sound starts on Begin and the HUD mutes it', async ({ page }) => {
  const errors = await begun(page, 'seed=42&webgl=1');
  const audio = await page.evaluate(() => window.__world!.audio);
  expect(audio.available).toBe(true);
  await expect(page.locator('#muteBtn')).toHaveText('sound on');
  // headless Chromium may keep a context suspended without an output device; the gain checks need it running
  const running = await page
    .waitForFunction(() => window.__world!.audio.state === 'running', null, { timeout: 6_000 })
    .then(() => true)
    .catch(() => false);
  if (running)
    // The master gain is a four-second ramp on the audio clock, and a runner
    // with no sound device advances that clock far slower than the wall clock:
    // CI has seen 0.48 s of it pass in eight of ours, which is a gain of 0.06
    // where this used to demand 0.1. What the test is for is that Begin starts
    // the sound and the HUD stops it, so it asks whether the ramp is under way
    // rather than how far along it got.
    await expect
      .poll(() => page.evaluate(() => window.__world!.audio.gain), { timeout: 8_000 })
      .toBeGreaterThan(0);
  await page.click('#muteBtn');
  await expect(page.locator('#muteBtn')).toHaveText('sound off');
  expect((await page.evaluate(() => window.__world!.audio)).muted).toBe(true);
  if (running) {
    // Muting is a fade with a time constant of 0.3 s and, like the ramp above,
    // it runs on the **audio clock**. Asking for a gain under 0.05 within eight
    // of *our* seconds is asking the runner to own a sound card: CI advanced
    // that clock 0.48 s in eight of ours, which left a gain of 0.135 on a fade
    // that was behaving perfectly. So this reads the fade's own curve instead.
    //
    // The reference is taken after the click and never before it. Measured
    // here, the audio clock jumps 7.9 s across that click -- the page stalls on
    // a software rasteriser and the sound card does not wait for it -- so a
    // reading from before the click predicts nothing about what follows.
    const from = await page.evaluate(() => {
      const a = window.__world!.audio;
      return { gain: a.gain, clock: a.clock };
    });
    await expect
      .poll(() => page.evaluate((c) => window.__world!.audio.clock - c, from.clock), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0.25);
    const after = await page.evaluate(() => {
      const a = window.__world!.audio;
      return { gain: a.gain, clock: a.clock };
    });
    if (from.gain < 0.02) {
      // the stall swallowed the whole fade; there is nothing left to watch
      expect(after.gain).toBeLessThan(0.02);
    } else {
      // e^(-t/tau) from where the fade actually was, with a frame of slack
      expect(after.gain).toBeLessThan(from.gain * Math.exp(-(after.clock - from.clock) / 0.3) + 0.02);
      expect(after.gain).toBeLessThan(from.gain);
    }
  }
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dreamfall-settings')!).muted)).toBe(true);
  expect(errors).toEqual([]);
});

test('the clouds move with the wind: sixty simulated seconds change the sky under the same sun', async ({
  page,
}) => {
  // The first capture compiles the whole scene a second time, for the capture's
  // own target: about 5 s here and several times that on a CI runner with no
  // GPU. Everything after it is a fifth of a second -- as long as the loop is
  // paused, which is why the pause below is not only about the wind.
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page);
  const sky = async () =>
    page.evaluate(async () => {
      const shot = await window.__world!.capture(96, 54);
      return shot ? Array.from(shot.data.subarray(0, 18 * 96 * 4)) : null;
    });
  const wind = await page.evaluate(() => window.__world!.wind);
  expect(wind.speed).toBeGreaterThanOrEqual(10);
  // The galaxy's atlas is baked in a worker and lands when it lands -- measured
  // here, between the first capture and the second. The day opens at dawn, where
  // the night sky is still worth 0.0005 of the picture, and that was the flake:
  // two captures with nothing arriving between them are identical to the bit.
  // Waiting for the atlas, and stepping once so it reaches the GPU, is what
  // makes the pair below a pair.
  await expect.poll(() => page.evaluate(() => window.__world!.galaxy.baked), { timeout: 120_000 }).toBe(true);
  await page.evaluate(() => window.__world!.step(0.05));
  const phase = await page.evaluate(() => window.__world!.dayPhase);
  const a = await sky();
  const again = await sky();
  await page.evaluate((p) => {
    const w = window.__world!;
    for (let i = 0; i < 1200; i++) w.step(0.05);
    w.dayPhase = p; // the same sun, so only the wind has moved anything
  }, phase);
  const b = await sky();
  const diff = (x: number[] | null, y: number[] | null) =>
    x && y ? x.reduce((s, v, i) => s + Math.abs(v - y[i]!), 0) / x.length : NaN;
  expect(diff(a, again)).toBeLessThan(1e-4);
  expect(diff(a, b)).toBeGreaterThan(0.01);
  expect(errors).toEqual([]);
});

test('the registry reaches the page and two climates paint different ground', async ({ page }) => {
  // Five window refills and three renders, on a software rasteriser, and every
  // refill now runs twelve presence hooks over 313 600 texels: this one is slow
  // by construction, not by accident.
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page); // no render loop competing with the teleports below
  const biomes = await page.evaluate(() => window.__world!.biomes);
  // The ten climate biomes of the original, and the two settlements, which are
  // claimed off a lattice rather than out of climate space and so go last: the
  // first biome is the one that takes ground nobody else claims.
  expect(biomes).toHaveLength(12);
  expect(biomes[0]).toBe('wildsong');
  expect(biomes.slice(-2)).toEqual(['village', 'town']);
  const here = await page.evaluate(() => window.__world!.weightsAt(0, 0));
  expect(here).toHaveLength(3);
  expect(here.reduce((s, slot) => s + slot.weight, 0)).toBeCloseTo(1, 4);
  expect(here[0]!.weight).toBeGreaterThanOrEqual(here[1]!.weight);
  expect(biomes).toContain(here[0]!.id);

  // Two places on dry land that different biomes own. They are hard-coded
  // rather than searched for because a search means a window refill per probe,
  // and sixty of those do not fit in a test budget; seed 42's base fields are
  // frozen (see worldSampler.test.ts), so these stay where they are, and the
  // ids below fail loudly if the weighting ever moves.
  const STEPPE = { x: 24_000, z: 5_500 },
    WILDSONG = { x: 162_000, z: 62_500 };
  const owner = async (at: { x: number; z: number }) =>
    page.evaluate(({ x, z }) => {
      const w = window.__world!;
      w.state.x = x;
      w.state.z = z;
      w.step(0.05); // the window refills on the jump
      return { id: w.weightsAt(x, z)[0]!.id, h: w.heightAt(x, z) };
    }, at);
  const a = await owner(STEPPE),
    b = await owner(WILDSONG);
  expect(a.id).toBe('steppe');
  expect(b.id).toBe('wildsong');
  expect(a.h).toBeGreaterThan(40);
  expect(b.h).toBeGreaterThan(40);

  // The same flight, the same sun, the same frame: only the ground differs.
  const groundAt = async (x: number, z: number, h: number) =>
    page.evaluate(
      async ({ x, z, h }) => {
        const w = window.__world!;
        // Everything the picture depends on is set by hand, and set again before
        // every step, so two visits to one place are the same picture. The pose
        // is pinned before the jump as well as after it: a step taken from a
        // heading left over from the last visit lands a few metres off, which
        // used to be invisible in the colour of the ground and stopped being so
        // the day trees stood on it.
        const pin = () => {
          w.state.x = x;
          w.state.z = z;
          w.state.y = h + 110;
          w.state.heading = 0;
          w.state.bank = 0;
          w.state.pitch = 0;
          w.state.vy = 0;
          w.state.t = 100;
          w.state.speed = 40;
        };
        pin();
        w.step(0.05); // the window refills and the ring rebuilds on the jump
        pin();
        w.dayPhase = 0.3;
        // Short steps, the pose pinned before each of them, so the flight cannot
        // fly away while the things that ease -- the exposure above all -- settle
        // on the same value they settled on the last time this place was visited.
        for (let k = 0; k < 12; k++) {
          pin();
          w.step(0.02);
        }
        pin();
        // One animation frame before the picture, and it is not politeness.
        // Everything above happens inside one task, and three advances the node
        // graph's frame id only in the renderer's own animation tick -- so a
        // capture taken here carries whatever the nodes held before `dayPhase`
        // was written, which on the first visit is the palette the page started
        // at. CI read 0.243 between two visits to one place for exactly that
        // reason, the same number twice.
        await new Promise<void>((settled) => requestAnimationFrame(() => settled()));
        pin();
        const shot = await w.capture(96, 54);
        if (!shot) return null;
        // The mean colour of the bottom left corner: ground from this height,
        // and far enough from the middle that the figure and its shadow are not
        // in it -- their flutter is the one thing here that is not deterministic.
        let r = 0,
          g = 0,
          b = 0,
          n = 0;
        for (let row = 40; row < 54; row++)
          for (let col = 0; col < 24; col++) {
            const i = (row * 96 + col) * 4;
            r += shot.data[i]!;
            g += shot.data[i + 1]!;
            b += shot.data[i + 2]!;
            n++;
          }
        return {
          colour: [r / n, g / n, b / n],
          drift: [w.state.x - x, w.state.z - z, w.state.y],
          trees: w.scenery!.trees,
          grass: w.scenery!.grass,
          rebuilds: w.scenery!.rebuilds,
        };
      },
      { x, z, h },
    );
  const shotA = await groundAt(STEPPE.x, STEPPE.z, a.h);
  const shotAgain = await groundAt(STEPPE.x, STEPPE.z, a.h);
  const shotB = await groundAt(WILDSONG.x, WILDSONG.z, b.h);
  /**
   * How far apart two pictures are, and **only** the pictures. This used to
   * average the differences across one flat array that also carried the drift,
   * the altitude and the scenery counters -- and `rebuilds` is a counter that
   * grows, so two extra ring rebuilds between the first visit and the second
   * came out as 2/9 = 0.222 against a threshold of 0.002. A photograph and a
   * tally do not belong in one average.
   */
  const apart = (x: typeof shotA, y: typeof shotA) =>
    x && y ? x.colour.reduce((s, v, i) => s + Math.abs(v - y.colour[i]!), 0) / x.colour.length : NaN;
  // The pixels come back 0..1, so these are small numbers on purpose. Measured
  // at seed 42: steppe reads (0.29, 0.31, 0.11) and wildsong (0.17, 0.28, 0.08).
  expect(apart(shotA, shotAgain)).toBeLessThan(0.002);
  expect(apart(shotA, shotB)).toBeGreaterThan(0.02);
  // and the place itself is the same place twice: the same forest, the same
  // meadow, the flight pinned where it was put
  expect(shotAgain!.trees).toBe(shotA!.trees);
  expect(shotAgain!.grass).toBe(shotA!.grass);
  for (const [i, v] of shotAgain!.drift.entries()) expect(v).toBeCloseTo(shotA!.drift[i]!, 3);
  // no console errors anywhere above is the proof that ten branches of TSL compiled
  expect(errors).toEqual([]);
});

test('the forest stands where the climate wants it, and the flight is told about it', async ({ page }) => {
  // Two teleports, each of them a window refill and a ring rebuild over 1681
  // cells, on a software rasteriser.
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page); // no render loop competing with the teleports below
  // Hard-coded for the same reason as the two climates above: a search costs a
  // window refill per probe. Seed 42's base fields are frozen, so these two
  // places stay what they are, and the biome ids below fail loudly if the
  // weighting ever moves.
  const WOODS = { x: -48_000, z: -42_000 },
    DUNES = { x: -12_000, z: -48_000 };
  const visit = async (at: { x: number; z: number }) =>
    page.evaluate(({ x, z }) => {
      const w = window.__world!;
      w.state.x = x;
      w.state.z = z;
      w.state.y = w.heightAt(x, z) + 120;
      w.step(0.05); // the window refills and the ring rebuilds on the jump
      return { id: w.weightsAt(x, z)[0]!.id, scenery: w.scenery!, obstacles: w.obstacles };
    }, at);

  const woods = await visit(WOODS);
  expect(woods.id).toBe('wildsong');
  expect(woods.scenery.trees).toBeGreaterThan(800);
  expect(woods.scenery.cells).toBeGreaterThan(400);
  // everything that stands is something the flight has to fly around
  expect(woods.obstacles).toBeGreaterThanOrEqual(woods.scenery.trees);
  expect(woods.scenery.bakeMs).toBeGreaterThan(0);

  // The desert is the same machinery over a climate that wants almost nothing:
  // this is the assertion that the biome weights really reach the scenery, and
  // not only the colour of the ground.
  const dunes = await visit(DUNES);
  expect(dunes.id).toBe('dunes');
  expect(dunes.scenery.trees).toBeLessThan(woods.scenery.trees / 5);
  expect(dunes.scenery.rebuilds).toBeGreaterThan(woods.scenery.rebuilds);
  expect(errors).toEqual([]);
});

test('the flight keeps its clearance over the trees, not only over the ground', async ({ page }) => {
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page);
  const clearances = await page.evaluate(() => {
    const w = window.__world!;
    w.state.x = -48_000;
    w.state.z = -42_000;
    w.state.y = w.heightAt(-48_000, -42_000) + 60;
    w.step(0.05);
    const worst: number[] = [];
    // a minute of flight over the wood, sampled every second
    for (let second = 0; second < 60; second++) {
      for (let k = 0; k < 50; k++) w.step(0.02);
      worst.push(w.state.y - w.floorAt(w.state.x, w.state.z));
    }
    return { worst, trees: w.scenery!.trees };
  });
  expect(clearances.trees).toBeGreaterThan(100);
  // MIN_CLEARANCE is 25 m; the envelope holds it over the canopy as it does
  // over the ground, and a metre of slack covers one step of the integrator
  expect(Math.min(...clearances.worst)).toBeGreaterThan(24);
  expect(errors).toEqual([]);
});

test('a jump of the floating origin takes the forest with it', async ({ page }) => {
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page);
  const moved = await page.evaluate(() => {
    const w = window.__world!;
    // two origin thresholds in one step: the scene's frame moves under the ring
    w.state.x = 9000;
    w.state.z = 0;
    w.step(0.05);
    const sample = w.scenerySample(0)!;
    return {
      origin: { ...w.origin },
      sample,
      trees: w.scenery!.trees,
      rebuilds: w.scenery!.rebuilds,
    };
  });
  expect(moved.trees).toBeGreaterThan(0);
  expect(moved.rebuilds).toBeGreaterThan(1);
  // the instance was written in the scene's frame, and the frame is the origin's
  expect(moved.sample.local[0]).toBeCloseTo(moved.sample.world[0] - moved.origin.x, 3);
  expect(moved.sample.local[1]).toBeCloseTo(moved.sample.world[1] - moved.origin.z, 3);
  expect(Math.abs(moved.sample.local[0])).toBeLessThan(4000);
  expect(errors).toEqual([]);
});

test('grass grows close to the ground and costs nothing from altitude', async ({ page }) => {
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page);
  const counts = await page.evaluate(() => {
    const w = window.__world!;
    w.state.x = -48_000;
    w.state.z = -42_000;
    const ground = w.heightAt(-48_000, -42_000);
    w.state.y = ground + 40;
    w.step(0.05);
    const low = w.scenery!.grass;
    w.state.y = ground + 1000;
    w.state.x += 200; // a new cell, so the window has a reason to rebuild
    w.step(0.05);
    return { low, high: w.scenery!.grass };
  });
  expect(counts.low).toBeGreaterThan(100);
  expect(counts.high).toBe(0);
  expect(errors).toEqual([]);
});

/**
 * Seed 42's nearest village, hard-coded for the same reason as the two climates
 * above: a search costs a window refill per probe. The lattice seats it 2.2 km
 * from where the flight starts, which is near enough for `siteNear` to answer
 * for it from there and too far for the ring to raise it -- so the start is the
 * control for the counts below. Everything here takes the village's real centre,
 * radius and lot count from `siteNear`; these two numbers only have to land the
 * question inside its 2 km reach.
 */
const VILLAGE = { x: 1525, z: 1588 };
/** The next village out, 8.3 km away: further than the height window can answer for. */
const NEXT_VILLAGE = { x: 8401, z: -2905 };
/**
 * Wooded ground with no settlement inside the ring's reach of it: the nearest
 * is over 3.2 km away, and the ring sees 2.6. What stands here is only forest.
 */
const VILLAGE_FREE = { x: 6000, z: 6000 };

/** Drops the flight over a world point; the jump crosses cells, so the ring rebuilds. */
const teleport = (page: Page, at: { x: number; z: number }, above = 120) =>
  page.evaluate(
    (to) => {
      const w = window.__world!;
      w.state.x = to.x;
      w.state.z = to.z;
      w.state.y = w.heightAt(to.x, to.z) + to.above;
      w.state.vy = 0;
      w.step(0.05);
    },
    { ...at, above },
  );

/**
 * The flight over the village, with its houses standing. Seating a site reads
 * the sampler, which answers anywhere, but its plan reads the height window, so
 * a village is planned only once the flight's window covers it and raised only
 * on the rebuild after that. Stepping inside a poll is what that sequence looks
 * like from out here, and it holds whichever frame the houses arrive in.
 */
const overVillage = async (page: Page) => {
  await teleport(page, VILLAGE);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const w = window.__world!;
          w.step(0.05);
          return w.scenery!.buildings;
        }),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  return page.evaluate((v) => {
    const w = window.__world!;
    return {
      site: w.siteNear(v.x, v.z)!,
      trees: w.scenery!.trees,
      buildings: w.scenery!.buildings,
      obstacles: w.obstacles,
    };
  }, VILLAGE);
};

test('the forest reaches past two kilometres, where the fade is not worth watching', async ({ page }) => {
  // The ring used to stop at 1.9 km, and a tree there folded into its own base
  // to leave: growth in plain sight, because the fog covers only a quarter of
  // what stands at that distance. The reach is what moved; this is the half of
  // it the page can answer for, and the console below is the other half -- a
  // material that faded instead of shrinking had to compile to say nothing.
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page);
  const standing = await page.evaluate((at) => {
    const w = window.__world!;
    w.state.x = at.x;
    w.state.z = at.z;
    w.state.y = w.heightAt(at.x, at.z) + 120;
    w.step(0.05);
    // What stands over the ground, counted in rings around the flight: the
    // obstacle registry is filled by the ring and by nothing else, so a ring
    // with something in it is a ring the scenery reached.
    const band = (from: number, to: number) => {
      let found = 0;
      let land = 0;
      for (let k = 0; k < 720; k++) {
        const a = (k / 720) * Math.PI * 2,
          r = from + ((k * 37) % 100) * ((to - from) / 100);
        const x = at.x + Math.cos(a) * r,
          z = at.z + Math.sin(a) * r;
        // Dry ground only: floorAt answers with the sea level over water, and
        // a seabed ten metres under it would read as something standing on it.
        const ground = w.heightAt(x, z);
        if (ground < 10) continue;
        land++;
        if (w.floorAt(x, z) - ground > 5) found++;
      }
      return { found, land };
    };
    return { near: band(1000, 1500), edge: band(2000, 2500), beyond: band(2700, 3200) };
  }, VILLAGE_FREE);
  // Trees stand where they always did, and now also in the band the old ring
  // could not reach at all.
  expect(standing.near.found).toBeGreaterThan(0);
  expect(standing.edge.found).toBeGreaterThan(0);
  // and the ring still ends: past its reach there is dry ground, and nothing
  // standing on any of it
  expect(standing.beyond.land).toBeGreaterThan(50);
  expect(standing.beyond.found).toBe(0);
  expect(errors).toEqual([]);
});

test('a village stands where the lattice seated it, and every house of it joins the obstacles', async ({
  page,
}) => {
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page);
  // Wooded country with no settlement within the ring's reach, as the control:
  // everything the obstacle registry holds here is a tree, so the reading over
  // the village has houses and nothing else on top of it. It is not the
  // flight's own start any more -- the village sits 2.2 km from there and the
  // ring reaches 2.6, so the start now has a village standing in it.
  const bare = await page.evaluate((at) => {
    const w = window.__world!;
    w.state.x = at.x;
    w.state.z = at.z;
    w.state.y = w.heightAt(at.x, at.z) + 120;
    w.step(0.05);
    return { site: w.siteNear(at.x, at.z), scenery: w.scenery!, obstacles: w.obstacles };
  }, VILLAGE_FREE);
  expect(bare.site).toBeNull();
  expect(bare.scenery.buildings).toBe(0);
  expect(bare.scenery.trees).toBeGreaterThan(500);
  expect(bare.obstacles).toBe(bare.scenery.trees);

  const village = await overVillage(page);
  // Two kilometres of slack in the question, half a metre in the answer: the
  // centre comes from the lattice, not from the guess above.
  expect(Math.hypot(village.site.x - VILLAGE.x, village.site.z - VILLAGE.z)).toBeLessThan(5);
  expect(village.site.radius).toBeGreaterThanOrEqual(120);
  expect(village.site.radius).toBeLessThanOrEqual(250);
  expect(village.buildings).toBeGreaterThan(20);
  // A plan is raised whole or not at all -- a village with half its houses is
  // worse than a village a frame late -- so the houses standing are its lots.
  expect(village.buildings).toBe(village.site.lots);
  // And every one of them is something the flight has to fly around: over this
  // ground the registry now holds the ring's trees plus the houses, and nothing
  // else got in on their way through the ring.
  expect(village.obstacles).toBe(village.trees + village.buildings);
  expect(errors).toEqual([]);
});

test('the ground under the village is flat, because one lattice hit both chose it and flattened it', async ({
  page,
}) => {
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page);
  const { site } = await overVillage(page);
  const relief = await page.evaluate((s) => {
    const w = window.__world!;
    // The worst a ring of eight points rises or falls against its own centre.
    const ring = (cx: number, cz: number, r: number) =>
      Math.max(
        ...Array.from({ length: 8 }, (_, k) => {
          const a = (k / 8) * Math.PI * 2;
          return Math.abs(w.heightAt(cx + Math.cos(a) * r, cz + Math.sin(a) * r) - w.heightAt(cx, cz));
        }),
      );
    return {
      centre: ring(s.x, s.z, 80),
      // Six hundred metres out, past the plateau's radius and its feather both.
      around: [
        ring(s.x + 600, s.z, 80),
        ring(s.x - 600, s.z, 80),
        ring(s.x, s.z + 600, 80),
        ring(s.x, s.z - 600, 80),
      ],
    };
  }, site);
  // Eighty metres from its centre the village's ground holds to within ten. It
  // is not a table and is not meant to be one: the plateau's strength is 0.3, so
  // it pulls the ground three tenths of the way to the centre's height and
  // leaves the hill reading as a hill. What makes that number mean anything is
  // the country beside it, which swings three to six times as far over the same
  // eighty metres. Both halves come from one lattice hit -- it refuses a cell
  // too steep to seat on, and it flattens what it seats -- so a hash between the
  // seat and the plateau would leave this village on ground as rough as its
  // neighbours', and that is what this catches.
  expect(relief.centre).toBeLessThan(12);
  for (const around of relief.around) expect(around).toBeGreaterThan(25);
  expect(errors).toEqual([]);
});

test('the village is a clearing with its own trees in it, not a bald patch and not a wood', async ({
  page,
}) => {
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page);
  const { site } = await overVillage(page);
  // scenerySample hands out four trees of a rebuild, in the order the ring's
  // rows emit them, so it cannot say where the trees of a place are. What the
  // flight reads can: floorAt is the top of whatever stands over a point and
  // heightAt is the ground under it, so the difference is what is standing
  // there -- and asked on a grid it also counts what is not.
  const standing = await page.evaluate((s) => {
    const w = window.__world!;
    const scan = (from: number, to: number, step: number) => {
      let ground = 0,
        anything = 0,
        canopy = 0,
        tallest = 0;
      for (let x = s.x - to; x <= s.x + to; x += step)
        for (let z = s.z - to; z <= s.z + to; z += step) {
          const d = Math.hypot(x - s.x, z - s.z);
          if (d < from || d > to) continue;
          ground++;
          const over = w.floorAt(x, z) - w.heightAt(x, z);
          if (over > 0.5) anything++;
          if (over > 15) canopy++;
          tallest = Math.max(tallest, over);
        }
      return { ground, anything, canopy, tallest };
    };
    // Open country, and it has to be past the village's presence: radius plus
    // feather is 413 m for this one, and a band starting at 1.4 radii would be
    // measuring the village's own thinned fringe and calling it the wood.
    return { inside: scan(0, s.radius, 4), outside: scan(700, 1100, 6) };
  }, site);
  // Something stands over a good tenth of the probes inside: the houses, and
  // the village's own trees among them.
  expect(standing.inside.anything).toBeGreaterThan(200);
  // This assertion used to read `canopy === 0`, on the theory that a village
  // with no trees in it was what kept its ground a village and not a wood. What
  // it actually kept was a disc of bare paint 420 m across -- radius plus
  // feather -- with two hundred metres of houses in the middle, which is what
  // the owner saw from the air and called odd. A settlement sows its own ground
  // now, so there are trees in the village.
  expect(standing.inside.canopy).toBeGreaterThan(0);
  // And it is still a clearing, which is the half of it that has to stay true.
  // Nothing thins the scatter toward the middle on purpose: the lots'
  // reservations refuse a tree where the houses are and the village's own
  // density is a fraction of the wood's, and between them the canopy inside
  // comes out well under the canopy outside.
  // Measured here: 0.130 of the village stands under a canopy against 0.326 of
  // the open country, a ratio of 0.40 -- and the same ratio the tree counts
  // give over the ring in Node. Six tenths is the line, and what it catches is
  // a village as wooded as the wood, which is what this was at a scatter
  // density of 0.55: 1.7 trees a hectare on both sides of its own edge.
  const inside = standing.inside.canopy / standing.inside.ground,
    outside = standing.outside.canopy / standing.outside.ground;
  expect(inside).toBeLessThan(outside * 0.6);
  // Outside it the wood is a wood: a canopy over a good quarter of the ground
  // and sixty metres of it at its tallest.
  expect(outside).toBeGreaterThan(0.2);
  expect(standing.outside.tallest).toBeGreaterThan(40);
  expect(errors).toEqual([]);
});

test('the flight does not fly through the village', async ({ page }) => {
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page);
  const { site } = await overVillage(page);
  const flown = await page.evaluate((s) => {
    const w = window.__world!;
    // Four roofs spread across the village, found the way the forest is counted:
    // by asking what stands over the ground.
    const roofs: Array<[number, number]> = [];
    for (let x = s.x - s.radius; x <= s.x + s.radius; x += 4)
      for (let z = s.z - s.radius; z <= s.z + s.radius; z += 4)
        if (Math.hypot(x - s.x, z - s.z) <= s.radius && w.floorAt(x, z) - w.heightAt(x, z) > 5)
          roofs.push([x, z]);
    const legs = [0, 0.25, 0.5, 0.75].map((f) => roofs[Math.floor(f * roofs.length)]!);
    let worst = Infinity;
    const out = [];
    for (const [hx, hz] of legs) {
      const roof = w.floorAt(hx, hz) - w.heightAt(hx, hz);
      w.state.x = hx;
      w.state.z = hz;
      // A metre under the clearance the ground alone would ask for, so the
      // envelope has to lift the figure over the house rather than over the
      // field it stands in.
      w.state.y = w.heightAt(hx, hz) + 26;
      w.state.vy = 0;
      w.state.heading = Math.atan2(s.x - hx, s.z - hz); // across the village, not away from it
      w.step(0.05);
      let closest = Infinity,
        buildings = 0;
      // fifteen seconds a leg, four legs: a minute of flight, sampled every step
      for (let k = 0; k < 15 * 50; k++) {
        w.step(0.02);
        worst = Math.min(worst, w.state.y - w.floorAt(w.state.x, w.state.z));
        const d = Math.hypot(w.state.x - s.x, w.state.z - s.z);
        if (d < closest) {
          closest = d;
          buildings = w.scenery!.buildings;
        }
      }
      out.push({ roof, closest, buildings });
    }
    return { worst, legs: out };
  }, site);
  expect(flown.legs).toHaveLength(4);
  for (const leg of flown.legs) {
    // it really did start over a house, with the whole village standing under it
    expect(leg.roof).toBeGreaterThan(5);
    expect(leg.closest).toBeLessThan(site.radius);
    expect(leg.buildings).toBeGreaterThan(20);
  }
  // The same envelope that holds over the canopy, over the roofs: the figure
  // hangs 0.3 m below the clearance, and one step of the integrator is worth
  // less than the rest of the half metre.
  expect(flown.worst).toBeGreaterThanOrEqual(MIN_CLEARANCE - 0.5);
  expect(errors).toEqual([]);
});

test('the plan queue does not stall a frame', async ({ page }) => {
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page);
  await overVillage(page);
  // The next village out is 8.3 km away, further than the height window reaches,
  // so its plan cannot have been built before the jump: whatever the queue
  // spends on it falls inside the frames sampled here.
  const queue = await page.evaluate((n) => {
    const w = window.__world!;
    w.state.x = n.x;
    w.state.z = n.z;
    w.state.y = w.heightAt(n.x, n.z) + 120;
    w.state.vy = 0;
    const ms: number[] = [];
    for (let frame = 0; frame < 12; frame++) {
      w.step(0.05);
      ms.push(w.scenery!.sitesMs);
    }
    return { ms, site: w.siteNear(n.x, n.z), buildings: w.scenery!.buildings };
  }, NEXT_VILLAGE);
  // A different village, planned inside those twelve frames and standing at the
  // end of them: the samples are of a queue that had work to do.
  expect(queue.site!.id).not.toBe('village:0,0');
  expect(queue.site!.lots).toBeGreaterThan(20);
  expect(queue.buildings).toBeGreaterThan(20);
  // The budget is 4 ms a frame. Eight leaves room for a software rasteriser
  // having a bad moment and still fails if a plan ever costs half a frame.
  expect(Math.max(...queue.ms)).toBeLessThanOrEqual(8);
  expect(errors).toEqual([]);
});

test('the village draws: the road and the houses compile', async ({ page }) => {
  // The first capture compiles the whole scene a second time for its own target,
  // which is ten seconds on this rasteriser -- and is the point: a material is
  // compiled when something is first drawn with it, so a paused flight that
  // never drew the village would prove nothing about the village's materials.
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page);
  const { site } = await overVillage(page);
  const drawn = await page.evaluate(async (s) => {
    const w = window.__world!;
    // Back off and turn to face it, so the roads and the houses are in front of
    // the camera in the frame that follows rather than under it.
    const x = s.x - 700,
      z = s.z - 700;
    w.state.x = x;
    w.state.z = z;
    w.state.y = w.heightAt(x, z) + 90;
    w.state.vy = 0;
    w.state.heading = Math.atan2(s.x - x, s.z - z);
    w.step(0.05);
    const shot = await w.capture(128, 72);
    return {
      buildings: w.scenery!.buildings,
      pixels: shot ? shot.data.length : 0,
      finite: shot ? shot.data.every(Number.isFinite) : false,
    };
  }, site);
  expect(drawn.buildings).toBeGreaterThan(20);
  expect(drawn.pixels).toBe(128 * 72 * 4);
  expect(drawn.finite).toBe(true);
  // Nothing in the console is what proves their materials compiled, and it is
  // the whole of the proof: the geometry counter cannot say anything here. It
  // was read before and after this capture until CI read the same 51 twice --
  // a step renders, so the houses reached the GPU back in `overVillage`'s poll,
  // and at 2.2 km from the start they were inside the ring on the very first
  // frame. What this frame buys is the capture's own target, which compiles
  // every material in the scene a second time for that configuration.
  expect(errors).toEqual([]);
});

/**
 * The town seed 42 seats 9.2 km from the start: the nearest one, and the one
 * with no village inside 1.4 km of it. That second condition is not fussiness.
 * A village standing inside a town dilutes the town's plateau to its own share
 * of the fragment, and the ground that should be a table comes out with tens of
 * metres of relief in it -- measured in M4b's second-lattice note. The centre
 * comes from `siteNear` like the village's; these two numbers only have to land
 * the question inside the ring's reach.
 */
const TOWN = { x: -5289, z: -7577 };

/**
 * The flight over the town, with its buildings standing. Same sequence as the
 * village: a town is seated off the sampler, which answers anywhere, but its
 * plan reads the height window, so it is planned only once the window covers it
 * and raised on the rebuild after that.
 */
const overTown = async (page: Page) => {
  await teleport(page, TOWN, 200);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const w = window.__world!;
          w.step(0.05);
          return w.scenery!.buildings;
        }),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(100);
  return page.evaluate((t) => {
    const w = window.__world!;
    return {
      site: w.siteNear(t.x, t.z)!,
      trees: w.scenery!.trees,
      buildings: w.scenery!.buildings,
      refused: w.scenery!.buildingsRefused,
      obstacles: w.obstacles,
    };
  }, TOWN);
};

test('a town stands, and not one house of it is lost on the way through the pools', async ({ page }) => {
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page);
  const town = await overTown(page);
  expect(town.site.id.startsWith('town')).toBe(true);
  expect(Math.hypot(town.site.x - TOWN.x, town.site.z - TOWN.z)).toBeLessThan(5);
  expect(town.site.radius).toBeGreaterThanOrEqual(400);
  expect(town.site.radius).toBeLessThanOrEqual(900);
  // The spec's own number: a town is five hundred to two thousand buildings,
  // and the generator hits it by construction rather than by a cap.
  expect(town.buildings).toBeGreaterThan(500);
  expect(town.buildings).toBeLessThanOrEqual(2000);
  // A plan is raised whole or not at all, so what stands is its lots.
  expect(town.buildings).toBe(town.site.lots);
  // And this is the assertion the counter exists for. A pool at its ceiling and
  // a shape nobody baked are both a `continue` in the ring, so before M4b a
  // town could lose two hundred houses and nothing would say so. Measured: the
  // worst pool a town fills is a third of one, and this is what keeps it true.
  expect(town.refused).toBe(0);
  // Every building is something the flight has to fly around, on top of the
  // ring's trees and nothing else.
  expect(town.obstacles).toBe(town.trees + town.buildings);
  expect(errors).toEqual([]);
});

test('the town levels its ground, and stops short of levelling the county', async ({ page }) => {
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page);
  const { site } = await overTown(page);
  const relief = await page.evaluate((s) => {
    const w = window.__world!;
    // The worst a ring of eight points rises or falls against its own centre.
    const ring = (cx: number, cz: number, r: number) =>
      Math.max(
        ...Array.from({ length: 8 }, (_, k) => {
          const a = (k / 8) * Math.PI * 2;
          return Math.abs(w.heightAt(cx + Math.cos(a) * r, cz + Math.sin(a) * r) - w.heightAt(cx, cz));
        }),
      );
    // How rough the ground is, on average, all the way round a circle: one
    // radius cannot answer for a town whose ground falls to the sea on one side
    // and to a wood on the other.
    const belt = (r: number) => {
      const rough = Array.from({ length: 12 }, (_, k) => {
        const a = (k / 12) * Math.PI * 2;
        return ring(s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, 80);
      });
      return rough.reduce((sum, v) => sum + v, 0) / rough.length;
    };
    return { centre: ring(s.x, s.z, 80), inside: belt(200), country: belt(1500) };
  }, site);
  // The town's own ground holds to a few metres over eighty, and the country a
  // kilometre and a half out is three times as rough. Measured here: 4.8 m at
  // the centre, 5.1 as a mean inside, 14.0 in the country.
  expect(relief.centre).toBeLessThan(9);
  expect(relief.inside).toBeLessThan(relief.country * 0.6);
  expect(relief.country).toBeGreaterThan(8);
  // And it is deliberately not a table, which is what this assertion used to
  // say. A plateau at full strength pulls the whole disc to the height of its
  // centre; on the coastal hill this town sits on that was a pale mesa with
  // buildings on top of it, a geological event rather than a place. At half
  // strength the ground still moves, and what needs to be level is the streets,
  // which have a slope rule of their own.
  expect(relief.inside).toBeGreaterThan(0.5);
  expect(errors).toEqual([]);
});

test('the flight does not fly through the town, landmark included', async ({ page }) => {
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page);
  const { site } = await overTown(page);
  const flown = await page.evaluate((s) => {
    const w = window.__world!;
    // The tallest thing standing in the town, found the way the forest is
    // counted: by asking what stands over the ground. The landmark is three or
    // four stages of 10.8 m on a plinth, so it is half again the tallest roof
    // and taller than anything the flight has had to climb over before.
    let tallest = { x: s.x, z: s.z, top: 0 };
    for (let x = s.x - s.radius; x <= s.x + s.radius; x += 4)
      for (let z = s.z - s.radius; z <= s.z + s.radius; z += 4) {
        if (Math.hypot(x - s.x, z - s.z) > s.radius) continue;
        const top = w.floorAt(x, z) - w.heightAt(x, z);
        if (top > tallest.top) tallest = { x, z, top };
      }
    // Straight at it from 500 m out, a metre under the clearance the bare
    // ground would ask for, so the envelope has to lift the figure over the
    // town rather than over the field it stands in.
    const heading = Math.atan2(tallest.x - s.x, tallest.z - s.z);
    const from = { x: tallest.x - Math.sin(heading) * 500, z: tallest.z - Math.cos(heading) * 500 };
    w.state.x = from.x;
    w.state.z = from.z;
    w.state.y = w.heightAt(from.x, from.z) + 26;
    w.state.vy = 0;
    w.state.heading = heading;
    w.step(0.05);
    let worst = Infinity,
      closest = Infinity;
    for (let k = 0; k < 40 * 50; k++) {
      w.step(0.02);
      worst = Math.min(worst, w.state.y - w.floorAt(w.state.x, w.state.z));
      closest = Math.min(closest, Math.hypot(w.state.x - s.x, w.state.z - s.z));
    }
    // Where the flight goes over the town is the autopilot's business -- it
    // steers, and a figure told to cross a town does not promise to cross one
    // particular roof of it. So the landmark gets a question of its own, and a
    // deterministic one: stand the figure inside the tower, a metre under the
    // clearance the bare ground would ask for, and take one step. The envelope
    // clamps after the move, so what comes back is the lift itself.
    w.state.x = tallest.x;
    w.state.z = tallest.z;
    w.state.y = w.heightAt(tallest.x, tallest.z) + 26;
    w.state.vy = 0;
    w.step(0.05);
    const lifted = {
      overGround: w.state.y - w.heightAt(tallest.x, tallest.z),
      overTower: w.state.y - w.floorAt(tallest.x, tallest.z),
    };
    return { tallest, worst, closest, lifted, buildings: w.scenery!.buildings };
  }, site);
  // It really is a landmark and not a roof: the tallest thing a town has after
  // it is a four-storey mill at about sixteen metres, and this is over thirty.
  expect(flown.tallest.top).toBeGreaterThan(30);
  expect(flown.buildings).toBeGreaterThan(500);
  // The same envelope that holds over the canopy and over the village's roofs,
  // over a tower half again as tall: the figure hangs 0.3 m below the
  // clearance and one step of the integrator is worth less than the rest.
  expect(flown.worst).toBeGreaterThanOrEqual(MIN_CLEARANCE - 0.5);
  // and it really crossed the town rather than turning away from it
  expect(flown.closest).toBeLessThan(site.radius);
  // The landmark, asked on its own: the figure stood inside the tower and the
  // envelope put it over the top, not over the field the tower stands in.
  expect(flown.lifted.overTower).toBeGreaterThanOrEqual(MIN_CLEARANCE - 0.5);
  expect(flown.lifted.overGround).toBeGreaterThan(flown.tallest.top + MIN_CLEARANCE - 0.5);
  expect(errors).toEqual([]);
});

test('the town costs the frame it was measured to cost, and no more', async ({ page }) => {
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page);
  // Nowhere near the town: 9.2 km is well past what the height window can
  // answer for, so the town cannot have been planned before the jump and
  // whatever the queue spends on it falls inside the frames sampled here.
  const queue = await page.evaluate((t) => {
    const w = window.__world!;
    w.state.x = t.x;
    w.state.z = t.z;
    w.state.y = w.heightAt(t.x, t.z) + 200;
    w.state.vy = 0;
    const ms: number[] = [];
    for (let frame = 0; frame < 16; frame++) {
      w.step(0.05);
      ms.push(w.scenery!.sitesMs);
    }
    return { ms, site: w.siteNear(t.x, t.z), buildings: w.scenery!.buildings };
  }, TOWN);
  expect(queue.site!.id.startsWith('town')).toBe(true);
  expect(queue.buildings).toBeGreaterThan(500);
  // What M4b decided, and the thing worth defending, is the **shape**: a town is
  // built whole in one frame, and nothing else in the rebuild costs a frame at
  // all. That is machine-independent. Ten milliseconds is far over the queue's
  // own 4 ms budget and far under what a town costs anywhere, so exactly one
  // long frame in sixteen is the town and no second one is a plan that started
  // being built in pieces.
  expect(queue.ms.filter((v) => v > 10)).toHaveLength(1);
  // And a ceiling, which is not machine-independent and cannot be. Measured in
  // Node over this ground: 18.8 ms at the widest radius, 18.9 for this town
  // through the queue; on a two-core CI runner under a software rasteriser the
  // same work is 41. The ceiling was 40 -- twice the first of those numbers,
  // set without ever having seen the second, so it failed the first time CI
  // ever ran this test. Eighty is twice the slowest honest reading. It will not
  // catch a town that got twice as dear on the runner; the assertion above and
  // a local run will. A town is 41 km from the next, so this is one long frame
  // every eleven to seventeen minutes of flying, deliberately, because the
  // machinery to remove it costs more than it does.
  expect(Math.max(...queue.ms)).toBeLessThanOrEqual(80);
  expect(errors).toEqual([]);
});

test('the town draws: its streets, its houses and its landmark compile', async ({ page }) => {
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page);
  const { site } = await overTown(page);
  const drawn = await page.evaluate(async (s) => {
    const w = window.__world!;
    // Back off and turn to face it, so the streets and the buildings are in
    // front of the camera in the frame that follows rather than under it.
    const x = s.x - 1400,
      z = s.z - 1400;
    w.state.x = x;
    w.state.z = z;
    w.state.y = w.heightAt(x, z) + 220;
    w.state.vy = 0;
    w.state.heading = Math.atan2(s.x - x, s.z - z);
    w.step(0.05);
    const before = w.memory();
    const shot = await w.capture(128, 72);
    return {
      before,
      after: w.memory(),
      buildings: w.scenery!.buildings,
      refused: w.scenery!.buildingsRefused,
      pixels: shot ? shot.data.length : 0,
      finite: shot ? shot.data.every(Number.isFinite) : false,
    };
  }, site);
  expect(drawn.buildings).toBeGreaterThan(500);
  expect(drawn.refused).toBe(0);
  expect(drawn.pixels).toBe(128 * 72 * 4);
  expect(drawn.finite).toBe(true);
  // No assertion on the geometry count here, unlike the village's. It counts
  // meshes that have reached the GPU, which is a proxy for "this frame drew
  // something new" -- and for a town it is not a stable one: raising a town
  // takes enough frames that its pools have already been drawn by the time the
  // camera is turned on it. It passed alone and failed in the suite, which is
  // the definition of an assertion not worth keeping. What is left proves the
  // same thing anyway: a frame with the town in front of the camera came back
  // whole, and nothing in the console. An `uncapturederror` is fatal here on
  // purpose, so a shader that only warned would not have got this far.
  expect(errors).toEqual([]);
});

test('the country under the flight is heard, and only when it could be', async ({ page }) => {
  const errors = await begun(page, 'seed=42&webgl=1');
  // What the biomes ask for, at a height and a time of day. The mix is the
  // engine's answer and the graph's input, so reading it here is reading the
  // same number the gains are set from.
  const heard = (phase: number, over: number) =>
    page.evaluate(
      ({ phase, over }) => {
        const w = window.__world!;
        w.dayPhase = phase;
        w.state.y = Math.max(0, w.heightAt(w.state.x, w.state.z)) + over;
        for (let i = 0; i < 4; i++) w.step(1 / 60);
        return w.audio.layers as Record<string, number>;
      },
      { phase, over },
    );

  // The sun decides two of the five: a dawn chorus at midnight is wrong in a
  // way no biome would ever ask for, and so is a cricket at noon.
  const midnight = await heard(0, 60);
  expect(midnight.birds).toBe(0);
  expect(midnight.bells).toBe(0);
  const noon = await heard(0.5, 60);
  expect(noon.crickets).toBe(0);

  // Height decides the rest. Crickets, birds and bells stand on the ground and
  // are gone by 450 m; the high wind only starts where they stop.
  const up = await heard(0, 1500);
  for (const layer of ['crickets', 'birds', 'bells']) expect(up[layer]).toBe(0);

  // and something is heard somewhere: ten biomes that all say nothing would
  // pass every assertion above.
  const readings = [midnight, noon, up, await heard(0.5, 1500)];
  const loudest = Math.max(...readings.flatMap((r) => Object.values(r)));
  expect(loudest).toBeGreaterThan(0);
  expect(loudest).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('a country tints its own air, and the sky over it with it', async ({ page }) => {
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page);
  const found = await page.evaluate(
    (tinted) => {
      const w = window.__world!;
      let best: { x: number; z: number; id: string } | null = null,
        plain: { x: number; z: number; id: string } | null = null;
      // One sweep, not one per biome: which countries seed 42 puts near the start
      // is the terrain's business, so the test takes the best of whatever is
      // there rather than naming a biome it may have to fly a day to reach.
      for (let r = 400; r <= 60_000 && !(best && plain); r += 900)
        for (let a = 0; a < 24; a++) {
          const x = Math.sin((a / 24) * Math.PI * 2) * r,
            z = Math.cos((a / 24) * Math.PI * 2) * r;
          if (w.heightAt(x, z) < 5) continue;
          const here = w.weightsAt(x, z)[0];
          if (!here || here.weight < 0.7) continue;
          const at = { x, z, id: here.id };
          if (tinted.includes(here.id)) best ??= at;
          else plain ??= at;
        }
      return { best, plain };
    },
    ['jungle', 'dunes', 'badlands', 'frostpines', 'moor'],
  );
  const hazy = found.best; // one of the five that tint their air
  const plain = found.plain; // and one that tints nothing
  expect(hazy, 'no biome that tints its air within sixty kilometres of the start').toBeTruthy();
  expect(plain).toBeTruthy();

  /**
   * The fog, the background and the dome's horizon -- one colour in this engine
   * -- over a place, at one hour and one height.
   *
   * This reads the uniform rather than photographing the sky, and it is worth
   * saying why: the tint is capped at a third of the way and half the biomes
   * that carry one carry something pale. Measured on pixels, frostpines against
   * wildsong moved the sky by **half a unit in 255** -- a real effect drowned in
   * the difference between two landscapes. The uniform is what the shader is
   * handed, and the shader's own path from it to the sky is what the day-turns
   * and Milky Way tests already watch.
   */
  const horizonOver = async (at: { x: number; z: number }) =>
    page.evaluate((at) => {
      const w = window.__world!;
      w.setAutopilot(false);
      w.state.x = at.x;
      w.state.z = at.z;
      w.state.y = Math.max(0, w.heightAt(at.x, at.z)) + 120;
      w.dayPhase = 0.42;
      for (let i = 0; i < 4; i++) w.step(1 / 60);
      return w.horizon;
    }, at);

  const over = await horizonOver(hazy!);
  const away = await horizonOver(plain!);
  const tint = await page.evaluate((id) => window.__world!.hazeOf(id), hazy!.id);
  expect(tint, `${hazy!.id} has no tint`).toBeTruthy();
  // The two are different, and the difference points at the biome's own colour:
  // a direction and a distance, rather than a colour the test could name, since
  // what the cap buys is a tint and never a repaint.
  const moved = Math.hypot(over.r - away.r, over.g - away.g, over.b - away.b);
  const toward =
    (over.r - away.r) * (tint!.r / 255 - away.r) +
    (over.g - away.g) * (tint!.g / 255 - away.g) +
    (over.b - away.b) * (tint!.b / 255 - away.b);
  expect(moved, `${hazy!.id} against ${plain!.id}`).toBeGreaterThan(0.004);
  expect(toward, `${hazy!.id} against ${plain!.id}`).toBeGreaterThan(0);
  // and the plain country's air is the palette's own: nothing was added to it
  const plainAgain = await horizonOver(plain!);
  expect(Math.hypot(away.r - plainAgain.r, away.g - plainAgain.g, away.b - plainAgain.b)).toBeLessThan(1e-6);
  expect(errors).toEqual([]);
});

test('the opening plays once, and anything at all ends it', async ({ page }) => {
  const errors = await begun(page, 'seed=42&webgl=1', true);
  /** The script's own seconds: the page runs in slow motion on a rasteriser. */
  const run = (seconds: number) =>
    page.evaluate((s) => {
      for (let i = 0; i < Math.round(s * 60); i++) window.__world!.step(1 / 60);
      const w = window.__world!;
      return { card: w.opening.card, done: w.opening.done, y: w.state.y, phase: w.dayPhase };
    }, seconds);

  // It starts at dawn with a card over it, and under the cloud deck: the climb
  // is the act with something to see and it needs something to climb through.
  const early = await run(2);
  expect(early.card).toBeGreaterThan(0.5);
  expect(early.done).toBe(false);
  expect(early.phase).toBeGreaterThan(0.1);
  expect(early.phase).toBeLessThan(0.2);
  const start = early.y;
  expect(start).toBeLessThan(520);

  // The card goes before the flight does anything worth watching, and the
  // climb takes the figure over the deck.
  const mid = await run(16);
  expect(mid.card).toBe(0);
  expect(mid.y).toBeGreaterThan(520);
  expect(mid.done).toBe(false);

  // It ends itself and hands the flight back.
  const after = await run(14);
  expect(after.done).toBe(true);
  // the real flag, off the debug surface: `state.autopilot` does not exist, and
  // reading it gave `undefined ?? true`, which is an assertion that cannot fail
  expect(await page.evaluate(() => window.__world!.autopilot)).toBe(true);
  // and the day is the world's own again: a rate left at three would show up
  // here as three times the phase in the same number of steps
  const before = after.phase;
  const later = await run(6);
  expect((later.phase - before) * 600).toBeGreaterThan(4);
  expect((later.phase - before) * 600).toBeLessThan(9);
  expect(errors).toEqual([]);
});

test('a hand on the controls ends the opening, and a remembered flight never sees it', async ({ page }) => {
  // Two page starts with a reload between them, and each start compiles every
  // shader in the scene: ninety seconds ran out on CI.
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1', true);
  await page.evaluate(() => {
    for (let i = 0; i < 120; i++) window.__world!.step(1 / 60);
  });
  expect(await page.evaluate(() => window.__world!.opening.done)).toBe(false);
  // One arrow key. Not a drag, not the HUD: the cheapest thing a person does.
  await page.keyboard.press('ArrowLeft');
  const skipped = await page.evaluate(() => {
    const w = window.__world!;
    return { done: w.opening.done, card: w.opening.card };
  });
  expect(skipped.done).toBe(true);
  expect(skipped.card).toBe(0);

  // Now leave a flight behind and come back to it. Thirty seconds of titles is
  // not what somebody coming back came back for.
  await page.evaluate(() => window.__world!.saveFlight());
  await page.reload();
  await page.waitForFunction(() => window.__world?.ready === true, null, { timeout: 90_000 });
  await page.click('#beginBtn');
  await expect.poll(() => page.evaluate(() => window.__world!.running), { timeout: 15_000 }).toBe(true);
  expect(await page.evaluate(() => window.__world!.resumed)).toBe(true);
  expect(await page.evaluate(() => window.__world!.opening.done)).toBe(true);
  expect(await page.evaluate(() => window.__world!.opening.card)).toBe(0);
  expect(errors).toEqual([]);
});
test('the dev panel switches a layer off and the frame loses it', async ({ page }) => {
  // Three captures, so the first compiles the scene a second time for the
  // capture's own target: slow on a runner with no GPU, and the reason this is
  // one test and not three.
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1&dev=1');
  await expect(page.locator('#dev')).toBeVisible();
  await paused(page);
  // Noon: the galaxy's atlas lands in the middle of a test like this one, and
  // at dawn that is worth 0.0005 of the picture (measured in the wind test).
  // At noon the night factor is zero and the atlas cannot change a pixel.
  await page.evaluate(() => {
    window.__world!.dayPhase = 0.5;
  });
  const shot = async () => {
    const data = await page.evaluate(async () => {
      const picture = await window.__world!.capture(96, 54);
      return picture ? Array.from(picture.data) : null;
    });
    return data;
  };
  const diff = (x: number[] | null, y: number[] | null) =>
    x && y ? x.reduce((sum, v, i) => sum + Math.abs(v - y[i]!), 0) / x.length : NaN;
  // One capture thrown away first. Taken in the same animation frame as the
  // day was moved, it reads 0.07 away from every capture after it -- measured,
  // and the cause is the node graph's frame id, which three advances only in
  // the renderer's own tick: nodes that update once per id are still carrying
  // the state from before the day moved. One animation frame later they are
  // not, and from there the captures are identical to the last bit.
  await shot();
  const full = await shot();
  const terrain = page.locator('#dev label.layer', { hasText: 'terrain' }).locator('input');
  await terrain.uncheck();
  expect(await page.evaluate(() => window.__world!.layers.visible('terrain'))).toBe(false);
  const bare = await shot();
  // A world with the ground switched off is a different picture by any measure;
  // what it is not is a broken one, so the pixels are still numbers.
  expect(diff(full, bare)).toBeGreaterThan(0.02);
  expect(bare!.every(Number.isFinite)).toBe(true);
  await terrain.check();
  expect(await page.evaluate(() => window.__world!.layers.visible('terrain'))).toBe(true);
  // And the switch gave it back: the same sun, the same place, the same frame,
  // to within the microsecond of day each redraw costs (measured: 1.4e-5).
  expect(diff(full, await shot())).toBeLessThan(1e-3);
  expect(errors).toEqual([]);
});

test('the dev panel measures what the biomes cost a texel', async ({ page }) => {
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1&dev=1');
  await paused(page);
  await page.locator('#dev button', { hasText: 'measure hooks' }).click();
  const costs = page.locator('#dev .wrap').last();
  await expect(costs).toContainText(/hooks -?\d+\.\d\d µs\/texel \(budget 2\)/, { timeout: 30_000 });
  // The measurement itself, off the same surface: one entry per biome in the
  // registry, real time on the clock, and nothing infinite in it.
  const measured = await page.evaluate(() => {
    const w = window.__world!;
    const costs = w.measureHeightHooks(512);
    return { ...costs, biomes: w.biomes };
  });
  expect(measured.perBiome.map((b) => b.id)).toEqual(measured.biomes);
  expect(measured.base).toBeGreaterThan(0);
  expect(measured.all).toBeGreaterThan(0);
  expect(Number.isFinite(measured.hooks)).toBe(true);
  expect(errors).toEqual([]);
});

test('the dev panel jumps the flight to a settlement', async ({ page }) => {
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1&dev=1');
  await paused(page);
  // The village of the tests above, typed into the panel's own fields.
  const fields = page.locator('#dev .fields input[type=number]');
  await fields.nth(0).fill(String(VILLAGE.x));
  await fields.nth(1).fill(String(VILLAGE.z));
  await page.locator('#dev .fields button', { hasText: 'go' }).first().click();
  const where = await page.evaluate(() => {
    const w = window.__world!;
    return { x: w.state.x, z: w.state.z, clearance: w.clearance };
  });
  // Not to the metre: a jump ends in a step, and a step is a step -- the flight
  // flies the 0.05 s that puts the window, the ring and the origin where it
  // has landed. Two metres at 44 m/s is what that costs.
  expect(Math.hypot(where.x - VILLAGE.x, where.z - VILLAGE.z)).toBeLessThan(5);
  expect(where.clearance).toBeGreaterThan(50);
  // And the settlement is found from there: the panel's `site` button walks the
  // flight to the middle of the plan the ring is holding.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const w = window.__world!;
          w.step(0.05);
          return w.scenery!.buildings;
        }),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  await page.locator('#dev .fields button', { hasText: 'site' }).click();
  const site = await page.evaluate(() => {
    const w = window.__world!;
    return { id: w.siteNear(w.state.x, w.state.z)!.id, x: w.state.x, z: w.state.z };
  });
  expect(site.id).toBe('village:0,0');
  expect(Math.hypot(site.x - VILLAGE.x, site.z - VILLAGE.z)).toBeLessThan(200);
  expect(errors).toEqual([]);
});

test('the wardrobe dresses the figure, and the world picks the marking until somebody does', async ({
  page,
}) => {
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  // Nobody has chosen a marking, so this one is seed 42's own -- the rule, not
  // a roll: the same address opens wearing the same thing every time.
  const first = await page.evaluate(() => window.__world!.wearing);
  expect(first.outfit).toBe('dusk');
  expect(first.pattern.length).toBeGreaterThan(0);
  expect(await page.locator('#wardrobe').isVisible()).toBe(false);

  await page.click('#wardrobeBtn');
  await expect(page.locator('#wardrobe')).toBeVisible();
  await expect(page.locator('#wardrobeBtn')).toHaveAttribute('aria-expanded', 'true');
  // One tile per outfit and one chip per marking, and the tiles are drawn from
  // the catalogue's own colours (the unit tests hold that end of it).
  const tiles = page.locator('#wardrobeOutfits button');
  await expect(tiles).toHaveCount(6);
  await expect(page.locator('#wardrobePatterns button')).toHaveCount(5);

  await page.click('#wardrobeOutfits button[data-id="moss"]');
  await page.click('#wardrobePatterns button[data-id="bands"]');
  expect(await page.evaluate(() => window.__world!.wearing)).toEqual({
    outfit: 'moss',
    pattern: 'bands',
  });
  // A choice is the person's, so it is remembered -- and the figure is
  // repainted on the spot rather than on the next thing that happens to draw.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dreamfall-settings')!))).toMatchObject({
    outfit: 'moss',
    pattern: 'bands',
  });
  await page.reload();
  await page.waitForFunction(() => window.__world?.ready === true, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__world!.wearing)).toEqual({
    outfit: 'moss',
    pattern: 'bands',
  });
  expect(errors).toEqual([]);
});
