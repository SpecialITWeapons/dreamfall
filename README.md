# Dreamfall

A flight from a dream: a person in a free-fall pose glides over an endless,
procedural world. A page meant to stay open next to your work. The pattern
and source of the ported modules is [fly-with-me](https://github.com/kunchenguid/fly-with-me) (MIT).

## Running it

    npm install
    npm run dev          # http://localhost:5173

Address parameters: `?seed=<n>` picks the world, `?webgl=1` forces WebGL2,
`?profile=1` arms frame profiling, `?dev=1` loads the developer panel (M5).
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
