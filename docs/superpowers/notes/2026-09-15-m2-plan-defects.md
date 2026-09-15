# M2 plan defects — permanent record

Copied from the SDD workspace's `plan-defects.md` after the final whole-branch review (opus)
independently re-verified every entry below and after the owner resolved the one remaining
open question. Kept here, outside the git-ignored `.superpowers/` workspace, so the audit
trail survives past the plan's execution.

# Plan defects found during M2 execution — for later verification by a more capable model

Each entry: where the plan's mandated text was numerically/internally inconsistent, what
I changed it to (and why), and what a stronger reviewer should specifically re-check.
This file is NOT part of the normal task review loop — it is a standing punch list to
hand to the final whole-branch reviewer (dispatched on the most capable model) so real
mistakes in my on-the-fly fixes get caught, since I'm applying these corrections without
stopping to ask each time (per owner's instruction 2026-09-15).

---

## Task 1 — Obstacles.ts / tests/unit/obstacles.test.ts

Plan text (docs/superpowers/plans/2026-09-15-m2-lot.md lines ~93-104) has an
implementation using strict `<` for disk-coverage tests, paired with a test that is
mathematically inconsistent with ANY single choice of `<` vs `<=`, and independent of
that choice, two assertions in the first `it` block flatly contradict the stated obstacle
positions/radii. Obstacles: A = {x:100,z:100,top:40,radius:6}, B = {x:104,z:100,top:55,radius:3}.

1. `expect(o.floorAt(112, 100, 5)).toBe(55)` — B's boundary is exactly at distance 8
   (radius 3 + pad 5); this is a boundary TIE, only satisfiable with an inclusive `<=`
   comparison. The implementation as given in the plan uses strict `<`, which would
   exclude it (-Infinity, since A is also out of range at distance 12 > 11).
   **Fix applied:** changed both `floorAt` and `near` in Obstacles.ts to use `<=` instead
   of `<` for the disk-coverage test (point exactly on the disk edge counts as covered).
   **Verified by the final review:** inclusive boundary is safe — no consumer
   (`FlightController.floorAt`, `terrainAhead`) assumes an exclusive boundary anywhere.

2. `expect(o.floorAt(100, 112, 5)).toBe(40)` — distance from query point to A is 12,
   but A's own padded radius is 11 (6+5), so A cannot cover it under `<=` either
   (12 > 11, not a tie). This looks like a copy-paste of the literal number `112` from
   the preceding assertion (which tested B's boundary at 104+3+5=112) without
   recomputing for A's own radius (100+6+5=**111**).
   **Fix applied:** changed the query z-coordinate from `112` to `111` (A's own
   boundary, mirroring the pattern of the previous assertion but for A's radius 6
   instead of B's radius 3). With `111`: distance to A = 11, exactly A's padded radius
   → covered under `<=` → top 40. Matches the expected value.
   **Verified by the final review:** confirmed 111 is exactly right, mirroring the x-axis
   assertion for obstacle B.

3. `expect(o.floorAt(100, 100, 0)).toBe(55)` — with pad 0, B's bare radius is 3, but the
   query point (A's own center) is distance 4 from B's center, so B cannot cover it
   under any boundary rule (4 > 3, not a tie). Only A covers (distance 0 < 6), giving 40.
   Expected value `55` looks like it was copied from the sibling assertion two lines
   above (`floorAt(100, 100)` with default pad 5, which legitimately gives 55).
   **Fix applied:** changed expected value from `55` to `40`.
   **Verified by the final review:** confirmed correct, intent preserved.

4. Second `it` block, `expect(o.near(-250, 500, 5, out).map((t) => t.top)).toEqual([32])`
   — obstacle E = {x:-300,z:500,top:32,radius:40}. Distance from query point (-250,500)
   to E is 50; `reach(5) + radius(40) = 45`. 50 > 45 by a clear margin (not a boundary
   tie) under any comparison rule, so E cannot be "near" that point.
   **Fix applied:** changed the query x-coordinate from `-250` to `-255` (exact tie:
   distance becomes 40+5=45, matching `reach+radius` exactly, consistent with using
   inclusive `<=` elsewhere in this file).
   **Verified by the final review:** confirmed the tie is exact in IEEE754 (both sides
   are integer squares), not numerically fragile.

**Net implementation change from the plan's literal code:** `Obstacles.ts`'s `floorAt`
and `near` use `<=` where the plan's snippet had `<`. Everything else (structure, hash
grid, cell math, `add`/`clear`/`size`) matches the plan verbatim. The final review also
added a cheap `if (size === 0) return;` guard at the top of `scan()`, since the registry
is always empty in M2 (trees arrive in M3) and the un-guarded box scan was wasting
~2700 Map lookups per frame for nothing.

---

## Task 2 — tests/unit/skyPulls.test.ts / src/engine/flight/angles.ts

Plan text (task-2-brief.md, Step 1 test / Step 3 implementation) gives `wrapAngle` as
`a - Math.round(a / (Math.PI * 2)) * Math.PI * 2`, documented as wrapping "into (-pi, pi]",
paired with a test asserting `wrapAngle(Math.PI * 3)` is close to `Math.PI`.

Computed by hand (and confirmed with `node -e`) that this is wrong: `Math.PI * 3 / (Math.PI * 2)`
is exactly `1.5`, and JS's `Math.round` breaks exact `.5` ties toward `+Infinity`
(`Math.round(1.5) === 2`, `Math.round(0.5) === 1`, `Math.round(-0.5) === -0`), so the given
implementation actually returns `-Math.PI` for `wrapAngle(Math.PI * 3)` — a difference of
`2*Math.PI` from the test's expected `Math.PI`, not a floating-point rounding gap. The same
tie-break also makes `wrapAngle(Math.PI)` itself return `-Math.PI`, and `wrapAngle(-Math.PI)`
return `-Math.PI` too (self-consistently). So the implementation's true codomain, given JS's
`Math.round`, is `[-pi, pi)`, not the doc comment's `(-pi, pi]`.

**Fix applied:** changed the expected value in `tests/unit/skyPulls.test.ts` from
`expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 9)` to
`expect(wrapAngle(Math.PI * 3)).toBeCloseTo(-Math.PI, 9)`. The final review's fix wave also
corrected `angles.ts`'s doc comment from `(-pi, pi]` to `[-pi, pi)` (implementation unchanged).

**Verified by the final review, more strongly than originally claimed:** this is bit-exact,
not float noise — `3π` and `2π` are both exact in the float64 mantissa, their ratio is exactly
`1.5`. Grepped every `wrapAngle`/`headingOf` call site in `src/` — none feed a literal odd
multiple of π, so the (now-fixed) doc-comment inaccuracy had zero behavioral risk throughout.

---

## Task 3 — tests/unit/simulation.test.ts

Plan text (task-3-brief.md, Step 5, `simulation.test.ts`'s second `it` block) hardcoded a
400-step (20s) resume-and-release test. `createSimulation` starts a fresh flight's day-clock
phase at `0.3` (an intentional "starts in the morning" design choice). `SkyPulls.release()` is,
by Task 2's own design, a no-op unless a sky-pull event is currently active.

Computed by hand, confirmed with a scratch script calling the real `findSkyEvents`/
`skyEventWeight` on `createDayClock({ phase: 0.3 })`: at `t = 20s` (400 steps), day-clock phase
is only `≈0.3333` — broad daylight, no active event — so `release()` is a guaranteed no-op and
the test's `expect(b.pulls.released).toBe(true)` fails every run, deterministically, with no
implementation bug.

**Fix applied:** changed the step count from `400` to `6000` (20s → 300s of elapsed sim time)
and the three dependent literals accordingly. 300s sits inside the moonrise event's window from
a phase-0.3 start.

**Corrected numbers (the original write-up here had an arithmetic error the final review
caught):** the real moonrise window, from a phase-0.3 start, is **≈270.60s to ≈324.45s**,
immediately followed by sunset's window, **≈324.45s to ≈368.60s**. (The original text here
described the combined moonrise+sunset span, ~[271s, 369s), as if it were the moonrise window
alone.) At `t=300s` the real trailing margin — until moonrise's *own* window ends — is
**≈24.4s** (488 steps at `MAX_STEP=0.05`), not the ~69s originally claimed. The test remains
safe either way; only the justification text was wrong, not the fix or the test's actual pass
margin.

Also flagged here and fixed in Task 12 (see below): `SkyPulls.restore()` didn't prime
`sunward.event`, so a resume mid-event could briefly re-pull for one tick.

**Verified by the final review:** fix confirmed correct via independent resimulation; the
window-numbers correction above is the final review's own finding, applied in the post-review
fix wave.

---

## Task 9 — src/engine/sky/Wind.ts / tests/unit/wind.test.ts

Plan text (task-9-brief.md, Step 3) computed `windFromSeed`'s `heading` as a raw
`u * Math.PI * 2` (range `[0, 2π)`), paired with a test asserting
`Math.atan2(a.x, a.z)).toBeCloseTo(a.heading, 9)` — `Math.atan2`'s range is `(-π, π]`, so for
roughly half of all seeds the two differ by exactly `2π`. Flagged by the owner before
implementation as a likely defect; confirmed at seed 42 with the real `hash2`: raw
`heading ≈ 6.000449`, `atan2 ≈ -0.282736`, differing by exactly `2π`.

**Fix applied:** wrapped `heading` in `windFromSeed` with `wrapAngle` (from Task 2's
`flight/angles.ts`) so `Wind.heading` follows the same `(-π, π]`-ish convention as the rest of
the engine's headings. `x`/`z` are unaffected (`sin`/`cos` of a wrapped angle are numerically
identical to the unwrapped one). Test left as given in the brief — no test-side change needed.

**Verified by the final review, with a new finding beyond the original write-up:** confirmed
the exact `2π` discrepancy directly from real `hash2` outputs for seeds 42/43/7. Additionally
confirmed **`Wind.heading` is never read anywhere in `src/`** — only `.x`/`.z` are consumed
(`World.ts` → `uWind` uniform, `Clouds.update`) — so the blast radius of the original bug,
had it shipped unfixed, would have been exactly zero in M2 (a latent landmine for whoever
reads `.heading` first, not an active bug).

---

## Task 12 — src/engine/flight/SkyPulls.ts, src/main.ts (pre-existing bugs, not plan-text defects)

Unlike every other entry, these two are pre-existing bugs in already-merged Task 2 and Task 4
code, found during review and deliberately deferred to Task 12 to fix where the consuming/
wiring code lives.

### 1. `SkyPulls.restore()` never primed `sunward.event`

`restore(released)` only set `sunward.released`; a freshly constructed `SkyPulls` starts with
`sunward.event = null`, so the first `update()` after a resume mid-event would see "the event
changed" and reset `released` back to `false` for one tick.

**Fix applied:** factored the event-selection loop out of `update()` into a shared
`strongestEvent(phase)` helper, called from both `update()` (unchanged behavior) and from
`restore()`, which now primes `sunward.event` from `clock.phase` before setting `released`.
Regression test added to `tests/unit/skyPulls.test.ts`.

**Verified by the final review:** confirmed correct on the full final codebase, tracing the
exact construction order in `Simulation.ts` that makes `restore()`'s phase read match the
first `update()`'s phase exactly.

### 2. `Steering.pointerDown` had no guard against an overlapping second button

Present verbatim in Task 4's own brief: a second pointer button going down mid-drag would
overwrite `dragButton`, leaving `FlightController.held` stuck `true` forever after the buttons
were released.

**Fix applied (round 1):** guarded in `main.ts`'s DOM wiring — `if (steering.dragging) return;`
before forwarding `pointerdown` to `steering.pointerDown(...)`.

**Fix round 2 (after task review):** the round-1 guard prevented `dragButton` corruption but
not a related defect it didn't originally cover — releasing the *untracked* button first would
still end the tracked drag early (`endDrag` fired unconditionally on any `pointerup`). Fixed by
tracking `activePointerId`/`activeButton` and only forwarding a `pointerup` to `steering` when
it matches the button actually driving the drag.

**Verified by the final review:** confirmed this final version is *more* complete than this
file's own original write-up described — it also covers "wrong button released first," which
the initial fix didn't, and which is now covered by an e2e regression test.

---

## Task 13 — tests/e2e/smoke.spec.ts (pre-existing test, not this task's own new text)

Three defects in the same pre-existing M1 test block ("the world stands on the heightfield"),
stale leftovers from before the M2 flight-model rewrite (Task 3), never revisited since.

1. **`minClearance` threshold** (this task's own mandated fix): `30 → 25`, matching Task 3's
   `MIN_CLEARANCE`. `start.clearance`'s separate, pre-Begin assertion did not need the same
   change (unrelated to `MIN_CLEARANCE`).

2. **`Math.hypot(flown.x, flown.z) > 4400` net-displacement threshold** (root-caused by a peer
   Claude session working the same repo, handed off mid-task): Task 3's ported "wander" heading
   noise, combined with the scripted-heading-hold intro being deferred to a later milestone,
   means net displacement comes in well under path length for any seed (18-seed survey,
   ratio 0.16-0.75, never near the ~0.98 the old assertion needed) — not implementation bugs.
   **Fix applied:** lowered the threshold (ultimately to `3000`, after the loop length itself
   changed for defect 3 below).

3. **`Math.hypot(flown.origin.x, flown.origin.z) > 0`** (found independently, same root cause):
   with the real wander drift, seed 42's origin never shifts within the test's original
   2250-step window. **Fix applied (round 1):** extended the loop to 8000 steps, past the
   step-~6501 point where the origin first legitimately shifts. **Fix applied (round 2, after
   whole-branch review):** superseded that with a direct, single-step proof — mutate
   `WorldDebug.state.x` past `Origin`'s 4000m threshold and step once, proving the
   `World → Origin` wiring deterministically, independent of any seed's emergent flight path
   (`Origin.shiftFor`'s own algorithm already has a direct unit test).

**Verified by the final review:** all three confirmed correct with comfortable, non-borderline
margins. One residual caveat noted (not fixed — low severity): the surviving
`hypot(flown.x, flown.z) > 3000` net-displacement assertion still depends on seed 42's emergent
8000-step trajectory, the same class of fragility the origin-shift fix eliminated for its own
assertion — worth revisiting if that flight model is ever rebalanced.

---

## Post-implementation: final whole-branch review findings (opus, 2026-09-15)

The full final review is preserved in the SDD workspace's `final-review.md` (not copied here in
full — it also covers 19 Minor findings and detailed strengths, none blocking). Two items worth
recording permanently:

- **`AGENTS.md` inaccuracy, fixed:** the docs claimed wind drives the water's waves; it doesn't
  (`Water.ts`'s `uWind` usage only feeds the reflected-sky/cloud-shadow terms, not actual wave
  motion). Corrected to describe only what's actually wired.

- **FPP forearms — a real plan defect (owner decision, not fixed in code):** hand-computed
  body-frame geometry (taken verbatim from the plan) put the avatar's arms behind the FPP
  camera's eye plane in the neutral pose, so `fppHands` (enabled by default per spec §9) would
  show nothing in that pose. No single task's reviewer could catch this — the geometry is Task 6,
  the eye position is also Task 6, the FPP camera is Task 5, and assembly is Task 11. Owner's
  call (2026-09-15): the arms ARE visible when looking around in FPP (confirmed in the actual
  running app), just awkward at the extremes ("the last segment looks comic") — left as-is for
  now, since the whole avatar silhouette is expected to be revisited in a later milestone.
