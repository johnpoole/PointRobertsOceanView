"""Export the open cabin.blend without changing the editable source.

blender --background authoring/cabin/cabin.blend --python authoring/cabin/export.py
"""
import hashlib
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
scene = bpy.context.scene
origin = list(scene['world_origin'])
model = bpy.data.collections['MODEL - exported cabin and access']
clearance = bpy.data.collections['CLEARANCE - edit with walking surfaces']
clearance.hide_viewport = False
bpy.data.collections['CONTROLS - approach stair and entrance'].hide_viewport = False
bpy.context.view_layer.update()

def world(p):
    return [p.x + origin[0], p.z + origin[1], -p.y + origin[2]]

surfaces = []
for obj in clearance.objects:
    if obj.type != 'MESH':
        continue
    for face in obj.data.polygons:
        p = [world(obj.matrix_world @ obj.data.vertices[i].co) for i in face.vertices]
        if len(p) < 3 or max(v[1] for v in p) - min(v[1] for v in p) > .0001:
            raise RuntimeError(f'{obj.name}: terrain ceiling must be a horizontal polygon')
        surfaces.append({'name': obj.name, 'polygon': [[v[0], v[2]] for v in p], 'ceiling': p[0][1]})

control = lambda name: world(bpy.data.objects[name].matrix_world.translation)
foot, head, width = [control(n) for n in ['Approach foot', 'Approach last riser', 'Approach half width']]
dx, dz = head[0] - foot[0], head[2] - foot[2]
run = math.hypot(dx, dz)
spec = json.loads(scene['approach_stair'])
steps = spec['steps']
if steps < 2 or run < .1 or head[1] <= foot[1]:
    raise RuntimeError('Invalid approach stair controls')
spec['bottom'] = {'lat': 48.989009 - foot[2]/111320,
    'lon': -123.085318 + foot[0]/(111320*math.cos(math.radians(48.989009))), 'ground_m': foot[1]}
spec['bearing_deg'] = math.degrees(math.atan2(dx, -dz)) % 360
spec['going_m'] = run/(steps - 1)
spec['rise_m'] = (head[1] - foot[1])/(steps - 1)
spec['width_m'] = math.hypot(width[0] - foot[0], width[2] - foot[2])*2
edge = [control('Entrance edge A'), control('Entrance edge B')]
if any(abs(p[1] - foot[1]) > .0001 for p in edge):
    raise RuntimeError('Entrance controls and approach foot must have the same level')

# Copy evaluated meshes, then merge the copies for a small number of web draw
# calls. The named source meshes, reference photos and terrain stay in .blend.
depsgraph = bpy.context.evaluated_depsgraph_get()
copies = []
for obj in model.all_objects:
    if obj.type != 'MESH':
        continue
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph), depsgraph=depsgraph)
    copied = bpy.data.objects.new('Export copy - ' + obj.name, mesh)
    scene.collection.objects.link(copied)
    copied.matrix_world = obj.matrix_world.copy()
    copies.append(copied)
if not copies or not surfaces:
    raise RuntimeError('Missing model or clearance geometry')
bpy.ops.object.select_all(action='DESELECT')
for obj in copies:
    obj.select_set(True)
bpy.context.view_layer.objects.active = copies[0]
bpy.ops.object.join()
merged = bpy.context.object
merged.name = 'Cabin and access'
root = bpy.data.objects.new('CabinAsset', None)
scene.collection.objects.link(root)
merged.parent = root
root['schema'] = 1
root['worldOrigin'] = origin
root['terrain'] = json.dumps(surfaces, separators=(',', ':'))
root['stair'] = json.dumps(spec, separators=(',', ':'))
root['entrance'] = json.dumps(edge, separators=(',', ':'))
root['source'] = 'authoring/cabin/cabin.blend'
root['sourceSha256'] = hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest()
root['sourceObjects'] = json.dumps([o.name for o in model.all_objects if o.type == 'MESH'])
if 'walkthrough_validation' in scene:
    root['walkthrough'] = scene['walkthrough_validation']
root.select_set(True)
output = ROOT / 'assets/site/389-cabin.glb'
bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB',
    use_selection=True, export_extras=True, export_yup=True,
    export_cameras=False, export_lights=False, export_animations=False,
    export_materials='EXPORT', export_texcoords=True, export_normals=True)
merged.data.calc_loop_triangles()
report = {'file': output.relative_to(ROOT).as_posix(), 'bytes': output.stat().st_size,
    'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
    'sourceSha256': root['sourceSha256'], 'sourceObjects': json.loads(root['sourceObjects']),
    'triangles': len(merged.data.loop_triangles), 'clearancePolygons': len(surfaces),
    'worldOrigin': origin, 'stair': spec, 'entrance': edge,
    'blender': bpy.app.version_string,
    'materialBatches': len([m for m in merged.data.materials if m]),
    'texturedMaterials': [m.name for m in merged.data.materials if m and m.get('source_frame')]}
(ROOT / 'authoring/cabin/export-report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({k: report[k] for k in ['file', 'bytes', 'triangles', 'clearancePolygons', 'blender']}))
