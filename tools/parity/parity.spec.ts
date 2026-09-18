// The same five vantages as the bench, photographed and compared against the
// pictures taken last time on this machine.
//
//     npm run parity:write     # take the references, on the build you trust
//     npm run parity           # compare this build against them
//
// What it is for is the sentence in the design that says a three.js upgrade is
// its own PR with a parity difference: the numbers say what a frame costs and
// these say what it looks like, and an upgrade that changes neither is an
// upgrade nobody has to argue about.
//
// The references are gitignored on purpose -- the reason is in
// `parity.config.ts`, and the short version is that a reference PNG is a
// photograph of one rasteriser.
import { expect, test } from '@playwright/test';
import { VANTAGES, beginPaused, settle } from '../vantages';

const SEED = Number(process.env.PARITY_SEED ?? 42);

test.describe('parity', () => {
  test('five vantages look the way they looked', async ({ page }) => {
    test.slow();
    const query = `seed=${SEED}${process.env.PARITY_WEBGL === '1' ? '&webgl=1' : ''}`;
    const errors = await beginPaused(page, query);
    const canvas = page.locator('#c');
    for (const vantage of VANTAGES) {
      await settle(page, vantage);
      // The whole picture, through the display chain, as the page presents it:
      // a capture would skip the chain, and the chain is where the tone mapping
      // and the exposure are.
      await expect(canvas).toHaveScreenshot(`${SEED}-${vantage.name}.png`, {
        // A rasteriser is bit-identical to itself, so this is not a tolerance
        // for noise -- it is the width of "nothing anybody would notice", and
        // a real change sails past it.
        maxDiffPixelRatio: 0.002,
        threshold: 0.02,
        animations: 'disabled',
      });
    }
    expect(errors).toEqual([]);
  });
});
