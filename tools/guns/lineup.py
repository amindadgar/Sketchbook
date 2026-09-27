"""
Renders the built guns for checking: every file re-imported, in a row, from
the side, with the origin (red) and the 'muzzle' empty (green) marked and a
bar one unit tall (a person's height) for scale, then each gun on its own,
side on and from three quarters above.

    blender -b --factory-startup -P tools/guns/lineup.py -- <out prefix> build/assets/guns/*.glb

Writes <out prefix>_row.png and <out prefix>_closeups.png.
"""
import bpy, sys, os, math
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
OUT, FILES = args[0], args[1:]

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.view_settings.view_transform = 'Standard'
scene.world = bpy.data.worlds.new('w')
# Light enough behind that black steel stands out from it
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.42, 0.45, 0.5, 1)
for name, energy, rotation in (('key', 4.0, (50, 0, -110)), ('fill', 1.5, (60, 0, 60))):
    sun = bpy.data.lights.new(name, 'SUN')
    sun.energy = energy
    light = bpy.data.objects.new(name, sun)
    scene.collection.objects.link(light)
    light.rotation_euler = [math.radians(a) for a in rotation]


def flat(name, colour):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    emit = nodes.new('ShaderNodeEmission')
    emit.inputs['Color'].default_value = colour
    out = nodes.new('ShaderNodeOutputMaterial')
    material.node_tree.links.new(emit.outputs[0], out.inputs[0])
    return material


RED = flat('origin', (1, 0.05, 0.05, 1))
GREEN = flat('muzzle', (0.1, 1, 0.2, 1))
WHITE = flat('scale', (0.95, 0.95, 0.95, 1))
INK = flat('ink', (0.05, 0.05, 0.08, 1))


def marker(location, material, radius):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=location, segments=16, ring_count=8)
    bpy.context.object.data.materials.append(material)
    return bpy.context.object


def box(location, size, material):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.scale = Vector(size) / 2
    obj.data.materials.append(material)
    return obj


def label(text, location, size):
    curve = bpy.data.curves.new(text, 'FONT')
    curve.body = text
    curve.size = size
    curve.align_x = 'CENTER'
    obj = bpy.data.objects.new(text, curve)
    scene.collection.objects.link(obj)
    obj.location = location
    # Facing the camera, which looks along +X from -X
    obj.rotation_euler = (math.radians(90), 0, math.radians(-90))
    obj.data.materials.append(INK)
    return obj


# Every gun, laid end to end down -Y (glTF +Z, the barrel's way) so the row reads left to right
guns = []
cursor = 0.0
for path in FILES:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    gun = next(o for o in new if o.type == 'MESH')
    muzzle = next(o for o in new if o.name.startswith('muzzle'))
    ys = [(gun.matrix_world @ v.co).y for v in gun.data.vertices]
    butt, front = max(ys), min(ys)
    gun.location.y = cursor - butt
    cursor = gun.location.y + front - 0.18
    bpy.context.view_layer.update()
    guns.append((os.path.splitext(os.path.basename(path))[0], gun, muzzle))

span = -cursor
markers = {}
for name, gun, muzzle in guns:
    markers[name] = [marker(gun.matrix_world.translation, RED, 0.008),
                     marker(muzzle.matrix_world.translation, GREEN, 0.008)]


def markers_in_front(yes):
    """Side on, the dots are brought out toward the camera so the gun doesn't hide them."""
    for (name, gun, muzzle) in guns:
        red, green = markers[name]
        red.location = gun.matrix_world.translation
        green.location = muzzle.matrix_world.translation
        if yes:
            red.location.x -= 0.08
            green.location.x -= 0.08


markers_in_front(True)
for name, gun, muzzle in guns:
    label(name, gun.matrix_world.translation + Vector((0, 0, -0.3)), 0.05)

# One unit tall bar, ticked every tenth, standing where the row starts
bar_y = 0.25
scenery = [box((0, bar_y, 0), (0.01, 0.02, 1.0), WHITE)]
for tick in range(11):
    width = 0.07 if tick % 5 == 0 else 0.045
    scenery.append(box((0, bar_y - width / 2, -0.5 + tick * 0.1), (0.01, width, 0.006), WHITE))
scenery.append(label('1 unit', Vector((0, bar_y, 0.54)), 0.05))
# The line the origins sit on
scenery.append(box((0.02, -span / 2 + 0.1, 0), (0.001, span + 0.3, 0.002), RED))

cam = bpy.data.cameras.new('cam')
cam.type = 'ORTHO'
camera = bpy.data.objects.new('cam', cam)
scene.collection.objects.link(camera)
scene.camera = camera

width = span + 0.6
cam.ortho_scale = width
scene.render.resolution_x = 4000
scene.render.resolution_y = int(4000 * 1.2 / width)
camera.location = (-5, -span / 2 + 0.1, 0.0)
camera.rotation_euler = (math.radians(90), 0, math.radians(-90))
scene.render.filepath = OUT + '_row.png'
bpy.ops.render.render(write_still=True)

# Close ups, one gun at a time: side on, then from above and in front
for obj in scenery + [o for o in scene.objects if o.type == 'FONT']:
    obj.hide_render = True
tiles = []
for name, gun, muzzle in guns:
    for other, other_gun, _ in guns:
        other_gun.hide_render = other != name
        for dot in markers[other]:
            dot.hide_render = other != name
    points = [gun.matrix_world @ Vector(c) for c in gun.bound_box]
    low = Vector([min(p[i] for p in points) for i in range(3)])
    high = Vector([max(p[i] for p in points) for i in range(3)])
    centre = (low + high) / 2
    # Framed on whichever is tighter in a two to one picture, the length or the height
    length = max(high.y - low.y, (high.z - low.z) * 2)
    scene.render.resolution_x = 900
    scene.render.resolution_y = 450
    cam.type = 'ORTHO'
    cam.ortho_scale = length * 1.12
    camera.location = centre + Vector((-3, 0, 0))
    camera.rotation_euler = (math.radians(90), 0, math.radians(-90))
    markers_in_front(True)
    scene.render.filepath = OUT + '_' + name + '_side.png'
    bpy.ops.render.render(write_still=True)
    markers_in_front(False)
    cam.type = 'PERSP'
    cam.lens = 50
    view = Vector((-0.8, -0.9, 0.55)).normalized() * length * 1.25
    camera.location = centre + view
    camera.rotation_euler = (centre - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = OUT + '_' + name + '_three_quarter.png'
    bpy.ops.render.render(write_still=True)
    tiles.append(name)

# Stitched into one sheet with Blender's own image API, so nothing else is needed
sheet_width, sheet_height = 1800, 450 * len(tiles)
sheet = bpy.data.images.new('sheet', sheet_width, sheet_height)
pixels = [0.0] * (sheet_width * sheet_height * 4)
for row, name in enumerate(tiles):
    for column, view in enumerate(('side', 'three_quarter')):
        tile = bpy.data.images.load(OUT + '_' + name + '_' + view + '.png')
        tile_pixels = list(tile.pixels)
        top = sheet_height - (row + 1) * 450
        for y in range(450):
            start = ((top + y) * sheet_width + column * 900) * 4
            pixels[start:start + 900 * 4] = tile_pixels[y * 900 * 4:(y + 1) * 900 * 4]
        bpy.data.images.remove(tile)
        os.remove(OUT + '_' + name + '_' + view + '.png')
sheet.pixels = pixels
sheet.filepath_raw = OUT + '_closeups.png'
sheet.file_format = 'PNG'
sheet.save()
