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

## Adding a species

A species is a tree: a file under `library/species/`, one line in
`library/index.js`, and a biome that names it. Eight of the nine are data for
the built-in kit -- a **trunk** (height, radius, lean, bark tint), its **limbs**
(how many, how far out, how high up the trunk they start) and a **crown** of one
of four shapes: `dome` hangs a cloud of cards on every limb, `cone` runs them up
the trunk, `fan` opens a ring of fronds at the top, `bare` hangs none at all.
`leaf` names one of the painted palettes in `contract.ts`, `tint` gives the
three climate tints the engine lerps between by temperature and moisture, and
`scale` is the range of sizes, capped at three.

The ninth, `cypress.js`, writes its own `bake(kit)` and grows itself through the
same two verbs the kit uses -- lay wood, hang a card -- and gets the crown
morph, the shrink at the edge of the ring, the shadow and the tint for free.
Reach for it when the shape is not one of the four, not when the numbers are
not to your taste.

Budgets bite at bake time and stop the page: a crown of more than 200 cards is
refused by name. The cap is on the cards a tree hangs in total, which for a
`dome` is `limbs.count x crown.cards` -- the elder oak is eight cards short of
it, so read that product before raising either number.

## Adding a prop

A prop is anything else that stands: a boulder, a cairn, a bush, a fence post.
A file under `library/props/`, one line in `library/index.js`, and two hooks.
**`bake(kit)`** builds one geometry once, out of parts merged with vertex
colours; it is measured against 6000 triangles and the colour envelope.
**`place(cell, kit)`** is asked once per 96 m cell of the streamed ring and
answers with where instances stand: it reads the ground (`height`, `slope`,
`land`), its own random stream (`roll`), how much this cell wants it
(`mix('boulders')`, folded from the weights the biomes gave it) and the biomes'
own colours (`blend('rock')`). Give it an `obstacle` and the flight and the
camera will keep clear of it.

That is the split, and it is deliberate: **the biome says how much grows, the
prop says how it stands.** A biome's `populate` names prop weights and never
places a prop itself; a prop's `place` never decides how welcome it is.

Grass is data on the same `populate` descriptor (`grass: { tint, density }`),
folded by weight across the biomes under the window. A biome whose `populate` is
a function written in code has neither prop weights nor grass -- both are read
from the descriptor, not called.

Objects that run in a line -- fences across a field, walls, hedges -- are not
props scattered thinly. They are ribbons along a polyline, the same shape as a
road, and they arrive with the road kit in M4.

## Publishing

`.github/workflows/pages.yml` builds and publishes `dist/` to GitHub Pages on
every push to `main`. One-time setup: Settings > Pages > Source: GitHub Actions.
