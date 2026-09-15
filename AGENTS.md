# Dreamfall

The engine's rules for agents and anyone changing `src/`. The design in
`docs/superpowers/specs/2026-09-14-dreamfall-design.md` is the source of
truth; this file collects what you need to know for every change.

## Layout

Vite + TypeScript in `src/`, JavaScript with JSDoc in `library/` (from M3
onward). Under `src/engine/`: `sim/` (flight, floating origin), `terrain/`
(noise, base fields, heightfield window, terrain mesh), `sky/` (uniforms,
lights, atmosphere, fog, dome, clouds), `water/`, `render/` (color grade,
lighting model, display chain), `time/` (day clock). `three` is aliased to
`three/webgpu`, pinned to 0.185.1; an
upgrade is its own PR with a pixel comparison. `tools/` and `tests/` never
end up in the bundle. Paths are relative, so the page works under a Pages
subdirectory.

## Rules

- No module-level singletons: state lives in objects returned by factories
  (`createEngine`, `createWorld`, `createLoop`, `createSimulation`).
- The pure CPU modules (`src/engine/sim/**`, `terrain/noise.ts`,
  `terrain/WorldSampler.ts`, `terrain/Heightfield.ts`, `time/DayClock.ts`,
  `render/ColorGrade.ts`) import neither `three/webgpu`, `three/tsl` nor the
  DOM; from `three` they take only the math classes (`Color`, `Vector2`,
  `Vector3`, `MathUtils`). Everything that runs on the CPU has a Vitest
  test; the GPU is checked by Playwright on WebGL2.
- The CPU height field is the sole source of truth for terrain; the GPU only
  reads it.
- Background color and fog color are one uniform.
- Shader time is simulation time.
- The veil lifts only after `engine.waitForGpu()` following the first
  frame; there is no loop behind the gate; pause and a hidden tab stop the
  loop; `dispose` releases the renderer, and disposing the world releases
  what it allocated -- the browser test asserts the drop in the renderer's
  memory counters, not a return to zero (the renderer itself still owns
  some GPU state).
- `Renderer.init()` starts an internal animation tick that
  `setAnimationLoop(null)` does not stop, so "no loop behind the gate"
  means no rendering and no simulation, not no callbacks.
- Any WebGPU `uncapturederror` is treated as a fatal device loss on
  purpose (fail loud); a shader that only warns must not ship.
- Pixel budget of 2,000,000 and DPR capped at 1.5 (`renderScale`).
- Interface text lives only in `index.html` and `src/page/Hud.ts`.

## Terrain, sky and time

- The CPU heightfield is the only terrain truth; `heightAt` interpolates the
  exact rendered triangle (same diagonal as `buildGrid`), never bilinearly.
- `WorldSampler` is a verbatim port of fly-with-me's `sampleWorld`; its unit
  tests hold golden values for seed 42, and a change to the terrain must
  update them deliberately.
- The simulation works in world coordinates (double precision); the scene is
  in the local frame of `Origin`, which jumps in whole cells. Shaders that
  read the world add `uWorldOrigin`; nothing else may read `positionWorld`
  as a world position.
- Day clock and solar clock differ; palette keys, sky bodies and anything
  keyed to the sun's height read `solar(phase)`.
- Sky and fog share `horizonTint`; `uSunDir` is always the true sun; the one
  directional light changes direction only at zero intensity.
- The sky dome draws last among the opaque objects (`renderOrder 1`), writes
  no depth, and rides on the camera.
- Only the scene pass is multisampled; everything past tone mapping is
  eight-bit; `capture` renders before the display chain.
- TSL is strictly typed in `@types/three`: annotate `Fn` parameters with the
  node type (`Node<'vec3'>`, `Node<'float'>`); a bare `Node` has no operator
  methods, so never cast to it.
- `uncapturederror` remains fatal on purpose; a new shader that only warns
  must not ship.

## Checking

`npm run check` (types, lint, format, tests, build) and `npm run test:e2e`.
Close any browser tab left open for testing when you're done.

## Maintaining this file

Only knowledge useful in nearly every session. Don't repeat code or the
design doc; point to the file instead. Prefer fixing an existing entry over
adding a new one.
