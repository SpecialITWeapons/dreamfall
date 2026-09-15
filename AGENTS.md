# Dreamfall

The engine's rules for agents and anyone changing `src/`. The design in
`docs/superpowers/specs/2026-09-14-dreamfall-design.md` is the source of
truth; this file collects what you need to know for every change.

## Layout

Vite + TypeScript in `src/`, JavaScript with JSDoc in `library/` plus its one
TypeScript file, `contract.ts`, checked by `checkJs`. Nothing under
`library/standard/` imports TSL: a ground hook is handed `color`, `mix` and
`ramp` through its context, which is what lets the layer painter be read by a
test in Node. Under `src/engine/`: `sim/` (simulation aggregate, floating origin),
`flight/` (controller, sky pulls, steering, camera), `scenery/` (obstacle
registry), `avatar/` (character interface, procedural human, outfits),
`terrain/` (noise, base fields, heightfield window, terrain mesh), `sky/`
(uniforms, lights, atmosphere, fog, dome, clouds), `water/`, `audio/`
(ambience model and sound graph), `render/` (color grade, lighting model,
display chain), `time/` (day clock). `three` is aliased to
`three/webgpu`, pinned to 0.185.1; an
upgrade is its own PR with a pixel comparison. `tools/` and `tests/` never
end up in the bundle. Paths are relative, so the page works under a Pages
subdirectory.

## Rules

- No module-level singletons: state lives in objects returned by factories
  (`createEngine`, `createWorld`, `createLoop`, `createSimulation`).
- The pure CPU modules (`src/engine/sim/**`, `terrain/noise.ts`,
  `terrain/WorldSampler.ts`, `terrain/Heightfield.ts`, `time/DayClock.ts`,
  `render/ColorGrade.ts`, `flight/angles.ts`, `flight/SkyPulls.ts`,
  `flight/FlightController.ts`, `flight/Steering.ts`, `flight/ChaseCamera.ts`'s
  pose math (not `applyCameraPose`, which writes an actual camera),
  `scenery/Obstacles.ts`, `page/Memory.ts`, `audio/AmbienceModel.ts`,
  `sky/Wind.ts`) import neither `three/webgpu`, `three/tsl` nor the DOM; from
  `three` they take only the math classes (`Color`, `Vector2`, `Vector3`,
  `MathUtils`). Everything that runs on the CPU has a Vitest test; the GPU is
  checked by Playwright on WebGL2.
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
- Interface text lives only in `index.html` and `src/page/Hud.ts`; `#manual`
  sits outside the HUD pill on purpose, because the pill dims and "the autopilot
  is off" must not.

## Terrain, sky and time

- The CPU heightfield is the only terrain truth; `heightAt` interpolates the
  exact rendered triangle (same diagonal as `buildGrid`), never bilinearly.
- The window carries `(h, w0, w1, w2)` and `slots` `(i0, i1, i2, spare)` from
  one sampling: heights interpolate across the triangle, weights belong to the
  cell, and the spare byte is reserved for standing water.
- Presence is the CPU's: every biome's hook is clipped to 0..1, normalised, and
  the three strongest are kept and renormalised. The GPU only reads the result,
  which is why a biome may have any presence function rather than a point in
  climate space. The climate sharpening (2.2) lives inside `climatePoint`, not
  in the sampler, or the borders move.
- A height hook sees the base height, never a neighbour's answer, and its change
  is clipped to `MAX_HEIGHT_DELTA` and weighed by its own slot, so the order of
  the registry cannot move the ground.
- The ground material is composed once from the registry, one branch per biome
  gated at a hundredth of a fragment; ten biomes cost about 2 ms on a full
  window fill (530 ms against 528 without them), because the base fields are
  what a fill actually costs.
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
  eight-bit; `capture` renders before the display chain. It renders straight to
  its own target, so the scene compiles a second time for that configuration:
  the first capture costs seconds and the rest a fifth of one, provided the loop
  is paused -- a running loop puts a pipeline frame between two captures and
  buys the recompile again. A browser test that captures pauses first.
- The renderer's tone mapping stays `NoToneMapping` and the display chain names
  ACES itself: a node program is keyed on the renderer's tone mapping, so
  flipping that global recompiles every material in the scene. Exposure is a
  uniform and is free to move every frame.
- TSL is strictly typed in `@types/three`: annotate `Fn` parameters with the
  node type (`Node<'vec3'>`, `Node<'float'>`); a bare `Node` has no operator
  methods, so never cast to it.
- `uncapturederror` remains fatal on purpose; a new shader that only warns
  must not ship.

## Flight, camera and memory

- The simulation (`sim/Simulation.ts`) is the CPU aggregate: day clock, sky
  pulls, flight controller; `World.update` runs `steering.update`, then
  `sim.step`, then places everything. Nothing in the presentation writes
  flight state.
- The envelope holds in every mode, autopilot or not: after the move `y` is
  clamped down to `MAX_ALTITUDE` and then up to `MIN_CLEARANCE` over ground and
  obstacle tops, in that order, so ground above the ceiling still gets its
  clearance. `terrainAhead` and `climbAhead` follow the arc of the current turn
  and reach in proportion to the airspeed; terrain that asks for more altitude
  than the ceiling allows turns the figure aside (`escapeTurn`) -- the world has
  no other edge. `Obstacles` is a 64 m hash grid and the only way scenery
  reaches the flight.
- Airspeed is state (`state.speed`): a dive buys it and a climb spends it, in
  `AIRSPEED.min..max` about a second behind `vy`. Everything that measures the
  path ahead reads it; the stick still asks for a climb rate, so `AIM.up` and
  `AIM.down` stay tied to the nominal `SPEED`.
- The pilot's stick: `steerBy` turns the figure whole on the next step,
  `aimBy` owns the vertical while held and for `AIM.release` seconds after;
  the sky pulls let go the moment the pilot steers, not merely aims.
- The arrow keys are not the stick: the first one down hands the flight to the
  pilot (`fly(yaw, climb)`, autopilot off, sky pulls released, deck schedule and
  low passes stopped), the keys turn and climb while held, and letting go holds
  the course and the height. The vertical is inverted the way an aircraft's
  stick is: `ArrowDown` raises the nose. Only `setAutopilot(true)` -- the HUD
  button -- hands it back. A pause, a blur or a hidden tab releases the keys.
- Headings grow counter-clockwise seen from above; rightward input subtracts;
  the figure's frame is x left, y up, z ahead; `bodyToWorld` and
  `Object3D.rotation` with order `'YXZ'` agree.
- `applyCameraPose` is the only place the camera is moved; poses are computed
  in the world and written through `Origin.localX/localZ`.
- Memory: `dreamfall-settings` and `dreamfall-resume`; every numeric field
  passes through `finite`, everything else by a direct type or equality
  check; `?seed` wins over a remembered one; a flight resumes only on its own
  seed; saves happen roughly every 2 s while flying, and on pause, a hidden
  tab and leaving, never before Begin.
- Sound starts on Begin (a gesture) and never before; pause and a hidden tab
  suspend the context; `AmbienceModel` holds the arithmetic so it is tested
  in Node.
- One wind (`uWind`) drives the painted clouds, the puffs, the cloud sea, the
  cloud shadows, and the clouds reflected in the water; shader time is still
  simulation time, so pause freezes the wind too.

## Checking

`npm run check` (types, lint, format, tests, build) and `npm run test:e2e`.
Close any browser tab left open for testing when you're done.

## Maintaining this file

Only knowledge useful in nearly every session. Don't repeat code or the
design doc; point to the file instead. Prefer fixing an existing entry over
adding a new one.
