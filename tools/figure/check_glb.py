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
ENGINE_TRIANGLES = 33_000  # what Flesh.ts grows, per AGENTS.md
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


def decode_png(b):
    """An 8-bit PNG as (width, height, channels, pixels). Slow and dependency-free."""
    w, h, depth, colour = png_head(b)
    channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(colour)
    if channels is None or depth != 8:
        return None
    idat, off = b'', 8
    while off < len(b):
        ln, = struct.unpack_from('>I', b, off)
        if b[off + 4:off + 8] == b'IDAT':
            idat += b[off + 8:off + 8 + ln]
        off += 12 + ln
    raw = zlib.decompress(idat)
    stride = w * channels
    prev, rows, i = bytearray(stride), [], 0
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
                q = a + prev[x] - c
                pa, pb, pc = abs(q - a), abs(q - prev[x]), abs(q - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else prev[x] if pb <= pc else c)) & 255
        rows.append(bytes(line))
        prev = line
    return w, h, channels, b''.join(rows)


def texture_image(gltf, d, base, texture_index, cache):
    """The decoded PNG behind a texture reference, decoded at most once."""
    if texture_index is None:
        return None
    src = gltf['textures'][texture_index].get('source')
    if src is None:
        return None
    if src not in cache:
        img = gltf['images'][src]
        if 'bufferView' not in img or img.get('mimeType') != 'image/png':
            cache[src] = None
        else:
            bv = gltf['bufferViews'][img['bufferView']]
            o = base + bv.get('byteOffset', 0)
            cache[src] = decode_png(d[o:o + bv['byteLength']])
    return cache[src]


def sample(decoded, uvs, channel):
    """A channel's mean, min and max where the mesh actually reads it.

    Over the whole image instead, an atlas that is three quarters empty answers
    for the empty part: the helmet's base colour runs 0..255 across the sheet
    and 254..255 over the texels its own triangles land on, which is the
    difference between calling it see-through and calling it opaque.
    """
    if decoded is None:
        return None
    w, h, channels, px = decoded
    if channel >= channels:
        return None
    total, lo, hi = 0, 255, 0
    for u, v in uvs:
        x = min(w - 1, max(0, int(u % 1.0 * w)))
        # glTF's v runs down from the top; the rows are stored the same way.
        y = min(h - 1, max(0, int(v % 1.0 * h)))
        value = px[(y * w + x) * channels + channel]
        total += value
        lo = min(lo, value)
        hi = max(hi, value)
    return (total / len(uvs), lo, hi) if uvs else None


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
    decoded = {}
    # Which texels each material is actually read at, gathered from the meshes
    # that wear it.
    worn = {}
    for mesh in gltf.get('meshes', []):
        for prim in mesh['primitives']:
            if 'material' not in prim or 'TEXCOORD_0' not in prim['attributes']:
                continue
            worn.setdefault(prim['material'], []).extend(
                accessor(gltf, d, base, prim['attributes']['TEXCOORD_0']))

    for mi, mat in enumerate(gltf.get('materials', [])):
        uvs = worn.get(mi, [])
        tag = f'material {mi} "{mat.get("name", "")}"'
        ext = mat.get('extensions', {})
        khr = ext.get('KHR_materials_transmission', {})
        factor = khr.get('transmissionFactor')
        if factor:
            # three multiplies the factor by the transmission map's red channel,
            # so a factor of 1 over a near-black map is not glass. Measure it:
            # reporting the factor alone calls a suit glass when it is not, and
            # the fault that matters is the other one either way -- any non-zero
            # transmission puts the material on three's transmission path, which
            # copies the viewport and builds a mip chain on every render call.
            stats = sample(
                texture_image(gltf, d, base, khr.get('transmissionTexture', {}).get('index'), decoded),
                uvs, 0)
            if stats:
                mean, lo, hi = stats
                effective = (f'{factor * lo / 255:.2f}..{factor * hi / 255:.2f}, mean '
                             f'{factor * mean / 255:.2f}, over the texels this mesh reads')
            else:
                effective = f'{factor:.2f} (no map)'
            faults.append(
                f'{tag}: KHR_materials_transmission, factor {factor}, effective {effective}. '
                f'Even a little of it puts the figure on three\'s transmission path: a full-viewport '
                f'copy and a mip chain every render call, against a pixel budget of 2 000 000. '
                f'Set the Principled BSDF\'s Transmission Weight to 0 and unplug its texture.')
        if mat.get('alphaMode') == 'BLEND':
            pbr = mat.get('pbrMetallicRoughness', {})
            alpha = pbr.get('baseColorFactor', [1, 1, 1, 1])[3]
            img = texture_image(gltf, d, base, pbr.get('baseColorTexture', {}).get('index'), decoded)
            # The alpha channel is the last one, and only an RGBA or grey+alpha
            # image has one.
            measured = sample(img, uvs, img[2] - 1) if img and img[2] in (2, 4) else None
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
                    # The range alone reads as half see-through when a handful
                    # of texels on an island's edge are the only ones below
                    # opaque; the mean is what the figure looks like.
                    notes.append(
                        f'{tag}: alphaMode BLEND, texture alpha {lo}..{hi}, mean {mean:.0f}/255 '
                        f'({100 * mean / 255:.0f}% opaque) -- deliberate?')
            elif alpha < 1:
                faults.append(f'{tag}: alphaMode BLEND with baseColorFactor alpha {alpha}.')
            else:
                warnings.append(f'{tag}: alphaMode BLEND. Opaque costs less and sorts itself.')
        if mat.get('doubleSided'):
            warnings.append(
                f'{tag}: doubleSided -- twice the fragments. A closed surface does not need it; a hole '
                f'is a hole to close in the mesh.')

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

    # An image carried twice is bytes carried twice. The first export shipped one
    # texture as both the base colour and the transmission map, 62 per cent of
    # the file between them.
    # Byte equality misses it: the same picture saved once as RGB and once as
    # RGBA is two different files and one texture. Compare the pixels.
    seen = {}
    for ii, img in enumerate(gltf.get('images', [])):
        if 'bufferView' not in img:
            continue
        bv = gltf['bufferViews'][img['bufferView']]
        o = base + bv.get('byteOffset', 0)
        got = decode_png(d[o:o + bv['byteLength']])
        if got is None:
            continue
        w, h, channels, px = got
        # A coarse fingerprint: the mean of each channel over a grid of samples.
        step = max(1, (w * h) // 4096)
        mark = (w, h, tuple(
            round(sum(px[k::channels][::step]) / len(px[k::channels][::step]), 2)
            for k in range(min(3, channels))))
        if mark in seen:
            warnings.append(
                f'image {ii} "{img.get("name", "")}" is the same picture as image {seen[mark]}, '
                f'saved twice: {bv["byteLength"] // 1024} KiB for nothing.')
        seen[mark] = ii

    # A colour attribute that is the same colour everywhere is a vertex buffer
    # and a hundred kilobytes spent saying nothing.
    for mi, mesh in enumerate(gltf.get('meshes', [])):
        for pi, prim in enumerate(mesh['primitives']):
            for name, ai in sorted(prim['attributes'].items()):
                if not name.startswith('COLOR_'):
                    continue
                values = set(accessor(gltf, d, base, ai))
                if len(values) == 1:
                    warnings.append(
                        f'mesh {mi} "{mesh.get("name", "")}" prim {pi}: {name} is {values.pop()} on '
                        f'every vertex. Dead data, and it costs a vertex buffer. Delete the colour '
                        f'attribute in Blender.')

    # --- the figure itself --------------------------------------------------
    # Only what the skeleton moves is the figure. Measured over every mesh in
    # the file instead, Blender's default cube -- two metres on a side, sitting
    # where nobody deleted it -- makes the figure 2.67 m tall.
    lo, hi, tris, loose = [1e9] * 3, [-1e9] * 3, 0, []
    for mesh in gltf.get('meshes', []):
        for prim in mesh['primitives']:
            a = gltf['accessors'][prim['attributes']['POSITION']]
            count = (gltf['accessors'][prim['indices']]['count'] // 3
                     if 'indices' in prim else a['count'] // 3)
            if 'JOINTS_0' not in prim['attributes']:
                loose.append((mesh.get('name', ''), count))
                continue
            tris += count
            for k in range(3):
                lo[k] = min(lo[k], a['min'][k])
                hi[k] = max(hi[k], a['max'][k])
    if loose:
        warnings.append(
            'not weighted to the skeleton, so not the figure: '
            + ', '.join(f'"{n}" ({t} tris)' for n, t in loose)
            + '. Exporting the whole scene carries whatever else is in it.')
    if tris:
        height = hi[1] - lo[1]
        notes.append(
            f'figure: {height:.3f} m tall, {hi[0] - lo[0]:.3f} m across, {hi[2] - lo[2]:.3f} m deep, '
            f'{tris} tris over {len(gltf.get("meshes", [])) - len(loose)} skinned meshes')
        if not 1.4 < height < 2.1:
            warnings.append(f'figure: {height:.3f} m tall. The engine\'s own is about {ENGINE_HEIGHT} m.')
        if tris > ENGINE_TRIANGLES:
            warnings.append(
                f'figure: {tris} tris against the {ENGINE_TRIANGLES} the engine grows for itself. '
                f'An authored figure that costs more than the procedural one is not a saving.')

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
