"""Replace the invented entrance bridge with the owner's ground/paved landing.

One-time follow-up to #101. The owner confirms level ground/paving between
the concrete stairs and timber deck. Outline dimensions remain estimates.
"""
import bpy, json, math, ast
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]; scene=bpy.context.scene
if scene.get('paved_landing_101'): raise RuntimeError('Already applied')
c,s=math.cos(.318),math.sin(.318)
model=bpy.data.collections['MODEL - exported cabin and access']
clear=bpy.data.collections['CLEARANCE - edit with walking surfaces']
foot=bpy.data.objects['Approach foot'].location.copy()
head=bpy.data.objects['Approach last riser'].location.copy()
axis=head-foot; axis.z=0; axis.normalize()
def local(p): return Vector((p.x*c+p.y*s,p.z,p.x*s-p.y*c))
def point(x,y,z): return Vector((x*c+z*s,x*s-z*c,y))
def along(p): return (p-foot).dot(axis)

# Preserve originals outside MODEL for an inspectable edit history.
archive=bpy.data.collections.new('ARCHIVE - rejected railed entrance bridge')
scene.collection.children.link(archive); archive.hide_render=True; archive.hide_viewport=True
def filter_faces(name, remove):
    obj=bpy.data.objects[name]; old=obj.data
    backup=obj.copy(); backup.data=old.copy(); backup.name='Before paved landing - '+name
    archive.objects.link(backup)
    vertices=[]; faces=[]; colors=[]; attr=old.color_attributes['Color']; count=0
    for f in old.polygons:
        pts=[obj.matrix_world@old.vertices[i].co for i in f.vertices]
        if remove(pts): count+=1; continue
        start=len(vertices); vertices.extend(old.vertices[i].co[:] for i in f.vertices)
        faces.append(list(range(start,len(vertices))))
        colors.extend(attr.data[i].color[:] for i in f.loop_indices)
    mesh=bpy.data.meshes.new(name+' without bridge'); mesh.from_pydata(vertices,[],faces); mesh.update()
    for mat in old.materials: mesh.materials.append(mat)
    col=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
    col.data.foreach_set('color',[v for color in colors for v in color]); obj.data=mesh
    assert count>0, name
    print('Removed',count,'bridge faces from',name)

# Remove only the flat connector, not the nineteen individually positioned
# treads or the upper path landing. Stop the long level rails at the stair foot.
filter_faces('Approach concrete treads and landings',lambda pts:max(along(p) for p in pts)<.0001)
filter_faces('Approach timber handrails',lambda pts:max(local(p).x for p in pts)<6.4 and min(local(p).x for p in pts)<5)

f=local(foot); right=Vector((-axis.y,axis.x,0)); a=local(foot-right*.6); b=local(foot+right*.6)
if a.z>b.z:a,b=b,a
# Widen the former diagonal strip into a level court at the stair foot. Keep
# the west edge beside the beach stair, without filling over its descending treads.
poly=[(4.385,3.395),(4.9,3.395),(a.x,a.z),(b.x,b.z),(4.385,b.z)]
groups={}
module=ast.parse((ROOT/'authoring/cabin/refine_upper_deck.py').read_text())
for name in ['face','prism']:
    fn=next(n for n in module.body if isinstance(n,ast.FunctionDef) and n.name==name)
    exec(compile(ast.Module(body=[fn],type_ignores=[]),'paving mesh helpers','exec'))
name='Entrance ground paving'
prism(name,poly,10.28,10.45,(.29,.285,.26))
# The neighbouring descending beach stair forces terrain vertices below its
# treads. A solid subgrade fills that local clearance under the court, ending
# exactly at the flight edge; its bottom is buried below the nearby terrain.
# This is the landing's ground volume, not another elevated bank skin.
prism('Entrance compacted ground',poly,7.9,10.28,(.17,.15,.105))
for name,g in groups.items():
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(g['v'],[],g['f']);mesh.update()
    attr=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
    attr.data.foreach_set('color',[v for col in g['col'] for v in col])
    mat='Approach concrete' if name=='Entrance ground paving' else 'Cabin vertex colours'
    mesh.materials.append(bpy.data.materials[mat]);obj=bpy.data.objects.new(name,mesh);model.objects.link(obj)
    obj['evidence']='Owner: a level ground/paved area connects the concrete stairs and wooden deck. Perimeter estimated from ground views.'

# The court is supported by the actual terrain, after the broad stair cut.
# Its ceiling and visible base share a height; the old bridge clearance no
# longer leaves a slot below it. Keep the original hillside grading as well.
grade=json.loads(scene['entrance_grade'])
def world(x,y,z):
    p=point(x,y,z); return [p.x-34.17,p.z,-p.y-7.03]
for i in range(1,len(poly)-1):
    grade['triangles'].append([world(x,10.28,z) for x,z in [poly[0],poly[i],poly[i+1]]])
scene['entrance_grade']=json.dumps(grade)
o=bpy.data.objects['Entrance bridge clearance'];o.name='Entrance paved ground clearance'
mesh=bpy.data.meshes.new(o.name);mesh.from_pydata([point(x,10.28,z) for x,z in poly],[],[list(range(len(poly)))]);mesh.update();o.data=mesh
o['purpose']='Ground-supported entrance paving underside; updated with its wider landing footprint.'

p=ROOT/'authoring/cabin/entrance-layout.json';layout=json.loads(p.read_text())
layout['pavedLanding']={'ownerConfirmation':'A level ground/paved area connects them',
 'outline':[list(v) for v in poly],'surface':10.45,'base':10.28,
 'changed':['Broadened landing footprint south of the former diagonal connector','Removed the two level connector handrails; rails now end at the concrete flight','Terrain and solid subgrade support the paving instead of a raised bridge'],
 'limits':'The ground/paved connection is owner-confirmed; outline dimensions remain photo-based estimates. No new measurement relocates the 19-step flight.'}
layout['limits']='Ground/paved landing connection confirmed by owner. Landing perimeter and bank grade are estimates; stair count, going and existing location remain the earlier owner controls.'
layout['routes']=layout['routes'][:3]+[[[5.7,4.85],[5.1,4.85],[4.9,4.7],[4.9,3.85],[3.8,3.85]]]
p.write_text(json.dumps(layout,indent=2)+'\n');scene['paved_landing_101']=json.dumps(layout['pavedLanding'])
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'authoring/cabin/cabin.blend'),compress=True)
