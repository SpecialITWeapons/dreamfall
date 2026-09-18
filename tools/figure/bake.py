"""Bake the figure into one continuous skin, in Blender, headless.

    <venv>/bin/python tools/figure/bake.py [--preview]

What this buys over `Skin.ts`, and the only reason it exists: `Skin.ts` sweeps a
tube along each chain and merges the buffers, so an arm is a tube standing
inside the slab of the chest and the shoulder is where they intersect. Blender's
skin modifier grows **one surface** over the whole skeleton, so a shoulder is a
junction of that surface. Nothing else about the figure changes: the numbers are
the engine's own, read from `figure.json`, which `npm run figure:dump` writes.

Blender is a build-time tool and never ships: the bake is committed as a .glb
and the page loads that. See tools/figure/README.md.
"""

import json
import math
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

HERE = Path(__file__).resolve().parent
FIGURE = json.loads((HERE / 'figure.json').read_text())
OUT = HERE / 'figure.glb'

# The engine's frame is x left, y up, z ahead. Blender is z up, -y forward, and
# its glTF exporter writes (x, y, z) out as (x, z, -y). Going in the other way
# is what keeps the baked figure facing the same direction the engine's does.
def to_blender(v):
    return Vector((v[0], -v[2], v[1]))


def bone_rest():
    return {b['name']: to_blender(b['rest']) for b in FIGURE['bones']}


def build_skin(step=2):
    """The edge skeleton, one strand per chain, with a radius on every vertex."""
    mesh = bpy.data.meshes.new('figure')
    obj = bpy.data.objects.new('figure', mesh)
    bpy.context.scene.collection.objects.link(obj)
    bm = bmesh.new()
    radius = {}
    swatch = {}
    placed = []  # (vertex, position) for joining a limb to the body

    spine = []

    def nearest(point):
        """The point of the body a limb grows out of. Only the spine is offered:
        an arm allowed to find the nearest vertex of anything would sooner or
        later join the other arm, and one surface is not the same as one body."""
        best, at = None, 1e9
        for vert, pos in spine:
            d = (pos - point).length
            if d < at:
                best, at = vert, d
        return best

    for index, chain in enumerate(FIGURE['chains']):
        samples = chain['samples'][::step]
        if samples[-1] is not chain['samples'][-1]:
            samples.append(chain['samples'][-1])
        verts = []
        for sample in samples:
            at = to_blender(sample['at'])
            vert = bm.verts.new(at)
            # The skin modifier takes a half-width across each of two axes, and
            # `flatten` is exactly that: wider one way than the other. What it
            # cannot do is follow the profile between two vertices, so the chain
            # is sampled finely enough that it does not have to.
            radius[vert] = (sample['radius'] * chain['flatten'], sample['radius'] / chain['flatten'])
            swatch[vert] = sample['swatch']
            verts.append((vert, at))
        for (a, _), (b, _) in zip(verts, verts[1:]):
            bm.edges.new((a, b))
        # The spine is laid first and everything else grows out of it: an arm
        # joined to the nearest point of the body is what makes one surface out
        # of six chains, and is the whole difference from the engine's own skin.
        if index > 0:
            root = nearest(verts[0][1])
            if root is not None and not any(
                set(e.verts) == {root, verts[0][0]} for e in bm.edges
            ):
                bm.edges.new((root, verts[0][0]))
        if index == 0:
            spine.extend(verts)
        placed.extend(verts)

    order = list(bm.verts)
    bm.to_mesh(mesh)
    bm.free()
    return obj, mesh, [radius[v] for v in order], [swatch[v] for v in order]


def skin_and_smooth(obj, mesh, radii, levels=1):
    # Smoothing a branch is how a shoulder stops being a corner, but it is
    # also how a shoulder stops being a shoulder: at 0.3 the girdle and the
    # waist were both gone and the figure was a sausage.
    obj.modifiers.new('skin', 'SKIN').branch_smoothing = 0.1
    layer = mesh.skin_vertices[0].data
    # Catmull-Clark pulls a square section in by about a third, so the engine's
    # own half-widths come out that much too thin unless they are scaled here.
    for i, (rx, ry) in enumerate(radii):
        layer[i].radius = (rx * 1.45, ry * 1.45)
    layer[0].use_root = True
    obj.modifiers.new('sub', 'SUBSURF').levels = levels
    bpy.context.view_layer.objects.active = obj
    for name in ('skin', 'sub'):
        bpy.ops.object.modifier_apply(modifier=name)
    bpy.ops.object.shade_smooth()


def build_armature(rests):
    armature = bpy.data.armatures.new('figure')
    rig = bpy.data.objects.new('figure_rig', armature)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    children = {}
    for bone in FIGURE['bones']:
        children.setdefault(bone['parent'], []).append(bone['name'])
    made = {}
    for bone in FIGURE['bones']:
        edit = armature.edit_bones.new(bone['name'])
        head = rests[bone['name']]
        kids = children.get(bone['name'], [])
        # A bone reaches to its child; one with no child borrows its parent's
        # direction, because a bone of no length is not a bone at all.
        if kids:
            tail = rests[kids[0]]
        elif bone['parent']:
            back = head - rests[bone['parent']]
            tail = head + (back.normalized() if back.length > 1e-6 else Vector((0, 0, 0.08))) * 0.09
        else:
            tail = head + Vector((0, 0, 0.1))
        if (tail - head).length < 1e-4:
            tail = head + Vector((0, 0, 0.05))
        edit.head, edit.tail = head, tail
        made[bone['name']] = edit
    for bone in FIGURE['bones']:
        if bone['parent']:
            made[bone['name']].parent = made[bone['parent']]
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


def paint(mesh, swatches, radii_order_count):
    """One colour per vertex, from the swatch the engine's own chain wears."""
    outfit = FIGURE['outfit']
    def linear(c):
        # Blender's colour attributes are linear light; the outfit is written in
        # sRGB, as every hex colour is. Handing one over as the other is what
        # turned a navy suit into a pale blue ghost in the first preview.
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    def rgb(name):
        value = outfit[name]
        return tuple(linear((value >> shift & 255) / 255) for shift in (16, 8, 0)) + (1.0,)

    # The skin modifier made new vertices; each takes the swatch of the nearest
    # point of the edge skeleton it grew from.
    points = []
    for chain in FIGURE['chains']:
        for sample in chain['samples']:
            points.append((to_blender(sample['at']), sample['radius'], sample['swatch']))
    layer = mesh.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
    for i, vertex in enumerate(mesh.vertices):
        at = vertex.co
        best, near = points[0][2], 1e9
        for point, radius, name in points:
            # Not the nearest point of the skeleton but the nearest *surface*:
            # a vertex belongs to the chain whose own thickness reaches it. By
            # plain distance the head, which is a fat chain with a short axis,
            # claimed the tops of both shoulders and the figure wore a white
            # yoke.
            d = abs((point - at).length - radius)
            if d < near:
                best, near = name, d
        layer.data[i].color = rgb(best)


def preview(obj, out):
    """Three pictures of what was baked, because a .glb is not a look at it."""
    scene = bpy.context.scene
    light = bpy.data.objects.new('key', bpy.data.lights.new('key', 'SUN'))
    light.rotation_euler = (0.85, 0.15, 0.7)
    light.data.energy = 5
    scene.collection.objects.link(light)
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.35, 0.6, 0.78, 1)
    scene.world = world
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 40
    scene.render.resolution_x, scene.render.resolution_y = 760, 560
    camera = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(camera)
    scene.camera = camera
    bpy.context.view_layer.update()
    box = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = Vector((min(b.x for b in box), min(b.y for b in box), min(b.z for b in box)))
    hi = Vector((max(b.x for b in box), max(b.y for b in box), max(b.z for b in box)))
    target = (lo + hi) / 2
    span = max((hi - lo).x, (hi - lo).y, (hi - lo).z)
    for name, (az, el) in {'above': (0.2, 1.1), 'side': (1.55, 0.12), 'front': (3.1, 0.25)}.items():
        at = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
        camera.location = target + at * span * 2.2
        camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = f'{out}-{name}.png'
        bpy.ops.render.render(write_still=True)
        print('preview', name)


def wear(obj):
    """A material that shows the vertex colours, so a preview is of the outfit."""
    material = bpy.data.materials.new('suit')
    material.use_nodes = True
    tree = material.node_tree
    attribute = tree.nodes.new('ShaderNodeVertexColor')
    attribute.layer_name = 'Col'
    principled = tree.nodes['Principled BSDF']
    principled.inputs['Roughness'].default_value = 0.65
    tree.links.new(attribute.outputs['Color'], principled.inputs['Base Color'])
    obj.data.materials.append(material)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rests = bone_rest()
    obj, mesh, radii, swatches = build_skin()
    skin_and_smooth(obj, mesh, radii)
    paint(mesh, swatches, len(radii))
    wear(obj)
    rig = build_armature(rests)

    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    try:
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    except RuntimeError as error:
        print('bone heat failed, falling back to envelopes:', error)
        bpy.ops.object.parent_set(type='ARMATURE_ENVELOPE')

    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    rig.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUT),
        export_format='GLB',
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_skins=True,
        export_animations=False,
        export_materials='EXPORT',
    )
    print(f'baked {len(mesh.vertices)} vertices, {len(mesh.polygons)} faces -> {OUT}')
    if '--preview' in sys.argv:
        preview(obj, sys.argv[sys.argv.index('--preview') + 1])


main()
