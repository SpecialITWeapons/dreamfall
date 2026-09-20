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
`flight/` (controller, sky pulls, steering, camera), `avatar/` (character
interface, procedural human, the outfit), `terrain/` (noise, base fields,
heightfield window, terrain mesh), `scenery/` (obstacle registry, streamed
ring, settlement lattice, pools, tree kit, structure kit, road kit, painted
textures, ground shade, grass), `sky/`
(uniforms, lights, atmosphere, fog, dome, clouds), `water/`, `audio/`
(ambience model and sound graph), `render/` (color grade, lighting model,
display chain), `time/` (day clock). `three` is aliased to
`three/webgpu`, pinned to 0.185.1; an
upgrade is its own PR with a pixel comparison. `tools/` and `tests/` never
end up in the bundle, and neither does `src/dev/`: the dev panel is imported
dynamically by `?dev=1` and is a chunk of its own. Paths are relative, so the
page works under a Pages subdirectory.

## Rules

- No module-level singletons: state lives in objects returned by factories
  (`createEngine`, `createWorld`, `createLoop`, `createSimulation`).
- The pure CPU modules (`src/engine/sim/**`, `terrain/noise.ts`,
  `terrain/WorldSampler.ts`, `terrain/Heightfield.ts`, `time/DayClock.ts`,
  `render/ColorGrade.ts`, `flight/angles.ts`, `flight/SkyPulls.ts`,
  `flight/FlightController.ts`, `flight/Steering.ts`, `flight/ChaseCamera.ts`'s
  pose math (not `applyCameraPose`, which writes an actual camera),
  `scenery/Obstacles.ts`, `page/Memory.ts`, `audio/AmbienceModel.ts`,
  `avatar/Skin.ts`, `sky/Wind.ts`, `sky/GalaxyMatter.ts`, `sky/Haze.ts`,
  `render/Layers.ts`, `terrain/HookCost.ts`) import neither
  `three/webgpu`, `three/tsl` nor
  the DOM; from `three` they take only the math classes (`Color`, `Vector2`, `Vector3`,
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
  means no rendering and no simulation, not no callbacks. That tick is also
  the only place three advances the node graph's frame id, and the display
  chain's scene pass is a node that updates once per id: **a second render
  inside one animation frame draws the chain over a scene texture nobody
  refilled** (measured: 3 draws and 3 triangles where the frame has a
  million). So `loop.renderNow()` and `__world.frame(dt)` are for one-off
  redraws -- a switch, a jump, a test about to read what it drew -- and
  anything that wants a hundred real frames has to let the browser have its
  animation frames, which is what the loop is and what `tools/bench` counts.
  A capture is not affected: it renders the scene into its own target.
- Any WebGPU `uncapturederror` is treated as a fatal device loss on
  purpose (fail loud); a shader that only warns must not ship.
- Pixel budget of 2,000,000 and DPR capped at 1.5 (`renderScale`).
- Interface text lives only in `index.html` and `src/page/Hud.ts`; `#manual`
  sits outside the HUD pill on purpose, because the pill dims and "the autopilot
  is off" must not. The dev panel's strings are its own: that rule is about the
  page a player reads.

## Terrain, sky and time

- The CPU heightfield is the only terrain truth; `heightAt` interpolates the
  exact rendered triangle (same diagonal as `buildGrid`), never bilinearly.
- The window carries `(h, w0, w1, w2)` and `slots` `(i0, i1, i2, baseTemp)` from
  one sampling: heights interpolate across the triangle, weights belong to the
  cell, and the **fourth slot byte is the climate temperature the snow line is
  drawn on** (`packBaseTemp`/`unpackBaseTemp`, over a range of two), which is
  what lets the ground shader draw a snow line the CPU's tree line agrees with:
  one line and not two. It was reserved for standing water, and that reservation
  could never have worked -- a lake needs a surface height, and a byte over this
  world's relief is four metres a step.
- Presence is the CPU's: every biome's hook is clipped to 0..1, normalised, and
  the three strongest are kept and renormalised. The GPU only reads the result,
  which is why a biome may have any presence function rather than a point in
  climate space. The climate sharpening (2.2) lives inside `climatePoint`, not
  in the sampler, or the borders move.
- A height hook sees the base height, never a neighbour's answer, and its change
  is clipped to `MAX_HEIGHT_DELTA` and weighed by its own slot, so the order of
  the registry cannot move the ground.
- Snow is a **world layer**, not a biome's: above `snowLineAt`, wandering with
  noise and rising on the faces that meet the noon sun, holding only where the
  ground is gentle enough (`SNOW.hold`, about 25 degrees) with bare alpine rock
  in a band under it. A biome opts out with `snow: false`, which was in
  `contract.ts` unread from M3a until now.
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
- The Milky Way is grown, not downloaded: `sky/GalaxyMatter.ts` is the whole of
  its shape -- a branching dust field and the stellar light behind it, in
  galactic coordinates, pure CPU and tested in Node. `sky/MilkyWay.ts` bakes
  that into an atlas and hands the dome a `galaxy` hook. **The bake is two
  million texels and 3.5 s, so it runs in a worker** and the atlas is allocated
  empty and filled when it arrives: an empty atlas is simply no galaxy, and the
  start pays nothing for a sky nobody sees until nightfall. The core's bearing
  is the other half -- 93 ms on the main thread, because the flight asks for it
  on its first step -- and `GALAXY_HEADING` is that bearing with a unit test
  asking the bake for it again, so there is one of it and not two.
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
- The figure is **one skin on sixteen bones**, not a pile of solids: `Skin.ts`
  is pure geometry (rings swept along a chain of joints, crowded where a joint
  bends, weighted symmetrically across it) and is tested in Node;
  `ProceduralHuman.ts` builds the `Bone` tree and two `SkinnedMesh`es -- the
  body and the head, separate only so the first person can hide the figure
  without hiding it part by part. The world's material needs no change:
  `setupPosition` adds `skinning(object)` for a skinned mesh by itself.
  Everything a chain looks like is its `profile` -- a half-width in metres at a
  share of its length, read through a monotone cubic so the stops are hit and
  nothing kinks between them -- and its `swatch`, and **a swatch band is only a
  band if a ring lands in it**: write the stops against the rings the chain
  samples at, not against a picture of a body. A cap is a dome of `CAP_RINGS`
  rings, never a fan to a point; a normal is tilted by the taper, or a thigh
  shades as a cylinder; limbs take twelve sides and the torso sixteen, because
  eight read as a stop sign from three metres. A `swatch` is a belt round the chain and
  nothing else, which is why a visor is a `patch` -- a colour for one place,
  taking the angle around the ring as well: a dark belt on a pale solid of
  revolution reads as a face from every bearing at once, and the head appears
  to turn to follow the camera.
- The figure's motion is **five shapes and the air**: box, delta, track, climb,
  and a turn laid over any of the others rather than instead of it. A shape is
  five directions a side (upper arm, forearm, thigh, shin, foot) and nothing
  else; the quaternions are read off them by the same chain rule the skeleton is
  built with, so a pose cannot drift out of step with the bones. Which one is
  worn is read off three axes -- flight angle, airspeed, bank -- and **every
  threshold in `POSE` has to be inside what the controller can actually fly**:
  it reaches `pitch -0.42..+0.56`, `rush 0.75..1.48` and `bank 0.47`, a test
  asks the controller itself, and a number written from a picture of a skydiver
  instead was a pose that existed and could not be reached. Nose up and slow are
  one state and not two, because a climb is paid for in airspeed; the climb
  sweeps the arms back like the track and is told from it by the knees.
- Every joint is a spring-damper the air pushes, substepped so `omega * h` stays
  under a half, slower the further it is from the chest; the shape weights are
  sprung per joint too, so a shape arrives shoulder first and ankle last.
  `dt <= 0` means "be there now" -- position and velocity both -- which is how
  the world places the figure before the first frame.
- The figure wears **one suit in one colour** (`avatar/Outfit.ts`), painted
  once at build. There was a wardrobe -- six suits, five markings, a panel --
  and the owner removed it: a marking read as camouflage. What covers the
  figure stays inside the palette envelope; the goggles, boots and gloves sit
  under its floor on purpose, and a test holds both halves. `Skin.ts` still
  writes `along` and `around` per vertex, which is what a UV map would be made
  of.
- The opening (`sim/Opening.ts`) is a pure function of how long it has been
  running: five acts, a title card and the pace of the day. It drives the
  flight with `fly(yaw, climb)`, which takes a **sign** as an arrow key does,
  so the script cannot ask the figure for anything the flight would refuse a
  person and the envelope holds through all of it. It owns the camera and the
  clock outright and hands both back in one place. It plays for a first flight
  only -- never for a resumed one, never under `prefers-reduced-motion` -- and
  any input at all ends it. The flight starts under the cloud deck because the
  climb is the act with something to see; a test holds the climb's length
  against the flight's own climb rate.
- Memory: `dreamfall-settings` and `dreamfall-resume`; every numeric field
  passes through `finite`, everything else by a direct type or equality
  check; `?seed` wins over a remembered one; a flight resumes only on its own
  seed; saves happen roughly every 2 s while flying, and on pause, a hidden
  tab and leaving, never before Begin.
- Sound starts on Begin (a gesture) and never before; pause and a hidden tab
  suspend the context; `AmbienceModel` holds the arithmetic so it is tested
  in Node. A biome's `ambience.layers` are mixed by the **height window's own
  three slots** under the flyer, so the sound and the ground never disagree
  about which country this is; `layerMix` then gates them, because the engine
  and not the biome decides that crickets are the night's and birds the day's,
  that a thing standing on the ground is gone by 450 m, and that the high wind
  only starts where they stop. Every fade in the graph runs on the **audio
  clock**, which a runner with no output device advances at a twentieth of
  wall time -- a test timing one against `setTimeout` is timing the runner.
- A biome's `ambience.fogTint` is the air over it, and `sky/Haze.ts` mixes it
  off the same three slots. It goes on **after** `atmosphere.update`, which
  copies the palette every frame, so the tint never accumulates; it goes on
  `uHorizon`, which here is the fog, the background and the dome's horizon at
  once, and on `uHorizonWarm` at six tenths of that, so the sun's side of the
  sky takes a little less of the tint than the fog does; it is capped at
  `MAX_HAZE` and fades out above the low air, because a biome may colour a
  horizon and never repaint one. An entry that stands **in** a country -- a
  settlement -- says `ambience.inherit`: its slot's weight goes to the biomes
  beside it in both the haze and the sound, and what it names is added on top,
  so a village is not a hole in the jungle's air with a bell in it.
- One wind (`uWind`) drives the painted clouds, the puffs, the cloud sea, the
  cloud shadows, and the clouds reflected in the water; shader time is still
  simulation time, so pause freezes the wind too.

## Scenery

- The ring (96 m cells, 2.6 km) rebuilds when the flight crosses a cell **and
  when `Origin` jumps**: the instances the pools wrote are relative to an origin
  that no longer exists. Positions are decided in the world, matrices are written
  in the local frame, and that is the only conversion.
- `populate` runs once per biome with more than 0.05 of a cell, so the density
  is scaled by that share and the cap of three trees per cell belongs to the kit,
  not to the hook. The biome says how much grows; the prop's own `place` says
  how it stands.
- `Obstacles` is filled by the ring and by nothing else, out of the baked shape's
  own top and radius -- never the entry's data, so a generator cannot understate
  how much sky it takes; a building is measured the same way, and its entry's own
  `obstacle` may ask for more room, never for less.
- Everything that decides what stands where is behind `ScenerySink` and runs in
  Node with a test; everything past it is instancing and is checked in the
  browser. Leaves and grass sway on `uniforms.time`, so a paused flight is a
  still forest.
- A tree, a prop and a building **fade** at the edge of the ring, through
  opacity against an alpha test, and stand at full height until they do. The
  original folded them into their own base instead, which is cheaper and reads
  as a tree sprouting out of the ground in front of the flight: the fog covers
  only a quarter of what stands at two kilometres, so that band is watched, not
  hidden. The ring's own ceiling (`MAX_RING_TREES`) is deliberately above a
  pool's (`MAX_TREES`): the sweep runs in row order and stops dead on it, so a
  ring that reaches its ceiling is a wood with one side missing.
- Grass is tufts, not blades: three painted cards crossed about an axis, in four
  baked forms an instance takes one of, because one card is a line seen from
  above and a meadow of them reads as streaks. Each form is a mesh of its own
  and `Grass.mesh` is the group of them.
- The grass window is **a set of tiles written a rim at a time**, and the whole
  of what makes that correct is that a tile's tufts are a pure function of its
  own coordinates: nothing in the placement may read where the flyer is, or
  approaching a meadow would change it. Crossing a cell drops the tiles that
  left, moves the last live tuft into each hole, and writes only the arrivals;
  only an origin jump rewrites everything, because only then are the matrices
  wrong. Three numbers move together: a tile is taken by its centre so a tuft
  may stand 45 m past `REACH`, which makes `GRASS_FADE[1] <= REACH - STEP - 45`,
  and `CEILING` has to clear the fade or crossing it hides visible grass.

## Settlements

- One lattice answers four questions -- where a site stands (the `lattice`
  presence hook), how wide it is, where the ground goes flat (the `plateau`
  height hook) and where the site is seated -- and none of them is a second
  draw. `Sites` calls the biome's own presence hook at the lattice centre and
  stands the settlement there, and both hooks take the `[min, max]` radius and
  draw the width out of `SITE_STREAM.radius`, the same stream the seat draws it
  from. Two draws on one cell agree about half the time, which is what two coins
  do, and the other half is a village on the slope beside its own flat square --
  or, when it is the width that disagrees, a town of four hundred metres
  standing in nine hundred metres of levelled, painted nothing.
  `SitesSpec` therefore carries no odds and no land line of its own.
- A plan is data -- roads, lines, lots, reservations, never geometry -- and a
  pure function of its site, which is what lets a village be built and tested in
  Node; the pools make the geometry out of it, as they do out of a scatter. A
  settlement is that plan plus its parameters and nothing else: one entry,
  `settlements/settlement.js`, makes the village and the town alike, and the
  parameters carry the id, the name and the landmark, because a factory that
  knew the word "village" could only ever make one.
- A plan may not plant and a scatter may not build: `kit.tree` inside a plan and
  `kit.structure` inside a `populate` both throw. What a plan can lay is a
  `kit.line` -- a fence, a wall, a hedge -- and it claims no ground, so it says
  where people drew a boundary and nothing about what grows inside it. It does
  not stand in for planting: a hedge squared off around a plot, on the argument
  that the scatter would fill it, came out an empty green frame lying on bare
  clay. A hedgerow beside a lane needs nothing inside it to read.
- A settlement **sows the ground it claims**: its own weight is what crowds the
  country's biomes out of it, so a settlement with no `populate` is a disc of
  bare paint as wide as its presence. No thinning toward the middle is needed --
  the lots' reservations already refuse a tree where the houses are -- but the
  density has to be a real fraction of the country's, because those reservations
  do less than they look: the village read 1.7 trees a hectare inside and 1.7
  outside until its own density came down to 0.3.
- `maxSlope` refuses a lattice **cell** whose centre is steep, measured across
  `LATTICE_SLOPE_PROBE`; `maxCut` fades the settlement where the ground has run
  too far from its centre, in metres. They were one number until a town asked,
  and over 900 m that departure is the terrain's relief and has almost nothing
  to do with the slope at the middle of it, so tightening the slope only made
  towns rare. A small settlement can leave `maxCut` unsaid.
- A settlement's `plateau.strength` is how much of a place it levels, and the
  answer for a wide one is not "all of it": a town at full strength on a coastal
  hill pulls its whole disc to the hilltop's height and reads from the air as a
  pale mesa with buildings on it. Half is a town. What a settlement needs is
  level streets, and a street has its own slope rule for the rest.
- Plans are built in a queue with a budget of 4 ms a frame and cached wider than
  the ring, so a plan survives the ring leaving it and coming back. Seating
  reads the sampler and needs no window; the plan reads the height window, so a
  site the window cannot answer for keeps its turn in the queue rather than
  laying its street over the other side of the world. The budget is checked
  before a plan, never during one: a town costs 19 ms and is built whole on
  purpose, because towns are 41 km apart and the machinery to slice one costs
  more than the frame does. How many buildings it has is a **share of what its
  streets offer** and never a cap on the count -- a cap walks the streets in the
  order they were laid and builds a town with one side missing, which is the
  fault the ring's own tree ceiling has -- and what the pools then refuse is
  counted in `SceneryStats.buildingsRefused`, because a `continue` is how a
  settlement quietly loses two hundred houses.
- `cell.occupied` reads the plans' reservations and roads out of a hash grid
  filled at every rebuild, which is why the forest keeps off the square and the
  road.
- Windows are **panes, not a belt**: `kit.windows` cuts a floor's band at its
  two heights and then slices it along the wall into panes with piers between
  them, `slabOf` taking one slice at a time (splitting at each plane in turn
  costs three times the triangles). Each wall -- a vertical plane, by its
  normal and its offset -- is sliced along **its own length** in its own frame
  and the pattern is centred on that wall, so a pier lands in every corner
  whatever bearing the wall stands at; cut along x and z instead, the tower's
  lantern had half a window on each side of both side corners. Which ones are alight after dark is three
  numbers from three places, because a house is baked once and stood up
  hundreds of times: `pane` is baked per window, `lit` is the lot's, `wake` is
  the settlement's share, and a pane is lit when `fract(pane + lit) <= wake`.

## Measuring

- `npm run bench` and `npm run parity` (`tools/bench/`, `tools/parity/`, one
  list of vantages in `tools/vantages.ts`): what a frame costs at five
  vantages of one seed, and what those five look like. Neither runs in CI,
  because a shared runner measures its own weather, and parity's references
  are gitignored, because a reference PNG is a photograph of one rasteriser.
  Both READMEs carry the method and the reasoning; `docs/perf-notes.md`
  carries the numbers.
- The median of a window of frames, and the minimum across rounds: both throw
  the machine away rather than the engine. The spec asks for the fifth
  percentile, which is right on a GPU and wrong on a rasteriser without one --
  there the intervals come out bimodal, because the loop sometimes reports two
  frames inside one sampling window, and the fast end is those artefacts rather
  than the engine. It read 7.3 ms where every frame took 3.3 s. The fifth
  percentile is kept beside the median for the machine that has a GPU.
- GPU milliseconds exist on WebGPU only. Asked for them, SwiftShader answers
  with a number that is not a frame time -- the same 2 827.99 ms at five
  different vantages -- so the engine does not ask, and the bench prints `--`.

## The dev panel

- `?dev=1` and nothing else pulls in `src/dev/Panel.ts`. It is a **view over
  `WorldDebug`** -- the same surface the browser tests read -- so it cannot show
  a number no test can assert, and it is written by hand rather than pulled from
  a control library that would ship in `dependencies` for a page only whoever
  builds this ever opens. Keep its value imports type-only: a value import from
  the engine drags a shared chunk out of the main bundle and the page pays a
  second request for a panel it never asked for.
- A layer switch may only take away. The engine writes visibility every frame
  for its own reasons (the cloud sea under the deck, the grass over its ceiling,
  the figure in the first person), so `layers.apply()` runs last in the world's
  update and hides what is switched off; switching one back on hands the object
  to the engine, which is free to hide it again.
- What a hook costs is measured, never argued about. `measureHeightHooks` times
  the window's own `sampleWindow` against a sampler with no registry at all, and
  each biome's share by leaving that one out -- a marginal cost, which is the
  honest answer when three of ten biomes get to speak for a texel. The soft
  budget (2 µs a texel) travels in the result, so a reader needs nothing else.

## Checking

`npm run check` (types, lint, format, tests, build) and `npm run test:e2e`.
Close any browser tab left open for testing when you're done.

## Maintaining this file

Only knowledge useful in nearly every session. Don't repeat code or the
design doc; point to the file instead. Prefer fixing an existing entry over
adding a new one.
