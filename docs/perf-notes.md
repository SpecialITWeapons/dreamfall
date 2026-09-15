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
