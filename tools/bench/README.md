# bench

What a frame costs, at five vantages of one seed's world.

    npm run bench

Builds the page, opens it in Chromium, and holds the flyer still at each
vantage while it times frames. Prints a table and writes `last.json`, which is
gitignored: it is a measurement of one machine on one evening.

Knobs, all environment variables: `BENCH_ROUNDS` (3), `BENCH_FRAMES` (60),
`BENCH_SEED` (42), `BENCH_WEBGL=1` (force WebGL2, as CI runs it), and
`BENCH_CHROME` (a browser binary to use instead of Playwright's own -- which is
also how you bench against a particular Chrome).

## The method, and why it is this one

From fly-with-me, and §13 of the design:

- **Fixed vantages.** A flight that moves measures a different world every
  frame. The flight is paused and the frames are driven by hand.
- **The fifth percentile of a window of frames.** Not the mean: a frame that
  took longer than its neighbours took longer because something else on the box
  wanted the CPU. The fast end is the part the engine is responsible for.
- **The minimum across rounds.** Same argument, one level up.
- **Interleaved builds.** The reason the method compares two builds round by
  round is that a machine drifts over minutes -- thermals, another process
  waking up. This tool does not do that for you: run it on each branch and
  compare the two `last.json`s, and only read them as one measurement if
  nothing else changed on the machine in between.

It never runs in CI. A shared runner measures its own weather, and the numbers
would be noise with a version number on them.

## What the vantages are for

| vantage | what it holds still                                           |
| ------- | ------------------------------------------------------------- |
| dawn    | the low sun, the horizon's tint, the ground under it          |
| noon    | the same ground with the sun overhead: the palette's own cost |
| far     | 1 500 m up, where the window's whole reach is in the frame    |
| deck    | over the cloud sea, where the ground is behind cloud          |
| night   | the village at midnight: lit panes, and the galaxy over them  |

The night vantage waits for the Milky Way's atlas, which is baked in a worker
and takes seconds; measuring the night sky without it measures an empty atlas.
