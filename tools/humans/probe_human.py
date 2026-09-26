# Quick probe: build one MPFB human and report what came out.
import bpy, sys, os, json
from bl_ext.user_default.mpfb.services.humanservice import HumanService

out = sys.argv[sys.argv.index('--') + 1]

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

info = HumanService._create_default_human_info_dict()
info['name'] = 'Player'
info['phenotype'] = {"gender": 1.0, "age": 0.5, "muscle": 0.6, "weight": 0.5, "proportions": 0.6,
                     "height": 0.55, "cupsize": 0.5, "firmness": 0.5,
                     "race": {"asian": 0.0, "caucasian": 1.0, "african": 0.0}}
info['rig'] = 'mixamo'
info['eyes'] = 'low-poly/low-poly.mhclo'
info['eyebrows'] = 'eyebrow001/eyebrow001.mhclo'
info['eyelashes'] = 'eyelashes01/eyelashes01.mhclo'
info['teeth'] = 'teeth_base/teeth_base.mhclo'
info['hair'] = 'short02/short02.mhclo'
info['clothes'] = ['male_casualsuit06/male_casualsuit06.mhclo', 'shoes06/shoes06.mhclo']
info['skin_mhmat'] = 'young_caucasian_male/young_caucasian_male.mhmat'
info['skin_material_type'] = 'GAMEENGINE'
info['clothes_material_type'] = 'GAMEENGINE'
info['eyes_material_type'] = 'GAMEENGINE'

settings = HumanService.get_default_deserialization_settings()
settings['subdiv_levels'] = 0
basemesh = HumanService.deserialize_from_dict(info, settings)

for o in bpy.data.objects:
    extra = ''
    if o.type == 'MESH':
        extra = 'verts=%d mats=%s mods=%s groups=%d' % (len(o.data.vertices), [m.name for m in o.data.materials], [m.type for m in o.modifiers], len(o.vertex_groups))
    if o.type == 'ARMATURE':
        extra = 'bones=%d first=%s' % (len(o.data.bones), [b.name for b in o.data.bones][:70])
    print('OBJ', o.name, o.type, 'parent=', o.parent.name if o.parent else None, tuple(round(d, 3) for d in o.dimensions), extra)

for m in bpy.data.materials:
    nodes = [n.type for n in m.node_tree.nodes] if m.use_nodes else []
    imgs = [n.image.name for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image] if m.use_nodes else []
    print('MAT', m.name, nodes, imgs, m.blend_method if hasattr(m, 'blend_method') else '')

bpy.ops.wm.save_as_mainfile(filepath=out)
