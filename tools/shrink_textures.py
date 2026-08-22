#!/usr/bin/env python3
"""
Recompresses the textures inside a .glb in place.

The world file is 26 MB and 24.5 MB of that is images, most of them PNGs of
photographic material that PNG has no way to compress. Geometry is only about
1.5 MB, so mesh compression would barely move the number; the textures are the
whole download. Everything opaque becomes a JPEG at its original resolution,
and the ambient occlusion maps become grayscale JPEGs, because three.js reads
occlusion out of the red channel alone and their alpha is a binary mask over
parts of the atlas nothing samples.

    python3 tools/shrink_textures.py build/assets/world.glb
"""

import io
import json
import struct
import sys

from PIL import Image

COLOR_QUALITY = 88
OCCLUSION_QUALITY = 85


def chunks(data):
    """Yields (type, payload) for each chunk in a binary glTF."""
    magic, version, length = struct.unpack_from('<III', data, 0)
    if magic != 0x46546C67:
        raise SystemExit('not a glb')

    offset = 12
    while offset < length:
        size, kind = struct.unpack_from('<II', data, offset)
        yield kind, data[offset + 8:offset + 8 + size]
        offset += 8 + size


def occlusion_only(gltf):
    """Images used for occlusion and nothing else, so colour can be thrown away."""
    source = {index: texture['source'] for index, texture in enumerate(gltf.get('textures', []))}
    occlusion = set()
    other = set()

    for material in gltf.get('materials', []):
        pbr = material.get('pbrMetallicRoughness', {})
        for slot in ('baseColorTexture', 'metallicRoughnessTexture'):
            if slot in pbr:
                other.add(source[pbr[slot]['index']])
        for slot in ('normalTexture', 'emissiveTexture'):
            if slot in material:
                other.add(source[material[slot]['index']])
        if 'occlusionTexture' in material:
            occlusion.add(source[material['occlusionTexture']['index']])

    return occlusion - other


def encode(payload, grayscale):
    image = Image.open(io.BytesIO(payload))
    image.load()

    out = io.BytesIO()
    if grayscale:
        image.convert('L').save(out, 'JPEG', quality=OCCLUSION_QUALITY, optimize=True)
    else:
        image.convert('RGB').save(out, 'JPEG', quality=COLOR_QUALITY, optimize=True)

    return out.getvalue()


def pad(value):
    return (4 - value % 4) % 4


def main(path):
    original = open(path, 'rb').read()

    gltf = None
    binary = None
    for kind, payload in chunks(original):
        if kind == 0x4E4F534A:
            gltf = json.loads(payload.decode('utf-8'))
        elif kind == 0x004E4942:
            binary = payload

    if gltf is None or binary is None:
        raise SystemExit('expected a json and a bin chunk')

    grayscale = occlusion_only(gltf)
    views = gltf['bufferViews']
    replaced = {}

    for index, image in enumerate(gltf.get('images', [])):
        view = views[image['bufferView']]
        start = view.get('byteOffset', 0)
        payload = binary[start:start + view['byteLength']]

        encoded = encode(payload, index in grayscale)
        if len(encoded) >= len(payload):
            print('%-32s %7.0fk kept, jpeg was no smaller' % (image.get('name', '?'), len(payload) / 1e3))
            continue

        replaced[image['bufferView']] = encoded
        image['mimeType'] = 'image/jpeg'
        print('%-32s %7.0fk -> %6.0fk%s' % (image.get('name', '?'), len(payload) / 1e3,
                                            len(encoded) / 1e3, ' (gray)' if index in grayscale else ''))

    # Rebuild the binary chunk in view order, since every offset moves once one
    # image changes size. Accessors want 4 byte alignment, so each view is padded.
    rebuilt = bytearray()
    for index, view in enumerate(views):
        payload = replaced.get(index)
        if payload is None:
            start = view.get('byteOffset', 0)
            payload = binary[start:start + view['byteLength']]

        rebuilt.extend(bytes(pad(len(rebuilt))))
        view['byteOffset'] = len(rebuilt)
        view['byteLength'] = len(payload)
        rebuilt.extend(payload)

    gltf['buffers'][0]['byteLength'] = len(rebuilt)

    json_chunk = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    json_chunk += b' ' * pad(len(json_chunk))
    rebuilt.extend(bytes(pad(len(rebuilt))))

    total = 12 + 8 + len(json_chunk) + 8 + len(rebuilt)
    out = bytearray()
    out.extend(struct.pack('<III', 0x46546C67, 2, total))
    out.extend(struct.pack('<II', len(json_chunk), 0x4E4F534A))
    out.extend(json_chunk)
    out.extend(struct.pack('<II', len(rebuilt), 0x004E4942))
    out.extend(rebuilt)

    open(path, 'wb').write(out)
    print('\n%s: %.1f MB -> %.1f MB' % (path, len(original) / 1e6, len(out) / 1e6))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'build/assets/world.glb')
