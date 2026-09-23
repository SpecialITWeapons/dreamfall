# The figure: what is done, what is not, and what lies in wait

Notes on `src/engine/avatar/`, written for whoever picks this up next. Written
in English beside `perf-notes.md` because it is the same kind of file:
measurements and the reasoning that goes with them, not an approved design.
The design is `docs/superpowers/specs/2026-09-14-dreamfall-design.md`, and the
rules that bind every change are in `AGENTS.md`.

There is **one figure**: the one drawn in Blender (`AuthoredFigure.ts`,
`figure.glb`), which every player gets. There used to be two -- the engine grew
a body of its own from a distance field (`ProceduralHuman.ts`, `Skin.ts`,
`Flesh.ts`), and the drawn one sat behind `?figure=glb` -- until the owner
retired the grown one. What they shared is still here: `Posture.ts` is the
figure's motion, written for the grown body and kept whole, and three faults in
a row found in one body turned out to be in it.

## What it wears

The file's suit and helmet were near-black textures -- the suit a flat
0x2a2a2a, the helmet black under 98 per cent of its vertices -- and the body
under them is trimmed to hands, feet and a neck, all bare skin. So the figure
was one dark silhouette with pale hands and feet, and barefoot. On load now
(`recolour`, `dress`, `cobble`, all before the bake):

- the suit and the helmet drop their textures for `OUTFIT.suit` and
  `OUTFIT.helmet`;
- the hands are painted `OUTFIT.gloves` off their own skin weights -- the
  whole arm chain, or the rim at the wrist stays skin and shows as a pale line
  round the cuff;
- a boot is grown over each foot: eighteen sections along it, each a rounded
  rectangle grown until the whole slab of toes is inside it, skinned from the
  nearest vertex of the foot. Painting the toes instead read as a sock with
  five toes in it.

The suit shows a fine lattice from the side in a low sun. It was there on the
black suit too and hid in the dark; the owner likes it, so it stays. It is
_not_ z-fighting with a lining: a one-sided suit shows it just the same, and
the suit has to stay two-sided anyway (`tools/figure/README.md`, `--two-sided`).

The figure casts a shadow, as the grown one did, and costs every player two
megabytes and about a fifth of a second behind the veil, where it used to cost
only whoever asked for it.

## Where things stand

Done and measured, with the numbers that say so:

|                                          | before      | after       |
| ---------------------------------------- | ----------- | ----------- |
| arm behind the shoulder line, peak       | 0.98 rad    | 0.45 rad    |
| ... time held past 0.5 rad               | 1.13 s      | 0 s         |
| cuffs, worst opening in any shape        | 126 mm      | 0.0 mm      |
| collar, worst opening                    | ~60 mm      | 3.7 mm      |
| armpit area, level flight (mean / worst) | 0.82 / 0.25 | 1.00 / 0.98 |
| armpit area, banked turn                 | 0.79 / 0.15 | 0.94 / 0.73 |
| thigh twist wrung in by the bake         | 154°        | 26°         |
| shin twist                               | 167°        | 11°         |

The twist is now a test, `tests/unit/authoredFile.test.ts`, and it reads a
little differently from the two rows above because it takes the **worst frame**
over the four corners of the envelope, flown on the controller, rather than one
pose: thigh 6°, shin 18°, foot 24° against the file, and 6°, 3° and 21° for the
forearm, the shin and the foot turned on the bone above them. Handed the old
fault back (`ROLL.hip` at `1`), it reads the thigh at 177° and fails.

Load cost of the authored figure: about 192 ms, once, behind the veil — 165 ms
of it the seam weld, 88 ms the rebind, before the weld's grid was made cheaper.

## Open, in the order I would take them

### 1. The shoulder and the elbow away from the box — corrected per shape

The owner saw it from the chase camera before any number did: in the track and
the climb the shoulder was an epaulette and the elbow a telescope, the forearm
stepping out of the upper arm. The cause was the one this section always
named — **the upper arm swings 120° between the box and the dive and 102°
between the box and the climb**, and the elbow the box holds bent at 116° is
nearly straight in both, so a skin cut in the box is far from home there.

What fixed it is none of the three ways out this section used to list. The
file is drawn with straight arms held out, much nearer the track and the
climb than the box is, so in those shapes the skin is skinned **from the file**
instead: at load, for the delta, the track and the climb, the difference
between the two skinnings is kept as a morph target and worn in the
proportion the shoulders wear that shape (`correction`, `CORRECTED`,
`Posture.shape`). Computed rather than sculpted, and exact at each shape; in
the box it is zero by construction. Measured on the suit around the shoulder,
as the share of its drawn area the worst twentieth of its triangles keeps:

| shape | box-cut | corrected |
| ----- | ------- | --------- |
| delta | 0.45    | 0.64      |
| track | 0.38    | 0.56      |
| climb | 0.42    | 0.56      |

and the worst stretch in the track from 2.2 to 1.6. Two other things were
measured and left: spreading the track's and the climb's arms wider from the
body changes these numbers by a hundredth, and smoothing the file's own
weights round the shoulder buys the box and the turn at the track's expense.
What is left — about a fifth of the area in the worst hundredth, in every
shape including the box — is the file's weights and would take a re-rig.

Still true of the rejected ways out: baking at the middle trades level flight
away, and the skeleton has no scapula.

### 2. The foot in a steep dive — looked at, and nothing there

The earlier version of this file carried a foot at 120° of twist and said
nobody had looked at it in a steep dive. Both have now been done, and the 120°
does not come back: measured against the file with the metric under Traps, over
the dive the controller can actually hold (`pitch -0.42` near `rush 1.48`), the
foot reads **10°**, and its worst anywhere in the envelope is 24°, in the box. Where
the 120° came from is not known; it was never committed as code, which is why
the metric is a test now.

The pictures agree with the number. `tools/figure/look.mjs` flies the dive and
photographs it from four sides: the toes are pointed along the leg, the soles
face the sky, and the big toe is on the inside of each foot, from above and from
the side. The climb and the turn look the same way. One thing from those
pictures that is not a fault and will look like one: from the side, at three
metres, the climb reads as a body broken at the hips. It is the lens. Measured
in the figure's frame, hips to neck sits 6° under the body's axis and the thigh
1° over it, where level flight holds the neck 11° over — a slight pike, which is
what `Torso`'s arch does when the flight is climbing rather than falling.

### 3. Things named and deliberately left

- The figure's materials do not go through the engine's `SoftLighting`.
- First person cannot hide only the head: it is one mesh with the body, and a
  skin cannot be culled part by part, so the first person hides the whole
  figure. The grown figure had the head as its own region for exactly this
  reason, and showed its own arms.
- The pelvis and the finger bones are not driven. Ten joints a side are.

### The head

It was there and could not be seen, for two reasons. It turned into a turn
about the figure's up, which for a body lying face down tips an ear toward a
shoulder and leaves the face on the ground; and it held the face straight
down the line of the spine in level flight, lifting the chin only in a dive.
Measured on the file, the face pointed at the ground under the chest in a
level glide and at exactly the same place in a hard turn either way.

Now (`GAZE` in `Posture.ts`, `flex` in `AuthoredFigure.ts`): the chin is held
up all the time, the face about 44° off straight down in level flight, more in
a dive and less in a climb, whose nose is already up; the head turns about the
line of the spine, about 35° into a hard turn; when nothing asks anything of
it, it glances about — a quick look, a hold, a third of them straight ahead,
all a pure function of the flight's clock — and a turn fades the glances out;
it nods into a change of flight angle before the body has made it; and the
flutter reaches the helmet. The skin is cut with the chin up, because `BAKE`
is level flight and level flight now has one.

## Traps, each of which cost a day

**An area ratio on a figure that rebinds is measuring itself.** `rebind` cuts
the skin at the box pose, so triangle area against the figure's own stored
geometry reports the box as perfect _whatever the bones are doing_ — including
a 154° wring baked straight into it. It reported the leg fix as a regression.
The metric that sees a wring is the **twist against the authored file**: load
the .glb twice, take each bone's rest orientation and direction from the
untouched copy, and decompose `now · rest⁻¹` into swing and twist about the
limb's axis. `tests/unit/authoredFile.test.ts` is exactly that. The upper arm
and the forearm are left out of its bound on purpose: the box holds the forearm
pointing at the head, which is a shoulder turned a right angle outward from the
T, so about a hundred degrees of their roll is real and asked for.

**Direction is not orientation.** The retarget puts every bone exactly where
the posture says — measured at 0.0° of error on all ten joints. The legs were
still wrong, because a limb's roll about its own axis is invisible to any test
that compares directions, and it is the number that twists the skin.

**A quaternion is not a rotation unless you build it as one.** `makeBasis(x, y,
z)` needs `z = x cross y` in that order; the other way the determinant is −1
and what you read off it is not a rotation. `setFromUnitVectors` gives the
_minimal_ rotation, which carries whatever roll falls out of the cross product
and turns as the target moves. A normalised linear blend of near-antipodal
directions is ill-conditioned — two shapes pulling opposite ways cancel and the
normalisation amplifies what is left.

**A glTF's bind pose is not the pose anything is flown in.** This body was
modelled in a T and never flies in one: the upper arm points 93° off the T in
level flight and no less in anything else. Check the actual bend before
believing a skinning artefact is a rigging bug.

**Order matters between the weld and the bake, and only one order works.** The
bake is itself a skinning, so two vertices a millimetre apart with different
weights are two vertices the bake pulls apart. Weld first. Welding afterwards
cannot even be made to work: at `BAKE` every bone matrix is the identity, so
changing a weight moves nothing.

**`bindMode` defaults to `attached`**, under which three recomputes
`bindMatrixInverse` from the mesh's live world matrix every frame. A rebind
that writes `boneInverses` and leaves `bindMatrix` alone is half a rebind, and
it put a fixture's skin 640 mm from where it had just been baked. Use three's
own `mesh.bind(mesh.skeleton)` — and bake every geometry _before_ binding any
of them, because all three meshes share one `Skeleton`.

**A change that looks like a clean win may be unpicking another bug.** Raising
the collarbone's share read as a fourfold gain on the armpit. It was measuring
a half-finished rebind whose distorted bind matrices the collarbone happened to
cancel. Against a correct rebind the armpit reads 0.04, 0.08 and 0.07 at a
quarter, a third and nearly a half — noise either side of a number the girdle
does not set. Finish one change before measuring the next.

## How to look at it

Unit tests in Node cover the arithmetic: `tests/unit/posture.test.ts` and
`tests/unit/authoredFigure.test.ts`, the latter over a fixture that is two
skinned meshes on a CMU skeleton where every bone wears a rest rotation of its
own — because on the real figure nothing starts at identity — and
`tests/unit/authoredFile.test.ts`, which is the one of them that loads the real
.glb, because a roll is the one thing a fixture cannot say anything about.

For anything you have to see, `tools/figure/look.mjs` does it in about half a
minute: with `npm run preview` running,
`node tools/figure/look.mjs OUT dive` (or `climb`, `turn`, `level`) flies the
controller to that corner of the envelope with `__world.step` behind a paused
loop and photographs the figure from behind, the side, below and above. Stepping
by hand is what makes it quick: waiting on `window.__world.frames` for a settle
of 40 frames under SwiftShader takes minutes. By hand it is `?seed=42&webgl=1`,
`window.__world.skipOpening()`, and a mouse drag orbits the chase camera. Never run two Chromiums at once, because a
software rasteriser wants the whole machine.

The container's Playwright browsers and `@playwright/test` can disagree about
version (it wanted `chrome-headless-shell-1243` against an installed `-1194`).
That fails at browser launch, before any test code runs. A config that extends
`playwright.config.ts` and sets `launchOptions.executablePath` to the chromium
that is actually in `/opt/pw-browsers/` runs the suite; do not run `playwright
install`. `look.mjs` takes the same path from `CHROMIUM`.
