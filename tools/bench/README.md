# bench

What a frame costs, at five vantages of one seed's world.

    npm run bench

Builds the page, opens it in Chromium, and holds the flyer still at each
vantage while it times frames. Prints a table and writes `last.json`, which is
gitignored: it is a measurement of one machine on one evening.

Knobs, all environment variables: `BENCH_ROUNDS` (2), `BENCH_FRAMES` (24),
`BENCH_SEED` (42), `BENCH_WEBGL=1` (force WebGL2, as CI runs it), and
`BENCH_CHROME` (a browser binary to use instead of Playwright's own -- which is
also how you bench against a particular Chrome).

## The method, and why it is this one

From fly-with-me, and §13 of the design:

- **Fixed vantages.** A flight that moves measures a different world every
  frame. The flight is paused and the frames are driven by hand.
- **The median of a window of frames**, with the fifth percentile beside it.
  The spec asks for the fifth percentile, and on a GPU that is right: frames
  are alike, and a slow one is the machine's fault rather than the engine's.
  Here it lied. On a rasteriser with no GPU the intervals come out bimodal --
  `[3399, 3360, 6797, 11, 3454, 3352, 3367, 3425]` at one vantage -- because
  now and then the loop reports two frames inside one sampling window and the
  pair divides into a number that never happened. The fifth percentile picks
  exactly those: it read 7.3 ms at a vantage where every frame took three and a
  third seconds. The median is the headline, the fast end is kept, and `fps` is
  the whole window divided by the frames in it.
- **The minimum across rounds.** A slower round is the machine's.
- **Interleaved builds.** The reason the method compares two builds round by
  round is that a machine drifts over minutes -- thermals, another process
  waking up. This tool does not do that for you: run it on each branch and
  compare the two `last.json`s, and only read them as one measurement if
  nothing else changed on the machine in between.

It never runs in CI. A shared runner measures its own weather, and the numbers
would be noise with a version number on them.

**What the absolute numbers are worth.** On a machine with no GPU they are
SwiftShader's, not the engine's: a frame of this world measures about 3.3
seconds there, flat across every vantage and every altitude, while `ringMs` and
`grassMs` -- the CPU's own share -- stay at 15 and 20 milliseconds. So read the
columns as a comparison between two builds on one machine, and never as what
anybody's frame costs. The `gpu ms` column is empty on WebGL2 for the same
reason it is honest to leave it empty: there are no timestamps there worth
printing.

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
