# Dreamfall

The engine's rules for agents and anyone changing `src/`. The design in
`docs/superpowers/specs/2026-09-14-dreamfall-design.md` is the source of
truth; this file collects what you need to know for every change.

## Layout

Vite + TypeScript in `src/`, JavaScript with JSDoc in `library/` (from M3
onward). `three` is aliased to `three/webgpu`, pinned to 0.185.1; an
upgrade is its own PR with a pixel comparison. `tools/` and `tests/` never
end up in the bundle. Paths are relative, so the page works under a Pages
subdirectory.

## Rules

- No module-level singletons: state lives in objects returned by factories
  (`createEngine`, `createWorld`, `createLoop`, `createSimulation`).
- `src/engine/sim/**` imports neither Three.js nor the DOM. Everything that
  runs on the CPU has a Vitest test; the GPU is checked by Playwright on
  WebGL2.
- The CPU height field will be the sole source of truth for terrain (M1);
  the GPU only reads it.
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

## Checking

`npm run check` (types, lint, format, tests, build) and `npm run test:e2e`.
Close any browser tab left open for testing when you're done.

## Maintaining this file

Only knowledge useful in nearly every session. Don't repeat code or the
design doc; point to the file instead. Prefer fixing an existing entry over
adding a new one.
