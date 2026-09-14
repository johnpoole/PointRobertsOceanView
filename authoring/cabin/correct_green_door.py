"""Issue #95: one-time edit of the saved Blender model, not the bootstrap.

The August 20:29:37 photo places the green door in the seaward first bay of
the lower south deck. The old isolated door was roughly three metres uphill.
Keep the existing deck/storey elevations and measured roof/approach controls.
"""
import bpy, math, json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
scene = bpy.context.scene
if scene.get('green_door_correction_95'):
    raise RuntimeError('Correction already applied; edit the saved source')
model = bpy.data.collections['MODEL - exported cabin and access']
clear = bpy.data.collections['CLEARANCE - edit with walking surfaces']
paint = bpy.data.materials['Cabin vertex colours']
c, s = math.cos(.318), math.sin(.318)

def point(x,y,z): return Vector((x*c+z*s,x*s-z*c,y))
def local(p): return Vector((p.x*c+p.y*s,p.z,p.x*s-p.y*c))

west, east, zw, ze = -6.435, 2.10, 4.305, 7.055
slope = (ze-zw)/(east-west)
edge = lambda x: zw+(x-west)*slope
angle = math.atan(slope); ca,sa = math.cos(angle),math.sin(angle)
cx,cz,floor = -5.77,edge(-5.77)-.14,6.32

def door_point(x,y,z):
    # Rotate the frame into the actual raked south rim, set back 140 mm.
    dx,dz=x+2.90,z-5.42
    return point(cx+ca*dx-sa*dz,y,cz+sa*dx+ca*dz)

for name in ['Photo - underdeck storage door','Photo - underdeck storage frame',
             'Photo - underdeck storage panels','Photo - storage threshold']:
    obj=bpy.data.objects[name]
    inv=obj.matrix_world.inverted()
    for v in obj.data.vertices:v.co=inv@door_point(*local(obj.matrix_world@v.co))
    obj.data.update();obj['evidence']='Issue #95: first seaward bay, August 2026 owner photograph'

# Move the existing clearance with the entrance; the obsolete uphill cut must
# not remain. Its footprint is replaced with a compact threshold/apron cut.
obj=bpy.data.objects['Photo - storage apron clearance']
poly=[(-.73,-.22),(.73,-.22),(.73,1.28),(-.73,1.28)]
def entrance(u,y,v):return point(cx+ca*u-sa*v,y,cz+sa*u+ca*v)
mesh=bpy.data.meshes.new('Corrected storage apron clearance')
mesh.from_pydata([entrance(u,floor-.22,v) for u,v in poly],[],[[0,1,2,3]])
obj.data=mesh

groups={}
def face(name,pts,color=(.23,.225,.20)):
    g=groups.setdefault(name,{'v':[],'f':[],'colors':[]})
    start=len(g['v']);g['v'].extend(pts);g['f'].append(list(range(start,start+len(pts))))
    g['colors'].extend([(*color,1)]*len(pts))
def box(name,u0,u1,v0,v1,y0,y1,color=(.23,.225,.20)):
    pts=[entrance(u,y,v) for y in (y0,y1) for u,v in [(u0,v0),(u1,v0),(u1,v1),(u0,v1)]]
    for ids in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:
        face(name,[pts[i] for i in ids],color)

# An actual small paved apron joins the threshold to the retained bank.
box('Photo - storage entrance apron',-.65,.65,.12,1.10,floor-.14,floor,(.32,.31,.285))
# The wider photo shows a rock shelf beneath the threshold. The low-resolution
# bank otherwise leaves the relocated entrance hanging above empty space.
# Join a small, irregular rock shelf to the actual cleared terrain around it;
# this is local model geometry, not a replacement elevation dataset.
terrain=json.loads((ROOT/'data/cabin-blender/current-terrain.json').read_text())
grid=terrain['grid'];heights=terrain['heights']
def terrain_at(p):
    wx=p.x-34.17;wz=-p.y-7.03
    lat=48.989009-wz/111320;lon=-123.085318+wx/(111320*math.cos(math.radians(48.989009)))
    r=(grid['north_lat']-lat)/grid['cellsize_deg'];col=(lon-grid['west_lon'])/grid['cellsize_deg']
    i=max(0,min(grid['nrows']-2,math.floor(r)));j=max(0,min(grid['ncols']-2,math.floor(col)))
    u=max(0,min(1,col-j));v=max(0,min(1,r-i));n=grid['ncols']
    return (heights[i*n+j]*(1-u)+heights[i*n+j+1]*u)*(1-v)+(heights[(i+1)*n+j]*(1-u)+heights[(i+1)*n+j+1]*u)*v
inner=[entrance(u,floor-.14,v) for u,v in [(-.81,-.24),(.85,-.24),(.85,1.17),(-.81,1.17)]]
outer=[]
for u,v in [(-1.20,-.60),(1.30,-.54),(1.35,2.70),(-1.42,2.90)]:
    p=entrance(u,0,v);p.z=min(floor-.19,terrain_at(p)-.08);outer.append(p)
face('Photo - storage rock shelf',inner,(.27,.27,.25))
for i in range(4):
    j=(i+1)%4
    face('Photo - storage rock shelf',[inner[i],outer[i],outer[j]],(.24+i*.015,.24+i*.014,.225+i*.012))
    face('Photo - storage rock shelf',[inner[i],outer[j],inner[j]],(.29-i*.014,.29-i*.013,.27-i*.012))
face('Photo - storage rock shelf',list(reversed(outer)),(.22,.22,.20))
# Flanking boards stay inside the first structural bay, not beyond its corner.
for a,b in [(-.66,-.53),(.53,.72)]:
    box('Photo - storage enclosure',a,b,-.10,-.025,floor,8.40)
box('Photo - storage enclosure',-.66,.72,-.10,-.025,8.28,8.41)

# Enclose the short west return between the existing square skirt and the
# door bay. This is beneath the walking deck, not an extra habitable storey.
for z in [3.42+i*.115 for i in range(8)]:
    pts=[point(x,y,zz) for y in (5.60,8.40) for x,zz in
         [(west-.012,z),(west+.02,z),(west+.02,z+.088),(west-.012,z+.088)]]
    for ids in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:
        face('Photo - lower enclosure return',[pts[i] for i in ids],(.16,.17,.145))

# Recessed lattice beside the door, with real openings, ends before the bank
# rises into the deck. It retains the photograph's open planted stair side.
for u in [.80+i*.14 for i in range(12)]:
    box('Photo - storage side lattice',u,u+.027,-.19,-.16,floor,8.39,(.12,.13,.11))
for y in [floor+i*.14 for i in range(15)]:
    box('Photo - storage side lattice',.80,2.37,-.165,-.138,y,y+.027,(.12,.13,.11))
box('Photo - storage side lattice',.74,.82,-.22,-.12,floor,8.41)

for name,g in groups.items():
    mesh=bpy.data.meshes.new(name+' correction 95');mesh.from_pydata(g['v'],[],g['f']);mesh.update()
    attr=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
    attr.data.foreach_set('color',[v for rgba in g['colors'] for v in rgba]);mesh.materials.append(paint)
    obj=bpy.data.objects.get(name)
    if obj:obj.data=mesh
    else:obj=bpy.data.objects.new(name,mesh);model.objects.link(obj)
    obj['evidence']='Issue #95: lower enclosure and green door, August owner photos; dimensions estimated'

evidence={'issue':95,'photo':'PXL_20260808_202937782.MP.jpg',
    'corroboratingPhoto':'PXL_20260808_202908454.jpg',
    'door':{'x':cx,'z':cz,'floor':floor,'angle':angle,'width':.90,'height':1.96},
    'camera':{'eye':[48.988889,-123.085828,4.2],'aim':[48.991573,-123.086080,23.0],'fov':57},
    'finding':'Door is in the first seaward bay below the lower south rim, not near the middle of the return.',
    'limits':'Door, enclosure and local rock shelf dimensions estimated. Saved comparison camera is not a solved photo pose. Existing deck levels, roof and approach controls retained.'}
scene['green_door_correction_95']=json.dumps(evidence)
(ROOT/'authoring/cabin/green-door-layout.json').write_text(json.dumps(evidence,indent=2)+'\n')
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'authoring/cabin/cabin.blend'),compress=True)
print('Corrected green door:',evidence['door'])
