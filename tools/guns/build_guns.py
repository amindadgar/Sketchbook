"""
Turns the guns in the CC0 'Free CC0 Guns & Explosives Pack' by 3dmodelscc0
into the game's eight gun models, one file per gun id.

    blender -b --factory-startup -P tools/guns/build_guns.py -- "<pack>/Guns&Explosives_glb" build/assets/guns

Each gun loses whatever lies beside it in the source scene (spare magazines),
is joined into one mesh, decimated to a budget, turned so the barrel runs
along glTF +Z with the top of the gun up +Y, scaled to the length the game
draws that gun at, and moved so the origin is where the hand holds it: at the
top of the grip, just behind the trigger. A child empty named 'muzzle' marks
the barrel tip. Textures are shrunk and packed as WebP.

Blender is Z up and the exporter turns +Z into glTF +Y and -Y into glTF +Z,
so in here a finished gun points its barrel down -Y with its top up +Z.
"""
import bpy, os, sys, math
import numpy as np
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index('--') + 1:]
SOURCE, OUTPUT = args[0], args[1]

# id: source file in the pack, and how to make it the game's gun.
#   length:  overall length in world units (a person is one tall), the size
#            the old box models were drawn at, which is bigger than life on
#            purpose so the guns read at game distance
#   barrel:  which way the source's barrel points, along its Y
#   drop:    objects in the source that aren't part of the gun
GUNS = {
    'handgun': dict(source='Pistol_MK/Makarov.glb', length=0.26, barrel='+Y',
                    drop=('Magazine',)),
    'heavy_pistol': dict(source='Luger/Luger.glb', length=0.30, barrel='-Y',
                         drop=('Clip',)),
    'automatic': dict(source='GreaseGun/Grease_Gun.glb', length=0.45, barrel='+Y'),
    # The drum stands face on to the barrel in the source; the real one hangs
    # with its face to the side, which is also the view the game shows most
    'smg': dict(source='Suomi_KP/Suomi_KP.glb', length=0.42, barrel='+Y',
                turn_drum='Magazine'),
    # The pack has no battle rifle, and the scoped bolt action is the sniper's,
    # so the M4 is the rifle and the AK, unmistakably, the assault rifle
    'rifle': dict(source='M4A1/M4A1.glb', length=0.80, barrel='+Y'),
    'assault_rifle': dict(source='AK-47/AK47.glb', length=0.85, barrel='+Y'),
    'shotgun': dict(source='Shotgun/Shotgun.glb', length=0.76, barrel='+Y'),
    # Lies tilted in the source, barrel up, so it's levelled on the barrel's axis
    'sniper': dict(source='Sniper/Sniper.glb', length=1.0, barrel='+Y',
                   drop=('Magazine',), level='Barrel'),
}

# Triangles at most. Only the Suomi, the M4 and the Grease Gun are over
BUDGET = 5500
TEXTURE_SIZE = 512
# Metalness and roughness carry little detail a gun this size shows
METAL_ROUGH_SIZE = 256


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for blocks in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for block in list(blocks):
            blocks.remove(block)


def apply_matrix(obj, matrix):
    """Transforms an object's mesh in place, custom normals included, by way of the object's own transform."""
    obj.matrix_world = matrix @ obj.matrix_world
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def bounds(points):
    points = np.asarray(points)
    return points.min(axis=0), points.max(axis=0)


def world_points(obj):
    return np.array([(obj.matrix_world @ v.co)[:] for v in obj.data.vertices])


def principal_axis(points):
    """The direction the points spread along most, which for a barrel is its bore."""
    centred = points - points.mean(axis=0)
    _, _, vt = np.linalg.svd(centred, full_matrices=False)
    axis = Vector(vt[0])
    return axis if axis.y > 0 else -axis


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def decimate(gun, budget):
    """
    Collapses the mesh down to the budget. Guns already under it keep the
    normals they came with.

    The importer splits vertices along every UV seam and hard edge, and the
    collapse crumples a mesh left in that many pieces, so they're welded
    first. Welding scrambles the imported custom normals, and neither those
    nor normals copied back from the full mesh shade cleanly afterwards, so
    the normals start over: smooth, with hard edges at the sharp corners,
    which is what these were modelled with.
    """
    before = triangles(gun)
    if before <= budget:
        return before
    bpy.ops.object.select_all(action='DESELECT')
    gun.select_set(True)
    bpy.context.view_layer.objects.active = gun
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.00001)
    bpy.ops.object.mode_set(mode='OBJECT')

    modifier = gun.modifiers.new('decimate', 'DECIMATE')
    modifier.ratio = budget / triangles(gun)
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)

    bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    return triangles(gun)


def image_pixels(image):
    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    return pixels.reshape(height, width, 4)


def green_points_down(image):
    """
    True for a DirectX style normal map, which glTF reads upside down. Half the
    pack's maps are, and two of them aren't labelled as such. A height field
    has no curl, so the gradients a map implies only add up read the right
    way round; whichever reading leaves less curl is the one it was baked in.
    """
    normal = image_pixels(image)[..., :3] * 2 - 1
    depth = np.clip(normal[..., 2], 0.2, None)
    along_u = -normal[..., 0] / depth
    along_v = -normal[..., 1] / depth
    dv_du = along_v[:-1, 1:] - along_v[:-1, :-1]
    du_dv = along_u[1:, :-1] - along_u[:-1, :-1]
    # Only where there is some relief, and not across the seams between UV islands
    relief = (np.abs(dv_du) < 0.3) & (np.abs(du_dv) < 0.3) & ((np.abs(dv_du) > 0.004) | (np.abs(du_dv) > 0.004))
    opengl = ((dv_du - du_dv)[relief] ** 2).mean()
    directx = ((-dv_du - du_dv)[relief] ** 2).mean()
    return directx < opengl


def flip_green(image):
    pixels = image_pixels(image)
    pixels[..., 1] = 1 - pixels[..., 1]
    image.pixels.foreach_set(pixels.ravel())
    image.update()


def texture_roles(material):
    """Each image in the material with what it feeds: 'normal', 'metal_rough' or 'color'."""
    roles = {}
    for node in material.node_tree.nodes:
        if node.type != 'TEX_IMAGE' or node.image is None:
            continue
        role = 'color'
        for link in node.outputs['Color'].links:
            if link.to_node.type == 'NORMAL_MAP':
                role = 'normal'
            elif link.to_node.type in ('SEPARATE_COLOR', 'SEPRGB', 'SEPARATE_RGB'):
                role = 'metal_rough'
        roles[node.image] = role
    return roles


def build(gun_id, spec):
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=os.path.join(SOURCE, spec['source']))

    for name in spec.get('drop', ()):
        bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)

    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    # Bake parents' transforms in (the pack's are in centimetres under a 0.01 scale)
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    if 'turn_drum' in spec:
        drum = bpy.data.objects[spec['turn_drum']]
        low, high = bounds(world_points(drum))
        centre = Vector((low + high) / 2)
        # About the upright through its middle, so its neck stays in the magazine well
        apply_matrix(drum, Matrix.Translation(centre) @ Matrix.Rotation(math.pi / 2, 4, 'Z') @ Matrix.Translation(-centre))

    pitch = 0.0
    if 'level' in spec:
        axis = principal_axis(world_points(bpy.data.objects[spec['level']]))
        pitch = math.atan2(axis.z, axis.y)

    # Mark the trigger so it can be found in the joined mesh
    trigger = bpy.data.objects['Trigger']
    group = trigger.vertex_groups.new(name='trigger')
    group.add(range(len(trigger.data.vertices)), 1.0, 'REPLACE')

    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    gun = bpy.context.view_layer.objects.active
    for obj in list(bpy.data.objects):
        if obj != gun:
            bpy.data.objects.remove(obj, do_unlink=True)
    gun.name = gun_id
    gun.data.name = gun_id

    # Level the barrel, then point it down -Y, which the exporter makes glTF +Z
    turn = Matrix.Rotation(-pitch, 4, 'X')
    if spec['barrel'] == '+Y':
        turn = Matrix.Rotation(math.pi, 4, 'Z') @ turn
    apply_matrix(gun, turn)

    low, high = bounds(world_points(gun))
    scale = spec['length'] / (high[1] - low[1])
    apply_matrix(gun, Matrix.Scale(scale, 4))

    # Origin at the top of the trigger, at its back, which is where the grip
    # meets the frame and the fist closes. Across, the trigger's middle is the
    # gun's centre line; the bounds aren't, with a bolt handle out one side
    points = world_points(gun)
    index = gun.vertex_groups['trigger'].index
    in_trigger = [v.index for v in gun.data.vertices if any(g.group == index and g.weight > 0 for g in v.groups)]
    trigger_low, trigger_high = bounds(points[in_trigger])
    origin = Vector(((trigger_low[0] + trigger_high[0]) / 2, trigger_high[1], trigger_high[2]))
    apply_matrix(gun, Matrix.Translation(-origin))
    gun.vertex_groups.clear()

    before = triangles(gun)
    after = decimate(gun, BUDGET)

    # Muzzle in the middle of whatever is right at the front, which is the barrel's crown
    points = world_points(gun)
    front = points[:, 1].min()
    tip = points[points[:, 1] < front + 0.003]
    muzzle_at = Vector(((tip[:, 0].min() + tip[:, 0].max()) / 2, front, (tip[:, 2].min() + tip[:, 2].max()) / 2))
    muzzle = bpy.data.objects.new('muzzle', None)
    muzzle.empty_display_size = 0.02
    bpy.context.scene.collection.objects.link(muzzle)
    muzzle.parent = gun
    muzzle.location = muzzle_at

    # One material, named for the gun; drop slots nothing uses
    used = set(p.material_index for p in gun.data.polygons)
    for index in reversed(range(len(gun.data.materials))):
        if index not in used:
            gun.active_material_index = index
            bpy.ops.object.material_slot_remove()
    notes = ['removed the loose ' + ', '.join(spec['drop']) + ' lying beside it'] if 'drop' in spec else []
    if 'turn_drum' in spec:
        notes.append('drum turned to face sideways')
    if 'level' in spec:
        notes.append('levelled')
    if after < before:
        notes.append('decimated from %d triangles' % before)
    for material in gun.data.materials:
        material.name = gun_id
        for image, role in texture_roles(material).items():
            flipped = role == 'normal' and green_points_down(image)
            if flipped:
                flip_green(image)
                notes.append('normal map turned from DirectX to glTF\'s way up')
            size = METAL_ROUGH_SIZE if role == 'metal_rough' else TEXTURE_SIZE
            if image.size[0] > size:
                image.scale(size, size)
            image.name = gun_id + '_' + role
            print('TEXTURE', gun_id, role, image.size[:], 'green flipped' if flipped else '', flush=True)

    bpy.ops.object.select_all(action='DESELECT')
    gun.select_set(True)
    muzzle.select_set(True)
    path = os.path.join(OUTPUT, gun_id + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True,
        export_image_format='WEBP', export_image_quality=80, export_animations=False,
        export_meshopt_compression_enable=True, export_extras=False)

    # Reported in glTF axes: x, y up, z along the barrel
    low, high = bounds(world_points(gun))
    stats = dict(
        size=[round(float(v), 3) for v in (high[0] - low[0], high[2] - low[2], high[1] - low[1])],
        muzzle=[round(v, 3) + 0.0 for v in (muzzle_at.x, muzzle_at.z, -muzzle_at.y)],
        butt=round(-float(high[1]), 3), bottom=round(float(low[2]), 3),
        triangles=after, bytes=os.path.getsize(path), notes=notes)
    print('GUN', gun_id, 'from', spec['source'], stats, flush=True)
    return stats


os.makedirs(OUTPUT, exist_ok=True)
# Names after the output folder build just those guns, for trying one out
only = args[2:]
built = {}
for gun_id, spec in GUNS.items():
    if only and gun_id not in only:
        continue
    built[gun_id] = build(gun_id, spec)

if not only:
    lines = [
        'Gun models, built by tools/guns/build_guns.py from the "Free CC0 Guns & Explosives Pack"',
        'by 3dmodelscc0, released as CC0 (public domain). Sources are inside its Guns&Explosives_glb folder.',
        '',
        'Each file is one mesh named for the gun, with one material, its origin at the top of the grip',
        'just behind the trigger, the barrel along +Z and the top of the gun up +Y, and a child empty',
        'named "muzzle" at the barrel tip. Units are the world\'s: a person is 1 tall.',
        'Positions below are x, y, z from the origin; "butt" is how far back the gun reaches (z) and',
        '"bottom" how far down (y), grip or magazine.',
        '',
    ]
    for gun_id, spec in GUNS.items():
        stats = built[gun_id]
        lines.append('%s  from %s' % (gun_id + '.glb', spec['source']))
        lines.append('    %.2f long, %d triangles, %d KB; muzzle %s, butt %.3f, bottom %.3f'
                     % (stats['size'][2], stats['triangles'], round(stats['bytes'] / 1024), stats['muzzle'],
                        stats['butt'], stats['bottom']))
        if stats['notes']:
            lines.append('    ' + '; '.join(stats['notes']))
    with open(os.path.join(OUTPUT, 'README.txt'), 'w') as readme:
        readme.write('\n'.join(lines) + '\n')
