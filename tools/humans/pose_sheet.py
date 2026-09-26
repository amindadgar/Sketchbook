# Renders a contact sheet of poses: action:frame pairs, each from the side and three-quarter front.
import bpy, sys, math, mathutils, os
args = sys.argv[sys.argv.index('--') + 1:]
out = args[0]
pairs = [a.split(':') for a in args[1:]]
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 360
scene.render.resolution_y = 420
if scene.world is None:
    scene.world = bpy.data.worlds.new('w')
scene.world.color = (0.5, 0.55, 0.62)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.5
so = bpy.data.objects.new('sun', sun); scene.collection.objects.link(so)
so.rotation_euler = (math.radians(50), 0, math.radians(30))
cam = bpy.data.cameras.new('cam'); cam.lens = 50
co = bpy.data.objects.new('cam', cam); scene.collection.objects.link(co)
scene.camera = co
# ground plane for reference
bpy.ops.mesh.primitive_plane_add(size=4)
files = []
for name, frame in pairs:
    act = bpy.data.actions.get(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    if act.slots:
        arm.animation_data.action_slot = act.slots[0]
    scene.frame_set(int(frame))
    for angle in (90, 30):
        a = math.radians(angle)
        center = mathutils.Vector((0, 0, 0.5))
        co.location = center + mathutils.Vector((math.sin(a) * -2.6, -math.cos(a) * 2.6, 0.35))
        co.rotation_euler = (center - co.location).to_track_quat('-Z', 'Y').to_euler()
        path = '%s_%s_%s_%d.png' % (out, name, frame, angle)
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        files.append(path)
print('FILES', ' '.join(files))
