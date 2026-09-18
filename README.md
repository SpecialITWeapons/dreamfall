# Dreamfall

A flight from a dream: a person in a free-fall pose glides over an endless,
procedural world. A page meant to stay open next to your work. The pattern
and source of the ported modules is [fly-with-me](https://github.com/kunchenguid/fly-with-me) (MIT).

## Why this repository exists

The page is real and I want it to work. But the reason I started it is that I
wanted to find out how far an agent can carry a codebase on its own, and this is
the experiment: Claude Code working in a cloud session, on a repository it does
not share a machine with, for as long as it can keep the thread.

What I am actually watching:

- **Git as the interface.** Branches, commits, pull requests, CI, review. Not
  "can it write a function" but can it land one -- keep its own history legible,
  get a red build green, and say plainly when it cannot.
- **The port.** The first half of the work is taking someone else's finished
  application, fly-with-me, and carrying its parts across faithfully. That half
  has a right answer to be measured against. The second half is growing a line of
  my own from it, where nothing does.
- **Memory across sessions.** A session ends when its context fills. The specs,
  the plans and the notes in `docs/` are there so the next one does not start by
  reading a chat log. When that hand-off fails, it fails visibly.
- **The models.** What each one can hold in its head at once, what it plans
  before it types, what it finishes, and what it quietly leaves out.

The rules I run it by: the agent writes the code, the specifications, the plans
and the commit messages; I read them and decide. Anything it measured, it had to
measure -- the numbers in `docs/perf-notes.md` are readings, not estimates. When
it broke something, the history says so, because a green build at the end is not
the interesting part. `VISION.md` is about the page; this section is about the
repository.

## Running it

    npm install
    npm run dev          # http://localhost:5173

Address parameters: `?seed=<n>` picks the world, `?webgl=1` forces WebGL2,
`?profile=1` arms frame profiling, `?dev=1` loads the developer panel -- its own
chunk, downloaded only when asked for: readings of the page, the flight and the
scenery, a switch per layer, a jump to a point, a settlement or another seed, the
day on a slider, and a measurement of what the biomes' hooks cost a texel.
`?seed=42` opens the reference world (the same terrain as fly-with-me's seed 42).

## Controls

The flight flies itself until you take it. Right button or a finger: steer and
aim. Left button: orbit the camera, or look around in the first-person view.
Wheel: distance. Arrow keys fly it yourself: left and right turn, and the
vertical is inverted the way an aircraft's stick is -- down raises the nose.
The first arrow switches the autopilot off and the page says so; let the keys
go and it holds that course and height until the HUD hands the flight back.
Diving is faster than climbing, and the ground, the ceiling and a range too
tall to climb are held against you whichever way you fly. `V`: switch the view.
Space: pause. Settings and the flight are remembered in this browser;
`?seed=<n>` opens a world, and reopening the same seed continues where it was.

## Documents

- `VISION.md`: why this page exists and what it doesn't do.
- `AGENTS.md`: the engine's rules for agents and humans changing `src/`.
- `CONTRIBUTING.md`: commands and the library contract.
- `docs/superpowers/specs/`: the design; `docs/superpowers/plans/`: one plan per milestone.

## Status

M0 Skeleton: engine, empty world, veil and gate, tests, CI, Pages.
M1 World: heightfield terrain, water, sky and day cycle, floating origin, display chain.
M2 Flight and figure: flight controller with clearance and ceiling, steering, third- and first-person camera, procedural human, memory and resume, synthesized sound, wind in the clouds. Then: airspeed that follows the dive, an autopilot the arrow keys switch off, and a figure that holds a skydiver's arch.
M3a Contract and ground: the library contract with its validators, standard hooks, three biome slots in the height window, a ground shader composed from the biomes' own hooks, and the ten biomes of the original as biomes made of data.
M3b Scenery: a streamed ring of 96 m cells, instanced pools that shrink into the ground and morph their crowns with distance, nine tree species, props, grass, the shade under the trees, and an empty override layer the editor will fill.
M4a Settlements: villages on a sparse lattice, the ground flattened under them by the same lattice that seats them, plans built in a queue as data and turned into houses and road ribbons by the pools, three kinds of building whose windows are cut into their walls and light up after dark, and a forest that keeps off the square and the street.
M4b Towns: five hundred to two thousand buildings on a jittered grid inside a ring road, a plaza with a tower on it, streets that stop where the hillside starts, fences and hedges as their own kind of ribbon, and settlements that sow the ground they claim instead of leaving it bare. Then: a cut allowance in metres, because over nine hundred metres the slope at the middle of a town says nothing about the hill it sits on.
