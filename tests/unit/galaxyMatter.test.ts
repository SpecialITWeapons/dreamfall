import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { GALAXY_HEADING } from '../../src/engine/flight/SkyPulls';
import {
  DUST,
  brightestMatter,
  makeDust,
  photographicMatter,
  sampleDust,
  type Dust,
} from '../../src/engine/sky/GalaxyMatter';
import { galacticDirection } from '../../src/engine/sky/MilkyWay';

// Growing the field is 49 ms and every test below wants the same one; the seed
// is fixed inside it, so one is all there is anyway.
let dust: Dust;
beforeAll(() => {
  dust = makeDust();
});

/** Where the original grew its trails from, and where the bulge is written. */
const CORE_LONGITUDE = 2.98;

describe('makeDust', () => {
  it('grows a field with dark lanes in it, and the same one every time', () => {
    expect(dust.width).toBe(DUST.width);
    expect(dust.height).toBe(DUST.height);
    // Counted with a plain loop and asserted once: two million assertions is
    // twenty seconds of test runner and says nothing the summary does not.
    let dark = 0,
      peak = 0,
      floor = 0;
    for (const v of dust.data) {
      if (v > 0.5) dark++;
      if (v > peak) peak = v;
      if (v < floor) floor = v;
    }
    expect(floor).toBe(0);
    // Lanes, not a wash and not an empty field: a few per cent of the sky is
    // properly obscured and the thickest of it is thick.
    expect(dark / dust.data.length).toBeGreaterThan(0.005);
    expect(dark / dust.data.length).toBeLessThan(0.2);
    expect(peak).toBeGreaterThan(1.5);
    // The seed is the module's, so a second field is the first one.
    const again = makeDust();
    expect(again.data[12_345]).toBe(dust.data[12_345]);
    expect(again.data[2_000_000]).toBe(dust.data[2_000_000]);
  });

  it('wraps in longitude, because the sky has no seam in it', () => {
    // The same bearing written twice: a field that did not wrap would show the
    // join as a line down the sky, and it would show it at night only.
    for (const latitude of [-0.2, -0.05, 0, 0.05, 0.2]) {
      const left = sampleDust(dust, -Math.PI + 1e-6, latitude);
      const right = sampleDust(dust, Math.PI - 1e-6, latitude);
      expect(Math.abs(left - right)).toBeLessThan(1e-3);
    }
    // and off the top and bottom there is nothing to read
    expect(sampleDust(dust, 0, DUST.latitudeSpan)).toBe(0);
    expect(sampleDust(dust, 0, -DUST.latitudeSpan)).toBe(0);
  });
});

describe('photographicMatter', () => {
  it('is a band with a bright core, not a uniform ribbon', () => {
    const at = (longitude: number, latitude: number) => {
      const m = photographicMatter(longitude, latitude, dust);
      return { ...m, luminance: m.color[0] * 0.2126 + m.color[1] * 0.7152 + m.color[2] * 0.0722 };
    };
    const core = at(CORE_LONGITUDE, 0);
    const opposite = at(CORE_LONGITUDE - Math.PI, 0);
    const above = at(CORE_LONGITUDE, 0.3);
    // The core is the brightest thing in the field by a long way, the far side
    // of the galaxy is a faint band, and 0.3 radians off the plane is neither.
    expect(core.luminance).toBeGreaterThan(opposite.luminance * 3);
    expect(opposite.luminance).toBeGreaterThan(above.luminance);
    expect(core.core).toBeGreaterThan(0.9);
    expect(opposite.core).toBeLessThan(0.01);
    // The disc's ribbon follows the plane and is gone well off it. Its middle
    // is not latitude zero: the band has a slow wave in it (`curve`) and sits a
    // little above the plane, which is why this sweeps for the peak instead of
    // reading the one latitude a flat band would have had.
    let ridge = 0;
    for (let i = -40; i <= 40; i++) ridge = Math.max(ridge, at(0.4, i * 0.002).body);
    expect(ridge).toBeGreaterThan(0.95);
    expect(at(0.4, 0.25).body).toBeLessThan(0.01);
  });

  it('never lets more light through than there was, and never less than none', () => {
    for (let i = 0; i < 400; i++) {
      const longitude = (i / 400) * Math.PI * 2 - Math.PI;
      for (const latitude of [-0.3, -0.1, 0, 0.1, 0.3]) {
        const m = photographicMatter(longitude, latitude, dust);
        expect(m.transmission).toBeGreaterThan(0);
        expect(m.transmission).toBeLessThanOrEqual(1);
        for (const c of m.color) expect(Number.isFinite(c)).toBe(true);
      }
    }
  });

  it('is dark where the dust is thick, which is what makes the rift a rift', () => {
    // Find the thickest lane in the field and read the light through it
    // against the light a quarter turn away at the same latitude.
    let best = 0,
      bestX = 0,
      bestY = 0;
    for (let x = 0; x < dust.width; x += 7)
      for (let y = 0; y < dust.height; y += 3) {
        const v = dust.data[y * dust.width + x]!;
        if (v > best) {
          best = v;
          bestX = x;
          bestY = y;
        }
      }
    const longitude = (bestX / dust.width - 0.5) * Math.PI * 2,
      latitude = (bestY / dust.height - 0.5) * DUST.latitudeSpan;
    const lane = photographicMatter(longitude, latitude, dust);
    const clear = photographicMatter(longitude + Math.PI / 2, latitude, dust);
    expect(lane.transmission).toBeLessThan(clear.transmission);
    expect(lane.transmission).toBeLessThan(0.02);
  });
});

describe('brightestMatter', () => {
  it('finds the core where the core is, and finds it the same way twice', () => {
    const core = brightestMatter(dust);
    // Within a tenth of a radian of where the field's bulge is written, and
    // near the plane: the answer is the middle of the core, not a speckle of
    // texture somewhere in the band.
    expect(Math.abs(core.longitude - CORE_LONGITUDE)).toBeLessThan(0.1);
    expect(Math.abs(core.latitude)).toBeLessThan(0.1);
    expect(core.peak).toBeGreaterThan(0.5);
    const again = brightestMatter(dust);
    expect(again.longitude).toBe(core.longitude);
  });

  it('is where GALAXY_HEADING points, because there is only one of them', () => {
    // The flight turns toward the core once a night, off a constant in
    // `SkyPulls`. That constant used to be a guess from the original's written
    // core longitude and was three degrees out. It is the bake's own answer
    // now, and this is what keeps it that way: change the galaxy and the
    // heading fails here rather than the flight quietly turning toward where
    // the core used to be.
    const core = brightestMatter(dust);
    const dir = galacticDirection(core.longitude, core.latitude, new Vector3());
    expect(Math.atan2(dir.x, dir.z)).toBeCloseTo(GALAXY_HEADING, 3);
    // and it is a real bearing rather than the default anything would give
    expect(GALAXY_HEADING).toBeGreaterThan(-Math.PI);
    expect(GALAXY_HEADING).toBeLessThan(Math.PI);
  });

  it('points somewhere the flight can actually look: above the horizon, off the pole', () => {
    const core = brightestMatter(dust);
    const dir = galacticDirection(core.longitude, core.latitude, new Vector3());
    expect(dir.length()).toBeCloseTo(1, 6);
    // Nine degrees up: a core under the ground is a pull toward nothing, and
    // one overhead is a heading with no meaning.
    expect(dir.y).toBeGreaterThan(0.05);
    expect(dir.y).toBeLessThan(0.7);
  });
});
