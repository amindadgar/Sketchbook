# Renders a front and three-quarter view of whatever humans are in the open file.
import bpy, sys, math, mathutils
out = sys.argv[sys.argv.index('--') + 1]
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE_NEXT'
scene.render.resolution_x = 900
scene.render.resolution_y = 900
scene.render.film_transparent = False
world = bpy.data.worlds.new('w') if scene.world is None else scene.world
scene.world = world
world.color = (0.55, 0.6, 0.68)

# Bounds of every mesh
pts = []
for o in bpy.data.objects:
    if o.type == 'MESH' and o.visible_get():
        pts += [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
mn = mathutils.Vector([min(p[i] for p in pts) for i in range(3)])
mx = mathutils.Vector([max(p[i] for p in pts) for i in range(3)])
center = (mn + mx) / 2
height = mx.z - mn.z

sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.5
so = bpy.data.objects.new('sun', sun); scene.collection.objects.link(so)
so.rotation_euler = (math.radians(50), 0, math.radians(30))
cam = bpy.data.cameras.new('cam'); cam.lens = 70
co = bpy.data.objects.new('cam', cam); scene.collection.objects.link(co)
scene.camera = co

views = sys.argv[sys.argv.index('--') + 2:] or ['0', '35']
for angle in views:
    a = math.radians(float(angle))
    dist = height * 2.6
    co.location = center + mathutils.Vector((math.sin(a) * dist, -math.cos(a) * dist, height * 0.1))
    direction = center - co.location
    co.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = out + '_' + angle + '.png'
    bpy.ops.render.render(write_still=True)
