"""Export an authored figure from a .blend, headless, with settings the engine can read.

    blender --background FIGURE.blend --python tools/figure/export_authored.py -- --out tools/figure/authored.glb

Or, with Blender as a module (see tools/figure/README.md for the venv):

    <venv>/bin/python tools/figure/export_authored.py --blend FIGURE.blend --out authored.glb

Why this exists rather than a line in a README: the first export of the figure
came out with `Flatten Bone Hierarchy` on, which writes every bone as a root
node carrying an absolute world transform. The bones keep their positions and
their lengths, so the file looks right in a viewer that only draws the bind
pose -- and cannot be posed at all, because rotating the spine no longer moves
the head. Three non-default switches did it, and a checklist a person follows
by hand gets two of three right on a tired evening. This gets them right every
time and says what it did.

The settings that matter are at the top, with the reason for each. Everything
else is the exporter's own default and is written down only where the default
would surprise someone reading this later.
"""

import argparse
import sys
from pathlib import Path

import bpy


# The exporter's switches, and why each is where it is. A `None` means "leave
# the exporter's default alone"; anything else is set explicitly, because a
# default that is right today is not a promise about the next release.
SETTINGS = {
    # --- the skeleton -------------------------------------------------------
    # The whole point. On, every bone is written as a root node holding an
    # absolute world transform and nothing is a child of anything: the rig
    # cannot be posed. This is what broke the first export.
    'export_hierarchy_flatten_bones': False,
    # A leaf node per bone, to carry the bone's length. The engine reads the
    # length from the child joint's position and has no use for 31 extra
    # nodes; with the hierarchy flattened they also made every bone look like
    # a leaf, which is how the fault hid.
    'export_leaf_bone': False,
    # The armature object is the parent the bones hang under. Removed, the
    # joints have nowhere to be, which is why the first export has them
    # missing from the scene graph entirely.
    'export_armature_object_remove': False,
    # Export the bind pose, not whatever pose the armature happens to be in.
    'export_rest_position_armature': True,
    'export_skins': True,
    # Four influences a vertex is what a `skinIndex`/`skinWeight` pair holds
    # and what three reads. More are silently dropped somewhere downstream.
    'export_influence_nb': 4,
    'export_all_influences': False,
    # Off: control bones the mesh does not deform are weight nobody pays for.
    # It is off rather than on because the exporter has two open faults with
    # it combined with `export_armature_object_remove`, and the saving is a
    # handful of nodes.
    'export_def_bones': False,

    # --- the scene ----------------------------------------------------------
    # The first export carried two empty nodes named for Blender collections.
    # They are not the figure.
    'export_hierarchy_full_collections': False,
    'export_hierarchy_flatten_objs': False,
    # glTF is +Y up and the front of an asset faces +Z. The engine's frame is
    # x left, y up, z ahead, which is the same thing, so nothing downstream
    # has to turn the figure round.
    'export_yup': True,

    # --- the mesh -----------------------------------------------------------
    'export_apply': True,      # modifiers baked in; the engine has no modifiers
    'export_normals': True,
    'export_texcoords': True,
    'export_tangents': False,  # the engine's material builds no normal map
    # One colour layer at most. The first export carried COLOR_0 and COLOR_1,
    # and three reads only the first: the second is bytes for nothing, and on
    # WebGPU every attribute counts against a pipeline's eight vertex buffers.
    'export_all_vertex_colors': False,
    'export_attributes': False,
}

# Sockets on a Principled BSDF that make a suit render as glass, and what they
# should be. The first export set transmission to 1 on both materials and gave
# the suit a base colour texture whose alpha is 0.17 across every texel, so a
# correct renderer draws the figure 83 per cent see-through. Blender did not
# show it because Blender was looking at the viewport's own blend mode.
OPAQUE = {
    'Transmission Weight': 0.0,
    'Transmission': 0.0,  # the pre-4.0 name for the same socket
    'Alpha': 1.0,
}


def make_opaque(report):
    """Unplug what makes the figure transparent, and say what was unplugged."""
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type != 'BSDF_PRINCIPLED':
                continue
            for name, value in OPAQUE.items():
                socket = node.inputs.get(name)
                if socket is None:
                    continue
                for link in list(socket.links):
                    report.append(f'{mat.name}: unplugged {link.from_node.name} from {name}')
                    mat.node_tree.links.remove(link)
                if socket.default_value != value:
                    report.append(f'{mat.name}: {name} {socket.default_value:.3f} -> {value}')
                    socket.default_value = value
        # Blender 4.2 renamed the material's own blend setting; carry both.
        if hasattr(mat, 'surface_render_method') and mat.surface_render_method != 'DITHERED':
            report.append(f'{mat.name}: render method {mat.surface_render_method} -> DITHERED')
            mat.surface_render_method = 'DITHERED'
        if hasattr(mat, 'blend_method') and mat.blend_method != 'OPAQUE':
            report.append(f'{mat.name}: blend method {mat.blend_method} -> OPAQUE')
            mat.blend_method = 'OPAQUE'
        # Two-sided costs twice the fragments and a flyer is never inside the
        # suit. A hole in the mesh is a hole to fix in the mesh.
        if mat.use_backface_culling is False:
            report.append(f'{mat.name}: backface culling off -> on')
            mat.use_backface_culling = True


def args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--blend', help='the .blend to open; omit when Blender already has one open')
    p.add_argument('--out', default='tools/figure/authored.glb', help='where the .glb goes')
    p.add_argument('--keep-glass', action='store_true', help='leave the materials as they are')
    # Blender passes the script everything after a bare `--`.
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    return p.parse_args(argv)


def main():
    a = args()
    if a.blend:
        bpy.ops.wm.open_mainfile(filepath=str(Path(a.blend).resolve()))

    report = []
    if not a.keep_glass:
        make_opaque(report)

    out = Path(a.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)

    # Anything the installed exporter does not know about is dropped rather
    # than raised: the names here are checked against glTF-Blender-IO's own
    # operator, and a Blender old enough to be missing one should still export.
    known = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    settings = {k: v for k, v in SETTINGS.items() if k in known}
    for k in SETTINGS:
        if k not in known:
            report.append(f'this Blender has no `{k}`; left at its default')

    bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', **settings)

    for line in report:
        print(f'  {line}')
    print(f'{out}  ({out.stat().st_size} bytes)')
    print('Now check it: python3 tools/figure/check_glb.py ' + str(out))


if __name__ == '__main__':
    main()
