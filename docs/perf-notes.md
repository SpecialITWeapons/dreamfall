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
