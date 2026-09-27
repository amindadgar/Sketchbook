"""
Renders vehicle glbs side by side, straight from the exported files, to check them.

    blender -b --factory-startup -P tools/vehicles/preview_vehicles.py -- out.png <view> a.glb b.glb ...

view is 'front' (three-quarter from the front left), 'rear', 'side' or 'top'.
Add 'collision' after the view to draw the collision shapes as wireframes and
the markers (seats, entry points, camera, physics wheels) as small balls, or
'paint' to paint each 'Car' material a traffic colour the way the game does,
or 'riders' to sit the player in every seat in the 'driving' pose.
"""
import bpy, sys, os, math
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
out, view = args[0], args[1]
files = args[2:]
show_collision = 'collision' in files
paint = 'paint' in files
riders = 'riders' in files
files = [f for f in files if f not in ('collision', 'paint', 'riders')]
PLAYER = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'build', 'assets', 'humans', 'player.glb')


def sit_rider(seat, pivot):
    """The player in the 'driving' pose where the game puts them: 0.6 over the seat, less the model's 0.57 drop."""
    before_objects = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=PLAYER)
    new = [o for o in bpy.data.objects if o not in before_objects]
    action = next(a for a in bpy.data.actions if a not in before_actions and a.name.startswith('driving'))
    for obj in new:
        if obj.type == 'ARMATURE':
            obj.animation_data_create()
            obj.animation_data.action = action
            if len(action.slots):
                obj.animation_data.action_slot = action.slots[0]
        if obj.type == 'MESH' and obj.name.startswith('Icosphere'):
            obj.hide_render = True
        if obj.parent is None:
            obj.location = seat.location + Vector((0, 0, 0.03))
            obj.parent = pivot

# A few of TrafficCar.COLORS
PAINTS = [0x8c1c1c, 0x1f3a66, 0xf2f2f0, 0x2f4a3a, 0xcbbd9c, 0x5d6168, 0x6b2f4a, 0x3d5f8c]
GROUND = -0.358

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)

marker_material = bpy.data.materials.new('marker')
marker_material.diffuse_color = (1, 0.1, 0.6, 1)
marker_material.use_nodes = True
marker_material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (1, 0.1, 0.6, 1)
marker_material.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value = (1, 0.1, 0.6, 1)
marker_material.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 1.0

pivots = []
widths = []
heights = []
for i, path in enumerate(files):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    pivot = bpy.data.objects.new('pivot_%d' % i, None)
    bpy.context.scene.collection.objects.link(pivot)
    points = []
    for obj in new:
        data = obj.get('data')
        if data == 'collision':
            obj.hide_render = not show_collision
            obj.display_type = 'WIRE'
            if show_collision:
                # Wireframe, so the body shows through
                modifier = obj.modifiers.new('wire', 'WIREFRAME')
                modifier.thickness = 0.016
                obj.data.materials.clear()
                obj.data.materials.append(marker_material)
        elif obj.type == 'MESH':
            points += [obj.matrix_world @ Vector(c) for c in obj.bound_box]
            if show_collision:
                # See-through, to show what's inside
                for mat in obj.data.materials:
                    if mat is not None and not mat.get('ghost'):
                        mat['ghost'] = True
                        mat.surface_render_method = 'BLENDED'
                        shader = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
                        shader.inputs['Alpha'].default_value = 0.3
            for mat in obj.data.materials:
                if mat is None or mat.node_tree is None:
                    continue
                shader = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
                texture = next((n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE'), None)
                if texture is not None:
                    texture.interpolation = 'Closest'
                if paint and mat.name.split('.')[0] == 'Car' and not mat.get('painted'):
                    # The game multiplies its paint over the texture, or sets it if there's none
                    mat['painted'] = True
                    colour = PAINTS[i % len(PAINTS)]
                    srgb = [((colour >> s) & 255) / 255 for s in (16, 8, 0)]
                    linear = [c / 12.92 if c < 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
                    if texture is None:
                        shader.inputs['Base Color'].default_value = linear + [1]
                        continue
                    multiply = mat.node_tree.nodes.new('ShaderNodeMix')
                    multiply.data_type = 'RGBA'
                    multiply.blend_type = 'MULTIPLY'
                    multiply.inputs['Factor'].default_value = 1
                    multiply.inputs[7].default_value = linear + [1]
                    mat.node_tree.links.new(texture.outputs['Color'], multiply.inputs[6])
                    mat.node_tree.links.new(multiply.outputs[2], shader.inputs['Base Color'])
        if show_collision and obj.type == 'EMPTY' and (data in ('seat', 'camera', 'wheel') or obj.name.startswith(('entrance', 'headlight', 'taillight'))):
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.04, location=obj.matrix_world.translation)
            ball = bpy.context.active_object
            ball.data.materials.append(marker_material)
            new.append(ball)
        if show_collision and obj.type == 'MESH' and data == 'wheel':
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.03, location=obj.matrix_world.translation)
            ball = bpy.context.active_object
            ball.data.materials.append(marker_material)
            new.append(ball)
    for obj in new:
        if obj.parent is None:
            obj.parent = pivot
    if riders:
        for obj in new:
            if obj.get('data') == 'seat':
                sit_rider(obj, pivot)
    xs = [p.x for p in points] or [0]
    ys = [p.y for p in points] or [0]
    widths.append(max(max(xs) - min(xs), max(ys) - min(ys)))
    heights.append(max([p.z for p in points] or [0]))
    pivots.append(pivot)

# Laid out along X, each turned to the camera the same way
spacing = max(widths) * (1.08 if view in ('side', 'top') else 1.0) + 0.3
turn = {'front': -50, 'rear': 130, 'side': -90, 'top': -90}[view]
for i, pivot in enumerate(pivots):
    pivot.location.x = (i - (len(pivots) - 1) / 2) * spacing
    pivot.rotation_euler.z = math.radians(turn)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = max(800, int(len(files) * 420 * (1.2 if view in ('side', 'top') else 1)))
scene.render.resolution_y = 520 if view != 'top' else 440
scene.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('sky')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.62, 0.69, 0.78, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9

sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
scene.collection.objects.link(sun)
sun.data.energy = 3.2
sun.data.angle = math.radians(4)
sun.rotation_euler = (math.radians(40), 0, math.radians(-30))

bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, GROUND))
ground = bpy.context.active_object
ground_material = bpy.data.materials.new('road')
ground_material.use_nodes = True
ground_material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.33, 0.35, 1)
ground.data.materials.append(ground_material)

camera = bpy.data.objects.new('camera', bpy.data.cameras.new('camera'))
scene.collection.objects.link(camera)
scene.camera = camera
camera.data.type = 'ORTHO'
row = (len(pivots) - 1) * spacing + spacing
elevation = {'front': 18, 'rear': 18, 'side': 0, 'top': 90}[view]
camera.data.ortho_scale = row
e = math.radians(elevation)
if view == 'top':
    camera.location = (0, 0, 30)
    camera.rotation_euler = (0, 0, 0)
else:
    # Aimed at the middle of the tallest vehicle's height
    middle = (GROUND + max(heights)) / 2
    camera.location = (0, -30 * math.cos(e), middle + 30 * math.sin(e))
    camera.rotation_euler = (math.radians(90) - e, 0, 0)
bpy.context.scene.frame_set(2)
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
