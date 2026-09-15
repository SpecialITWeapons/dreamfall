# Contributing

## Commands

    npm run dev            development server
    npm run check          types, lint, format, unit tests, build
    npm run test:watch     unit tests in watch mode
    npm run test:e2e       build and browser tests (Playwright, Chromium)
    npm run build          dist/ for publishing
    npm run preview        preview dist/ at http://localhost:4173

First run of the browser tests: `npx playwright install chromium`.

## Library contract

Everything the world is made of that is not the engine lives in `library/`:
biomes now, species, props and structures as they arrive. An entry is a plain
object from one of the `define*` helpers in `library/contract.ts`, and it takes
one line in `library/index.js` to be part of the world.

A biome says three things at least. **Presence** is where it is, as a number
from zero to one: name a standard hook (`climatePoint` for a place in climate
space, `heightBand` for a band of altitude, `mul` and `max` to combine them) or
write a function of the fields. **Ground** is what it looks like: a stack of
`layers`, each colour coming in by its own mask (`slope`, `height`, `noise`), or
a function that builds nodes. **Params** are its numbers and colours, as JSON,
for the hooks and for the editor that will come later.

A biome may also give a **height** hook, which moves the ground under it by at
most 300 m and always reads the base height, so no two biomes can argue about
what the ground was.

The engine normalises presence across the whole registry, keeps the three
strongest biomes at any point and hands them to the ground material as weights.
So two hooks never have to agree on a scale -- only to be monotonic in how much
of a place is theirs.

Colours are swatch names from the book in `contract.ts`, or `#rrggbb` inside the
envelope: saturation at most 0.62 and lightness between 0.18 and 0.93, measured
in sRGB. `validateLibrary` checks the shape of every entry, the ids, the
duplicates, the hooks, the budgets and the colours when the page loads, names
whatever is wrong by entry, and stops the page rather than painting something
that is not the world.

## Publishing

`.github/workflows/pages.yml` builds and publishes `dist/` to GitHub Pages on
every push to `main`. One-time setup: Settings > Pages > Source: GitHub Actions.
