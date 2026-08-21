#!/usr/bin/env python3
"""
Turns a plain car .glb into one Sketchbook can drive.

Sketchbook reads a vehicle's parts out of custom properties on the nodes:
wheels, seats, entry points, collision shapes and a first person camera point.
A model from an asset pack has none of those. It also usually bakes the wheel
positions into the mesh vertices and leaves every node at the origin, which
Sketchbook can't use, because it drives each wheel from the physics simulation
and reads the node's position to know where that wheel is bolted on.

So this:

  * scales everything so the wheels match Sketchbook's physics wheel radius
  * moves each wheel's geometry onto its own node, at the right position
  * reuses the front wheel meshes for the rear, since packs often model the
    rear pair as one fused mesh that can't be steered or spun separately
  * writes the seats, entry points, collision shapes and camera point

Usage:
    python3 tools/ImportCar.py "<source>.glb" build/assets/sportscar.glb
"""

import json
import struct
import sys

# Sketchbook hard codes the raycast wheel radius in Car.ts, so the visible
# wheel has to be scaled to match or the car looks like it floats
PHYSICS_WHEEL_RADIUS = 0.25

# Where the wheel actually comes to rest below its connection point, which is
# not suspensionRestLength: the spring is carrying the car, so it sits
# compressed. Measured in game rather than derived, since it depends on the
# vehicle's mass and spring rate. Getting this wrong sits the body on its belly.
LOADED_SUSPENSION = 0.236
CONNECTION_LIFT = 0.2


def read_glb(path):
    data = open(path, 'rb').read()
    magic, version, total = struct.unpack('<III', data[:12])
    if magic != 0x46546C67:
        raise SystemExit('%s is not a glb' % path)

    offset = 12
    gltf = None
    binary = None

    while offset < total:
        length, kind = struct.unpack('<II', data[offset:offset + 8])
        chunk = data[offset + 8:offset + 8 + length]
        if kind == 0x4E4F534A:
            gltf = json.loads(chunk.decode('utf-8'))
        elif kind == 0x004E4942:
            binary = bytearray(chunk)
        offset += 8 + length + ((4 - length % 4) % 4)

    return gltf, binary


def write_glb(path, gltf, binary):
    js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    binary += b'\x00' * ((4 - len(binary) % 4) % 4)

    body = (struct.pack('<II', len(js), 0x4E4F534A) + js +
            struct.pack('<II', len(binary), 0x004E4942) + bytes(binary))

    open(path, 'wb').write(struct.pack('<III', 0x46546C67, 2, 12 + len(body)) + body)


def position_accessors(gltf, mesh_index):
    return {p['attributes']['POSITION'] for p in gltf['meshes'][mesh_index]['primitives']}


def accessor_points(gltf, binary, index):
    """Byte offset of every vertex position in an accessor."""
    accessor = gltf['accessors'][index]
    view = gltf['bufferViews'][accessor['bufferView']]
    stride = view.get('byteStride') or 12
    base = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)

    return [base + i * stride for i in range(accessor['count'])]


def transform_mesh(gltf, binary, mesh_index, offset, scale, done):
    """Shifts a mesh's vertices by -offset then scales them, in place."""
    lo = [1e30] * 3
    hi = [-1e30] * 3

    for index in position_accessors(gltf, mesh_index):
        if index in done:
            raise SystemExit('accessor %d is shared between meshes' % index)
        done.add(index)

        for at in accessor_points(gltf, binary, index):
            x, y, z = struct.unpack_from('<fff', binary, at)
            point = ((x - offset[0]) * scale, (y - offset[1]) * scale, (z - offset[2]) * scale)
            struct.pack_into('<fff', binary, at, *point)

            for k in range(3):
                lo[k] = min(lo[k], point[k])
                hi[k] = max(hi[k], point[k])

        gltf['accessors'][index]['min'] = [lo[0], lo[1], lo[2]]
        gltf['accessors'][index]['max'] = [hi[0], hi[1], hi[2]]

    return lo, hi


def mesh_bounds(gltf, mesh_index):
    lo = [1e30] * 3
    hi = [-1e30] * 3

    for index in position_accessors(gltf, mesh_index):
        accessor = gltf['accessors'][index]
        for k in range(3):
            lo[k] = min(lo[k], accessor['min'][k])
            hi[k] = max(hi[k], accessor['max'][k])

    return lo, hi


def centre(lo, hi):
    return [(lo[k] + hi[k]) / 2 for k in range(3)]


def node(name, translation=None, scale=None, mesh=None, extras=None):
    entry = {'name': name}
    if translation is not None:
        entry['translation'] = [round(v, 4) for v in translation]
    if scale is not None:
        entry['scale'] = [round(v, 4) for v in scale]
    if mesh is not None:
        entry['mesh'] = mesh
    if extras is not None:
        entry['extras'] = extras
    return entry


def main():
    source, destination = sys.argv[1], sys.argv[2]
    gltf, binary = read_glb(source)

    # Work out which mesh is what. Packs name them, and the fused rear pair is
    # obvious from its width: a single wheel is thin along x, a pair is not.
    body = None
    wheels = []
    fused = []

    for i, mesh in enumerate(gltf['meshes']):
        name = (mesh.get('name') or '').lower()
        lo, hi = mesh_bounds(gltf, i)
        width = hi[0] - lo[0]
        depth = hi[2] - lo[2]

        if 'wheel' in name:
            (wheels if width < depth else fused).append(i)
        elif body is None:
            body = i

    if body is None or len(wheels) < 2:
        raise SystemExit('expected a body mesh and at least two separate wheel meshes')

    # Left is +x in Sketchbook, matching its own car
    wheels.sort(key=lambda i: -centre(*mesh_bounds(gltf, i))[0])
    left_wheel, right_wheel = wheels[0], wheels[1]

    left_at = centre(*mesh_bounds(gltf, left_wheel))
    right_at = centre(*mesh_bounds(gltf, right_wheel))
    wheel_lo, wheel_hi = mesh_bounds(gltf, left_wheel)
    wheel_radius = (wheel_hi[1] - wheel_lo[1]) / 2

    scale = PHYSICS_WHEEL_RADIUS / wheel_radius

    # The fused rear mesh spans from the outer edge of one wheel to the other,
    # so its wheels sit a half width in from each end
    if fused:
        rear_lo, rear_hi = mesh_bounds(gltf, fused[0])
        half = (wheel_hi[0] - wheel_lo[0]) / 2
        rear_x = rear_hi[0] - half
        rear_z = centre(rear_lo, rear_hi)[2]
    else:
        rear_x = abs(left_at[0])
        rear_z = -left_at[2]

    body_lo, body_hi = mesh_bounds(gltf, body)

    done = set()
    transform_mesh(gltf, binary, body, [0, 0, 0], scale, done)
    transform_mesh(gltf, binary, left_wheel, left_at, scale, done)
    transform_mesh(gltf, binary, right_wheel, right_at, scale, done)

    # Put the node where the loaded wheel ends up back at the height the model
    # drew it, so the body keeps the ride height its author intended
    axle_y = left_at[1] * scale + LOADED_SUSPENSION - CONNECTION_LIFT

    front_z = left_at[2] * scale
    back_z = rear_z * scale
    left_x = left_at[0] * scale
    right_x = right_at[0] * scale
    rear_left_x = rear_x * scale
    rear_right_x = -rear_x * scale

    top = body_hi[1] * scale
    bottom = body_lo[1] * scale
    half_width = body_hi[0] * scale
    nose = body_hi[2] * scale
    tail = body_lo[2] * scale

    waist = bottom + (top - bottom) * 0.45
    cabin_y = bottom + (top - bottom) * 0.72

    nodes = [
        node('body', mesh=body),
        # Rear wheels reuse the front meshes: the pack fuses the real rear pair
        # into one mesh, which can't be spun or steered as two
        node('wheel_fl', [left_x, axle_y, front_z], mesh=left_wheel,
             extras={'data': 'wheel', 'drive': 'fwd', 'steering': 'true'}),
        node('wheel_fr', [right_x, axle_y, front_z], mesh=right_wheel,
             extras={'data': 'wheel', 'drive': 'fwd', 'steering': 'true'}),
        node('wheel_rl', [rear_left_x, axle_y, back_z], mesh=left_wheel,
             extras={'data': 'wheel', 'drive': 'rwd'}),
        node('wheel_rr', [rear_right_x, axle_y, back_z], mesh=right_wheel,
             extras={'data': 'wheel', 'drive': 'rwd'}),

        node('seat_1', [half_width * 0.42, waist + 0.06, -0.15], extras={
            'data': 'seat', 'seat_type': 'driver',
            'entry_points': 'entrance_1', 'connected_seats': 'seat_2'}),
        node('seat_2', [-half_width * 0.42, waist + 0.06, -0.15], extras={
            'data': 'seat', 'seat_type': 'passenger',
            'entry_points': 'entrance_2', 'connected_seats': 'seat_1'}),
        node('entrance_1', [half_width + 0.45, bottom - 0.2, -0.15]),
        node('entrance_2', [-half_width - 0.45, bottom - 0.2, -0.15]),

        node('camera', [half_width * 0.42, cabin_y + 0.12, -0.05], extras={'data': 'camera'}),

        node('collision_body', [0, waist, (nose + tail) / 2],
             scale=[half_width * 0.88, (waist - bottom) * 1.1, (nose - tail) / 2 * 0.94],
             extras={'data': 'collision', 'shape': 'box'}),
        node('collision_cabin', [0, cabin_y, (nose + tail) / 2 - 0.25],
             scale=[half_width * 0.66, (top - cabin_y) * 1.1, (nose - tail) / 5],
             extras={'data': 'collision', 'shape': 'box'}),
    ]

    # Spheres are what actually meets the world's trimesh: Sketchbook masks the
    # boxes out of it so a car can't catch on terrain triangles.
    #
    # They're kept well clear of the ground on purpose. The wheels are what hold
    # the car up, and a sphere hanging too low would take the weight itself
    # whenever the suspension compressed, which rides like a rock.
    radius = half_width * 0.3
    clearance = radius * 0.5

    for zi in range(4):
        z = tail + (nose - tail) * (0.14 + 0.24 * zi)
        for side in (1, -1):
            nodes.append(node('collision_skirt_%d_%d' % (zi, side),
                              [side * (half_width - radius), bottom + radius + clearance, z],
                              scale=[radius] * 3,
                              extras={'data': 'collision', 'shape': 'sphere'}))

    for zi in range(2):
        z = tail + (nose - tail) * (0.32 + 0.3 * zi)
        for side in (1, -1):
            nodes.append(node('collision_shoulder_%d_%d' % (zi, side),
                              [side * (half_width - radius), cabin_y, z],
                              scale=[radius] * 3,
                              extras={'data': 'collision', 'shape': 'sphere'}))

    gltf['nodes'] = nodes
    gltf['scenes'] = [{'nodes': list(range(len(nodes)))}]
    gltf['scene'] = 0
    gltf.pop('animations', None)
    gltf.pop('skins', None)

    write_glb(destination, gltf, binary)

    print('%s -> %s' % (source, destination))
    print('  scale          %.3f  (wheel radius %.3f -> %.2f)' % (scale, wheel_radius, PHYSICS_WHEEL_RADIUS))
    print('  body           %.2f wide, %.2f tall, %.2f long'
          % (half_width * 2, top - bottom, nose - tail))
    print('  wheelbase      %.2f   track %.2f   axle y %.2f' % (front_z - back_z, left_x - right_x, axle_y))
    print('  nodes          %d (4 wheels, 2 seats, %d collision shapes)'
          % (len(nodes), sum(1 for n in nodes if (n.get('extras') or {}).get('data') == 'collision')))


if __name__ == '__main__':
    main()
