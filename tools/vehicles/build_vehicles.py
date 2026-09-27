"""
Turns GGBotNet's CC0 'PSX Style Cars' (https://ggbot.itch.io/psx-style-cars)
into drivable game vehicles, and builds a motorbike from scratch to go with them.

    blender -b --factory-startup -P tools/vehicles/build_vehicles.py -- <psx_cars dir> build/assets [name ...]

With no names it builds DEFAULT; CARS has two more ready to build by name.
Each car is one mesh in the pack with its wheels baked in as loose 8-sided
drums. Those are cut out into four wheel objects, the rest is scaled to the
world (a person is one unit tall, a metre 0.58 of one) and given the markers
car.glb has, which the game finds by their custom properties (glTF extras):

  wheel_fl/fr/rl/rr  the wheel meshes themselves, {data: wheel, drive, steering}
  seat_1..4          {data: seat}, the driver's on the left (+X), as in car.glb
  entrance_1..4      where a seat is climbed into from, on the ground beside it
  Empty              {data: camera}, the driver's eyes
  collision boxes    {data: collision, shape: box}, scale = half extents
  collision spheres  {data: collision, shape: sphere}, scale = radius
  headlight_l/r, taillight_l/r   plain empties on the lamps, for night glows

Bodywork is 'Car', which the game paints over a light grey texture; glass,
chrome and lamps are 'Glass' and 'Chrome' and keep their colours, and the taxi
and police car are all 'Livery', which traffic leaves alone.

glTF has +Y up and +Z forward; in Blender that's +Z up and -Y forward, so the
front of every vehicle here points down -Y. The road is at y = -0.358 under the
origin, like car.glb and TrafficCar.RIDE.
"""
import bpy, bmesh, os, sys, math, json, struct
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index('--') + 1:]
SOURCE, OUTPUT = args[0], args[1]

DEFAULT = ['hatchback', 'sedan', 'taxi', 'police', 'van', 'motorbike']

# Road height under the origin, the same as car.glb's (its wheels' bottoms and
# entry points) and TrafficCar.RIDE, so every model sits on the road the same way
GROUND = -0.358
# The physics wheel is 0.25 in Car.ts, and it hangs from 0.2 above the marker,
# so the marker is the wheel's centre at rest
WHEEL_CENTRE = 0.25
# The wheels are octagons: 0.26 to a corner puts the flats at 0.24, so they roll
# round the 0.25 physics wheel without sinking into the road or floating
WHEEL_CORNER = 0.26

# How a character sits, measured off the player's 'driving' pose. Its origin
# goes 0.6 above the seat point (VehicleSeat.SIT_HEIGHT) and its model hangs
# 0.57 below that, so relative to the seat point:
HEAD_TOP = 0.54      # top of the head
FEET = 0.21          # soles, below
HEAD_BACK = 0.06     # head's centre, behind the seat point
ROW_GAP = 0.53       # front seat to back seat, as in car.glb: knees clear the seat ahead
EYES = Vector((0, 0.10, 0.47))                 # first person camera, from the driver's seat
STEERING = Vector((0, -0.245, 0.27))            # steering wheel centre, from the driver's seat
ENTRY_OUT = 0.39     # entry points stand this far out from the side, as in car.glb
ENTRY_BACK = 0.116   # and this far behind the seat

# The pack's models, each with the colour variant whose paint is easiest to
# tell from its glass and chrome, and whether the game paints it ('Car') or
# it wears a livery that stays as it is. Car 06 is a rusted shell and Car 07 a
# 1920s tourer, so neither is here.
CARS = {
    'hatchback': {'obj': 'Car 03/Car3.obj', 'texture': 'Car 03/car3_yellow.png'},
    'sedan':     {'obj': 'Car 05/Car5.obj', 'texture': 'Car 05/car5_green.png'},
    'taxi':      {'obj': 'Car 05/Car5_Taxi.obj', 'texture': 'Car 05/car5_taxi.png', 'livery': True},
    'police':    {'obj': 'Car 05/Car5_Police.obj', 'texture': 'Car 05/car5_police.png', 'livery': True},
    'van':       {'obj': 'Car 04/Car4.obj', 'texture': 'Car 04/car4.png'},
    # Not built unless named: an estate and a small saloon, ready if wanted
    'wagon':     {'obj': 'Car 01/Car.obj', 'texture': 'Car 01/car.png'},
    'compact':   {'obj': 'Car 02/Car2.obj', 'texture': 'Car 02/car2_red.png'},
}
# The pack runs about 1.45 of its units to the metre. One scale for all keeps
# the van bigger than the hatchback; this one makes them 15% over life size,
# which gives a seated character headroom under the lower roofs
SCALE = 0.46

# A face showing less body colour than this is glass or chrome, and keeps its
# colours when the game paints the car
TRIM_BELOW = 0.2
LAMPS_OVER = 0.15
# Body colour in the paint texture: the game multiplies its paint over this,
# and the source's shading is kept at this power of its contrast
PAINT_LEVEL = 0.9
PAINT_CONTRAST = 0.6


def reset():
    global _box_mesh, _ball_mesh
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _box_mesh = _ball_mesh = None


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def islands(bm):
    """Groups of vertices joined by edges: the pack's wheels, mirrors and bumpers are loose parts."""
    bm.verts.ensure_lookup_table()
    unvisited = set(bm.verts)
    groups = []
    while unvisited:
        start = unvisited.pop()
        group = [start]
        stack = [start]
        while stack:
            vert = stack.pop()
            for edge in vert.link_edges:
                other = edge.other_vert(vert)
                if other in unvisited:
                    unvisited.remove(other)
                    group.append(other)
                    stack.append(other)
        groups.append(set(v.index for v in group))
    return groups


def bounds(points):
    points = list(points)
    low = Vector([min(p[i] for p in points) for i in range(3)])
    high = Vector([max(p[i] for p in points) for i in range(3)])
    return low, high


def keep_only(obj, keep, name):
    """A copy of obj with only the given vertices left."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in keep], context='VERTS')
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    return link(bpy.data.objects.new(name, mesh))


def delete_verts(obj, remove):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index in remove], context='VERTS')
    bm.to_mesh(obj.data)
    bm.free()


def load_pixels(path):
    image = bpy.data.images.load(path)
    width, height = image.size
    pixels = np.empty(width * height * 4, np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    return pixels.reshape(height, width, 4)


def make_image(name, pixels):
    height, width = pixels.shape[:2]
    image = bpy.data.images.new(name, width, height, alpha=True)
    image.pixels.foreach_set(pixels.astype(np.float32).ravel())
    image.file_format = 'PNG'
    image.pack()
    return image


def body_colour(rgb):
    """The commonest colour in the atlas, which in all of the pack's is the bodywork."""
    levels = (rgb * 15).round().astype(int)
    keys = levels[..., 0] * 256 + levels[..., 1] * 16 + levels[..., 2]
    values, counts = np.unique(keys, return_counts=True)
    top = values[np.argmax(counts)]
    top = np.array([top // 256, (top // 16) % 16, top % 16])
    near = np.abs(levels - top).max(-1) <= 1
    return rgb[near].mean(0)


def split_texture(pixels):
    """
    From one of the pack's colour variants: how much each texel is bodywork,
    a paint texture with the bodywork turned a light grey for the game to tint
    (its panel lines and shading kept), and a trim texture for glass, chrome
    and tyres with what bodywork shows on them turned a neutral dark grey.
    Bodywork is told apart by its hue, and by not being as dark as glass.
    """
    rgb = pixels[..., :3]
    body = body_colour(rgb)
    value = rgb.max(-1)
    body_value = body.max()
    hue = rgb / np.maximum(value, 1e-3)[..., None]
    body_hue = body / body_value
    hue_distance = np.abs(hue - body_hue).max(-1)
    ratio = value / body_value
    bodywork = np.clip(1 - (hue_distance - 0.1) / 0.15, 0, 1) * np.clip((ratio - 0.3) / 0.2, 0, 1)
    # Softened, so the pack's grime and shading don't turn a white car grubby
    grey = np.clip(np.maximum(ratio, 0) ** PAINT_CONTRAST * PAINT_LEVEL, 0, 1)[..., None]
    # All grey, the rest too: any colour left in it, even a fringe of the
    # source's paint round a trim line, shows through whatever the game paints
    paint = pixels.copy()
    paint[..., :3] = bodywork[..., None] * grey + (1 - bodywork[..., None]) * value[..., None]
    # By hue alone, so the fringe where paint meets chrome goes grey too
    tinged = (np.clip(1 - (hue_distance - 0.1) / 0.15, 0, 1) * (value > 0.08))[..., None]
    trim = pixels.copy()
    trim[..., :3] = tinged * (value * 0.5)[..., None] + (1 - tinged) * rgb
    paint[..., 3] = 1
    trim[..., 3] = 1
    return bodywork, paint, trim


def texels_under(uvs, width, height):
    """Texel coordinates whose centres fall inside a face's UV polygon, or its middle if none do."""
    points = [(u * width, v * height) for u, v in uvs]
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    found = []
    for x in range(max(0, int(min(xs))), min(width, int(max(xs)) + 1)):
        for y in range(max(0, int(min(ys))), min(height, int(max(ys)) + 1)):
            cx, cy = x + 0.5, y + 0.5
            for i in range(1, len(points) - 1):
                a, b, c = points[0], points[i], points[i + 1]
                d1 = (b[0] - a[0]) * (cy - a[1]) - (b[1] - a[1]) * (cx - a[0])
                d2 = (c[0] - b[0]) * (cy - b[1]) - (c[1] - b[1]) * (cx - b[0])
                d3 = (a[0] - c[0]) * (cy - c[1]) - (a[1] - c[1]) * (cx - c[0])
                if (d1 >= 0 and d2 >= 0 and d3 >= 0) or (d1 <= 0 and d2 <= 0 and d3 <= 0):
                    found.append((x, y))
                    break
    if not found:
        cx = min(width - 1, max(0, int(sum(xs) / len(xs))))
        cy = min(height - 1, max(0, int(sum(ys) / len(ys))))
        found.append((cx, cy))
    return found


def texel_groups(texels):
    """Texels split into groups that touch, sides or corners."""
    left = set(texels)
    groups = []
    while left:
        start = left.pop()
        group = [start]
        stack = [start]
        while stack:
            x, y = stack.pop()
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    other = (x + dx, y + dy)
                    if other in left:
                        left.remove(other)
                        group.append(other)
                        stack.append(other)
        groups.append(group)
    return groups


def split_face(face, uv_layer, axis, value):
    """Cuts a face in two along a line in its UVs (u or v = value), if the line crosses it."""
    loops = list(face.loops)
    offsets = [loop[uv_layer].uv[axis] - value for loop in loops]
    crossings = []
    for i in range(len(loops)):
        a, b = offsets[i], offsets[(i + 1) % len(loops)]
        if (a < -1e-4 and b > 1e-4) or (a > 1e-4 and b < -1e-4):
            crossings.append((loops[i], a / (a - b)))
    if len(crossings) != 2:
        return [face]
    new_verts = []
    for loop, t in crossings:
        _, vert = bmesh.utils.edge_split(loop.edge, loop.vert, t)
        # Every face on the edge gets the new corner: give each its own UV
        # partway along its side, since a seam can run down the edge
        for corner in vert.link_loops:
            before, after = corner.link_loop_prev, corner.link_loop_next
            span = (after.vert.co - before.vert.co).length
            f = (vert.co - before.vert.co).length / span if span > 0 else 0.5
            corner[uv_layer].uv = before[uv_layer].uv.lerp(after[uv_layer].uv, f)
        new_verts.append(vert)
    other, _ = bmesh.utils.face_split(face, new_verts[0], new_verts[1])
    return [face, other]


def cut_out_lamps(obj, bodywork, lamps):
    """
    Tail lights and indicators are often drawn on a panel of bodywork, and
    under the game's paint they'd go the car's colour. Cutting round each lamp
    lets the lamp stay unpainted while the rest of the panel is painted.
    """
    height, width = lamps.shape
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv_layer = bm.loops.layers.uv.active
    cut = 0
    for face in list(bm.faces):
        texels = texels_under([loop[uv_layer].uv for loop in face.loops], width, height)
        share = sum(bodywork[y, x] for x, y in texels) / len(texels)
        lit = [(x, y) for x, y in texels if lamps[y, x]]
        if share < TRIM_BELOW or len(lit) < 4 or len(lit) > 0.7 * len(texels):
            continue
        pieces = [face]
        for group in texel_groups(lit):
            if len(group) < 4:
                continue
            xs = [x for x, _ in group]
            ys = [y for _, y in group]
            for axis, value in ((0, min(xs) / width), (0, (max(xs) + 1) / width),
                                (1, min(ys) / height), (1, (max(ys) + 1) / height)):
                pieces = [piece for p in pieces for piece in split_face(p, uv_layer, axis, value)]
        cut += len(pieces) > 1
    bm.to_mesh(obj.data)
    bm.free()
    return cut


def material(name, image, roughness=0.5):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    shader = nodes.get('Principled BSDF')
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = image
    # Crisp texels, the PSX look; the exporter writes it as a nearest filter
    texture.interpolation = 'Closest'
    mat.node_tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = 0
    # The pack's normals all face out, so one side is enough, and from the
    # first person camera inside the shell the world shows through
    mat.use_backface_culling = True
    return mat


def set_props(obj, **props):
    for key, value in props.items():
        obj[key] = value
    return obj


def empty(name, location, **props):
    obj = link(bpy.data.objects.new(name, None))
    obj.location = location
    obj.empty_display_size = 0.1
    return set_props(obj, **props)


_box_mesh = None
_ball_mesh = None


def collision_box(name, centre, half):
    """A unit cube scaled to half extents: the game reads the node's scale, not the mesh."""
    global _box_mesh
    if _box_mesh is None:
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=2)
        _box_mesh = bpy.data.meshes.new('collision_box')
        bm.to_mesh(_box_mesh)
        bm.free()
    obj = link(bpy.data.objects.new(name, _box_mesh))
    obj.location = centre
    obj.scale = half
    obj.display_type = 'WIRE'
    return set_props(obj, data='collision', shape='box')


def collision_ball(name, centre, radius):
    global _ball_mesh
    if _ball_mesh is None:
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1)
        _ball_mesh = bpy.data.meshes.new('collision_sphere')
        bm.to_mesh(_ball_mesh)
        bm.free()
    obj = link(bpy.data.objects.new(name, _ball_mesh))
    obj.location = centre
    obj.scale = (radius, radius, radius)
    obj.display_type = 'WIRE'
    return set_props(obj, data='collision', shape='sphere')


def texel_points(obj, facing, wanted, width, height):
    """
    Where on the model the wanted texels are drawn, for faces looking along
    facing (-1 forward, +1 back), found through each triangle's UVs.
    """
    uv = obj.data.uv_layers.active.data
    points = []
    for poly in obj.data.polygons:
        if poly.normal.y * facing < 0.5:
            continue
        corners = [(uv[i].uv.copy(), obj.data.vertices[obj.data.loops[i].vertex_index].co.copy()) for i in poly.loop_indices]
        for k in range(1, len(corners) - 1):
            (a, pa), (b, pb), (c, pc) = corners[0], corners[k], corners[k + 1]
            area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)
            if abs(area) < 1e-9:
                continue
            xs = [a.x * width, b.x * width, c.x * width]
            ys = [a.y * height, b.y * height, c.y * height]
            for x in range(max(0, int(min(xs))), min(width, int(max(xs)) + 1)):
                for y in range(max(0, int(min(ys))), min(height, int(max(ys)) + 1)):
                    if not wanted[y, x]:
                        continue
                    u, v = (x + 0.5) / width, (y + 0.5) / height
                    wb = ((u - a.x) * (c.y - a.y) - (c.x - a.x) * (v - a.y)) / area
                    wc = ((b.x - a.x) * (v - a.y) - (u - a.x) * (b.y - a.y)) / area
                    wa = 1 - wb - wc
                    if min(wa, wb, wc) >= -1e-6:
                        points.append(pa * wa + pb * wb + pc * wc)
    return points


def lamp_markers(points, name, below):
    """
    Empties at the middle of a patch of lamp on the left, and its mirror on
    the right: name_l and name_r. Nothing reads them yet; they're
    for the night glows TrafficCar puts where car.glb's lamps are. A patch
    reaching the middle is a bumper or a grille, and above the waist it's a
    roof sign or a light bar.
    """
    left = [p for p in points if p.x > 0 and p.z < below]
    groups = []
    for point in left:
        joined = [g for g in groups if any((point - q).length < 0.045 for q in g)]
        merged = [point]
        for g in joined:
            merged += g
            groups.remove(g)
        groups.append(merged)
    groups = [g for g in groups if min(p.x for p in g) > 0.12]
    if not groups:
        print('WARNING no', name, 'found', flush=True)
        return None
    # Of the patches of any size, the highest: a chrome bumper's end, the
    # other thing that looks like a lamp, is always lower
    most = max(len(g) for g in groups)
    lamp = max((g for g in groups if len(g) >= 0.25 * most), key=lambda g: sum(p.z for p in g) / len(g))
    centre = sum(lamp, Vector()) / len(lamp)
    empty(name + '_l', centre)
    empty(name + '_r', (-centre.x, centre.y, centre.z))
    return centre


class Probe:
    """Rays against a mesh, for finding its roof, floor and ends."""

    def __init__(self, obj):
        self.tree = BVHTree.FromPolygons([v.co.copy() for v in obj.data.vertices],
                                         [tuple(p.vertices) for p in obj.data.polygons])

    def cast(self, origin, direction):
        hit = self.tree.ray_cast(Vector(origin), Vector(direction), 100)
        return hit[0]

    def top(self, x, y):
        hit = self.cast((x, y, 50), (0, 0, -1))
        return None if hit is None else hit.z

    def bottom(self, x, y):
        hit = self.cast((x, y, -50), (0, 0, 1))
        return None if hit is None else hit.z

    def front(self, x, z):
        hit = self.cast((x, -50, z), (0, 1, 0))
        return None if hit is None else hit.y

    def rear(self, x, z):
        hit = self.cast((x, 50, z), (0, -1, 0))
        return None if hit is None else hit.y

    def side(self, y, z):
        hit = self.cast((50, y, z), (-1, 0, 0))
        return None if hit is None else hit.x


def steering_wheel(location, wheel_material, uv_point):
    """
    A plain ring and hub for the first person view, turned about the car's
    forward axis by the game. It shares the tyres' material, every corner of it
    on one dark texel of the tyre.
    """
    parent = empty('Steer parent', location)
    bm = bmesh.new()
    sides = 10
    ring, tube = 0.085, 0.012
    rings = []
    for i in range(sides):
        a = 2 * math.pi * i / sides
        centre = Vector((math.cos(a) * ring, 0, math.sin(a) * ring))
        loop = []
        for j in range(4):
            b = 2 * math.pi * j / 4
            offset = Vector((math.cos(a), 0, math.sin(a))) * math.cos(b) * tube + Vector((0, math.sin(b) * tube, 0))
            loop.append(bm.verts.new(centre + offset))
        rings.append(loop)
    for i in range(sides):
        a, b = rings[i], rings[(i + 1) % sides]
        for j in range(4):
            bm.faces.new((a[j], a[(j + 1) % 4], b[(j + 1) % 4], b[j]))
    # A bar across and the hub, so it reads as a steering wheel when it turns
    bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Diagonal((ring * 2, tube * 1.5, tube * 1.5, 1)))
    bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.02, radius2=0.02, depth=0.08,
                          matrix=Matrix.Translation((0, 0.04, 0)) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
    mesh = bpy.data.meshes.new('Steering wheel')
    bm.to_mesh(mesh)
    bm.free()
    uv = mesh.uv_layers.new()
    for corner in uv.data:
        corner.uv = uv_point
    mesh.materials.append(wheel_material)
    wheel = link(bpy.data.objects.new('Steering wheel', mesh))
    wheel.parent = parent
    wheel['data'] = 'steering_wheel'
    return parent


def build_car(name, spec):
    reset()
    bpy.ops.wm.obj_import(filepath=os.path.join(SOURCE, spec['obj']))
    body = bpy.context.selected_objects[0]
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    body.data.materials.clear()
    body.name = 'body'
    body.data.name = name + '_body'
    for v in body.data.vertices:
        v.co *= SCALE

    # The wheels: loose parts standing on the ground, about as long as they're tall
    bm = bmesh.new()
    bm.from_mesh(body.data)
    groups = islands(bm)
    coords = [v.co.copy() for v in bm.verts]
    bm.free()
    floor = min(c.z for c in coords)
    height = max(c.z for c in coords) - floor
    wheels = []
    for group in groups:
        low, high = bounds(coords[i] for i in group)
        size = high - low
        if low.z < floor + 0.05 * height and abs(size.y - size.z) < 0.15 * size.z and size.x < 0.5 * size.z:
            wheels.append((group, (low + high) / 2, size.z / 2))
    if len(wheels) != 4:
        raise RuntimeError('%s: expected 4 wheels, found %d' % (name, len(wheels)))

    # Centred between the axles, so the car's weight sits evenly on its wheels,
    # and lifted so the (larger) wheels' centres stay where the pack's were
    centres = [c for _, c, _ in wheels]
    old_radius = sum(r for _, _, r in wheels) / 4
    grow = WHEEL_CORNER / old_radius
    front_axle = min(c.y for c in centres)
    rear_axle = max(c.y for c in centres)
    shift = Vector((-sum(c.x for c in centres) / 4, -(front_axle + rear_axle) / 2,
                    GROUND + WHEEL_CENTRE - sum(c.z for c in centres) / 4))

    wheel_objects = []
    for group, centre, radius in wheels:
        left = centre.x > 0
        front = centre.y < 0
        wheel_name = 'wheel_' + ('f' if front else 'r') + ('l' if left else 'r')
        wheel = keep_only(body, group, wheel_name)
        wheel.data.name = name + '_' + wheel_name
        for v in wheel.data.vertices:
            v.co = (v.co - centre) * grow
        wheel.location = centre + shift
        # The game drives these from the physics wheels: steer and power the front
        if front:
            set_props(wheel, data='wheel', steering='true', drive='fwd')
        else:
            set_props(wheel, data='wheel', drive='rwd')
        wheel_objects.append(wheel)
    delete_verts(body, set().union(*[g for g, _, _ in wheels]))
    for v in body.data.vertices:
        v.co += shift

    # Textures and materials
    pixels = load_pixels(os.path.join(SOURCE, spec['texture']))
    height_px, width_px = pixels.shape[:2]
    bodywork, paint, trim = split_texture(pixels)
    rgb = pixels[..., :3]
    value = rgb.max(-1)
    saturation = (value - rgb.min(-1)) / np.maximum(value, 1e-3)
    if spec.get('livery'):
        livery = make_image(name + '_livery', pixels)
        # Not 'Car', so traffic and the paint shop leave the livery alone
        body.data.materials.append(material('Livery', livery))
        wheel_material = material('Wheel', livery, roughness=0.75)
    else:
        # Lamps and brightwork: strongly coloured, or pale and grey, and not bodywork
        lamps = (bodywork < 0.5) & (((saturation > 0.45) & (value > 0.35)) | ((saturation < 0.25) & (value > 0.6)))
        print('LAMPS', name, 'faces cut round lamps', cut_out_lamps(body, bodywork, lamps), flush=True)
        paint_image = make_image(name + '_paint', paint)
        trim_image = make_image(name + '_trim', trim)
        # Names the game won't tint: 'Car' is repainted, glass and chrome
        # keep their colour (Vehicle.UNPAINTED), as do the tyres
        body.data.materials.append(material('Car', paint_image))
        body.data.materials.append(material('Glass', trim_image, roughness=0.2))
        body.data.materials.append(material('Chrome', trim_image, roughness=0.3))
        wheel_material = material('Wheel', trim_image, roughness=0.75)
        uv = body.data.uv_layers.active.data
        counts = [0, 0, 0]
        for poly in body.data.polygons:
            uvs = [uv[i].uv for i in poly.loop_indices]
            texels = texels_under(uvs, width_px, height_px)
            share = sum(bodywork[y, x] for x, y in texels) / len(texels)
            lit = sum(lamps[y, x] for x, y in texels) / len(texels)
            # A tail light panel shows some bodywork too, but painted over
            # its lamps go dark, so lamps win when they're a fair part of it
            if share >= TRIM_BELOW and not (lit >= LAMPS_OVER and share < 0.4):
                poly.material_index = 0
            else:
                darkness = sum(pixels[y, x, :3].max() for x, y in texels) / len(texels)
                poly.material_index = 1 if darkness < 0.3 else 2
            counts[poly.material_index] += 1
        print('FACES', name, 'paint', counts[0], 'glass', counts[1], 'chrome', counts[2], flush=True)
        # Drop a slot nothing uses, so it isn't exported
        for index in reversed(range(3)):
            if counts[index] == 0:
                body.data.materials.pop(index=index)
                for poly in body.data.polygons:
                    if poly.material_index > index:
                        poly.material_index -= 1
    for wheel in wheel_objects:
        wheel.data.materials.append(wheel_material)

    # Head and tail lamps: pale on the front, red on the back
    pale = (bodywork < 0.5) & (value > 0.6) & (saturation < 0.35)
    red = (bodywork < 0.5) & (rgb[..., 0] > 0.35) & (rgb[..., 0] > 1.6 * rgb[..., 1]) & (rgb[..., 0] > 1.6 * rgb[..., 2])
    low, high = bounds(v.co for v in body.data.vertices)
    waist = (low.z + high.z) / 2
    head = lamp_markers(texel_points(body, -1, pale, width_px, height_px), 'headlight', waist)
    tail = lamp_markers(texel_points(body, 1, red, width_px, height_px), 'taillight', waist)

    # Measure the shell: the biggest loose part, which leaves out mirrors,
    # bumpers and roof signs
    bm = bmesh.new()
    bm.from_mesh(body.data)
    groups = islands(bm)
    bm.free()
    shell_group = max(groups, key=len)
    shell = keep_only(body, shell_group, 'shell')
    probe = Probe(shell)
    shell_low, shell_high = bounds(v.co for v in shell.data.vertices)
    all_low, all_high = bounds(v.co for v in body.data.vertices)
    half_width = max(abs(shell_low.x), abs(shell_high.x))

    # The roof: where the top is within a few centimetres of its highest, at the driver's shoulder
    seat_x = round(0.4 * half_width, 3)
    samples = [shell_low.y + i * 0.01 for i in range(int((shell_high.y - shell_low.y) / 0.01) + 1)]
    tops = [(y, probe.top(seat_x, y)) for y in samples]
    tops = [(y, z) for y, z in tops if z is not None]
    roof_z = max(z for _, z in tops)
    roof = [y for y, z in tops if z > roof_z - 0.04]
    roof_front, roof_rear = min(roof), max(roof)

    def seat_height(x, y):
        """Head clear of the roof above it, feet on the floor if there's room for both."""
        head_y = y + HEAD_BACK
        ceiling = min(z for z in (probe.top(x, head_y + d) for d in (-0.06, 0, 0.06)) if z is not None) - 0.03
        floor_z = probe.bottom(x, y - 0.25)
        if floor_z is None:
            floor_z = shell_low.z
        highest = ceiling - HEAD_TOP
        wanted = floor_z + FEET + 0.03
        return min(highest, wanted), ceiling, floor_z

    front_y = roof_front + 0.24 - HEAD_BACK
    rows = [front_y]
    if front_y + ROW_GAP + HEAD_BACK < roof_rear - 0.06:
        rows.append(front_y + ROW_GAP)
    seats = []
    number = 0
    for row, y in enumerate(rows):
        for side in (1, -1):
            number += 1
            height_z, ceiling, floor_z = seat_height(seat_x * side, y)
            seats.append((number, Vector((seat_x * side, y, height_z)), side, ceiling, floor_z))
    for number, position, side, ceiling, floor_z in seats:
        partner = number + 1 if number % 2 == 1 else number - 1
        props = dict(data='seat', seat_type='driver' if number == 1 else 'passenger',
                     entry_points='entrance_%d' % number, connected_seats='seat_%d' % partner)
        empty('seat_%d' % number, position, **props)
        empty('entrance_%d' % number, (side * (half_width + ENTRY_OUT), position.y + ENTRY_BACK, GROUND))
        print('SEAT', name, number, [round(c, 3) for c in position], 'headroom', round(ceiling - position.z - HEAD_TOP, 3),
              'feet above floor', round(position.z - FEET - floor_z, 3), flush=True)
    driver = seats[0][1]
    empty('Empty', driver + EYES, data='camera')
    # The middle of a face of tread, which is plain dark rubber
    tyre = wheel_objects[0].data
    tread = next(p for p in tyre.polygons if abs(p.normal.x) < 0.5)
    tread_uv = sum((tyre.uv_layers.active.data[i].uv for i in tread.loop_indices), Vector((0, 0))) / len(tread.loop_indices)
    steer = steering_wheel(driver + STEERING, wheel_material, tread_uv)
    steer.parent = body

    # Collision: a box for the lower body, bumper to bumper, and one for the
    # cabin; balls round the sides and roof for the world's meshes, which the
    # boxes don't collide with
    heights = [shell_low.z + i * 0.01 for i in range(int((shell_high.z - shell_low.z) / 0.01))]
    fronts = [(z, probe.front(0, z) or 99) for z in heights]
    nose_z, nose_y = min(fronts, key=lambda f: f[1])
    # The belt line: the first height above the nose where the front has
    # stepped back past the bonnet
    belt = next(z for z, y in fronts if z > nose_z and y > nose_y + 0.22 * (all_high.y - all_low.y))
    bottom = max(shell_low.z, GROUND + 0.12)
    lower_half = Vector((half_width, (all_high.y - all_low.y) / 2, (belt - bottom) / 2))
    lower_centre = Vector((0, (all_high.y + all_low.y) / 2, (belt + bottom) / 2))
    collision_box('collision_body', lower_centre, lower_half)
    cabin_mid = (belt + roof_z) / 2
    cabin_front = probe.front(0, cabin_mid)
    cabin_rear = probe.rear(0, cabin_mid)
    cabin_side = probe.side((roof_front + roof_rear) / 2, cabin_mid)
    cabin_half = Vector((cabin_side, (cabin_rear - cabin_front) / 2, (roof_z - belt) / 2))
    cabin_centre = Vector((0, (cabin_rear + cabin_front) / 2, cabin_mid))
    collision_box('collision_cabin', cabin_centre, cabin_half)

    balls = 0
    radius = min(0.3, half_width / 2, lower_half.z + 0.05)
    length = all_high.y - all_low.y - 2 * radius
    count = max(3, math.ceil(length / (1.7 * radius)) + 1)
    for i in range(count):
        y = all_low.y + radius + length * i / (count - 1)
        for side in (1, -1):
            balls += 1
            collision_ball('collision_ball_%d' % balls, (side * (half_width - radius), y, lower_centre.z), radius)
    top_radius = min(0.3, cabin_side / 2, cabin_half.z)
    roof_length = max(0.0, roof_rear - roof_front - 2 * top_radius)
    top_count = 2 if roof_length > 0 else 1
    for i in range(top_count):
        y = roof_front + top_radius + (roof_length * i / (top_count - 1) if top_count > 1 else 0)
        for side in (1, -1):
            balls += 1
            collision_ball('collision_ball_%d' % balls, (side * (cabin_side - top_radius), y, roof_z - top_radius), top_radius)

    bpy.data.objects.remove(shell, do_unlink=True)
    wheel_at = {w.name: [round(c, 3) for c in w.location] for w in wheel_objects}
    print('CAR', name, 'size', [round(all_high.x - all_low.x, 3), round(all_high.y - all_low.y, 3),
                                round(max(all_high.z, max(w.location.z + WHEEL_CORNER for w in wheel_objects)) - GROUND, 3)],
          'wheels', wheel_at, 'grow', round(grow, 3), 'belt', round(belt, 3), 'roof', round(roof_z, 3),
          'balls', balls, flush=True)
    print('LIGHTS', name, 'head', head and [round(c, 3) for c in head], 'tail', tail and [round(c, 3) for c in tail], flush=True)
    export(name)


def smooth_from_afar(path):
    """
    The exporter writes 'Closest' as nearest filtering both ways. Near, that
    keeps the pack's texels crisp; far off, blending between mipmaps stops a
    car in traffic sparkling, so minification is set to trilinear.
    """
    with open(path, 'rb') as f:
        data = f.read()
    json_length = struct.unpack('<I', data[12:16])[0]
    gltf = json.loads(data[20:20 + json_length])
    rest = data[20 + json_length:]
    for sampler in gltf.get('samplers', []):
        sampler['minFilter'] = 9987
    text = json.dumps(gltf, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    with open(path, 'wb') as f:
        f.write(data[:8] + struct.pack('<I', 20 + len(text) + len(rest)))
        f.write(struct.pack('<I', len(text)) + data[16:20] + text + rest)


def export(name):
    path = os.path.join(OUTPUT, name + '.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True,
        export_image_format='AUTO', export_animations=False, export_extras=True,
        export_cameras=False, export_lights=False)
    smooth_from_afar(path)
    triangles = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects
                    if o.type == 'MESH' and o.get('data') != 'collision')
    print('EXPORTED', path, os.path.getsize(path), 'bytes', triangles, 'triangles', flush=True)


# The motorbike, from scratch. Positions are (x, y, height above the road);
# the front points down -Y like the cars', and +X is the rider's left.
BIKE_WHEEL = 0.19          # tyre radius, both wheels
BIKE_AXLES = (-0.44, 0.44)  # front and rear axle, centred so the weight sits between them
RAKE = math.radians(25)    # steering axis, back from the vertical
FORK_OFFSET = 0.035        # fork legs ahead of the steering axis, which gives the front wheel trail
BIKE_SEAT = 0.45           # seat top, above the road


def at(x, y, h):
    return Vector((x, y, GROUND + h))


def flat_material(name, colour, roughness, metallic=0.0, glow=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = colour + (1,)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    if glow:
        shader.inputs['Emission Color'].default_value = colour + (1,)
        shader.inputs['Emission Strength'].default_value = glow
    mat.use_backface_culling = True
    mat.diffuse_color = colour + (1,)
    return mat


class Parts:
    """One mesh built up from closed low-poly pieces, each with its material."""

    def __init__(self, materials):
        self.bm = bmesh.new()
        self.materials = materials

    def rings(self, rings, material, closed=False, caps=True):
        """Joins rings of points (all the same count) into a tube, capped at the ends or closed round."""
        verts = [[self.bm.verts.new(p) for p in ring] for ring in rings]
        count = len(rings[0])
        pairs = list(zip(verts, verts[1:])) + ([(verts[-1], verts[0])] if closed else [])
        faces = []
        for a, b in pairs:
            for i in range(count):
                faces.append(self.bm.faces.new((a[i], a[(i + 1) % count], b[(i + 1) % count], b[i])))
        if caps and not closed:
            faces.append(self.bm.faces.new(list(reversed(verts[0]))))
            faces.append(self.bm.faces.new(verts[-1]))
        for face in faces:
            face.material_index = self.materials.index(material)
        return faces

    def path(self, points, radius, material, sides=6):
        """A round tube along points, its rings carried along without twisting."""
        points = [Vector(p) for p in points]
        tangents = []
        for i in range(len(points)):
            before = points[max(0, i - 1)]
            after = points[min(len(points) - 1, i + 1)]
            tangents.append((after - before).normalized())
        side = tangents[0].cross(Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))).normalized()
        rings = []
        for point, tangent in zip(points, tangents):
            side = (side - tangent * side.dot(tangent)).normalized()
            up = tangent.cross(side)
            rings.append([point + (side * math.cos(a) + up * math.sin(a)) * radius
                          for a in (2 * math.pi * k / sides for k in range(sides))])
        return self.rings(rings, material)

    def tube(self, a, b, radius, material, sides=6):
        return self.path([a, b], radius, material, sides)

    def lengthwise(self, sections, material, corners=0.4):
        """
        A body along Y from (y, height, half width, half height) sections: a
        box with its corners cut, the shape of a tank, a seat or a tail.
        """
        rings = []
        for y, h, width, height in sections:
            c = 1 - corners
            outline = [(width, c * height), (c * width, height), (-c * width, height), (-width, c * height),
                       (-width, -c * height), (-c * width, -height), (c * width, -height), (width, -c * height)]
            rings.append([at(x, y, h + z) for x, z in outline])
        return self.rings(rings, material)

    def block(self, low, high, material):
        """An axis-aligned box between two corners."""
        (x0, y0, z0), (x1, y1, z1) = low, high
        bottom = [Vector((x0, y0, z0)), Vector((x1, y0, z0)), Vector((x1, y1, z0)), Vector((x0, y1, z0))]
        top = [Vector((x0, y0, z1)), Vector((x1, y0, z1)), Vector((x1, y1, z1)), Vector((x0, y1, z1))]
        return self.rings([bottom, top], material)

    def finish(self, name, matrix=None):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        if matrix is not None:
            bmesh.ops.transform(self.bm, matrix=matrix.inverted(), verts=self.bm.verts)
        mesh = bpy.data.meshes.new(name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for material in self.materials:
            mesh.materials.append(material)
        obj = link(bpy.data.objects.new(name, mesh))
        if matrix is not None:
            obj.matrix_world = matrix
        return obj


def bike_wheel(name, width, centre, mats, disc=False, sprocket=False):
    """A tyre round a spoked rim, made about its own axle (X), to spin in place."""
    tyre, chrome, metal = mats['Wheel'], mats['Chrome'], mats['Black metal']
    parts = Parts([tyre, chrome, metal])
    segments = 14
    rim = 0.128
    # The tyre's cross-section: tread, shoulders, sidewalls down onto the rim
    profile = [(-0.38 * width, BIKE_WHEEL), (-0.5 * width, BIKE_WHEEL - 0.022), (-0.45 * width, rim + 0.004),
               (0.45 * width, rim + 0.004), (0.5 * width, BIKE_WHEEL - 0.022), (0.38 * width, BIKE_WHEEL)]

    def around(profile_points, count=segments):
        return [[Vector((x, -r * math.sin(a), r * math.cos(a))) for x, r in profile_points]
                for a in (2 * math.pi * k / count for k in range(count))]

    parts.rings(around(profile), tyre, closed=True)
    parts.rings(around([(-0.028, rim), (-0.028, rim - 0.022), (0.028, rim - 0.022), (0.028, rim)]), chrome, closed=True)
    for k in range(5):
        a = 2 * math.pi * k / 5
        direction = Vector((0, -math.sin(a), math.cos(a)))
        across = Vector((0, math.cos(a), math.sin(a)))
        inner, outer = direction * 0.03, direction * (rim - 0.02)
        corners = [inner - across * 0.014, outer - across * 0.009, outer + across * 0.009, inner + across * 0.014]
        parts.rings([[c + Vector((-0.008, 0, 0)) for c in corners], [c + Vector((0.008, 0, 0)) for c in corners]], chrome)
    parts.tube(Vector((-0.045, 0, 0)), Vector((0.045, 0, 0)), 0.032, metal, sides=8)
    if disc:
        parts.tube(Vector((0.038, 0, 0)), Vector((0.045, 0, 0)), 0.095, chrome, sides=12)
    if sprocket:
        parts.tube(Vector((0.045, 0, 0)), Vector((0.052, 0, 0)), 0.075, metal, sides=12)
    obj = parts.finish(name)
    obj.location = centre
    return obj


def build_motorbike(name):
    reset()
    mats = {
        'Car': flat_material('Car', (0.85, 0.85, 0.85), 0.4),
        'Wheel': flat_material('Wheel', (0.035, 0.035, 0.035), 0.85),
        'Black metal': flat_material('Black metal', (0.05, 0.05, 0.055), 0.45, metallic=0.5),
        'Chrome': flat_material('Chrome', (0.8, 0.8, 0.82), 0.22, metallic=0.9),
        'Black seat': flat_material('Black seat', (0.03, 0.028, 0.026), 0.7),
        'Headlight': flat_material('Headlight', (1.0, 0.97, 0.88), 0.2, glow=0.6),
        'Taillight': flat_material('Taillight', (0.8, 0.04, 0.03), 0.3, glow=0.4),
    }
    paint, tyre, metal, chrome = mats['Car'], mats['Wheel'], mats['Black metal'], mats['Chrome']
    front_y, rear_y = BIKE_AXLES
    front_axle = at(0, front_y, BIKE_WHEEL)
    rear_axle = at(0, rear_y, BIKE_WHEEL)

    # The steering axis runs up and back through the head tube; the fork legs
    # run parallel to it, a little ahead, down to the front axle
    axis = Vector((0, math.sin(RAKE), math.cos(RAKE)))
    back = Vector((0, math.cos(RAKE), -math.sin(RAKE)))
    base = front_axle + back * FORK_OFFSET

    def steer_axis(t):
        return base + axis * t

    def leg(t, x):
        return front_axle + axis * t + Vector((x, 0, 0))

    # Body: frame, engine, tank, seat, tail, swingarm, shocks, exhaust
    body = Parts(list(mats.values()))
    body.tube(steer_axis(0.34), steer_axis(0.54), 0.03, metal, sides=8)
    body.path([steer_axis(0.5), at(0, -0.02, 0.51), at(0, 0.13, 0.43)], 0.022, metal)
    for x in (0.05, -0.05):
        body.path([steer_axis(0.37) + Vector((x * 0.4, 0, 0)), at(x, -0.26, 0.2), at(x, -0.16, 0.1),
                   at(x, 0.1, 0.1), at(x * 1.5, 0.15, 0.24), at(x * 1.4, 0.13, 0.42)], 0.017, metal)
        seat_rail = x * 1.4
        body.tube(at(seat_rail, 0.12, 0.42), at(seat_rail, 0.56, 0.46), 0.014, metal)
        body.tube(at(seat_rail, 0.15, 0.25), at(seat_rail, 0.36, 0.44), 0.013, metal)
        # Footpegs
        body.tube(at(x * 1.8, 0.13, 0.2), at(x * 3.3, 0.13, 0.2), 0.012, tyre)
    # Crankcase, with the cylinder leaning forward out of it
    body.lengthwise([(-0.15, 0.21, 0.09, 0.085), (0.0, 0.2, 0.115, 0.1), (0.12, 0.21, 0.08, 0.08)], metal)
    body.rings([[at(0.085, -0.15, 0.29), at(-0.085, -0.15, 0.29), at(-0.085, 0.0, 0.29), at(0.085, 0.0, 0.29)],
                [at(0.085, -0.22, 0.47), at(-0.085, -0.22, 0.47), at(-0.085, -0.07, 0.47), at(0.085, -0.07, 0.47)]], chrome)
    for h in (0.34, 0.39, 0.44):
        # Cooling fins, dark between the bright
        lean = (h - 0.29) / 0.18 * 0.07
        body.block((-0.092, -0.155 - lean, GROUND + h), (0.092, 0.005 - lean, GROUND + h + 0.012), metal)
    body.rings([[at(0.07, -0.225, 0.47), at(-0.07, -0.225, 0.47), at(-0.07, -0.065, 0.47), at(0.07, -0.065, 0.47)],
                [at(0.06, -0.225, 0.5), at(-0.06, -0.225, 0.5), at(-0.06, -0.08, 0.5), at(0.06, -0.08, 0.5)]], metal)
    # Tank, seat and tail, lofted along the bike
    body.lengthwise([(-0.21, 0.555, 0.055, 0.04), (-0.16, 0.565, 0.11, 0.07), (-0.05, 0.56, 0.13, 0.078),
                     (0.05, 0.53, 0.11, 0.063), (0.1, 0.495, 0.07, 0.04)], paint)
    top = BIKE_SEAT
    body.lengthwise([(0.07, top + 0.045, 0.075, 0.03), (0.12, top - 0.025, 0.115, 0.035), (0.22, top - 0.035, 0.12, 0.035),
                     (0.34, top - 0.01, 0.105, 0.035), (0.46, top + 0.03, 0.08, 0.03)], mats['Black seat'])
    body.lengthwise([(0.1, 0.36, 0.1, 0.06), (0.3, 0.385, 0.105, 0.055), (0.5, 0.44, 0.08, 0.045),
                     (0.62, 0.48, 0.04, 0.025)], paint)
    body.block((-0.035, 0.605, GROUND + 0.46), (0.035, 0.63, GROUND + 0.495), mats['Taillight'])
    body.tube(at(0, 0.57, 0.44), at(0, 0.64, 0.41), 0.01, metal)
    body.block((-0.055, 0.635, GROUND + 0.34), (0.055, 0.646, GROUND + 0.415), metal)
    # Swingarm to the rear axle, and the shocks holding it up
    for x in (0.075, -0.075):
        pivot, axle = at(x, 0.14, 0.24), at(x, rear_y, BIKE_WHEEL)
        body.rings([[pivot + Vector(o) for o in ((0.015, 0, 0.025), (-0.015, 0, 0.025), (-0.015, 0, -0.025), (0.015, 0, -0.025))],
                    [axle + Vector(o) for o in ((0.012, 0, 0.018), (-0.012, 0, 0.018), (-0.012, 0, -0.018), (0.012, 0, -0.018))]], metal)
        body.tube(at(x * 1.07, 0.36, 0.2), at(x * 1.07, 0.29, 0.44), 0.02, chrome)
    body.tube(at(-0.075, 0.18, 0.235), at(0.075, 0.18, 0.235), 0.015, metal)
    # Exhaust down the right side to a silencer under the tail
    body.path([at(-0.03, -0.18, 0.36), at(-0.06, -0.25, 0.28), at(-0.075, -0.24, 0.15), at(-0.085, -0.14, 0.09),
               at(-0.095, 0.1, 0.1), at(-0.13, 0.21, 0.19)], 0.018, chrome)
    body.path([at(-0.14, 0.19, 0.185), at(-0.14, 0.3, 0.235), at(-0.14, 0.48, 0.3)], 0.042, chrome, sides=8)
    body.tube(at(-0.14, 0.48, 0.3), at(-0.14, 0.5, 0.308), 0.03, metal, sides=8)
    body.finish('body')

    # The fork turns about the steering axis: its origin sits on the axis and
    # its own up (glTF +Y) points along it, so turning it about that steers
    fork_origin = steer_axis(0.44)
    fork_matrix = Matrix.Translation(fork_origin) @ Matrix.Rotation(-RAKE, 4, 'X')
    fork = Parts(list(mats.values()))
    for x in (0.06, -0.06):
        fork.tube(leg(-0.03, x), leg(0.2, x), 0.022, metal, sides=8)
        fork.tube(leg(0.2, x), leg(0.55, x), 0.017, chrome, sides=8)
    for t in (0.36, 0.52):
        centre = leg(t, 0)
        fork.rings([[centre + Vector((0.085, -0.03, 0)), centre + Vector((-0.085, -0.03, 0)),
                     centre + Vector((-0.085, 0.07, 0)), centre + Vector((0.085, 0.07, 0))],
                    [centre + Vector((0.085, -0.03, 0.025)), centre + Vector((-0.085, -0.03, 0.025)),
                     centre + Vector((-0.085, 0.07, 0.025)), centre + Vector((0.085, 0.07, 0.025))]], metal)
    bar_top = steer_axis(0.55)
    grips = []
    for x in (1, -1):
        fork.tube(bar_top + Vector((x * 0.04, 0, 0)), at(x * 0.045, bar_top.y + 0.01, 0.69), 0.012, metal)
        grips.append([at(x * 0.15, bar_top.y + 0.04, 0.7), at(x * 0.21, bar_top.y + 0.075, 0.7)])
    fork.path([at(-0.15, bar_top.y + 0.04, 0.7), at(-0.1, bar_top.y + 0.02, 0.695), at(0, bar_top.y + 0.01, 0.69),
               at(0.1, bar_top.y + 0.02, 0.695), at(0.15, bar_top.y + 0.04, 0.7)], 0.011, metal)
    for a, b in grips:
        fork.tube(a, b, 0.016, tyre, sides=6)
    # Mirrors on stalks
    for x in (1, -1):
        stalk_top = at(x * 0.18, bar_top.y + 0.06, 0.8)
        fork.tube(at(x * 0.14, bar_top.y + 0.04, 0.7), stalk_top, 0.006, metal, sides=4)
        fork.block((stalk_top.x - 0.03, stalk_top.y - 0.006, stalk_top.z), (stalk_top.x + 0.03, stalk_top.y + 0.006, stalk_top.z + 0.035), metal)
    # Round headlight ahead of the legs, clocks behind it
    lamp_height = 0.565
    lamp = leg((lamp_height - BIKE_WHEEL) / math.cos(RAKE), 0) + Vector((0, -0.068, 0))
    shell = [[lamp + Vector((math.cos(a) * r, dy, math.sin(a) * r)) for a in (2 * math.pi * k / 10 for k in range(10))]
             for dy, r in ((0.045, 0.035), (0.01, 0.062), (-0.03, 0.065))]
    # The last face is the cap on the front ring: the lens
    lens = fork.rings(shell, metal)[-1]
    lens.material_index = fork.materials.index(mats['Headlight'])
    fork.tube(leg(0.38, 0.06), lamp + Vector((0.05, 0.03, 0)), 0.008, metal, sides=4)
    fork.tube(leg(0.38, -0.06), lamp + Vector((-0.05, 0.03, 0)), 0.008, metal, sides=4)
    clocks = at(0, bar_top.y - 0.04, 0.655)
    fork.block((clocks.x - 0.05, clocks.y - 0.02, clocks.z), (clocks.x + 0.05, clocks.y + 0.02, clocks.z + 0.035), metal)
    # Front mudguard over the wheel, and the brake caliper on the disc
    arc = []
    for k in range(7):
        a = math.radians(-40 + k * 18)
        radial = Vector((0, -math.sin(a), math.cos(a)))
        arc.append([front_axle + radial * r + Vector((x, 0, 0)) for x, r in
                    ((0.05, BIKE_WHEEL + 0.035), (-0.05, BIKE_WHEEL + 0.035), (-0.05, BIKE_WHEEL + 0.012), (0.05, BIKE_WHEEL + 0.012))])
    fork.rings(arc, paint)
    caliper = front_axle + Vector((0.052, 0.06, 0.06))
    fork.block((caliper.x - 0.012, caliper.y - 0.03, caliper.z - 0.03), (caliper.x + 0.012, caliper.y + 0.03, caliper.z + 0.03), metal)
    fork_obj = fork.finish('bike_fork', fork_matrix)
    # Where the front wheel's centre is, turning with the fork
    axle_marker = empty('bike_axle_front', (0, 0, 0))
    axle_marker.parent = fork_obj
    axle_marker.matrix_world = Matrix.Translation(front_axle)

    front = bike_wheel('bike_wheel_front', 0.075, front_axle, mats, disc=True)
    rear = bike_wheel('bike_wheel_rear', 0.1, rear_axle, mats, sprocket=True)

    # Physics: two wheels a side, a hand's width apart, under each axle; the
    # game keeps it upright. The markers are at the axles, so the physics
    # wheel radius to use is the tyre's
    for y, prefix, props in ((front_y, 'f', dict(data='wheel', steering='true', drive='fwd')),
                             (rear_y, 'r', dict(data='wheel', drive='rwd'))):
        for x, side in ((0.1, 'l'), (-0.1, 'r')):
            empty('wheel_%s%s' % (prefix, side), at(x, y, BIKE_WHEEL), **props)

    # The rider's hips just above the seat: the seat point is 0.135 under them
    seat = at(0, 0.12, BIKE_SEAT + 0.06 - 0.135)
    empty('seat_1', seat, data='seat', seat_type='driver', entry_points='entrance_1;entrance_2')
    empty('entrance_1', (0.55, seat.y + ENTRY_BACK, GROUND))
    empty('entrance_2', (-0.55, seat.y + ENTRY_BACK, GROUND))
    empty('Empty', seat + EYES, data='camera')
    empty('headlight', lamp + Vector((0, -0.035, 0)))
    empty('taillight', at(0, 0.63, 0.478))

    collision_box('collision_body', at(0, 0.01, 0.39), (0.13, 0.63, 0.27))
    for i, (y, h, r) in enumerate(((-0.44, 0.3, 0.14), (0.44, 0.3, 0.14), (-0.02, 0.27, 0.15),
                                   (-0.15, 0.56, 0.14), (0.2, 0.47, 0.13), (0.5, 0.5, 0.1))):
        collision_ball('collision_ball_%d' % (i + 1), at(0, y, h), r)

    bpy.context.view_layer.update()
    low, high = bounds(o.matrix_world @ v.co for o in bpy.data.objects
                       if o.type == 'MESH' and o.get('data') != 'collision' for v in o.data.vertices)
    print('BIKE size', [round(c, 3) for c in (high - low)], 'seat', [round(c, 3) for c in seat],
          'fork origin', [round(c, 3) for c in fork_origin], 'front axle', [round(c, 3) for c in front_axle],
          'rear axle', [round(c, 3) for c in rear_axle], flush=True)
    export(name)


names = args[2:] or DEFAULT
for name in names:
    if name in CARS:
        build_car(name, CARS[name])
    elif name == 'motorbike':
        build_motorbike(name)
    else:
        raise RuntimeError('unknown vehicle ' + name)
