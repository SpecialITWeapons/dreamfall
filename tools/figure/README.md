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
