import { expect, test, type Page } from '@playwright/test';
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
  await expect
    .poll(() => page.evaluate(() => window.__world!.frames), { timeout: 15_000 })
    .toBeGreaterThan(idle);
  await expect
    .poll(() => page.evaluate(() => window.__world!.state.t), { timeout: 15_000 })
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__world!.backend)).toBe('webgl2');
  await expect(page.locator('#hud')).not.toHaveAttribute('inert', '');
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
  const errors = await openWorld(page, 'seed=42&webgl=1');
  await page.click('#beginBtn');
  await expect.poll(() => page.evaluate(() => window.__world!.running), { timeout: 15_000 }).toBe(true);
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
  expect(await page.evaluate(() => window.__world!.paused)).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__world!.audio.state), { timeout: 5_000 })
    .toBe('suspended');
  expect(errors).toEqual([]);
});

const begun = async (page: Page, query: string) => {
  const errors = await openWorld(page, query);
  await page.click('#beginBtn');
  await expect.poll(() => page.evaluate(() => window.__world!.running), { timeout: 15_000 }).toBe(true);
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
  await expect.poll(() => page.evaluate(() => window.__world!.view)).toBe('fpp');
  await expect(page.locator('#viewBtn')).toHaveText('view: eyes');
  // the projection follows on the next frame
  await expect.poll(() => page.evaluate(() => window.__world!.cameraFov), { timeout: 15_000 }).toBe(75);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dreamfall-settings')!).view)).toBe('fpp');
  await page.click('#viewBtn');
  await expect.poll(() => page.evaluate(() => window.__world!.view)).toBe('tpp');
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
    await expect
      .poll(() => page.evaluate(() => window.__world!.audio.gain), { timeout: 8_000 })
      .toBeGreaterThan(0.1);
  await page.click('#muteBtn');
  await expect(page.locator('#muteBtn')).toHaveText('sound off');
  expect((await page.evaluate(() => window.__world!.audio)).muted).toBe(true);
  if (running)
    await expect
      .poll(() => page.evaluate(() => window.__world!.audio.gain), { timeout: 8_000 })
      .toBeLessThan(0.05);
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
  // refill now runs ten presence hooks over 313 600 texels: this one is slow by
  // construction, not by accident.
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page); // no render loop competing with the teleports below
  const biomes = await page.evaluate(() => window.__world!.biomes);
  expect(biomes).toHaveLength(10);
  expect(biomes[0]).toBe('wildsong');
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
        return [
          r / n,
          g / n,
          b / n,
          w.state.x - x,
          w.state.z - z,
          w.state.y,
          w.scenery!.trees,
          w.scenery!.grass,
          w.scenery!.rebuilds,
        ];
      },
      { x, z, h },
    );
  const shotA = await groundAt(STEPPE.x, STEPPE.z, a.h);
  const shotAgain = await groundAt(STEPPE.x, STEPPE.z, a.h);
  const shotB = await groundAt(WILDSONG.x, WILDSONG.z, b.h);
  const apart = (x: number[] | null, y: number[] | null) =>
    x && y ? x.reduce((s, v, i) => s + Math.abs(v - y[i]!), 0) / x.length : NaN;
  // The pixels come back 0..1, so these are small numbers on purpose. Measured
  // at seed 42: steppe reads (0.29, 0.31, 0.11) and wildsong (0.17, 0.28, 0.08).
  expect(apart(shotA, shotAgain)).toBeLessThan(0.002);
  expect(apart(shotA, shotB)).toBeGreaterThan(0.02);
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
