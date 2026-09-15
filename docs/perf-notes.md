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
