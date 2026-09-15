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

## Documents

- `VISION.md`: why this page exists and what it doesn't do.
- `AGENTS.md`: the engine's rules for agents and humans changing `src/`.
- `CONTRIBUTING.md`: commands and the library contract.
- `docs/superpowers/specs/`: the design; `docs/superpowers/plans/`: one plan per milestone.

## Status

M0 Skeleton: engine, empty world, veil and gate, tests, CI, Pages.
M1 World: heightfield terrain, water, sky and day cycle, floating origin, display chain.
