# Imports several character glbs side by side and renders them from the front.
import bpy, sys, math, mathutils
files = sys.argv[sys.argv.index('--') + 1:]
out = files.pop(0)
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
for i, f in enumerate(files):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f)
    for o in set(bpy.data.objects) - before:
        if o.parent is None:
            o.location.x += (i - (len(files) - 1) / 2) * 0.62
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 1600; scene.render.resolution_y = 520
if scene.world is None: scene.world = bpy.data.worlds.new('w')
scene.world.color = (0.55, 0.6, 0.68)
sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.2
so = bpy.data.objects.new('sun', sun); scene.collection.objects.link(so); so.rotation_euler = (math.radians(55), 0, math.radians(20))
cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.ortho_scale = len(files) * 0.64
co = bpy.data.objects.new('cam', cam); scene.collection.objects.link(co); scene.camera = co
co.location = (0, -6, 0.5); co.rotation_euler = (math.radians(90), 0, 0)
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
