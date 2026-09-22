# The figure, baked

`Skin.ts` sweeps a tube along each chain of the figure and merges the buffers.
That is cheap, it is tested in Node, and it has one fault no amount of tuning
removes: an arm is a tube standing inside the slab of the chest, so a shoulder
is where two surfaces intersect rather than a place on one surface. From above
it reads as limbs plugged into a body.

This bakes the same figure -- the same numbers, the same rest pose -- as **one
continuous skin**, using Blender's skin modifier, and writes it as a `.glb`.

Blender is a **build-time** tool. It is not a dependency of the page, it is not
in `package.json`, and CI never runs it: the bake is committed and the page
loads the result. The scripts exist so that the figure can be changed in one
place -- the engine -- and rebaked, rather than being drawn a second time by
hand somewhere else.

## Baking

```sh
npm run figure:dump                     # the engine writes figure.json
python3 -m venv .venv && .venv/bin/pip install bpy   # Blender as a module, ~1 GB
.venv/bin/python tools/figure/bake.py               # figure.json -> figure.glb
.venv/bin/python tools/figure/bake.py --preview /tmp/look   # and three pictures of it
```

`bpy` is Blender itself, headless, with no window and no GUI; the wheel wants
the Python it was built for (5.0 wants 3.11). `bake.py` never touches the
engine's source and `figure.dump.ts` never touches Blender: `figure.json` is
the whole of what passes between them.

## What is in figure.json

Bones with their rest positions and parents, in the order the skeleton keeps
them -- which is the order the glTF's joints come out in, so the engine can bind
the baked mesh to the skeleton it builds itself -- and every chain sampled along
its length: where it runs, how thick it is there, and which swatch it wears.

## What the bake is worth watching for

- **Branch smoothing** is how a shoulder stops being a corner and also how a
  shoulder stops being a shoulder. At 0.3 the girdle and the waist were both
  gone and the figure was a sausage; 0.1 keeps them.
- **Colour** in Blender is linear and an outfit is written in sRGB. Handed over
  as one another, a navy suit renders as a pale blue ghost.
- **A vertex belongs to the chain whose surface reaches it**, not to the nearest
  point of the skeleton: the head is a fat chain on a short axis and by plain
  distance it claimed the top of both shoulders, so the figure wore a white
  yoke.
- Catmull-Clark pulls a square section in by about a third, so the engine's own
  half-widths are scaled up by 1.45 before they are handed to the modifier.

## The other figure: one somebody drew

The owner brought a rigged body out of Blender, and these three read it. None
of them needs Blender, and none of them ships: `tools/` is not in the bundle.

```sh
python3 tools/figure/check_glb.py FIGURE.glb        # what would stop it working
node    tools/figure/load_glb.mjs FIGURE.glb        # whether three accepts it
python3 tools/figure/trim_glb.py in.glb out.glb ... # cut what nobody will see
```

`check_glb.py` reads the container with the standard library and exits
non-zero on a fault. `load_glb.mjs` puts the file through three's own
GLTFLoader and skins it, because a container can be valid and still draw
nothing -- the first export loaded with no error at all and collapsed into a
30 cm crumple, because all 31 of its bones came back with `parent === null`.

`trim_glb.py` is the one with options; `--help` lists them. What it took off
the first figure, and why each is worth having written down:

- **7 681 triangles of naked body** provably enclosed by the suit, by ray
  parity along three axes. One ray is enough for a closed surface and none of
  these are closed -- a suit has a hole at each wrist, each ankle and the neck
  -- so a single ray leaves through one and calls a hip "outside".
- **A collar of two rings around every cut.** Flush at the hole is right to the
  letter and wrong at the edge of it.
- **Two eyeballs and a 600 KiB iris**, four centimetres behind a helmet with no
  visor opening. No enclosure test will ever say so, because that shell is
  open; `--drop-mesh` is for what only a person can see.
- **A texture carried twice**, once as RGB and once as RGBA, which comparing
  bytes does not catch.
- **The transmission and the alpha.** Both materials came out as glass with a
  base colour whose alpha was 0.17 across every texel, which draws the figure
  19 per cent visible. Blender showed none of it.

Two of its switches exist because of faults this made rather than found.

`--two-sided NAME` keeps a material double-sided, and the suit needs it. A
sleeve and a trouser are open tubes with five millimetres of clearance over
the wrist and the ankle; culled inside, a grazing angle looks straight through
the cuff at the sky, and there is a bright line between the trouser and the
foot. Turning it off is right for a closed surface and wrong for a tube.

`--tint NAME=RRGGBB` paints a base colour, and the skin needs it: the authored
`skora` carries no base colour at all, so glTF's default white made the hands,
neck and feet read as bone. The hex is sRGB the way a person picks it and glTF
wants linear -- `0xd9a984`, the engine's own skin, renders at about
`(101, 87, 70)` in a low sun, which is the number to tune against rather than
the one you typed.
