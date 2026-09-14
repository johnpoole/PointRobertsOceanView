"""One-time migration only. Never overwrite an edited cabin.blend with this.

blender --background --python authoring/cabin/create_blend.py
The bootstrap input is created by bootstrap.mjs. Regular publishing uses export.py.
"""
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "authoring/cabin/cabin.blend"
if SOURCE.exists():
    raise RuntimeError("cabin.blend already exists; preserve edits and use export.py")
data = json.loads((ROOT / "data/cabin-blender/bootstrap.json").read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.length_unit = 'METERS'
scene["world_origin"] = data["worldOrigin"]
scene["height_datum"] = "metres above MLLW; survey NAVD88 + 0.411 m"
scene["axes"] = "X east, Y north, Z up; horizontal origin at fitted roof centre"
scene["approach_stair"] = json.dumps(data["stair"])
scene["approach_edge"] = json.dumps(data["approachEdge"])

def collection(name, hidden=False):
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    c.hide_render = hidden
    return c

model = collection("MODEL - exported cabin and access")
cleared = collection("CONTEXT - cleared terrain")
survey = collection("CONTEXT - original survey", True)
survey.hide_viewport = True
clearance = collection("CLEARANCE - edit with walking surfaces", True)
clearance.hide_viewport = True
references = collection("REFERENCES - 12 photos and 69 video frames", True)
references.hide_viewport = True
cameras = collection("CAMERAS - comparison and inspection")
controls = collection("CONTROLS - approach stair and entrance", True)
controls.hide_viewport = True
def control(name, point):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = 'PLAIN_AXES'
    obj.empty_display_size = .35
    obj.location = (point[0] + 34.17, -(point[2] + 7.03), point[1])
    controls.objects.link(obj)
    return obj
stair = data['stair']
foot = [(stair['bottom']['lon'] + 123.085318)*111320*math.cos(math.radians(48.989009)),
        stair['bottom']['ground_m'], -(stair['bottom']['lat'] - 48.989009)*111320]
bearing = math.radians(stair['bearing_deg'])
run = (stair['steps'] - 1)*stair['going_m']
control('Approach foot', foot)
control('Approach last riser', [foot[0] + math.sin(bearing)*run,
    foot[1] + (stair['steps'] - 1)*stair['rise_m'], foot[2] - math.cos(bearing)*run])
control('Approach half width', [foot[0] + math.cos(bearing)*stair['width_m']/2,
    foot[1], foot[2] + math.sin(bearing)*stair['width_m']/2])
for label, point in zip(['Entrance edge A', 'Entrance edge B'], data['approachEdge']):
    control(label, point)

def material(name, roughness=.85, metalness=.04):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = False
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metalness
    color = m.node_tree.nodes.new('ShaderNodeVertexColor')
    color.layer_name = 'Color'
    m.node_tree.links.new(color.outputs['Color'], bsdf.inputs['Base Color'])
    return m

paint = material("Cabin vertex colours")
concrete = material("Approach concrete", 1, 0)
timber = material("Approach timber", 1, 0)
terrain_mat = material("Terrain reference", 1, 0)

def mesh_object(name, position, colors, col, mat):
    # Weld positions for useful vertex/edge editing. Retain colour per corner.
    vertices, indices, lookup = [], [], {}
    for i in range(0, len(position), 3):
        p = tuple(position[i:i+3])
        key = tuple(round(v, 6) for v in p)
        if key not in lookup:
            lookup[key] = len(vertices)
            vertices.append(p)
        indices.append(lookup[key])
    faces = [indices[i:i+3] for i in range(0, len(indices), 3)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    attr = mesh.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
    rgba = [v for i in range(0, len(colors), 3) for v in (*colors[i:i+3], 1)]
    attr.data.foreach_set('color', rgba)
    mesh.validate(clean_customdata=False)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    col.objects.link(obj)
    obj.data.materials.append(mat)
    return obj

for item in data['objects']:
    name = item['name']
    col = survey if name.startswith('Original survey') else cleared if name.startswith('Cleared terrain') else model
    mat = terrain_mat if col != model else timber if name == 'Approach timber handrails' else concrete if name.startswith('Approach') else paint
    obj = mesh_object(name, item['position'], item['color'], col, mat)
    obj['evidence'] = 'See README.md and CONTINUE-cabin-photos.md; dimensions include estimates'

for item in data['surfaces']:
    mesh = bpy.data.meshes.new(item['name'])
    mesh.from_pydata(item['polygon'], [], [list(range(len(item['polygon'])))])
    obj = bpy.data.objects.new(item['name'], mesh)
    clearance.objects.link(obj)
    obj.display_type = 'WIRE'
    obj['purpose'] = 'Terrain ceiling including underside clearance; edit with its deck/tread'

files = sorted((ROOT / 'images/Photos-1-001').glob('*.jpg'))
files += sorted((ROOT / 'images/cabin-walkthrough-20170718').glob('frame-*.jpg'))
files += sorted((ROOT / 'images/cabin-walkthrough-20170718').glob('contact-*.jpg'))
for i, file in enumerate(files):
    img = bpy.data.images.load(str(file), check_existing=True)
    img.filepath = bpy.path.relpath(str(file), start=str(SOURCE.parent))
    obj = bpy.data.objects.new(file.stem, None)
    obj.empty_display_type = 'IMAGE'
    obj.data = img
    obj.empty_display_size = 4
    obj.location = (50 + (i % 10) * 4.5, 20 - (i // 10) * 3.5, 16)
    obj.rotation_euler = (math.pi/2, 0, 0)
    obj['source'] = img.filepath
    obj['reference_only'] = True
    references.objects.link(obj)

def local(x, y, z):
    c, s = math.cos(.318), math.sin(.318)
    return Vector((x*c + z*s, x*s - z*c, y))

def camera(name, eye, target, fov=55):
    cam = bpy.data.cameras.new(name)
    cam.type = 'PERSP'
    cam.sensor_fit = 'VERTICAL'
    cam.angle = math.radians(fov)
    obj = bpy.data.objects.new(name, cam)
    obj.location = eye
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    cameras.objects.link(obj)
    return obj

overview = camera('Inspect - southeast access', local(19, 23, 19), local(0, 10, 1))
camera('Inspect - north landing', local(12, 17, -14), local(-1, 10.4, -3.4))
camera('Inspect - west decks', local(-23, 16, 18), local(-1, 10.5, 1))
for name, eye, aim in [
    ('Owner comparison - entrance 20211108_175012789', (4.2382726,13.3,9.4993628), (-9.7441224,-57.9,-281.6471933)),
    ('Owner comparison - uphill 20211108_174949325', (17.9518729,19,3.8174430), (-254.1691046,-107.1,10.2264798)),
    ('Owner comparison - north ABOVE 20250517_150947629', (8.9029740,15.7,-5.3725764), (-246.0373574,-142.3,-1.1602899)),
]:
    cam = camera(name, local(*eye), local(*aim), 25)
    cam['calibration'] = 'Owner comparison view, not a solved photo camera; north view is higher than photo'

scene.camera = overview
scene.render.engine = 'BLENDER_WORKBENCH'
scene.render.resolution_x = 1400
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
shading = scene.display.shading
shading.light = 'STUDIO'
shading.color_type = 'VERTEX'
shading.show_shadows = True
shading.show_cavity = True
shading.cavity_type = 'BOTH'
shading.background_type = 'WORLD'
scene.world = bpy.data.worlds.new('Inspection background')
scene.world.color = (.16, .19, .22)
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.render.image_settings.file_format = 'PNG'
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        area.spaces.active.region_3d.view_distance = 34
        area.spaces.active.region_3d.view_location = local(0, 10, 0)
        area.spaces.active.region_3d.view_rotation = overview.rotation_euler.to_quaternion()
        area.spaces.active.clip_end = 2000
        area.spaces.active.shading.color_type = 'VERTEX'

notes = bpy.data.texts.new('START HERE')
notes.write('Edit named meshes in MODEL. Metres; X east, Y north, Z up; heights MLLW.\n'
    'Enable REFERENCES for all 12 photos, 69 video frames and four contact sheets. Media remains local.\n'
    'Enable CLEARANCE and update the matching underside polygons when editing decks or stairs.\n'
    'Keep the approach stair controls in sync when changing the owner-positioned 19-step flight.\n'
    'Export with authoring/cabin/export.py. The source .blend is never merged or overwritten by export.\n'
    'Camera names beginning Owner comparison are approximate comparison views, not photo calibration.\n'
    'North access has been corrected; road/shed route reconstruction still needs further modeling.\n')
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE), compress=True)
print(f'Saved {SOURCE}: {len(model.objects)} editable mesh objects, {len(files)} references')
