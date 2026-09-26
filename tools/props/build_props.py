"""
Packs Poly Haven's CC0 street props into one game-ready file.

    blender -b --factory-startup -P tools/props/build_props.py -- <polyhaven models dir> build/assets/props.glb

Each prop is joined into a single mesh, decimated to a game budget, scaled
from metres to the world's units (a person here is one unit tall, which makes
a metre 0.58 of one), stood with its base on the origin, and exported with its
textures shrunk and packed as WebP.
"""
import bpy, bmesh, os, sys, math
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
SOURCE, OUTPUT = args[0], args[1]
METRE = 0.58

# Files that hold a few variants side by side, of which only the first is wanted
SINGLE = ('fire_hydrant', 'metal_trash_can', 'modular_street_seating', 'concrete_road_barrier')


# Variants that touch, so the gap test can't split them: cut at a fraction of the width
SPLIT_AT = {'modular_street_seating': 0.5, 'concrete_road_barrier': 0.5}


def keep_first_variant(obj, split_at=None):
    """Deletes everything but the leftmost group of pieces, where groups are split by gaps along X."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    unvisited = set(bm.verts)
    islands = []
    while unvisited:
        start = unvisited.pop()
        island = [start]
        stack = [start]
        while stack:
            vert = stack.pop()
            for edge in vert.link_edges:
                other = edge.other_vert(vert)
                if other in unvisited:
                    unvisited.remove(other)
                    island.append(other)
                    stack.append(other)
        xs = [v.co.x for v in island]
        islands.append((min(xs), max(xs), island))
    islands.sort(key=lambda item: item[0])
    keep = []
    if split_at is not None:
        left = min(i[0] for i in islands)
        right_edge = max(i[1] for i in islands)
        cut = left + (right_edge - left) * split_at
        for low, high, island in islands:
            if (low + high) / 2 < cut:
                keep.extend(island)
        islands = []
    right = None
    for low, high, island in islands:
        if right is not None and low > right + 0.05:
            break
        keep.extend(island)
        right = high if right is None else max(right, high)
    keeping = set(keep)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v not in keeping], context='VERTS')
    bm.to_mesh(obj.data)
    bm.free()
    # Drop material slots nothing uses any more
    used = set(p.material_index for p in obj.data.polygons)
    for index in reversed(range(len(obj.data.materials))):
        if index not in used:
            obj.active_material_index = index
            bpy.ops.object.material_slot_remove()


# name: (triangle budget, texture size)
PROPS = {
    'street_lamp_01': (900, 512),
    'street_lamp_02': (800, 512),
    'fire_hydrant': (260, 256),
    'metal_trash_can': (300, 256),
    'modular_street_seating': (700, 512),
    'concrete_road_barrier': (500, 512),
    'utility_box_01': (400, 256),
    'planter_box_01': (400, 256),
}

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)

roots = []
for name, (budget, texture_size) in PROPS.items():
    folder = os.path.join(SOURCE, name)
    gltf = next(f for f in os.listdir(folder) if f.endswith('.gltf'))
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(folder, gltf))
    new = [o for o in bpy.data.objects if o not in before]
    new_names = [o.name for o in new]
    meshes = [o for o in new if o.type == 'MESH']

    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    # Bake parents' transforms in before joining
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    if len(meshes) > 1:
        bpy.ops.object.join()
    prop = bpy.context.view_layer.objects.active
    for leftover in new_names:
        obj = bpy.data.objects.get(leftover)
        if obj is not None and obj != prop:
            bpy.data.objects.remove(obj, do_unlink=True)

    prop.name = name
    prop.data.name = name
    prop.scale = prop.scale * METRE
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    if name in SINGLE:
        keep_first_variant(prop, SPLIT_AT.get(name))

    triangles = sum(len(p.vertices) - 2 for p in prop.data.polygons)
    if triangles > budget:
        decimate = prop.modifiers.new('decimate', 'DECIMATE')
        decimate.ratio = budget / triangles
        decimate.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=decimate.name)
    after = sum(len(p.vertices) - 2 for p in prop.data.polygons)

    # Base on the origin, centred over it
    low = Vector((min(v.co.x for v in prop.data.vertices), min(v.co.y for v in prop.data.vertices), min(v.co.z for v in prop.data.vertices)))
    high = Vector((max(v.co.x for v in prop.data.vertices), max(v.co.y for v in prop.data.vertices), max(v.co.z for v in prop.data.vertices)))
    shift = Vector((-(low.x + high.x) / 2, -(low.y + high.y) / 2, -low.z))
    if name.startswith('street_lamp'):
        # Lamps pivot on the pole, not the middle of pole and arm together
        shift.x = 0
        shift.y = 0
    for v in prop.data.vertices:
        v.co += shift

    for material in prop.data.materials:
        for node in material.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image is not None:
                image = node.image
                if image.size[0] > texture_size:
                    image.scale(texture_size, texture_size)
    size = high - low
    print('PROP', name, triangles, '->', after, 'size', [round(v, 3) for v in size], 'materials', [m.name for m in prop.data.materials], flush=True)
    roots.append(prop)

# Laid out in a row, so a look at the file shows them all; the game reads them by name
for i, prop in enumerate(roots):
    prop.location.x = i * 3

bpy.ops.object.select_all(action='DESELECT')
for prop in roots:
    prop.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUTPUT, export_format='GLB', use_selection=True, export_apply=True,
    export_image_format='WEBP', export_image_quality=80, export_animations=False,
    export_meshopt_compression_enable=True, export_extras=False)
print('EXPORTED', OUTPUT, os.path.getsize(OUTPUT))
