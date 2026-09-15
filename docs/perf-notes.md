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
