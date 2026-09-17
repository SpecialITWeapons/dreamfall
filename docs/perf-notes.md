# What a frame costs

Measurements live here, one section per change that touched the cost.
Method (from fly-with-me): hold the flyer at fixed vantages of one seed's
world, read the fifth percentile of a window of frames, take the minimum
across repeated rounds, interleave builds round by round. The tools that do
this arrive in M5 (`tools/bench.ts`, `tools/parity.ts`).

## M1 baseline

Not yet measured. When M5 lands the bench, record here: GPU ms per vantage
(dawn, noon, far, above the deck, night), draw calls, triangles, graphics
memory, at 1 564 805 and 2 000 000 pixels.

## M3a: the library on the CPU

A full window fill (313 600 texels, `fillAll`), Node 22 in the development
container, mean of three: **528 ms with no library, 530 ms with the ten
biomes**. Ten presence hooks per texel are lost in the cost of the base fields,
which is where a fill actually goes. The GPU side is not measured yet; the
branch floor of 0.01 keeps at most three of ten ground hooks running in any
fragment, and the bench that would measure it arrives in M5.

## M3a: what a capture costs, and why CI was timing out

Measured in the development container (SwiftShader, loop paused, capture 96x54):

|                   | first capture | the ones after   |
| ----------------- | ------------- | ---------------- |
| ten biomes        | 4905 ms       | 235, 187, 187 ms |
| no library at all | 4120 ms       | 201, 117, 117 ms |

So the ground's ten branches are about **790 ms of the first compile**, a fifth
of it. The other four seconds are the rest of the scene -- sky, clouds, water,
the figure -- compiling a second time, because `capture` renders straight to its
own float target and that is a different pipeline configuration from the display
chain's.

Two things were making it much worse, both fixed:

- `capture` flipped `renderer.toneMapping` to `NoToneMapping` and back. A node
  material's program is keyed on that, so every capture recompiled every
  material twice. The renderer's tone mapping is now off for good and the
  display chain asks `renderOutput` for ACES by name. First capture: 11.1 s to
  5.2 s.
- `capture` built and disposed a render target per call. They are cached per
  size now.

With the loop running, each capture still pays a recompile, because the loop's
own frames alternate the two configurations: 45 s a capture here. Paused, the
second and later captures are 187 ms. Browser tests that capture pause first.

## M3a on a real GPU

The first numbers from hardware rather than from SwiftShader: the owner's
machine, WebGPU backend, ten biomes, `?profile=1`.

Start, ms from the module's first line:

| step                             | here (software) | on the GPU |
| -------------------------------- | --------------- | ---------- |
| `graphics` (renderer)            | 135             | 43         |
| `ground` (window, materials)     | 839             | 370        |
| `sky` (first frame, its shaders) | 5228            | 2146       |

So the shader compile is 1.8 s of a 2.1 s start on real hardware -- two and a
half times faster than software rendering, not the order of magnitude that was
predicted here. It stays five sixths of the start, and it stays behind the veil.

Frame cost, `__world.gpuMs` sampled ten times a second for ten seconds in
flight:

| min     | median      | max  |
| ------- | ----------- | ---- |
| 1.25 ms | **3.15 ms** | 8 ms |

A sixtieth of a second is 16.7 ms, so the whole scene -- ground with ten biome
branches, sky, clouds, water, the figure, the display chain -- costs about a
fifth of a 60 Hz frame, and fits inside 144 Hz with room to spare.

**What this settles:** the ten branches are not worth redesigning. The standing
fallback -- compiling every standard `layers` ground into one painter reading
its colours from a uniform array, so the shader stops growing with the registry
-- saves compile time, not frame time, and compile time is a one-off 1.8 s
behind a veil. Revisit it when the registry is two or three times longer, or if
a frame ever stops fitting; the number to watch is `__world.gpuMs`, not the
start.

## M3b: what the scenery costs

Measured in the development container, which is slower than the one M3a was
measured on: a full window fill is **754 ms** here against the 528 ms recorded
above, so read these as an upper bound and compare them with each other rather
than with the M3a section.

A ring rebuild (Node 22, 96 m cells out to 1.9 km, the real ten-biome library,
eleven rebuilds a few cells apart, seed 42):

| place                    | cells | trees | props | min    | median     | max     |
| ------------------------ | ----- | ----- | ----- | ------ | ---------- | ------- |
| woods (-48 000, -42 000) | 424   | 761   | 123   | 3.6 ms | **4.7 ms** | 15.5 ms |
| origin (0, 0)            | 674   | 1338  | 164   | 4.7 ms | **7.5 ms** | 10.7 ms |

The budget the plan set was 6 ms and the median sits on either side of it. A
rebuild happens every 96 m, which is one every 2.4 s at cruise, so the median is
a 10 ms frame twice a minute and the tail is a dropped one. That is worth
watching and not worth fixing yet: the escape hatch, cutting the rebuild into
rows across frames, is written down in the plan and stays unbuilt. Note that
only about half the ring is ever visited -- a cell whose centre is below 3 m
never asks a hook anything -- and that the lazy `Fields` in the cell is what
keeps a sea cell free.

Start, same container, `?profile=1`, ms from the module's first line:

| step                               | M3a  | M3b  |
| ---------------------------------- | ---- | ---- |
| `graphics` (renderer)              | 135  | 211  |
| `ground` (window, materials)       | 839  | 758  |
| `scenery` (species, props, canvas) | --   | 3015 |
| `sky` (first frame, its shaders)   | 5228 | 8879 |

Baking the nine species, the two props and the four painted canvases is
**2202 ms** of that, which is why it has a veil stage of its own rather than
hiding inside the ground's. The first frame grew by about 0.6 s: roughly twenty
new node materials, each compiled once. The escape hatch for that one -- a
single leaf atlas and one crown material for the whole world instead of nine --
also stays unbuilt, because 0.6 s of software rasteriser is perhaps 0.2 s of
real GPU and the bake dwarfs it.

In flight, over the woods of seed 42: 619 trees, 277 props and 5292 blades of
grass standing at once, 51 geometries and 28 textures on the renderer, 98.8 MB
of graphics memory. The pools are allocated for the ceiling rather than for what
stands: nine species times three meshes times 4000 instances is about 10 MB of
instance data on each side of the bus, whether the ring is over a forest or over
the sea. That is the price of the port's fixed allocation, and the knob if it
ever matters is the per-species capacity, not the ceiling.

The grass window takes **6.9 ms** to write, against a budget of 4 ms. The work
per rebuild is what it is -- 121 tiles of 256 attempts, each with a height and a
slope -- so what changed is how often it is paid: the window now rebuilds every
32 m rather than on the terrain's own 16 m cell, which halves it to a hitch
about once a second on a low pass. It reaches 260 m and fades its last blade
out by 190, so half a cell of lag is not visible. Writing only the tiles that
entered the window would be the real fix and is a redesign of the port.

The bundle grew from 938 kB to 1158 kB (267 kB to 332 kB gzipped).

## M4a: settlements

Measured in Node against seed 42's nearest village, `village:0,0` at
(1525, 1588), ground at 146 m: 47 lots (25 one-storey cottages, 13 two-storey,
four barns of each height and one three-storey mill), 7 roads, 47 reservations,
the furthest lot 216 m from the centre.

| what                                      | ms   |
| ----------------------------------------- | ---- |
| building one village plan                 | 0.78 |
| the road ribbons of one village, 532 tris | 2.97 |
| ring rebuild, 890 cells, no village       | 7.8  |
| ring rebuild, same cells, village raised  | 6.4  |

The plan is the cheap part: at 0.78 ms a frame's 4 ms budget builds five
villages, and the queue exists for the frame that meets a fresh lattice cell
rather than for any sustained cost. The two ring numbers straddle each other,
which is the honest reading -- 47 buildings and a plan lookup are lost inside
the noise of 890 cells of scatter. Raising a plan is a lookup, a distance test
per site and a matrix per lot; it is not where the time goes and there is
nothing here to make faster.

The road ribbon is the one number worth watching, because it is paid on the
rebuild that first covers a plan rather than spread over frames like the plan
queue: 3 ms in one frame, on top of that frame's 7 ms rebuild. It is bounded --
one ribbon per site, built once, kept until the ring leaves the plan behind --
and a village is at most SITE_RADIUS across, so a rebuild can meet at most a
handful. If it ever bites, the ribbon belongs in the plan queue beside the plan
it is built from, not in the rebuild.

In the browser, on the software rasteriser, the same work reads smaller:
`sitesMs` peaks at **0.2 ms** on the frame that plans a fresh village, against
the 4 ms budget. The browser test asserts 8 and has never been near it.

What the settlements did not cost: nothing was added to the bake. Three
buildings at two storey counts each is six more baked geometries inside the
`scenery` stage that already bakes nine species, and it did not move the stage
out of its own noise.

## The ring reaches further, and the grass is tufts

Two visual complaints from the owner, both measured before anything moved.

**Trees did not appear at the edge of the ring -- they grew out of it.**
`ringScale` scaled every vertex about the tree's own base over 1680..1850 m, so
a tree at the edge was a point in the ground and reached full height 170 m
later: two and a half to four seconds of visible sprouting at this world's
speeds. It was not hidden by distance either -- at 1850 m the fog covers 24 %
of what stands there, and less than that from altitude.

They now stand at full height and fade through opacity, and the ring reaches
2600 m instead of 1900 so the fade lands where less is worth watching. What
the radius costs, measured over the densest ring found in fourteen places of
seed 42:

|                           | 1900 m | 2600 m           |
| ------------------------- | ------ | ---------------- |
| trees in the ring         | 2190   | 3193 (peak 3335) |
| cells swept               | 1108   | 1729             |
| rebuild, median of twelve | 7.9 ms | 9.0 ms           |

One millisecond on the worst ground in the world, for 900 more trees. The fade
itself costs nothing at all: the same instances, one more multiply in three
materials. Nothing was allocated -- 3335 is still well under the pools' 4000 a
species, and the ring's own ceiling was split off at 6000 so that a denser
world than this one truncates nothing.

**Grass read as lines because a blade was one card 2.6 m wide and 1 m tall**,
turned about the vertical: from above, a streak. A tuft is now three painted
cards crossed about its axis, in four baked forms:

|                               | one card     | tuft of three |
| ----------------------------- | ------------ | ------------- |
| triangles an instance         | 2            | 6             |
| triangles, full window        | 40,000       | 120,000       |
| triangles, a real flight      | 10,584       | 31,752        |
| painted blade tips            | 0.50..1.24 m | 0.78..1.79 m  |
| alpha-tested area an instance | 2.485 m²     | 2.982 m²      |
| draw calls                    | 1            | 4             |

Tripling the triangles costs **20 %** more alpha-tested area, because three
narrow cards paint less than one wide one -- and that 20 % is the extra height,
not the crossing. Against the terrain's 557,568 triangles in the same frame,
grass at a real flight is 5.7 %. The extra roll per attempt adds 0.03 ms to a
6.9 ms window write.

Left alone, and worth knowing: only 52 of the window's 121 tiles fall inside
`REACH`, so a rebuild can never write more than **13,312** of the 20,000
instances the meshes hold. A third of that allocation is unreachable and has
been since the port. `SPAN` is the knob, and it changes how much grass there is
rather than only what it costs, so it is not a free win.

## A second lattice used to cost a second window

M4b adds the town, and with it the registry's second lattice: a village on
six kilometres and a town on twenty. Measured on a full 560x560 fill of seed
42, before anything was changed for it:

|                                  | fill        |
| -------------------------------- | ----------- |
| eleven biomes, one lattice       | 783 ms      |
| twelve biomes, no second lattice | 792 ms      |
| twelve biomes, **two lattices**  | **1810 ms** |

The twelfth biome is free; the second _lattice_ is not, and it is not the
hooks -- it is one line of cache. `Fields.lattice` remembered the centre's
base height in a single slot, which is right for one lattice, where the
window is filled row by row and a cell is kilometres wide, so one answer
covers almost every texel. With two lattices the same texel asks for two
different centres and they evict each other, so **every texel pays two extra
`baseFields`** and the whole saving is handed back. The comment above the
cache predicted exactly this and nobody read it as a warning.

Four slots, scanned rather than hashed because there are four: **828 ms**.
The second lattice now costs 62 ms of a fill rather than a full second. In
flight this is the difference between a worst frame of 3.7 ms and one of 8.2,
with the plan queue's 4 ms budget landing in the same frame.

It scales to a third and fourth lattice and then falls off the same cliff;
the slot count is the knob, and it is only worth turning when a fifth
settlement kind exists to turn it for.

## The slope rule that had never fired

A settlement is seated at its lattice centre, and the `lattice` hook measured
its slope as a rise from that centre outward -- which at the centre is zero, so
the term was always exactly one. `maxSlope` faded the edges of a settlement and
had never once refused to seat one, while the design had asked for a slope limit
at the centre since it was written.

Measured over 473 seated villages of seed 42, by the slope of the ground they
stand on (central differences over 125 m, the span a settlement is wide rather
than the span of one terrain cell):

| threshold                      | villages kept | refused |
| ------------------------------ | ------------- | ------- |
| 0.25, as the spec asked        | 63 %          | 174     |
| **0.45, chosen from pictures** | **92 %**      | **37**  |
| 0.6                            | 96 %          | 18      |
| 0.9                            | 100 %         | 1       |

The threshold was picked by looking rather than by arithmetic: five real
villages were photographed at slopes of 0.10, 0.25, 0.45, 0.71 and 1.08, and
the owner chose from the pictures. At 1.08 the village could not be
photographed from below at all -- the hill it stands on is in the way, which is
its own argument.

The hit carries the centre's slope from four more `baseFields`, taken once per
lattice cell beside its height and temperature and remembered in the same
seats. A full window fill is 789 ms against 783 before, and 824 with the second
lattice against 828: inside the noise, because a lattice cell covers thousands
of texels and the samples are paid once for all of them.

## M4b: what a town costs to plan

The plan for M4b set a threshold before anything was written: a town's `build`
hook runs whole inside the site queue, whose budget is 4 ms a frame, so if one
town cost more than **1.5 frames (25 ms)** the town would have to be cut into
quarters built over several frames -- a change to the model, since a plan is
otherwise raised whole or not at all.

Measured on this container against the real ground of seed 42, with the site's
own `height` and `slope` reading the filled height window, median of five after
a warm-up call:

| radius | roads | buildings | reservations | plan    |
| ------ | ----- | --------- | ------------ | ------- |
| 400 m  | 23    | 537       | 538          | 4.3 ms  |
| 650 m  | 39    | 1228      | 1229         | 10.3 ms |
| 900 m  | 51    | 1902      | 1903         | 18.8 ms |

and the town seed 42 actually seats 9.2 km from the origin, through the queue
rather than through a harness: radius 804 m, 47 roads, 1635 buildings, 18.9 ms.

**So the threshold holds and the town is built whole**, which is the cheap
answer the plan preferred: the lattice is 20 km and only 0.6 of its cells carry
a town on ground that will take one, so seed 42 puts them 41 km apart -- eleven
to seventeen minutes of flying. One long frame at that interval is cheaper than
any machinery that would remove it.

It did not hold at first. The first measurement was **24.6 ms at 900 m**, which
is inside the threshold by two per cent -- close enough that another machine
would decide differently. The whole of the difference was string keys: the plan
asks its two hash grids -- is this on a road, is there a building here already
-- some fifteen thousand times, and each question built nine `` `${cx},${cz}` ``
keys. Packing the two cell indices into one number instead took 24.6 ms to
18.8, with the same town coming out: the same 1902 buildings on the same 51
roads. Collisions are possible past four million cells from the origin and
harmless when they happen, because the bucket's own distance test is what
answers.

The cost is linear in the lots the grid offers, not in the buildings raised: a
900 m town walks 7576 places a building could stand, keeps 4233 of them, and
builds 1902. That is why the count is chosen as a share of what the grid offers
rather than by stopping at a cap -- a cap walks the streets in the order they
were laid and builds a town with one side missing.

## M4b: the pools a town fills, and the ones it does not

The plan expected a town of two thousand buildings to threaten the pools, whose
capacity is `BUDGET.propInstances` = 2000 **per kind and floor count**, and to
do it unevenly: a town that is mostly one-storey cottages puts them all in one
pool while eight others stand empty.

Measured over 24 towns spread across the whole radius range, on seed 42's
ground, taking the worst any single town put in each pool:

| pool      | worst | share of the pool |
| --------- | ----- | ----------------- |
| cottage:2 | 655   | 33 %              |
| cottage:1 | 607   | 30 %              |
| cottage:3 | 277   | 14 %              |
| barn:2    | 197   | 10 %              |
| barn:1    | 116   | 6 %               |
| mill:3    | 36    | 2 %               |
| tower:3   | 1     | 0 %               |

The largest of the 24 had 1871 buildings. **Nothing needs raising**: the worst
pool is a third full, because the weights spread a town over three kinds and
four floor counts and the biggest share of it is one of nine pools rather than
all of it. Only one town can face the flight at once -- a 20 km lattice against
the ring's 2.6 km reach -- and a village beside it adds some fifty houses.

The other half of the task stands whatever the measurement said. A pool that
refuses is a `continue` in the ring, so a building the plan asked for and the
pools would not take disappeared without a number anywhere -- exactly the class
of silent fault M4a spent a day finding in the floor counts. `SceneryStats` now
carries `buildingsRefused` from the last rebuild, counting both ways a lot can
fail to stand: a pool at its ceiling and a shape nobody baked. Nine pools of
2000 cost about 1.4 MB of instance data whether or not anything stands in them,
which is the price of not having to find out the hard way.

## The figure: one skin on sixteen bones

The figure was twenty solids -- ellipsoids and capsules parented to one another,
each with its own geometry and its own draw -- and is now two skinned surfaces on
one skeleton. Measured in Node with the old module beside the new one, 20 000
frames each after a warm-up:

|                     | solids  | skin    |
| ------------------- | ------- | ------- |
| meshes (draws)      | 20      | 2       |
| vertices            | 2334    | 577     |
| triangles           | 3528    | 1120    |
| bones               | 0       | 16      |
| the pose arithmetic | 8.6 us  | 7.8 us  |
| the whole frame     | 11.3 us | 11.4 us |

"The whole frame" is what the renderer actually pays: the pose, then
`updateMatrixWorld`, then -- for the skin only -- `Skeleton.update()`, which the
solids did not have at all. It comes out level, and that is the result worth
writing down: sixteen bone matrices and a bone-texture upload cost about what
walking twenty meshes and their groups cost, so the skin is **a third of the
geometry for the same microseconds**. On the page `__world.memory().geometries`
falls from 67 to 49.

A first pass at this measurement said the pose arithmetic had gone from 3.5 to
21.8 us -- a six-fold regression, which would have been worth a paragraph of
apology. Both halves of that were wrong. The 21.8 was two thousand unwarmed
iterations measuring the JIT; warmed and repeated five times it is 7.8. And the
3.5 was the figure's cost in the note of 2026-09-16, which is _before_ the joints
became springs -- the same twenty solids, measured today, cost 8.6. Comparing a
number to one taken from a different commit is how a rewrite gets blamed for the
commit before it. A number taken once is not a measurement, and a number from
somewhere else is not a baseline.

The budget was 4 000 triangles and the note that planned the change guessed
"well under half". It is under a third -- and none of the saving was the point.
The point was the seam at the shoulder, which is gone. What the pictures cost
was three tuning passes on the profiles, and one of those found a real fault: the
goggles, written as the band from 0.58 to 0.80 of the head's length, caught no
ring at all. A head of three rings a segment samples at 0, 0.107, 0.321, 0.428,
0.571, 0.857 and 1, and nothing lands between 0.58 and 0.80 -- so the figure flew
about in a plain cream egg and no test could see it, because every test asked
about weights and manifolds and none asked what colour anything was. A band is
only a band if a ring lands in it.

## The figure: five shapes instead of one

The figure held two poses -- the box and a track it folded into -- and chose
between them on `pitch` alone. It now holds five (box, delta, track, climb and
a turn laid over any of them) and chooses off three axes: flight angle,
airspeed and bank. A pose is five directions a side and nothing else, so the
five cost thirty numbers; what they cost per frame is the blend.

Measured in Node against the commit before, 20 000 warmed frames of a flight
that moves through all of them:

|                 | one shape | five    |
| --------------- | --------- | ------- |
| the pose        | 9.0 us    | 14.4 us |
| the whole frame | 11.4 us   | 17.0 us |

Six slots a joint, so sixty springs and up to sixty spherical interpolations a
frame where there used to be two. **5.6 us**, against a frame of 16 700. The
geometry did not move: 1 120 triangles, 2 draws, 16 bones, exactly as before.

`POSE.floor` -- the weight below which a slot is not worth interpolating -- is
worth measuring rather than assuming: without it the same flight costs 17.6 us
instead of 14.4. In ordinary flight two or three of the six slots carry
anything, and skipping the rest is **a third of the feature's cost** for one
comparison.

### The thresholds have to be inside the envelope

`POSE.dive` was 0.5 rad, taken from what a skydiver's flight angle looks like.
The controller's steepest sustained dive is **0.42** -- measured by flying each
corner of its envelope for half a minute with four kilometres of air underneath:

| corner         | pitch     | airspeed | rush |
| -------------- | --------- | -------- | ---- |
| steepest dive  | -0.42     | 59.2     | 1.48 |
| steepest climb | +0.56     | 30.0     | 0.75 |
| hardest turn   | bank 0.47 |          |      |

So the track existed, had a pose, had tests, and could not be reached by
flying: the axis saturated a fifth past the end of the world. `POSE.dive` is
0.40 now and a test asks the controller itself, so a threshold written from a
photograph instead of from the envelope fails rather than passes quietly.

### Is any of it visible without touching the keyboard

Ten minutes of hands-off autopilot on seed 42, weights recomputed per frame:

| shape | leads  | worn at all (>= 0.3) | peak |
| ----- | ------ | -------------------- | ---- |
| box   | 63.4 % | 67.2 %               | 1.00 |
| climb | 18.6 % | 21.6 %               | 1.00 |
| track | 14.1 % | 14.2 %               | 1.00 |
| turn  | 2.6 %  | 23.6 %               | 0.55 |
| delta | 1.4 %  | 2.0 %                | 0.92 |

Four of the five are worn whole without a hand on the stick. Two entries are
worth reading properly rather than as a ranking. The **turn** leads 2.6 % and is
worn a quarter of the time: an autopilot never banks hard, so it is a lean over
another shape almost always and a shape of its own almost never -- which is what
`POSE.lean` is for and exactly the intended behaviour. The **delta** is the
transition: the autopilot's descents are close to bang-bang, so `drive` crosses
the middle of the road rather than sitting in it, and the delta is what the
figure wears for the second or two it takes to cross. Under the hand, where the
pointer's aim is continuous, `vy -7` holds it at 0.85 and it is a position
rather than a passage.

The same measurement corrected the shape of the blend. The first draft made the
track the product of the two axes and the delta their disagreement, which is
right on paper: nose down **and** fast is a track, either alone is a delta. In
the air a dive buys airspeed, so the two axes agree within a second of each
other and the delta was a shape the figure flashed through rather than held.
Blending box, delta and track along one committed road -- the mean of the two
axes -- puts a level cruise in the box, the gentle descent the autopilot flies
all day at 85% delta, and only the steepest dive in a whole track.

### What the photograph said about the climb

The climb started life as a jumper's flare: arms reaching forward and high,
knees folded hard. It is what a skydiver slowing down actually does and it was
wrong here -- from the side it reads as a figure being lifted by the wrists, and
the owner said so on sight. The arms sweep **back** now, about as far as the
track's, and what tells the two shapes apart is underneath: the climb folds its
knees hardest of the four (1.41 rad against the box's 1.04) and the track does
not fold them at all (0.03). Nose up and slow stayed one state rather than two,
because a climb in this world is paid for in airspeed -- `pitch +0.56` and
`speed 30` arrive together and there is no third thing for a second shape to
mean.

## The grass window is written a rim at a time, and reaches twice as far

The owner said grass was still appearing in front of a low pass. It was: the
blades faded out at 190 m and the flight does 40 to 59 m/s, so the meadow
arrived with two to five seconds' warning, in a band across the middle of the
screen. The note that left this alone in M3b called the fix "a rebuild of the
port", and it was right about what was needed and wrong about what it would
cost.

**The window used to be thrown away and written again** every 32 m, over a
260 m disc. Reaching further that way is quadratic and hopeless: measured over
a real flight, a 480 m disc costs a median of 6.6 ms a rebuild and 19.1 at
worst, which is a dropped frame twice a second.

**It is now a set of tiles**, and a tile's tufts are a pure function of its own
coordinates -- they always were, which is what makes this possible. Crossing a
cell drops the tiles that left, moves the last live tuft into each hole they
made, and writes only the tiles that arrived. A kept tuft is never rewritten:
its matrix is a world place through `Origin` and has nothing to do with where
the flyer is. Ten minutes of a low flight over seed 42:

|                            | 260 m, wholesale | 480 m, a rim at a time |
| -------------------------- | ---------------- | ---------------------- |
| rebuilds in ten minutes    | 917              | 460                    |
| a rebuild, median          | 2.9 ms           | **1.1 ms**             |
| a rebuild, worst           | 10.9 ms          | **2.9 ms**             |
| rebuilds costing over 5 ms | **255 of 917**   | **0 of 459**           |
| tufts standing, median     | 5 508            | 20 660                 |
| tufts standing, peak       | 14 336           | 45 308                 |
| the last visible blade     | 190 m            | 360 m                  |

**Twice the reach, three and a half times the grass, and a quarter of the
frame cost.** The one thing that got dearer is the whole rebuild an origin jump
forces -- 16.0 ms against 28.5 -- and that happens once in ten minutes where
the old one happened 917 times.

Three numbers are tied together and none of them is free to move alone. A tile
is taken or left by its **centre**, so a tuft may stand half a tile's diagonal
(45 m) past `REACH`, and everything in that band appears and disappears as the
flyer moves: `GRASS_FADE[1] <= REACH - STEP - 45`. And `CEILING`, the height
over the ground past which the window sleeps, has to clear the far end of the
fade -- 250 was fine when the last blade was at 190 and would have hidden a
window with visible grass in it at 360, which is the same pop moved from the
horizon to the altimeter.

### What this costs the GPU, and what of it was not measured

Every millisecond above is **CPU**, on the main thread, and none of it moves to
the GPU by having one: it is the arithmetic of deciding where tufts stand and
writing their matrices, and it is what stalls a frame. The GPU's share is the
drawing, and this container has no GPU -- the browser suite rasterises in
software -- so what follows is arithmetic and a triangle count, not a timing.

|                                  | before  | after   |
| -------------------------------- | ------- | ------- |
| tufts drawn, peak                | 14 336  | 45 308  |
| triangles, peak                  | 86 016  | 271 848 |
| draw calls                       | 4       | 4       |
| instance data held               | 1.5 MB  | 4.9 MB  |
| instance data uploaded a rebuild | 1.28 MB | 4.1 MB  |

Against the terrain's 557 568 triangles in the same frame, grass at its peak
goes from 15 % to 49 %. The count is the easy half. The half that is not
measured here is **alpha-tested fill**: a tuft is three cards of painted blades
with `alphaTest`, so pixels are shaded and then thrown away, and tripling the
tufts at distance puts more of them in the same pixel. Far tufts are small, so
the screen area does not triple -- but the overdraw in it rises, and by how much
is a question only real hardware answers.

If it turns out to cost too much there, the lever is `GRASS_FADE` and `REACH`
together (less reach, same machinery) or a per-instance rank compared against
distance in the vertex shader, which thins the far field without the CPU ever
knowing -- and which, unlike thinning the placement, cannot pop, because the
instance's rank never changes and the comparison is continuous in distance.
Thinning the **placement** by distance was tried and reverted for exactly that
reason: the number of attempts a tile gets would depend on where the flyer was,
so flying toward a meadow would thicken it in the middle of the visible band.

### The measurement that was wrong for an hour

`Heightfield.fillAll(cx, cz)` takes **cell indices**, not metres; `update(x, z)`
is the one that takes metres and divides. Every grass measurement above was
first taken with metres passed to `fillAll`, which centred the terrain window
sixteen times too far out and quietly measured a different piece of the world.
The costs were real -- a window over real ground -- but the ground was not the
ground the flight was over, and the peak that sizes `PER_FORM` came from
nowhere in particular. It surfaced because a rewrite placed zero tufts on a
path a probe said had thick grass: the code was right and the harness was
lying. A harness is not a measurement until something it says can be checked
against something else.

## M5: the Milky Way is baked in a worker, because it is 3.5 seconds

The galaxy is grown rather than downloaded: a branching dust field and the
stellar light behind it, evaluated per texel into an atlas the sky dome samples.
What that costs, on this machine:

| step                                   | cost    | size   |
| -------------------------------------- | ------- | ------ |
| the dust field (`makeDust`)            | 49 ms   | 8.4 MB |
| the core's bearing (`brightestMatter`) | 44 ms   | --     |
| the light atlas, 4096 x 512            | 3446 ms | 8.4 MB |

**Three and a half seconds for something nobody can see until nightfall.** The
atlas is two million texels and each one is three fbm fields, a dust lookup and
a dozen exponentials -- 1.7 us a texel, and no way to make it cheap that does
not also make it look like something else.

So the split is by what has to be ready and when. The dust and the bearing are
the main thread's 93 ms, because the flight asks for the core's bearing on its
first step and cannot wait. The atlas is baked in a worker, and the texture is
allocated at full size and zero so the material is built once and the bake is a
fill rather than a new texture: **an empty atlas is simply no galaxy**. Measured
in the browser, it arrives 2.1 s after the page is already flying, and the start
timings are untouched.

The worker regrows the dust rather than being handed it -- 49 ms against a
transfer of 8.4 MB, and it leaves the main thread holding nothing it has no use
for. The field is deterministic (a fixed seed inside it), so the two agree.

### Two things CI said that this machine could not

The first CI run over the galaxy failed, and both faults were real.

**The bake was started behind the veil.** `createMilkyWay` began the worker in
its constructor, which runs beside the terrain fill, the scenery build and the
shader compile -- so the claim "the start pays nothing" was true of the main
thread and false of the machine. On a two-core runner the start itself timed
out twice. The world calls `galaxy.begin()` on its first frame of flight now,
when the veil is up and the core the bake burns is one nothing else wants.

**A frame budget was written against one machine's clock.** The town's plan
costs 18.8 ms in Node here and the browser test's ceiling was 40, "twice the
measured". On a two-core runner under a software rasteriser the same work is
41 ms, so the ceiling failed the first time CI ever ran that test. The test
asks two things now: that **exactly one frame in sixteen is a long one** --
machine-independent, and the actual invariant, since a town built in pieces
would show as two -- and a ceiling of 80, which is twice the slowest honest
reading and is admitted in the comment to be what it is.

### One bearing, not two

`SkyPulls.GALAXY_HEADING` was 0.95, guessed from the core longitude written in
the original. The bake's own answer is **1.0002** -- three degrees out, which
is the flight turning toward where the core nearly is, once a night, forever.
It is the measured number now and a unit test asks the bake for it again, so a
galaxy that moves fails a test rather than leaving a stale heading behind.

## M5: the snow, and the byte that was reserved for the wrong thing

The snow line has existed on the CPU since M3b -- `snowLineAt(baseTemp)`, which
the standard scatter reads to draw the tree line sixty metres over it -- and the
ground shader could not read it, because the height window carries heights,
weights and biome indices and no climate at all. So the world had a tree line
with nothing above it.

`baseTemp` now travels in the window's **fourth slot byte**, quantised over a
range of two. Measured over 160 000 points of seed 42 across a hundred
kilometres it runs 0.14 to 0.85, so two leaves room for a world hotter or higher
than this one and still spends only 3 m of snow line on a step -- under a line
that wanders 45 m by design.

That byte was documented as reserved for standing water. **The reservation could
never have worked**: a lake needs a surface height, and a byte over this world's
relief (-48 m to 979 m on seed 42) is four metres a step, which is not water,
it is a staircase. Standing water will want a channel of its own.

What it buys, per fragment: two texture channels already being read, a multiply
and an add. The snow itself is a `smoothstep` either side of the line times a
slope term, plus a band of alpine rock under it -- no new texture, no new pass,
and nothing at all below the line, which is most of any frame.

### The picture that nearly sent this the wrong way

The first summit picked for a photograph came out white from sea level to the
peak, which reads exactly like a snow layer with its line broken. It was not:
painting `cover`, `line` and `h` into the red, green and blue channels showed
`cover` at zero across the lowland and the line landing at 400 m, both correct.
The white was `frostpines`' own base colour, `frost`, and it has been there
since M3a. A photograph of HEAD at the same spot said the same thing in one
frame.

Two things came out of that. The diagnostic is the cheap move and should be the
first one: three numbers into three channels answers in one build what an hour
of reading the shader does not. And a biome whose ground is already white makes
the world's snow line invisible inside it -- which is the same two-lines fault
in another disguise, and it is `frost`'s to answer for, not the snow's.
