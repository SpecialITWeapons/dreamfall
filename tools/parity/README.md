# parity

The same five vantages as the bench, photographed and compared against the
pictures taken last time.

    npm run parity:write     # take the references, on the build you trust
    npm run parity           # compare this build against them

What it is for is the line in the design that says a three.js upgrade is its
own PR with a parity difference: the bench says what a frame costs, this says
what it looks like, and a change that moves neither is a change nobody has to
argue about. It is also the fastest way to find out what a refactor of the sky
or the ground actually did.

Playwright does the comparing, so a failure leaves `expected`, `actual` and
`diff` PNGs under `test-results/` and `npx playwright show-report` puts the
three side by side.

Knobs: `PARITY_SEED` (42), `PARITY_WEBGL=1`, `PARITY_CHROME` (a browser binary
to use instead of Playwright's own).

## Why the references are not committed

A reference PNG is a photograph of one rasteriser. Committing them would mean
either pinning the repository to whatever SwiftShader `ubuntu-latest` shipped
that month -- and the morning the image changes, every reference is stale at
once and nobody can tell a regression from a driver update -- or pinning it to
one contributor's GPU, which is worse. Locally the same rasteriser is
bit-identical to itself (measured: two captures of one frame differ by 0),
which is all a before-and-after needs.

So: take the references on the commit you are comparing against, then run the
comparison on the one you are asking about. They live in
`tools/parity/references/` and are gitignored.
