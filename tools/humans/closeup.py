# Close-up render of a bone region for checking: closeup.py -- out.png action frame bone distance angle
import bpy, sys, math, mathutils
a = sys.argv[sys.argv.index('--') + 1:]
out, action, frame, bone_name, dist, angle = a[0], a[1], int(a[2]), a[3], float(a[4]), float(a[5])
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 500; scene.render.resolution_y = 500
if scene.world is None: scene.world = bpy.data.worlds.new('w')
scene.world.color = (0.5, 0.55, 0.62)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
act = bpy.data.actions.get(action)
arm.animation_data_create(); arm.animation_data.action = act
if act.slots: arm.animation_data.action_slot = act.slots[0]
scene.frame_set(frame)
sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.5
so = bpy.data.objects.new('sun', sun); scene.collection.objects.link(so); so.rotation_euler = (math.radians(50), 0, math.radians(30))
cam = bpy.data.cameras.new('cam'); cam.lens = 60
co = bpy.data.objects.new('cam', cam); scene.collection.objects.link(co); scene.camera = co
pb = arm.pose.bones[bone_name]
center = arm.matrix_world @ pb.head
r = math.radians(angle)
co.location = center + mathutils.Vector((math.sin(r) * dist, -math.cos(r) * dist, 0.05))
co.rotation_euler = (center - co.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
