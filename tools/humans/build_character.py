"""
Builds a game-ready human from a spec in characters.json.

Run through Blender with MPFB installed, for example:

    blender -b -P tools/humans/build_character.py -- tools/humans/characters.json player build/assets/humans/player.glb

What it does, in order:

1. Generates the human with MPFB (MakeHuman's Blender add-on): body, skin,
   eyes, brows, lashes, hair, clothes and a Mixamo-named skeleton.
2. Cleans it up for a game: bakes the body shape, cuts away skin hidden under
   clothes, drops the teeth, and scales it to the size the world is built for.
3. Packs every texture into one atlas and joins every part into one mesh, so a
   character is a single draw call.
4. Optionally retargets the game's animation set onto the skeleton, from the
   boxman the game shipped with, and adds a walk cycle for pedestrians.
5. Exports a binary glTF.

Everything MPFB uses from MakeHuman's system asset pack is CC0.
"""

import bpy
import bmesh
import json
import math
import os
import sys

import numpy as np
from mathutils import Matrix, Quaternion, Vector

from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.objectservice import ObjectService

ARGS = sys.argv[sys.argv.index('--') + 1:]
SPEC_FILE, CHARACTER, OUTPUT = ARGS[0], ARGS[1], ARGS[2]
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BOXMAN = os.path.join(REPO, 'build', 'assets', 'boxman.glb')

SPECS = json.load(open(SPEC_FILE))
SPEC = dict(SPECS['defaults'])
SPEC.update(SPECS['characters'][CHARACTER])

PREFIX = 'mixamorig:'
FPS = 24


def log(*values):
    print('[character]', *values, flush=True)


# ---------------------------------------------------------------------------
# 1. Generate

def generate():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    info = HumanService._create_default_human_info_dict()
    info['name'] = 'Human'
    info['phenotype'] = SPEC['phenotype']
    info['rig'] = 'mixamo'
    for part in ['eyes', 'eyebrows', 'eyelashes', 'hair']:
        info[part] = SPEC.get(part, '')
    info['proxy'] = SPEC.get('proxy', '')
    info['clothes'] = SPEC['clothes']
    info['skin_mhmat'] = SPEC['skin']
    info['skin_material_type'] = 'GAMEENGINE'
    info['clothes_material_type'] = 'GAMEENGINE'
    info['eyes_material_type'] = 'GAMEENGINE'

    settings = HumanService.get_default_deserialization_settings()
    settings['subdiv_levels'] = 0
    basemesh = HumanService.deserialize_from_dict(info, settings)

    armature = basemesh.parent
    log('generated', armature.name, len(armature.data.bones), 'bones')
    return armature


# ---------------------------------------------------------------------------
# 2. Clean up

def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def bake_mesh(obj):
    """Shape keys applied, hiding masks applied, armature modifier kept."""
    activate(obj)
    if obj.data.shape_keys is not None:
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)

    for modifier in list(obj.modifiers):
        if modifier.type == 'MASK':
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        elif modifier.type not in ('ARMATURE',):
            obj.modifiers.remove(modifier)


def part_meshes(armature):
    return [child for child in armature.children if child.type == 'MESH']


def clean(armature):
    for obj in part_meshes(armature):
        lowered = obj.name.lower()
        if 'teeth' in lowered or 'tongue' in lowered:
            bpy.data.objects.remove(obj, do_unlink=True)
            continue

        # The full body is only there to drive a proxy, when one is used
        if SPEC.get('proxy') and obj.name.endswith('.body'):
            bpy.data.objects.remove(obj, do_unlink=True)
            continue

        bake_mesh(obj)

    for obj in part_meshes(armature):
        # MPFB leaves a mask modifier's group behind; nothing else needs them
        for group in list(obj.vertex_groups):
            if group.name not in armature.data.bones:
                obj.vertex_groups.remove(group)


def mesh_bounds(objects):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    low = Vector((1e9, 1e9, 1e9))
    high = Vector((-1e9, -1e9, -1e9))
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        for vertex in mesh.vertices:
            p = obj.matrix_world @ vertex.co
            low = Vector(map(min, low, p))
            high = Vector(map(max, high, p))
        evaluated.to_mesh_clear()
    return low, high


def rescale(armature):
    """To the height the world is built for, feet on the origin."""
    meshes = part_meshes(armature)
    body = [m for m in meshes if not any(k in m.name.lower() for k in ('hair', 'hat', 'fedora'))]
    low, high = mesh_bounds(body)
    height = high.z - low.z
    factor = SPEC['height'] / height
    log('height', round(height, 3), 'scaling by', round(factor, 4))

    armature.scale = (factor, factor, factor)
    armature.location = (0, 0, 0)
    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    low, high = mesh_bounds(part_meshes(armature))
    log('bounds after', [round(v, 3) for v in low], [round(v, 3) for v in high])


# ---------------------------------------------------------------------------
# 3. Atlas

def base_image(material):
    """The image feeding Base Color, and whether its alpha is used."""
    tree = material.node_tree
    principled = next((n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    image = None
    uses_alpha = False
    if principled is not None:
        for link in tree.links:
            if link.to_node == principled and link.from_node.type == 'TEX_IMAGE':
                if link.to_socket.name == 'Base Color':
                    image = link.from_node.image
                if link.to_socket.name == 'Alpha':
                    uses_alpha = True
    if image is None:
        images = [n.image for n in tree.nodes if n.type == 'TEX_IMAGE' and n.image is not None]
        image = images[0] if images else None
    return image, uses_alpha


def normal_image(material):
    for node in material.node_tree.nodes:
        if node.type == 'NORMAL_MAP':
            for link in material.node_tree.links:
                if link.to_node == node and link.from_node.type == 'TEX_IMAGE':
                    return link.from_node.image
    return None


def image_array(image, width, height):
    """RGBA floats, bottom row first, resized."""
    copy = image.copy()
    copy.scale(width, height)
    pixels = np.empty(width * height * 4, dtype=np.float32)
    copy.pixels.foreach_get(pixels)
    bpy.data.images.remove(copy)
    return pixels.reshape((height, width, 4))


def erase_rects(pixels, rects):
    """
    Paints over printed logos. Rects are fractions of the texture measured
    from its top left, as it appears in an image viewer. Each is filled with
    the colour just around it, with a soft edge.
    """
    height, width = pixels.shape[:2]
    for x0, y0, x1, y1 in rects:
        left, right = int(x0 * width), int(x1 * width)
        # Stored bottom row first
        bottom, top = int((1 - y1) * height), int((1 - y0) * height)
        pad = max(3, int((right - left) * 0.25))
        ring = np.concatenate([
            pixels[max(0, bottom - pad):bottom, left:right].reshape(-1, 4),
            pixels[top:min(height, top + pad), left:right].reshape(-1, 4),
            pixels[bottom:top, max(0, left - pad):left].reshape(-1, 4),
            pixels[bottom:top, right:min(width, right + pad)].reshape(-1, 4),
        ])
        fill = np.median(ring, axis=0)
        block = pixels[bottom:top, left:right]
        ys = np.linspace(-1, 1, top - bottom)[:, None]
        xs = np.linspace(-1, 1, right - left)[None, :]
        edge = np.clip((1 - np.maximum(np.abs(xs), np.abs(ys))) * 6, 0, 1)[..., None]
        pixels[bottom:top, left:right] = block * (1 - edge) + fill * edge


def role_of(obj):
    """What a part is, from the type MPFB tagged it with."""
    kind = ObjectService.get_object_type(obj).lower()
    if kind in ('basemesh', 'proxymeshes'):
        return 'body'
    if kind in ('hair', 'eyes'):
        return kind
    if kind == 'eyebrows':
        return 'eyebrow'
    if kind == 'eyelashes':
        return 'eyelash'
    name = obj.name.lower()
    if 'shoes' in name:
        return 'shoes'
    if 'fedora' in name:
        return 'fedora'
    return 'clothes'


# Parts whose texture alpha cuts the shape out. Everything else is solid.
CUTOUT_ROLES = ('hair', 'eyebrow', 'eyelash')


# Where each part goes, as fractions of the atlas: x, y (top left), w, h
LAYOUT = {
    'body': (0.0, 0.0, 0.5, 0.5),
    'clothes': (0.5, 0.0, 0.5, 0.5),
    'clothes2': (0.5, 0.5, 0.5, 0.5),
    'shoes': (0.0, 0.5, 0.25, 0.25),
    'hair': (0.25, 0.5, 0.25, 0.25),
    'fedora': (0.0, 0.75, 0.25, 0.25),
    'eyes': (0.25, 0.75, 0.0625, 0.0625),
    'eyebrow': (0.3125, 0.75, 0.125, 0.0625),
    'eyelash': (0.3125, 0.8125, 0.125, 0.0625),
}


def build_atlas(armature):
    size = SPEC['atlas']
    color = np.zeros((size, size, 4), dtype=np.float32)
    color[..., 3] = 1.0
    normals = np.zeros((size, size, 4), dtype=np.float32)
    normals[...] = (0.5, 0.5, 1.0, 1.0)
    has_normals = False

    used = set()
    tint = SPEC.get('tint')
    for obj in part_meshes(armature):
        role = role_of(obj)
        if role == 'clothes' and 'clothes' in used:
            role = 'clothes2'
        used.add(role)
        key = obj.name.split('.', 1)[-1]

        # Before the UVs move into the atlas, while they still match the
        # part's own texture, which is what the tint area is measured on
        mark_tint(obj, tint if tint is not None and tint['part'] == key else None)

        x, y, w, h = LAYOUT[role]
        tile_w, tile_h = int(w * size), int(h * size)

        material = obj.data.materials[0]
        image, uses_alpha = base_image(material)
        if image is None:
            log('no texture on', obj.name)
            continue

        pixels = image_array(image, tile_w, tile_h)
        if role not in CUTOUT_ROLES:
            pixels[..., 3] = 1.0

        if key in SPEC.get('erase', {}):
            erase_rects(pixels, SPEC['erase'][key])

        # Rows are stored bottom first, so the tile's top edge in image terms
        # is its highest row here
        row0 = size - int((y + h) * size)
        col0 = int(x * size)
        color[row0:row0 + tile_h, col0:col0 + tile_w] = pixels

        normal = normal_image(material)
        if normal is not None and SPEC.get('normals', False):
            normals[row0:row0 + tile_h, col0:col0 + tile_w] = image_array(normal, tile_w, tile_h)
            has_normals = True

        # UVs into the tile
        mesh = obj.data
        uv_layer = mesh.uv_layers.active
        for loop_uv in uv_layer.data:
            u, v = loop_uv.uv
            u = u - math.floor(u) if (u < 0 or u > 1) else u
            v = v - math.floor(v) if (v < 0 or v > 1) else v
            loop_uv.uv = (x + u * w, (1 - y - h) + v * h)
        uv_layer.name = 'UVMap'
        log('atlas', obj.name, role, (tile_w, tile_h), 'cutout' if role in CUTOUT_ROLES else '')

    atlas = bpy.data.images.new('atlas', size, size, alpha=True)
    atlas.pixels.foreach_set(color.ravel())
    atlas.file_format = 'PNG'
    atlas.pack()

    normal_atlas = None
    if has_normals:
        normal_atlas = bpy.data.images.new('atlas_normal', size, size, alpha=False)
        normal_atlas.colorspace_settings.name = 'Non-Color'
        normal_atlas.pixels.foreach_set(normals.ravel())
        normal_atlas.file_format = 'PNG'
        normal_atlas.pack()

    return atlas, normal_atlas


def mark_tint(obj, tint):
    """
    A per-vertex mask saying which parts take the player's colour. The game
    multiplies the colour in where it's 1, so a white shirt comes out in it
    and jeans next to it don't.
    """
    mesh = obj.data
    attribute = mesh.attributes.get('_tintmask') or mesh.attributes.new('_tintmask', 'FLOAT', 'POINT')
    values = [0.0] * len(mesh.vertices)
    if tint is not None:
        x0, y0, x1, y1 = tint['uv']
        uv_layer = mesh.uv_layers.active
        for polygon in mesh.polygons:
            for loop_index in polygon.loop_indices:
                u, v = uv_layer.data[loop_index].uv
                u = u - math.floor(u) if (u < 0 or u > 1) else u
                v = v - math.floor(v) if (v < 0 or v > 1) else v
                if x0 <= u <= x1 and y0 <= v <= y1:
                    values[mesh.loops[loop_index].vertex_index] = 1.0
        log('tint mask on', obj.name, int(sum(values)), 'of', len(values))
    attribute.data.foreach_set('value', values)


def join_parts(armature, atlas, normal_atlas):
    meshes = part_meshes(armature)
    body = next((m for m in meshes if role_of(m) == 'body'), meshes[0])

    material = bpy.data.materials.new('Human')
    tree = material.node_tree
    principled = next(n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED')
    principled.inputs['Roughness'].default_value = 0.72
    principled.inputs['Metallic'].default_value = 0.0
    texture = tree.nodes.new('ShaderNodeTexImage')
    texture.image = atlas
    tree.links.new(texture.outputs['Color'], principled.inputs['Base Color'])
    clip = tree.nodes.new('ShaderNodeMath')
    clip.operation = 'ROUND'
    tree.links.new(texture.outputs['Alpha'], clip.inputs[0])
    tree.links.new(clip.outputs[0], principled.inputs['Alpha'])

    if normal_atlas is not None:
        normal_texture = tree.nodes.new('ShaderNodeTexImage')
        normal_texture.image = normal_atlas
        normal_map = tree.nodes.new('ShaderNodeNormalMap')
        tree.links.new(normal_texture.outputs['Color'], normal_map.inputs['Color'])
        tree.links.new(normal_map.outputs['Normal'], principled.inputs['Normal'])

    for obj in meshes:
        obj.data.materials.clear()
        obj.data.materials.append(material)

    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body.name = 'Human'
    body.data.name = 'Human'

    # One armature modifier is all a joined mesh needs
    armatures = [m for m in body.modifiers if m.type == 'ARMATURE']
    for extra in armatures[1:]:
        body.modifiers.remove(extra)
    armatures[0].object = armature
    log('joined', len(body.data.vertices), 'vertices,', len(body.data.polygons), 'faces')
    return body


# ---------------------------------------------------------------------------
# 4. Animation

ROTATIONS = {
    'Hips': [('body_lower', 1.0)],
    'Spine': [('body_lower', 1.0)],
    'Spine1': [('body_lower', 0.5), ('body_upper', 0.5)],
    'Spine2': [('body_upper', 1.0)],
    'Neck': [('body_upper', 0.5), ('head', 0.5)],
    'Head': [('head', 1.0)],
    'LeftArm': [('arm_upper.L', 1.0)],
    'LeftForeArm': [('arm_lower.L', 1.0)],
    'RightArm': [('arm_upper.R', 1.0)],
    'RightForeArm': [('arm_lower.R', 1.0)],
    'LeftUpLeg': [('leg_upper.L', 1.0)],
    'LeftLeg': [('leg_lower.L', 1.0)],
    'RightUpLeg': [('leg_upper.R', 1.0)],
    'RightLeg': [('leg_lower.R', 1.0)],
}

# Joint each boxman bone points at, where its own tail isn't trustworthy
SOURCE_AIM = {
    'body_lower': 'body_upper',
    'body_upper': 'head',
    'arm_upper.L': 'arm_lower.L',
    'arm_upper.R': 'arm_lower.R',
    'leg_upper.L': 'leg_lower.L',
    'leg_upper.R': 'leg_lower.R',
}

# The boxman's arms hang from shoulders much wider than a person's, so hung
# straight down they'd pass through the hips. A few degrees out clears them.
ARM_SPREAD = 0.09


def rotation_of(matrix):
    return matrix.to_3x3().normalized().to_quaternion()


def bone_chain_order(armature):
    order = []

    def visit(bone):
        order.append(bone)
        for child in bone.children:
            visit(child)

    for bone in armature.data.bones:
        if bone.parent is None:
            visit(bone)
    return order


class Retargeter:
    def __init__(self, target):
        self.target = target
        self.order = bone_chain_order(target)
        self.rest = {b.name: b.matrix_local.copy() for b in target.data.bones}
        self.hips = PREFIX + 'Hips'
        self.hips_height = self.rest[self.hips].translation.z
        self.alignment = {}

    def align_to(self, source_directions):
        """Turns each target bone so it points where the boxman's did at rest."""
        for short, sources in ROTATIONS.items():
            bone = self.target.data.bones[PREFIX + short]
            aim = (bone.tail_local - bone.head_local).normalized()
            wanted = source_directions[sources[0][0]].copy()
            if short in ('LeftArm', 'LeftForeArm'):
                wanted = (wanted + Vector((ARM_SPREAD, 0, 0))).normalized()
            if short in ('RightArm', 'RightForeArm'):
                wanted = (wanted + Vector((-ARM_SPREAD, 0, 0))).normalized()
            self.alignment[short] = aim.rotation_difference(wanted)

    def solve(self, deltas, hips_offset):
        """
        Armature space matrices for every bone, given each mapped source
        bone's world rotation since rest and how far the hips have moved.
        Unmapped bones keep their rest pose relative to their parent.
        """
        posed = {}
        for bone in self.order:
            rest = self.rest[bone.name]
            if bone.parent is not None:
                parent_rest = self.rest[bone.parent.name]
                inherited = posed[bone.parent.name] @ parent_rest.inverted() @ rest
            else:
                inherited = rest.copy()

            short = bone.name[len(PREFIX):] if bone.name.startswith(PREFIX) else bone.name
            if short in ROTATIONS:
                delta = Quaternion()
                total = 0.0
                for source, weight in ROTATIONS[short]:
                    total += weight
                    delta = delta.slerp(deltas[source], weight / total)
                rotation = delta @ self.alignment[short] @ rotation_of(rest)
                location = inherited.translation
                if bone.name == self.hips:
                    location = rest.translation + hips_offset
                matrix = Matrix.LocRotScale(location, rotation, Vector((1, 1, 1)))
            else:
                matrix = inherited

            posed[bone.name] = matrix
        return posed

    def key(self, posed, frame, previous):
        for bone in self.order:
            # Anything that isn't driven keeps its rest pose, and a bone no
            # clip mentions stays there by itself, so it isn't keyed at all
            short = bone.name[len(PREFIX):] if bone.name.startswith(PREFIX) else bone.name
            if short not in ROTATIONS:
                continue

            rest = self.rest[bone.name]
            if bone.parent is not None:
                parent_rest = self.rest[bone.parent.name]
                basis = (parent_rest.inverted() @ rest).inverted() @ posed[bone.parent.name].inverted() @ posed[bone.name]
            else:
                basis = rest.inverted() @ posed[bone.name]

            pose_bone = self.target.pose.bones[bone.name]
            pose_bone.rotation_mode = 'QUATERNION'
            quaternion = basis.to_quaternion()
            last = previous.get(bone.name)
            if last is not None and last.dot(quaternion) < 0:
                quaternion.negate()
            previous[bone.name] = quaternion

            pose_bone.rotation_quaternion = quaternion
            pose_bone.keyframe_insert('rotation_quaternion', frame=frame)
            if bone.name == self.hips:
                pose_bone.location = basis.to_translation()
                pose_bone.keyframe_insert('location', frame=frame)


def linearize(action):
    """
    Straight lines between keys. There's a key every frame, so it looks no
    different, but Blender's default Bezier keys go out as glTF cubic splines
    whose tangents come out at the wrong scale for three.js: every bone
    overshoots between keys and snaps back, twenty four times a second, which
    reads as the whole body shaking.
    """
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in bag.fcurves:
                    for key in curve.keyframe_points:
                        key.interpolation = 'LINEAR'


def finger_curl(name):
    """A relaxed hand: fingers curled a little, thumb less."""
    if 'Hand' not in name or not name[-1].isdigit():
        return None
    angle = math.radians(12 if 'Thumb' in name else 24)
    axis = Vector((1, 0, 0))
    return Quaternion(axis, angle)


def relax_hands(armature, body):
    """
    Curls the fingers into the rest pose itself, so every clip gets relaxed
    hands without a single finger bone needing a track.
    """
    activate(armature)
    bpy.ops.object.mode_set(mode='POSE')
    for pose_bone in armature.pose.bones:
        curl = finger_curl(pose_bone.name)
        pose_bone.rotation_mode = 'QUATERNION'
        pose_bone.rotation_quaternion = curl if curl is not None else Quaternion()
    bpy.ops.object.mode_set(mode='OBJECT')

    activate(body)
    modifier = next(m for m in body.modifiers if m.type == 'ARMATURE')
    bpy.ops.object.modifier_apply(modifier=modifier.name)

    activate(armature)
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    modifier = body.modifiers.new('Armature', 'ARMATURE')
    modifier.object = armature


def import_boxman():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=BOXMAN)
    new = [o for o in bpy.data.objects if o not in before]
    source = next(o for o in new if o.type == 'ARMATURE')
    return source, new


def source_rest(source):
    world = source.matrix_world
    heads = {b.name: world @ b.head_local for b in source.data.bones}
    tails = {b.name: world @ b.tail_local for b in source.data.bones}
    directions = {}
    for bone in source.data.bones:
        aim = heads[SOURCE_AIM[bone.name]] if bone.name in SOURCE_AIM else tails[bone.name]
        directions[bone.name] = (aim - heads[bone.name]).normalized()
    rotations = {b.name: rotation_of(world @ b.matrix_local) for b in source.data.bones}
    return heads, directions, rotations


def retarget(armature):
    source, imported = import_boxman()
    heads, directions, rest_rotations = source_rest(source)
    source_hips_height = heads['body_lower'].z

    target = Retargeter(armature)
    target.align_to(directions)
    scale = target.hips_height / source_hips_height
    log('hips', round(target.hips_height, 3), 'boxman hips', round(source_hips_height, 3), 'scale', round(scale, 3))

    armature.animation_data_create()
    source_actions = [a for a in bpy.data.actions if a.name != 'reset' and len(a.slots) > 0]
    made = []
    for action in source_actions:
        name = action.name
        action.name = 'boxman:' + name
        source.animation_data.action = action
        if action.slots:
            source.animation_data.action_slot = action.slots[0]
        first, last = int(action.frame_range[0]), int(action.frame_range[1])

        result = bpy.data.actions.new(name)
        result.use_fake_user = True
        armature.animation_data.action = result
        previous = {}

        for frame in range(first, last + 1):
            bpy.context.scene.frame_set(frame)
            world = source.matrix_world
            deltas = {}
            for bone in source.pose.bones:
                posed = rotation_of(world @ bone.matrix)
                deltas[bone.name] = posed @ rest_rotations[bone.name].inverted()
            hips_now = world @ source.pose.bones['body_lower'].head
            offset = (hips_now - heads['body_lower']) * scale
            target.key(target.solve(deltas, offset), frame - first, previous)

        made.append(result)

    armature.animation_data.action = None
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)
    # Everything the boxman brought, including the clips that weren't wanted
    for action in list(bpy.data.actions):
        if action not in made:
            bpy.data.actions.remove(action)

    made.append(synthesize_walk(target, armature))
    for action in made:
        linearize(action)
    log('animations', [a.name for a in made])
    return made


def synthesize_walk(target, armature):
    """
    The boxman never walked, only jogged, and a city full of people jogging
    everywhere looks wrong. So a walk is made from sines: legs swinging from
    the hip with the knee bending on the way through, arms swinging opposite,
    and the hips bobbing twice a cycle and swaying once.
    """
    frames = int(FPS * 1.1)
    result = bpy.data.actions.new('walk')
    result.use_fake_user = True
    armature.animation_data.action = result
    previous = {}
    x = Vector((1, 0, 0))
    z = Vector((0, 0, 1))

    for frame in range(frames + 1):
        phase = 2 * math.pi * frame / frames
        s = math.sin(phase)

        def pitch(degrees):
            # Positive swings the limb forward, toward -Y
            return Quaternion(x, math.radians(-degrees))

        # A leg swinging forward has its knee bending on the way through
        left = s
        right = -s
        deltas = {
            'body_lower': Quaternion(z, math.radians(4 * s)) @ pitch(-3),
            'body_upper': Quaternion(z, math.radians(-6 * s)) @ pitch(-4),
            'head': Quaternion(z, math.radians(3 * s)) @ pitch(-2),
            'leg_upper.L': pitch(24 * left),
            'leg_upper.R': pitch(24 * right),
            'arm_upper.L': pitch(-14 * left),
            'arm_upper.R': pitch(-14 * right),
            'arm_lower.L': pitch(-14 * left) @ pitch(12 + 6 * max(0, -left)),
            'arm_lower.R': pitch(-14 * right) @ pitch(12 + 6 * max(0, -right)),
        }
        for side, swing in (('L', left), ('R', right)):
            thigh = 24 * swing
            # Knee bends while the leg passes under the body going forward
            knee = 6 + 38 * max(0.0, math.sin(phase + (0 if side == 'L' else math.pi) + math.pi * 0.65))
            deltas['leg_lower.' + side] = pitch(thigh) @ pitch(-knee)

        bob = 0.012 * math.cos(2 * phase)
        sway = 0.01 * s
        offset = Vector((sway, 0, bob - 0.006))
        target.key(target.solve(deltas, offset), frame, previous)

    armature.animation_data.action = None
    return result


# ---------------------------------------------------------------------------
# 5. Export

def export(armature, body):
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.context.scene.render.fps = FPS

    animate = SPEC.get('animations', False)
    bpy.ops.export_scene.gltf(
        filepath=OUTPUT,
        export_format='GLB',
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_attributes=True,
        export_materials='EXPORT',
        export_image_format='WEBP',
        export_image_quality=SPEC.get('quality', 82),
        export_skins=True,
        export_morph=False,
        export_animations=animate,
        export_animation_mode='ACTIONS',
        # Only what was keyed: rotations everywhere, position on the hips.
        # Sampling would add a position and scale track to every bone, which
        # is a megabyte of JSON describing things that never move
        export_force_sampling=False,
        export_optimize_animation_size=True,
        export_anim_slide_to_zero=True,
        export_reset_pose_bones=True,
        export_rest_position_armature=True,
        export_def_bones=False,
        export_leaf_bone=False,
        export_meshopt_compression_enable=True,
        export_extras=False,
    )
    log('exported', OUTPUT, os.path.getsize(OUTPUT), 'bytes')


def main():
    os.makedirs(os.path.dirname(os.path.abspath(OUTPUT)), exist_ok=True)
    armature = generate()
    clean(armature)
    rescale(armature)
    atlas, normal_atlas = build_atlas(armature)
    body = join_parts(armature, atlas, normal_atlas)
    relax_hands(armature, body)
    if SPEC.get('animations', False):
        retarget(armature)
    if SPEC.get('save_blend'):
        bpy.ops.wm.save_as_mainfile(filepath=OUTPUT.replace('.glb', '.blend'))
    export(armature, body)


main()
