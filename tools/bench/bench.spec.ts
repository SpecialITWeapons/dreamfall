// What a frame costs, at five vantages of one seed's world.
//
// The method is fly-with-me's and the spec's (§13): hold the flyer still at
// fixed vantages, read the **median** of a window of frames (the fifth
// percentile beside it, see `p5`), and take the **minimum across rounds**. Both of those are there to throw away the
// machine rather than the engine -- a frame that took longer than its
// neighbours took longer because something else on the box wanted the CPU, and
// averaging that in measures the box. The fastest frames are the ones the
// engine is actually responsible for.
//
// It runs by hand (`npm run bench`), never in CI: a shared runner measures its
// own weather. Two builds are compared by interleaving rounds, which this does
// not do for you -- run it on each branch and compare the JSON, and read the
// two runs as one only if nothing else changed on the machine between them.
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VANTAGES, beginPaused, settle } from '../vantages';

// Two rounds of twenty-four frames, because a frame here is a frame: on a
// software rasteriser it is the better part of a second, and the first attempt
// at a default -- three rounds of sixty -- was twenty minutes of honest
// rasterising. On a machine with a GPU, raise them.
const ROUNDS = Number(process.env.BENCH_ROUNDS ?? 2);
const FRAMES = Number(process.env.BENCH_FRAMES ?? 24);
const SEED = Number(process.env.BENCH_SEED ?? 42);

const at = (ms: number[], share: number) => {
  const sorted = [...ms].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * share)))]!;
};
/**
 * The fifth percentile: the fast end of a window of frames, and the spec's own
 * statistic. It is the right one on a GPU, where frames are alike and the slow
 * ones are the machine's fault. It is the wrong one here, and the bench said so
 * itself: on a rasteriser with no GPU the intervals come out bimodal --
 * measured at one vantage, `[3399, 3360, 6797, 11, 3454, 3352, 3367, 3425]` --
 * because now and then the loop reports two frames inside one sampling window
 * and the pair divides into something that never happened. The fifth percentile
 * picks exactly those, which is how a vantage came to read 7.3 ms where every
 * frame of it took three and a third seconds. The median is the headline; the
 * fast end is kept beside it, because on a real GPU it is the interesting one.
 */
const p5 = (ms: number[]) => at(ms, 0.05);
const median = (ms: number[]) => at(ms, 0.5);

const round2 = (v: number) => Math.round(v * 100) / 100;

interface Reading {
  name: string;
  /** Median interval between two frames the page drew: what a frame costs here. */
  frameMs: number;
  /** The fast end of the same window (see `p5`). */
  bestMs: number;
  /** Frames a second across the whole window, drawn frames over wall time. */
  fps: number;
  gpuMs: number;
  draws: number;
  triangles: number;
  trees: number;
  buildings: number;
  grass: number;
}

test('what a frame costs at five vantages', async ({ page }) => {
  const query = `seed=${SEED}&profile=1${process.env.BENCH_WEBGL === '1' ? '&webgl=1' : ''}`;
  const errors = await beginPaused(page, query);
  const backend = await page.evaluate(() => window.__world!.backend);

  const best = new Map<string, Reading>();
  for (let round = 0; round < ROUNDS; round++) {
    for (const vantage of VANTAGES) {
      await settle(page, vantage);
      // What the frame drew, read once: the renderer's counters are reset by
      // the scene pass and the display chain's quads keep adding to them, so
      // over sixty frames the draw count creeps by a hundred and eighty that
      // nobody drew.
      const drawn = await page.evaluate(() => {
        const w = window.__world!;
        w.frame(1 / 60);
        const frame = w.memory();
        return {
          draws: frame.draws,
          triangles: frame.triangles,
          trees: w.scenery?.trees ?? 0,
          buildings: w.scenery?.buildings ?? 0,
          grass: w.scenery?.grass ?? 0,
        };
      });
      // And the frames themselves, driven by the page's own loop.
      //
      // Not by hand: three advances the node graph's frame id inside the
      // renderer's animation tick alone, and the display chain's scene pass is
      // a node that updates once per id -- so a hundred hand-driven renders are
      // one scene and ninety-nine redraws of the chain over it, and they time
      // at 0.2 ms because that is what they are. A frame is what the loop does
      // between two animation frames, and this counts them.
      //
      // And held: the loop draws, the simulation does not step. Unheld, the
      // autopilot flew two metres a frame through the window -- forty-eight
      // over the twenty-four -- which is a ring cell's worth of rebuild landing
      // in the sample at some vantages and not at others.
      await page.evaluate(() => {
        window.__world!.hold = true;
        window.__world!.setPaused(false);
      });
      const sample = await page.evaluate(async (frames) => {
        const w = window.__world!;
        const cpu: number[] = [];
        const gpu: number[] = [];
        let wall = 0,
          drawn = 0;
        await new Promise<void>((resolve) => {
          let seen = w.frames;
          let last = performance.now();
          const tick = () => {
            const now = performance.now();
            const drew = w.frames - seen;
            if (drew > 0) {
              // an interval that held two frames is two frames' worth of wall
              // time, whatever the per-frame figure divides it into
              wall += now - last;
              drawn += drew;
              cpu.push((now - last) / drew);
              gpu.push(w.gpuMs);
              seen = w.frames;
              last = now;
            }
            if (cpu.length >= frames) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        return { cpu, gpu, wall, drawn };
      }, FRAMES);
      await page.evaluate(() => {
        window.__world!.setPaused(true);
        window.__world!.hold = false;
      });
      const reading: Reading = {
        name: vantage.name,
        frameMs: median(sample.cpu),
        bestMs: p5(sample.cpu),
        fps: sample.wall > 0 ? (sample.drawn * 1000) / sample.wall : 0,
        gpuMs: median(sample.gpu),
        draws: drawn.draws,
        triangles: drawn.triangles,
        trees: drawn.trees,
        buildings: drawn.buildings,
        grass: drawn.grass,
      };
      const held = best.get(vantage.name);
      // The minimum across rounds, vantage by vantage: a slower round is the
      // machine's, and the counters travel with the round that was fastest.
      if (!held || reading.frameMs < held.frameMs) best.set(vantage.name, reading);
    }
  }

  const readings = VANTAGES.map((v) => best.get(v.name)!);
  const table = readings.map((r) => ({
    vantage: r.name,
    'frame ms': round2(r.frameMs),
    fps: round2(r.fps),
    'best ms': round2(r.bestMs),
    // WebGL2 has no timestamps worth the name, so the column says so rather
    // than printing the same stale number five times.
    'gpu ms': r.gpuMs > 0 ? round2(r.gpuMs) : '--',
    draws: r.draws,
    triangles: r.triangles,
    trees: r.trees,
    buildings: r.buildings,
    grass: r.grass,
  }));
  console.log(
    `\nseed ${SEED} · ${backend} · ${ROUNDS} rounds of ${FRAMES} frames · the fastest round of each`,
  );
  console.table(table);
  const out = {
    seed: SEED,
    backend,
    rounds: ROUNDS,
    frames: FRAMES,
    when: new Date().toISOString(),
    readings,
  };
  const here = dirname(fileURLToPath(import.meta.url));
  writeFileSync(resolve(here, 'last.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`written to tools/bench/last.json`);

  // A bench is not a test, but a bench that measured a broken page is worse
  // than no bench: every vantage has to have drawn something, and the console
  // has to be empty.
  for (const reading of readings) {
    expect(reading.draws, `${reading.name} drew nothing`).toBeGreaterThan(0);
    expect(reading.triangles, `${reading.name} drew no triangles`).toBeGreaterThan(0);
    expect(reading.frameMs, `${reading.name} took no time`).toBeGreaterThan(0);
  }
  expect(errors).toEqual([]);
});
