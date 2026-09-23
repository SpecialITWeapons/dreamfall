# The figure's file

The figure is `src/engine/avatar/figure.glb`, a rigged body the owner brought
out of Blender, and the engine flies it (`AuthoredFigure.ts`). The engine used
to grow a body of its own from a distance field, and this directory used to
bake that one in Blender too; both are gone, and `docs/figure-notes.md` has the
history. What is left here reads the file, trims it, and looks at it flying.
None of it ships: `tools/` is not in the bundle.

## Looking at it

```sh
npm run build && npm run preview                 # in another shell
node tools/figure/look.mjs OUT_DIR dive          # or climb, turn, level
```

Flies the controller to that corner of the envelope behind a paused loop and
photographs the figure from behind, the side, below and above, in about half a
minute under SwiftShader. `CHROMIUM=/path/to/chrome` when Playwright's own idea
of a browser is a version the machine does not have.

And the file on its own, with nothing of the engine's done to it -- which is
how the helmet's visor turned out to be in the texture all along:

```sh
npx vite                                         # then open:
# /tools/figure/view/?file=/src/engine/avatar/figure.glb&yaw=30&dist=0.9&target=1.52
```

## Reading and trimming it

These three read the file, and none of them needs Blender. `export_authored.py`
is the one that does: it exports a `.blend` with the settings the engine can
read, and says why each is set.

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
