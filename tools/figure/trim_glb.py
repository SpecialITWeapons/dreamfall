"""Trim an authored figure down to what will actually be seen.

    python3 tools/figure/trim_glb.py in.glb out.glb [options]

Nothing here needs Blender, and that is the point: the person who authored the
figure should not have to learn mesh editing to stop shipping a naked body
under a closed suit. What this removes is removable without judgement --
geometry that is provably enclosed by other geometry, a picture carried twice,
an object nobody weighted to the skeleton -- and every removal is counted on
the way out.

What it does NOT do is simplify a surface. Decimation is a judgement about how
a thing should look, it is four clicks in Blender (Modifier Properties, Add
Modifier, Generate, Decimate, set Ratio), and a script that guessed at it would
be deciding something the author has an opinion about.

Options:
  --enclosed-by NAME    drop triangles of other meshes that sit inside NAME.
                        Repeatable. NAME itself is never trimmed.
  --drop-unskinned      drop meshes with no skin weights (the default cube).
  --drop-mesh NAME      drop this mesh outright. For geometry an enclosure test
                        cannot reach: an eyeball behind a helmet with no visor
                        opening is invisible, and no ray parity will say so,
                        because the helmet is an open shell. Repeatable.
  --opaque              strip KHR_materials_transmission, set alphaMode OPAQUE
                        and turn off doubleSided on every material.
  --keep-blend NAME     keep alphaMode BLEND on this material (a visor).
                        Repeatable. Its transmission still goes.
  --max-texture N       downsample any image wider or taller than N.
  --dry-run             say what would happen and write nothing.
"""

import argparse
import json
import struct
import sys
import zlib
from collections import defaultdict
from pathlib import Path

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942
# glTF component types, as (struct code, bytes).
COMPONENT = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2),
             5125: ('I', 4), 5126: ('f', 4)}
COUNT = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


# --------------------------------------------------------------------------
# reading


def read_glb(path):
    raw = Path(path).read_bytes()
    magic, _version, _length = struct.unpack_from('<III', raw, 0)
    if magic != GLB_MAGIC:
        raise SystemExit(f'{path}: not a .glb')
    chunks, off = {}, 12
    while off < len(raw):
        length, kind = struct.unpack_from('<II', raw, off)
        chunks[kind] = (off + 8, length)
        off += 8 + length
    off, length = chunks[CHUNK_JSON]
    gltf = json.loads(raw[off:off + length])
    off, length = chunks.get(CHUNK_BIN, (0, 0))
    return gltf, raw, off


def read_accessor(gltf, raw, base, index):
    """One accessor as a list of tuples, whatever its stride."""
    a = gltf['accessors'][index]
    code, size = COMPONENT[a['componentType']]
    n = COUNT[a['type']]
    if 'bufferView' not in a:
        return [(0,) * n] * a['count']
    bv = gltf['bufferViews'][a['bufferView']]
    off = base + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride') or n * size
    fmt = '<' + code * n
    return [struct.unpack_from(fmt, raw, off + k * stride) for k in range(a['count'])]


# --------------------------------------------------------------------------
# is one triangle inside another mesh


def ray_grid(triangles, axis, cell=0.04):
    """Triangles bucketed by the two axes a ray along `axis` does not travel."""
    u, v = [k for k in (0, 1, 2) if k != axis]
    grid = defaultdict(list)
    for t in triangles:
        us, vs = [p[u] for p in t], [p[v] for p in t]
        for a in range(int(min(us) // cell), int(max(us) // cell) + 1):
            for b in range(int(min(vs) // cell), int(max(vs) // cell) + 1):
                grid[(a, b)].append(t)
    return grid, u, v, cell


def crossings(point, grid_axis, axis):
    """How many of the triangles a ray from `point` along +axis passes through."""
    grid, u, v, cell = grid_axis
    hits = 0
    direction = [0.0, 0.0, 0.0]
    direction[axis] = 1.0
    for a, b, c in grid.get((int(point[u] // cell), int(point[v] // cell)), ()):
        e1 = [b[k] - a[k] for k in range(3)]
        e2 = [c[k] - a[k] for k in range(3)]
        h = [direction[1] * e2[2] - direction[2] * e2[1],
             direction[2] * e2[0] - direction[0] * e2[2],
             direction[0] * e2[1] - direction[1] * e2[0]]
        det = sum(e1[k] * h[k] for k in range(3))
        if abs(det) < 1e-12:
            continue
        f = 1.0 / det
        s = [point[k] - a[k] for k in range(3)]
        bary_u = f * sum(s[k] * h[k] for k in range(3))
        if bary_u < 0.0 or bary_u > 1.0:
            continue
        q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]]
        bary_v = f * sum(direction[k] * q[k] for k in range(3))
        if bary_v < 0.0 or bary_u + bary_v > 1.0:
            continue
        if f * sum(e2[k] * q[k] for k in range(3)) > 1e-9:
            hits += 1
    return hits


def enclosed(centres, triangles):
    """Which of `centres` are inside the surface, by parity along three axes.

    One ray is enough for a closed surface and this figure's are not closed --
    a suit has a hole at each wrist, each ankle and the neck -- so a ray that
    leaves through one counts even and calls a hip 'outside'. Three axes and a
    majority costs three times as much and does not care which way a hole
    faces. Where a surface is open enough that all three disagree, the answer
    is 'keep it', which is the safe way to be wrong.
    """
    grids = [ray_grid(triangles, axis) for axis in (0, 1, 2)]
    return [sum(1 for axis in (0, 1, 2) if crossings(c, grids[axis], axis) % 2 == 1) >= 2
            for c in centres]


# --------------------------------------------------------------------------
# pictures


def png_decode(data):
    width, height = struct.unpack_from('>II', data, 16)
    depth, colour = data[24], data[25]
    channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(colour)
    if channels is None or depth != 8:
        return None
    idat, off = b'', 8
    while off < len(data):
        length, = struct.unpack_from('>I', data, off)
        if data[off + 4:off + 8] == b'IDAT':
            idat += data[off + 8:off + 8 + length]
        off += 12 + length
    rows = zlib.decompress(idat)
    stride = width * channels
    previous, out, i = bytearray(stride), [], 0
    for _ in range(height):
        kind = rows[i]; i += 1
        line = bytearray(rows[i:i + stride]); i += stride
        if kind == 1:
            for x in range(channels, stride):
                line[x] = (line[x] + line[x - channels]) & 255
        elif kind == 2:
            for x in range(stride):
                line[x] = (line[x] + previous[x]) & 255
        elif kind == 3:
            for x in range(stride):
                left = line[x - channels] if x >= channels else 0
                line[x] = (line[x] + ((left + previous[x]) >> 1)) & 255
        elif kind == 4:
            for x in range(stride):
                left = line[x - channels] if x >= channels else 0
                corner = previous[x - channels] if x >= channels else 0
                guess = left + previous[x] - corner
                dl, du, dc = abs(guess - left), abs(guess - previous[x]), abs(guess - corner)
                best = left if dl <= du and dl <= dc else previous[x] if du <= dc else corner
                line[x] = (line[x] + best) & 255
        out.append(bytes(line))
        previous = line
    return width, height, channels, b''.join(out)


def png_encode(width, height, channels, pixels):
    colour = {1: 0, 2: 4, 3: 2, 4: 6}[channels]
    stride = width * channels
    raw = b''.join(b'\x00' + pixels[y * stride:(y + 1) * stride] for y in range(height))

    def chunk(tag, body):
        payload = tag + body
        return struct.pack('>I', len(body)) + payload + struct.pack('>I', zlib.crc32(payload) & 0xFFFFFFFF)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, colour, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


def downsample(decoded, limit):
    """Box-filter down to `limit`, by a whole factor so every texel counts once."""
    width, height, channels, pixels = decoded
    factor = max((max(width, height) + limit - 1) // limit, 1)
    if factor < 2:
        return None
    w2, h2 = max(1, width // factor), max(1, height // factor)
    out = bytearray(w2 * h2 * channels)
    area = factor * factor
    for y in range(h2):
        for x in range(w2):
            for c in range(channels):
                total = 0
                for dy in range(factor):
                    row = (y * factor + dy) * width
                    for dx in range(factor):
                        total += pixels[(row + x * factor + dx) * channels + c]
                out[(y * w2 + x) * channels + c] = total // area
    return w2, h2, channels, bytes(out)


# --------------------------------------------------------------------------
# writing


class Builder:
    """Collects the new binary chunk, one bufferView per accessor.

    Tightly packed and four-byte aligned: glTF asks that a bufferView feeding a
    vertex attribute start on a multiple of four, and giving every accessor its
    own view is a few more lines of JSON against a class of alignment fault
    that is silent on one backend and fatal on another.
    """

    def __init__(self):
        self.blob = bytearray()
        self.views = []
        self.accessors = []

    def add(self, values, kind, component, *, target=None, minmax=False):
        while len(self.blob) % 4:
            self.blob.append(0)
        offset = len(self.blob)
        code, size = COMPONENT[component]
        n = COUNT[kind]
        fmt = '<' + code * n
        for v in values:
            self.blob += struct.pack(fmt, *v)
        view = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(self.blob) - offset}
        if target:
            view['target'] = target
        self.views.append(view)
        accessor = {'bufferView': len(self.views) - 1, 'componentType': component,
                    'count': len(values), 'type': kind}
        if minmax and values:
            accessor['min'] = [min(v[k] for v in values) for k in range(n)]
            accessor['max'] = [max(v[k] for v in values) for k in range(n)]
        self.accessors.append(accessor)
        return len(self.accessors) - 1

    def add_bytes(self, data):
        while len(self.blob) % 4:
            self.blob.append(0)
        offset = len(self.blob)
        self.blob += data
        self.views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(data)})
        return len(self.views) - 1


def write_glb(path, gltf, blob):
    while len(blob) % 4:
        blob.append(0)
    payload = json.dumps(gltf, separators=(',', ':')).encode()
    while len(payload) % 4:
        payload += b' '
    out = bytearray(struct.pack('<III', GLB_MAGIC, 2, 12 + 8 + len(payload) + 8 + len(blob)))
    out += struct.pack('<II', len(payload), CHUNK_JSON) + payload
    out += struct.pack('<II', len(blob), CHUNK_BIN) + bytes(blob)
    Path(path).write_bytes(out)
    return len(out)


# --------------------------------------------------------------------------


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('source')
    p.add_argument('out', nargs='?')
    p.add_argument('--enclosed-by', action='append', default=[], metavar='NAME')
    p.add_argument('--drop-unskinned', action='store_true')
    p.add_argument('--drop-mesh', action='append', default=[], metavar='NAME')
    p.add_argument('--opaque', action='store_true')
    p.add_argument('--keep-blend', action='append', default=[], metavar='NAME')
    p.add_argument('--max-texture', type=int, metavar='N')
    p.add_argument('--dry-run', action='store_true')
    a = p.parse_args()
    if not a.out and not a.dry_run:
        p.error('give an output path, or --dry-run')

    gltf, raw, base = read_glb(a.source)
    report = []

    meshes = gltf.get('meshes', [])
    by_name = {m.get('name', ''): i for i, m in enumerate(meshes)}
    for name in a.enclosed_by:
        if name not in by_name:
            raise SystemExit(f'--enclosed-by {name}: no such mesh. Have: {", ".join(by_name)}')

    # The surfaces other meshes may be hidden inside.
    shells = {}
    for name in a.enclosed_by:
        prim = meshes[by_name[name]]['primitives'][0]
        pos = read_accessor(gltf, raw, base, prim['attributes']['POSITION'])
        idx = [v[0] for v in read_accessor(gltf, raw, base, prim['indices'])]
        shells[name] = [(pos[idx[t]], pos[idx[t + 1]], pos[idx[t + 2]])
                        for t in range(0, len(idx), 3)]

    build = Builder()
    kept_meshes, mesh_remap = [], {}
    dropped_tris = 0

    for mi, mesh in enumerate(meshes):
        name = mesh.get('name', f'#{mi}')
        if name in a.drop_mesh:
            count = sum(gltf['accessors'][pr['indices']]['count'] // 3 if 'indices' in pr
                        else gltf['accessors'][pr['attributes']['POSITION']]['count'] // 3
                        for pr in mesh['primitives'])
            report.append(f'dropped "{name}": asked for ({count} tris)')
            dropped_tris += count
            continue
        primitives = []
        for prim in mesh['primitives']:
            attrs = prim['attributes']
            if a.drop_unskinned and 'JOINTS_0' not in attrs:
                count = (gltf['accessors'][prim['indices']]['count'] // 3 if 'indices' in prim
                         else gltf['accessors'][attrs['POSITION']]['count'] // 3)
                report.append(f'dropped "{name}": no skin weights ({count} tris)')
                dropped_tris += count
                continue
            data = {k: read_accessor(gltf, raw, base, v) for k, v in attrs.items()}
            idx = ([v[0] for v in read_accessor(gltf, raw, base, prim['indices'])]
                   if 'indices' in prim else list(range(len(data['POSITION']))))
            triangles = [idx[t:t + 3] for t in range(0, len(idx), 3)]

            for shell, shell_tris in shells.items():
                if shell == name:
                    continue
                centres = [[sum(data['POSITION'][v][k] for v in tri) / 3 for k in range(3)]
                           for tri in triangles]
                inside = enclosed(centres, shell_tris)
                gone = sum(inside)
                if gone:
                    report.append(f'"{name}": {gone} of {len(triangles)} triangles are inside '
                                  f'"{shell}" and were dropped')
                    dropped_tris += gone
                triangles = [t for t, hid in zip(triangles, inside) if not hid]

            if not triangles:
                report.append(f'dropped "{name}": nothing left of it')
                continue

            # Keep only the vertices the surviving triangles still name.
            order, remap = [], {}
            for tri in triangles:
                for v in tri:
                    if v not in remap:
                        remap[v] = len(order)
                        order.append(v)
            flat = [remap[v] for tri in triangles for v in tri]

            new_attrs = {}
            for key, values in data.items():
                kind = gltf['accessors'][attrs[key]]['type']
                component = gltf['accessors'][attrs[key]]['componentType']
                new_attrs[key] = build.add([values[v] for v in order], kind, component,
                                           target=34962, minmax=(key == 'POSITION'))
            component = 5125 if len(order) > 65535 else 5123
            new_prim = dict(prim)
            new_prim['attributes'] = new_attrs
            new_prim['indices'] = build.add([(v,) for v in flat], 'SCALAR', component, target=34963)
            primitives.append(new_prim)

        if primitives:
            mesh_remap[mi] = len(kept_meshes)
            kept_meshes.append({**mesh, 'primitives': primitives})

    # Everything that is not mesh data rides along unchanged, through new views.
    for skin in gltf.get('skins', []):
        if 'inverseBindMatrices' in skin:
            values = read_accessor(gltf, raw, base, skin['inverseBindMatrices'])
            skin['inverseBindMatrices'] = build.add(values, 'MAT4', 5126)

    # A material nothing wears is a texture nothing reads is a picture nobody
    # sees. Dropping the eyeballs left an iris behind at 80 KiB, so the sweep
    # starts at the material and falls through.
    worn_materials = {pr['material'] for mesh in kept_meshes for pr in mesh['primitives']
                      if 'material' in pr}
    materials, material_remap = [], {}
    for mi, material in enumerate(gltf.get('materials', [])):
        if mi in worn_materials:
            material_remap[mi] = len(materials)
            materials.append(material)
        else:
            report.append(f'material "{material.get("name", mi)}": nothing wears it, dropped')
    if 'materials' in gltf:
        gltf['materials'] = materials
        for mesh in kept_meshes:
            for pr in mesh['primitives']:
                if 'material' in pr:
                    pr['material'] = material_remap[pr['material']]

    # Materials first, then the pictures, because stripping an extension can
    # orphan the texture that fed it: this figure's transmission map is 600 KiB
    # of a picture that, once the transmission goes, nothing reads.
    for material in gltf.get('materials', []) if a.opaque else []:
        name = material.get('name', '')
        extensions = material.get('extensions', {})
        if extensions.pop('KHR_materials_transmission', None) is not None:
            report.append(f'material "{name}": transmission stripped')
        if not extensions:
            material.pop('extensions', None)
        if material.get('doubleSided'):
            material['doubleSided'] = False
        if name in a.keep_blend:
            report.append(f'material "{name}": alphaMode BLEND kept')
        elif material.get('alphaMode') == 'BLEND':
            material['alphaMode'] = 'OPAQUE'
            report.append(f'material "{name}": alphaMode BLEND -> OPAQUE')

    # glTF names a texture the same way wherever it appears -- a textureInfo,
    # which is an object with an `index` and nothing outside this set -- so one
    # walk finds them all, in the core material and in any extension alike.
    TEXTURE_INFO = {'index', 'texCoord', 'scale', 'strength', 'extensions', 'extras'}

    def is_texture_info(node):
        return (isinstance(node, dict) and isinstance(node.get('index'), int)
                and set(node) <= TEXTURE_INFO)

    def walk(node, visit):
        if is_texture_info(node):
            visit(node)
        if isinstance(node, dict):
            for value in node.values():
                walk(value, visit)
        elif isinstance(node, list):
            for value in node:
                walk(value, visit)

    live = set()
    walk(gltf.get('materials', []), lambda info: live.add(info['index']))
    textures, texture_remap = [], {}
    for ti, texture in enumerate(gltf.get('textures', [])):
        if ti in live:
            texture_remap[ti] = len(textures)
            textures.append(texture)
    if 'textures' in gltf:
        gone = len(gltf['textures']) - len(textures)
        if gone:
            report.append(f'{gone} texture(s) nothing reads any more, dropped')
        gltf['textures'] = textures

        walk(gltf.get('materials', []),
             lambda info: info.__setitem__('index', texture_remap[info['index']]))

    # Pictures: one copy of each, no larger than asked for, and only the ones
    # a surviving texture still points at.
    wanted = {t['source'] for t in gltf.get('textures', []) if 'source' in t}
    seen, image_remap, new_images = {}, {}, []
    for ii, image in enumerate(gltf.get('images', [])):
        if ii not in wanted:
            report.append(f'image "{image.get("name", ii)}": nothing reads it, dropped')
            continue
        if 'bufferView' not in image:
            image_remap[ii] = len(new_images)
            new_images.append(image)
            continue
        view = gltf['bufferViews'][image['bufferView']]
        off = base + view.get('byteOffset', 0)
        data = raw[off:off + view['byteLength']]
        decoded = png_decode(data) if image.get('mimeType') == 'image/png' else None
        if decoded and a.max_texture:
            smaller = downsample(decoded, a.max_texture)
            if smaller:
                data = png_encode(*smaller)
                report.append(f'image "{image.get("name", ii)}": {decoded[0]}x{decoded[1]} -> '
                              f'{smaller[0]}x{smaller[1]}, {view["byteLength"]} -> {len(data)} bytes')
                decoded = smaller
        mark = (decoded[0], decoded[1], zlib.crc32(decoded[3])) if decoded else zlib.crc32(data)
        if mark in seen:
            image_remap[ii] = seen[mark]
            first = new_images[seen[mark]].get('name', seen[mark])
            report.append(f'image "{image.get("name", ii)}" is image "{first}" again: '
                          f'{len(data)} bytes saved')
            continue
        seen[mark] = len(new_images)
        image_remap[ii] = len(new_images)
        new_images.append({**image, 'bufferView': build.add_bytes(data)})
    if 'images' in gltf:
        gltf['images'] = new_images
        for texture in gltf.get('textures', []):
            if 'source' in texture:
                texture['source'] = image_remap[texture['source']]

    used = {e for m in gltf.get('materials', []) for e in m.get('extensions', {})}
    for key in ('extensionsUsed', 'extensionsRequired'):
        if key in gltf:
            gltf[key] = [e for e in gltf[key] if e in used]
            if not gltf[key]:
                del gltf[key]

    gltf['meshes'] = kept_meshes
    for node in gltf.get('nodes', []):
        if 'mesh' in node:
            if node['mesh'] in mesh_remap:
                node['mesh'] = mesh_remap[node['mesh']]
            else:
                node.pop('mesh', None)
                node.pop('skin', None)
    gltf['bufferViews'] = build.views
    gltf['accessors'] = build.accessors
    gltf['buffers'] = [{'byteLength': len(build.blob)}]

    for line in report:
        print(f'  {line}')
    print(f'  {dropped_tris} triangles dropped')
    if a.dry_run:
        print('(--dry-run: nothing written)')
        return 0
    size = write_glb(a.out, gltf, build.blob)
    print(f'{a.out}  {Path(a.source).stat().st_size} -> {size} bytes')
    print(f'Now check it: python3 tools/figure/check_glb.py {a.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
