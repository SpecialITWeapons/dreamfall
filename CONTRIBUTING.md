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
biomes, species, props, structures, and the settlements that decide where a
building stands. An entry is a plain object from one of the `define*` helpers in
`library/contract.ts`, and it takes one line in `library/index.js` to be part of
the world.

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
road. The road kit came with the settlements; the ribbon that is not a road is
`kit.line` on a site plan, which is in the contract and throws until M4b.

## Adding a structure

A structure is a building: a file under `library/structures/`, one line in
`library/index.js`, and a settlement that names it. It is data for the built-in
kit -- a **footprint** (the plan at ground level, in metres), a range of
**floors**, a **roof** (`gable`, `hip` or `flat`, with a `roofPitch` and an
optional `chimney`) and a **palette** of swatches for the wall, the roof, the
trim and the window. `library/structures/cottage.js` is a whole house in a dozen
numbers; `barn.js` and `mill.js` differ from it by those numbers alone.

The window colour is the one that does more than paint. The kit **cuts** a band
of windows into each storey's walls -- a box has no vertices where its windows go
-- paints the pieces that land inside the band and gives them a `glow` attribute
of 1. After dark the material multiplies that by the instance's own `lit` and by
the sky's night, so some houses are awake and others are not, without a second
geometry, a second material or a texture. A recipe that names no window colour
has no windows and never lights up: that is what makes `barn.js` a barn.

A shape that is none of these writes its own `bake(kit)`, as `cypress.js` does
among the species, and grows itself through the kit's verbs -- `box`, `roof`,
`windows`, `merge`, `matrix` -- reading `spec` and `floors` off the kit, the two
things that differ between two bakes of the same entry. There is one bake per
kind and per floor count, because whole buildings are instanced.

Budgets bite at bake time and stop the page: 6000 triangles a building, the
colour envelope on every vertex, and `BUDGET.floorSpan` storey counts -- every
count in a recipe's `floors` range is baked and pooled separately, because a
building is instanced whole and a plan is free to ask for any of them. What the flight has to clear is measured off the
baked shape, never off the entry; an entry's own `obstacle` may ask for more room
around it, never for less.

## Adding a settlement

A settlement is a biome with a `sites` block: the places someone built, and what
stands in one. It is the entry written as code over the standard hooks rather
than as data.

There are two of them and they share everything except their numbers and their
plan. `settlement.js` is the one biome entry both go through; it takes the
parameters and the plan and nothing else, so the parameters carry the id, the
name, the landmark and the ground paint. `village.js` and `plan.js` are a
village of thirty to a hundred and fifty houses along one street that follows a
contour; `town.js` and `plan-town.js` are five hundred to two thousand on a
jittered grid inside a ring road, with a plaza and a landmark in the middle.
A third kind is two files and one line in `index.js`.

The town is not the village with bigger numbers, and the reason is worth
knowing before you try: the village's layout is one street with paths off it,
which fills a ribbon. Stretched to a 900 m radius it lays 147 lots, measured.
A town fills a disc, and only a grid does that.

The `sites` block is five things. **`cell`** and **`salt`** name the lattice the
settlements sit on, one per cell at most; **`radius`** is `[min, max]` metres of
settlement, capped at 900; **`fits(fields)`** is the settlement's own last word;
**`build(site, kit)`** lays it out. Name the buildings you use in
**`structures`** as well, as weights by id: nothing but the validator reads
them, and what it does with them is refuse a building nobody baked -- the rule
that catches a typo in a biome's species.

What it is **not** is a lottery. There is no `odds` here and no land line: the
biome's presence hook decides whether a cell carries a settlement at all, and
`Sites` seats the settlement by calling that hook at the lattice centre. So
presence, the plateau and the site finder read one lattice by construction --
give `presence`, `height` and `sites` the same `cell` and the same `salt` and
they cannot drift. They used to draw separately, and separately they agreed
about half the time; the other half was a village on the slope beside its own
flat square, or a flat square with no village.

`fits` is asked at that same centre and can only refuse what the hook allowed,
so keep it saying what the hook says: `settlement.js` hands both the same three
numbers (`land`, `minTemp`, `maxSlope`) and a `fits` narrower than its hook
would leave ground painted for a village that never comes.

Two of those numbers pull in different directions and it is worth knowing which
is which. **`maxSlope`** refuses a cell whose own centre stands on a hillside,
measured across 125 m. **`maxCut`** is how far the ground may depart from the
centre's height before the settlement fades, in metres, and it is the one that
shapes a wide settlement: over 900 m that departure is the terrain's relief and
barely depends on the slope in the middle of it, so a town written with a strict
`maxSlope` and no `maxCut` cuts exactly the same table out of the hill and is
merely rarer. A village leaves `maxCut` unsaid and lets the slope stand for
both, which at 250 m is fair enough.

A settlement should also **sow the ground it claims** -- give it a `populate`
like any other biome. Its own weight is what crowds the country's trees and
grass out of the ground it stands on, so one without a `populate` is a disc of
bare paint as wide as its presence, with the houses in the middle of it. It
needs no thinning toward the centre: the lots' reservations already refuse a
tree where the houses are.

`build` produces data and never geometry: `kit.road(points, width)` for a street,
`kit.line(points, kind)` for a fence, a wall or a hedge, `kit.structure(id, x, z,
{ yaw, floors })` for a plot, `kit.reserve(x, z, radius)` for ground nothing else
may use. It may not plant: `kit.tree` inside a plan throws, because a settlement
plants through its biome's `populate` and its cells. A hedge is how a plan says
trees were planted here -- a line claims no ground, so the scatter fills the plot
and the square of trees reads as an orchard. It reads the ground through
`kit.height` and
`kit.slope` rather than off a window of terrain, and draws every random it needs
from `site.random()` in a fixed order -- change the order and the same cell grows
a different village. That is what keeps a plan a pure function of its site:
`tests/unit/settlementPlan.test.ts` lays out a whole village in Node with a stub
for the ground. Afterwards the pools raise the lots into instances and obstacle
records, and the road kit turns a polyline into a ribbon that hugs the ground; a
plan that made a geometry itself could be neither tested nor, one day, edited.

Two rules for a plan that lays more than a hundred lots, both learned the
expensive way. Ask for a floor count the recipe has **no bake at** and it throws
inside the site queue, so clamp what you ask into the range the recipe declares
-- `town.js` writes that range down in `storeys` because a pure function cannot
ask the kit. And decide how many buildings you have as a **share of what the
streets offered**, never by stopping at a cap: the streets are walked in the
order they were laid, so a cap builds a town with one side missing.

That is the split, and it is the same one the biomes and the props keep: **the
settlement says what stands where, the structure says what it looks like.** A
plan names an id, a spot, a heading and a floor count, and never how tall a
storey is or what colour the roof is; a recipe never knows there is a village.

## Publishing

`.github/workflows/pages.yml` builds and publishes `dist/` to GitHub Pages on
every push to `main`. One-time setup: Settings > Pages > Source: GitHub Actions.
