"""Check an authored .glb against what the engine can actually use.

    python3 tools/figure/check_glb.py tools/figure/authored.glb

No dependencies and no Blender: it reads the container itself. Run it after
every export. It exits non-zero when it finds something that would stop the
figure working, so it can sit in a script.

It exists because the interesting faults in the first export were all invisible
in a viewer. The bones were in the right places and the right lengths, so the
bind pose drew correctly; only posing it would have shown that nothing is
parented to anything. The suit's alpha was 0.17 in a channel nobody looks at.
Both are one line of arithmetic to find and an evening to find by eye.
"""

import json
import struct
import sys
import zlib
from pathlib import Path

# Everything the engine's own figure is, for comparison. See
# src/engine/avatar/ProceduralHuman.ts and tools/figure/figure.json.
ENGINE_BONES = 16
ENGINE_HEIGHT = 1.7  # metres, nose to toe
# WebGPU gives a pipeline eight vertex buffers and three does not ask for more;
# a pipeline over it fails validation quietly. See AGENTS.md.
MAX_VERTEX_BUFFERS = 8


def read_glb(path):
    d = Path(path).read_bytes()
    magic, version, length = struct.unpack_from('<III', d, 0)
    if magic != 0x46546C67:
        raise SystemExit(f'{path}: not a .glb (magic {magic:#x})')
    chunks, off = {}, 12
    while off < len(d):
        clen, ctype = struct.unpack_from('<II', d, off)
        chunks[ctype] = (off + 8, clen)
        off += 8 + clen
    o, l = chunks[0x4E4F534A]
    gltf = json.loads(d[o:o + l])
    o, l = chunks.get(0x004E4942, (0, 0))
    return gltf, d, o, version, length


def png_head(b):
    w, h = struct.unpack_from('>II', b, 16)
    return w, h, b[24], b[25]


def png_alpha(b):
    """Mean, min and max of a PNG's alpha channel, or None when it has none."""
    w, h, depth, colour = png_head(b)
    if colour not in (4, 6) or depth != 8:
        return None
    channels = 4 if colour == 6 else 2
    idat, off = b'', 8
    while off < len(b):
        ln, = struct.unpack_from('>I', b, off)
        if b[off + 4:off + 8] == b'IDAT':
            idat += b[off + 8:off + 8 + ln]
        off += 12 + ln
    raw = zlib.decompress(idat)
    stride = w * channels
    prev, out, i = bytearray(stride), [], 0
    for _ in range(h):
        f = raw[i]; i += 1
        line = bytearray(raw[i:i + stride]); i += stride
        if f == 1:
            for x in range(channels, stride):
                line[x] = (line[x] + line[x - channels]) & 255
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x - channels] if x >= channels else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - channels] if x >= channels else 0
                c = prev[x - channels] if x >= channels else 0
                p = a + prev[x] - c
                pa, pb, pc = abs(p - a), abs(p - prev[x]), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else prev[x] if pb <= pc else c)) & 255
        out.append(bytes(line[channels - 1::channels]))
        prev = line
    alpha = b''.join(out)
    return sum(alpha) / len(alpha), min(alpha), max(alpha)


def accessor(gltf, d, base, index):
    a = gltf['accessors'][index]
    bv = gltf['bufferViews'][a['bufferView']]
    off = base + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    fmt = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}[a['componentType']]
    stride = bv.get('byteStride') or n * struct.calcsize(fmt)
    return [struct.unpack_from('<' + fmt * n, d, off + k * stride) for k in range(a['count'])]


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    path = sys.argv[1]
    gltf, d, base, version, length = read_glb(path)
    faults, warnings, notes = [], [], []

    nodes = gltf.get('nodes', [])
    parent = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
    scene = gltf['scenes'][gltf.get('scene', 0)]['nodes']

    notes.append(f'glTF {version}, {length} bytes, generator {gltf.get("asset", {}).get("generator", "?")}')
    notes.append(f'{len(nodes)} nodes, {len(gltf.get("meshes", []))} meshes, {len(gltf.get("skins", []))} skins')

    # --- the skeleton -------------------------------------------------------
    for si, skin in enumerate(gltf.get('skins', [])):
        joints = skin['joints']
        roots = [j for j in joints if parent.get(j) not in joints]
        names = [nodes[j].get('name', f'#{j}') for j in joints]
        notes.append(f'skin {si} "{skin.get("name", "")}": {len(joints)} joints, {len(roots)} root(s)')
        notes.append(f'skin {si}: joints {", ".join(names)}')
        if len(roots) > 1:
            faults.append(
                f'skin {si}: the skeleton is FLAT -- {len(roots)} of {len(joints)} joints are roots. '
                f'Nothing is parented to anything, so rotating a joint moves no other joint and the rig '
                f'cannot be posed. Re-export with `Flatten Bone Hierarchy` OFF '
                f'(export_hierarchy_flatten_bones=False).')
        # Joints have to hang somewhere the scene can reach, or nothing updates
        # their world matrices and the skin collapses.
        reachable, stack = set(), list(scene)
        while stack:
            k = stack.pop()
            if k in reachable:
                continue
            reachable.add(k)
            stack.extend(nodes[k].get('children', []))
        orphans = [j for j in joints if j not in reachable]
        if orphans:
            faults.append(
                f'skin {si}: {len(orphans)} of {len(joints)} joints are not reachable from the scene '
                f'(scene.nodes = {scene}). Re-export with `Remove Armature Object` OFF '
                f'(export_armature_object_remove=False).')
        # The leaf nodes are children of the joints, not joints themselves.
        leaves = [n.get('name', '') for n in nodes if n.get('name', '').endswith('_leaf')]
        if leaves:
            warnings.append(
                f'skin {si}: {len(leaves)} `_leaf` nodes. The engine reads a bone\'s length from its '
                f'child joint and has no use for them. Re-export with `Add Leaf Bones` OFF '
                f'(export_leaf_bone=False).')
        if len(joints) != ENGINE_BONES:
            notes.append(
                f'skin {si}: {len(joints)} joints against the engine\'s {ENGINE_BONES}. Not a fault -- '
                f'but the pose system drives the engine\'s names, so a retarget has to exist somewhere.')

    # --- the meshes ---------------------------------------------------------
    for mi, mesh in enumerate(gltf.get('meshes', [])):
        for pi, prim in enumerate(mesh['primitives']):
            attrs = prim['attributes']
            tag = f'mesh {mi} "{mesh.get("name", "")}" prim {pi}'
            verts = gltf['accessors'][attrs['POSITION']]['count']
            tris = gltf['accessors'][prim['indices']]['count'] // 3 if 'indices' in prim else verts // 3
            notes.append(f'{tag}: {verts} verts, {tris} tris, attrs {sorted(attrs)}')
            # One vertex buffer per attribute, on WebGPU.
            if len(attrs) > MAX_VERTEX_BUFFERS:
                faults.append(
                    f'{tag}: {len(attrs)} vertex attributes against WebGPU\'s {MAX_VERTEX_BUFFERS} '
                    f'buffers. The pipeline fails validation quietly and the mesh is simply not drawn.')
            extra = sorted(k for k in attrs if k.endswith(('_1', '_2', '_3')))
            if extra:
                warnings.append(
                    f'{tag}: {extra} -- three reads only the first of each. Bytes for nothing, and '
                    f'each one costs a vertex buffer. Re-export with `Export All Vertex Colors` OFF.')
            if 'WEIGHTS_0' in attrs:
                w = accessor(gltf, d, base, attrs['WEIGHTS_0'])
                sums = [sum(x) for x in w]
                if min(sums) < 0.99 or max(sums) > 1.01:
                    faults.append(f'{tag}: skin weights sum to {min(sums):.3f}..{max(sums):.3f}, not 1.')
                else:
                    notes.append(f'{tag}: skin weights sum to 1 on every vertex')

    # --- the materials ------------------------------------------------------
    for mi, mat in enumerate(gltf.get('materials', [])):
        tag = f'material {mi} "{mat.get("name", "")}"'
        ext = mat.get('extensions', {})
        transmission = ext.get('KHR_materials_transmission', {}).get('transmissionFactor')
        if transmission:
            faults.append(
                f'{tag}: KHR_materials_transmission transmissionFactor {transmission}. This is glass. '
                f'Set the Principled BSDF\'s Transmission Weight to 0.')
        if mat.get('alphaMode') == 'BLEND':
            pbr = mat.get('pbrMetallicRoughness', {})
            alpha = pbr.get('baseColorFactor', [1, 1, 1, 1])[3]
            tex = pbr.get('baseColorTexture', {}).get('index')
            measured = None
            if tex is not None:
                src = gltf['textures'][tex].get('source')
                img = gltf['images'][src]
                if 'bufferView' in img and img.get('mimeType') == 'image/png':
                    bv = gltf['bufferViews'][img['bufferView']]
                    o = base + bv.get('byteOffset', 0)
                    measured = png_alpha(d[o:o + bv['byteLength']])
            if measured:
                mean, lo, hi = measured
                if hi < 250:
                    faults.append(
                        f'{tag}: alphaMode BLEND and the base colour texture\'s alpha never exceeds '
                        f'{hi}/255 (mean {mean:.1f}). Nothing wearing this is more than '
                        f'{100 * hi / 255:.0f}% visible. Set the Principled BSDF\'s Alpha to 1 and '
                        f'the render method to Dithered/Opaque, and save the texture without an '
                        f'alpha channel.')
                else:
                    notes.append(f'{tag}: alphaMode BLEND, texture alpha {lo}..{hi} -- deliberate?')
            elif alpha < 1:
                faults.append(f'{tag}: alphaMode BLEND with baseColorFactor alpha {alpha}.')
            else:
                warnings.append(f'{tag}: alphaMode BLEND. Opaque costs less and sorts itself.')
        if mat.get('doubleSided'):
            warnings.append(f'{tag}: doubleSided -- twice the fragments, for a suit nobody sees inside.')

    # --- the textures -------------------------------------------------------
    for ii, img in enumerate(gltf.get('images', [])):
        if 'bufferView' not in img:
            continue
        bv = gltf['bufferViews'][img['bufferView']]
        o = base + bv.get('byteOffset', 0)
        b = d[o:o + bv['byteLength']]
        if img.get('mimeType') == 'image/png':
            w, h, depth, colour = png_head(b)
            notes.append(f'image {ii} "{img.get("name", "")}": {w}x{h} png, {bv["byteLength"]} bytes')
            if bv['byteLength'] > 100_000:
                warnings.append(
                    f'image {ii} "{img.get("name", "")}": {bv["byteLength"] // 1024} KiB for a figure '
                    f'that is a few dozen pixels tall in flight.')

    # --- the figure itself --------------------------------------------------
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for mesh in gltf.get('meshes', []):
        for prim in mesh['primitives']:
            a = gltf['accessors'][prim['attributes']['POSITION']]
            for k in range(3):
                lo[k] = min(lo[k], a['min'][k])
                hi[k] = max(hi[k], a['max'][k])
    height = hi[1] - lo[1]
    notes.append(f'figure: {height:.3f} m tall, {hi[0] - lo[0]:.3f} m across, {hi[2] - lo[2]:.3f} m deep')
    if not 1.4 < height < 2.1:
        warnings.append(f'figure: {height:.3f} m tall. The engine\'s own is about {ENGINE_HEIGHT} m.')

    for line in notes:
        print(f'  . {line}')
    for line in warnings:
        print(f'  ~ {line}')
    for line in faults:
        print(f'  X {line}')
    print(f'\n{len(faults)} fault(s), {len(warnings)} warning(s).')
    return 1 if faults else 0


if __name__ == '__main__':
    sys.exit(main())
