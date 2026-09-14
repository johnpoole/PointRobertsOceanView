"""One-time, photo-guided Blender edit for issue #90. Refuse to duplicate it.

Use on cabin.blend with --python-exit-code 1. Future edits are made in Blender.
Dimensions here are estimates; frame ranges document feature/connection evidence.
"""
import json
import math
import random
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
scene = bpy.context.scene
if 'walkthrough_validation' in scene:
    raise RuntimeError('Walkthrough structures already exist; edit the saved model')
model = bpy.data.collections['MODEL - exported cabin and access']
clearances = bpy.data.collections['CLEARANCE - edit with walking surfaces']
bpy.data.collections['CONTEXT - original survey'].hide_viewport = False
bpy.data.collections['CONTROLS - approach stair and entrance'].hide_viewport = False
bpy.context.view_layer.update()
survey = bpy.data.objects['Original survey reference']
c, s = math.cos(.318), math.sin(.318)

def point(x, y, z):
    return (x*c + z*s, x*s - z*c, y)

def ground(x, z):
    hit, p, *_ = survey.ray_cast(Vector(point(x,100,z)), Vector((0,0,-1)))
    if not hit:
        raise RuntimeError(f'No survey under {x}, {z}')
    return p.z

paint = bpy.data.materials['Cabin vertex colours']

def photo_material(name, filename):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = False
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = 1
    bsdf.inputs['Metallic'].default_value = 0
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    path = ROOT / 'images/cabin-walkthrough-20170718' / filename
    tex.image = bpy.data.images.load(str(path), check_existing=True)
    tex.image.filepath = bpy.path.relpath(str(path))
    mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    mat['source_frame'] = filename
    return mat

wood = photo_material('Video frame 034 - weathered shed boards', 'frame-034-017.03s.jpg')
stone = photo_material('Video frame 047 - paving surface', 'frame-047-023.53s.jpg')
groups = {}
def face(name, vertices, color=(.20,.19,.16), mat=paint, uv=None):
    group = groups.setdefault(name, {'vertices': [], 'faces': [], 'colors': [], 'uvs': [], 'mat': mat})
    start = len(group['vertices'])
    group['vertices'] += [point(*p) for p in vertices]
    group['faces'].append(list(range(start,start+len(vertices))))
    group['colors'] += [(*color,1)]*len(vertices)
    group['uvs'] += uv if uv is not None else [(0,0)]*len(vertices)

def box(name,x0,x1,z0,z1,y0,y1,color=(.2,.18,.14),mat=paint,uv=None):
    p=[(x0,y0,z0),(x1,y0,z0),(x1,y0,z1),(x0,y0,z1),
       (x0,y1,z0),(x1,y1,z0),(x1,y1,z1),(x0,y1,z1)]
    for indices in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:
        face(name,[p[i] for i in indices],color,mat,uv)

def member(name,a,b,width=.09,depth=.12,color=(.23,.19,.14)):
    a,b=Vector(a),Vector(b)
    along=(b-a).normalized()
    across=along.cross(Vector((0,1,0)))
    if across.length < .01: across=Vector((1,0,0))
    across.normalize()
    other=along.cross(across).normalized()
    points=[tuple(end+across*i*width/2+other*j*depth/2) for end in (a,b) for i,j in [(-1,-1),(1,-1),(1,1),(-1,1)]]
    for ids in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:
        face(name,[points[i] for i in ids],color)

def ceiling(name,poly,height):
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata([point(x,height,z) for x,z in poly],[],[list(range(len(poly)))])
    obj=bpy.data.objects.new(name,mesh)
    clearances.objects.link(obj)
    obj.display_type='WIRE'
    obj['purpose']='Underside terrain clearance for the paired video structure'

def plate(name,poly,height,thick=.2,color=(.24,.23,.21),cut=True):
    y=height if callable(height) else lambda x,z:height
    top=[(x,y(x,z),z) for x,z in poly]
    low=[(x,y(x,z)-thick,z) for x,z in poly]
    face(name,top,color)
    face(name,list(reversed(low)),color)
    for i in range(len(poly)):
        j=(i+1)%len(poly)
        face(name,[top[i],low[i],low[j],top[j]],color)
    if cut: ceiling(name+' clearance '+str(len(clearances.objects)),poly,min(v[1] for v in top)-thick-.08)

def paving_rect(name,x0,x1,z0,z1,y):
    height=y if callable(y) else lambda x,z:y
    # A continuous bed remains under the narrow decorative paving joints.
    nx,nz=math.ceil((x1-x0)/.46),max(1,math.ceil((z1-z0)/.46))
    for i in range(nx):
        a=x0+(x1-x0)*i/nx; b=x0+(x1-x0)*(i+1)/nx
        for j in range(nz):
            d=z0+(z1-z0)*j/nz; e=z0+(z1-z0)*(j+1)/nz
            poly=[(a,d),(b,d),(b,e),(a,e)]
            plate(name+' foundation',poly,lambda x,z:height(x,z)-.006)
            q=[(a+.004,d+.004),(b-.004,d+.004),(b-.004,e-.004),(a+.004,e-.004)]
            # UVs select paving only, avoiding the flowers/bench in frame 047.
            uv=[(470/1920,1-425/1080),(650/1920,1-425/1080),
                (650/1920,1-570/1080),(470/1920,1-570/1080)]
            face(name+' video paving',[(x,height(x,z),z) for x,z in q],(1,1,1),stone,uv)

# Roadward profile follows the lidar bank, then levels beside the shed door and
# reaches the owner-controlled approach head. This is not a solved camera track.
stations=[(25.7,18.71),(24,18.54),(22.5,17.99),(21.45,17.10),
          (20.35,17.10),(19,15.96),(17.7,15.23),(15.5,14.42),(14.05,13.4632)]
def main_y(x,z=None):
    for (a,ya),(b,yb) in zip(stations,stations[1:]):
        if b-.00001 <= x <= a+.00001: return yb+(ya-yb)*(x-b)/(a-b)
    return stations[0][1] if x>stations[0][0] else stations[-1][1]

for (a,ya),(b,yb) in zip(stations,stations[1:]):
    paving_rect('Video - shed-side path',b,a,7.85,8.95,main_y)

# The wide turn in frames 43-50, with space to pass the bench on its uphill edge.
level=13.4632
spec=json.loads(scene['approach_stair'])
foot=bpy.data.objects['Approach foot'].location
head=bpy.data.objects['Approach last riser'].location
direction=(head-foot); direction.z=0; direction.normalize()
right=Vector((direction.y,-direction.x,0))
end=foot+direction*(spec['going_m']*spec['steps']+1.30)
end.z=level
def cabin_xy(v): return (v.x*c+v.y*s,v.x*s-v.y*c)
edge=[cabin_xy(end+right*k*spec['width_m']/2) for k in (-1,1)]
edge.sort(key=lambda p:p[1])
z0,z1=edge[0][1],edge[1][1]
connector=[edge[0],(14.05,z0),(14.05,z1),edge[1]]
plate('Video - head junction',connector,level)
face('Video - head junction video paving',[(x,level+.001,z) for x,z in connector],(1,1,1),stone,
     [(470/1920,1-425/1080),(650/1920,1-425/1080),(650/1920,1-570/1080),(470/1920,1-570/1080)])
paving_rect('Video - widened turn',12.85,14.05,z1,8.95,level)
paving_rect('Video - bench alcove',14.05,14.72,5.72,7.45,level)

# Low downhill border: visible cap blocks, following the path, not a solid tall
# retaining wall on both sides. Wooden rails protect the roadward exposed edge.
for a,b in zip(stations,stations[1:]):
    hi,lo=a[0],b[0]
    count=math.ceil((hi-lo)/.40)
    for k in range(count):
        x0=lo+(hi-lo)*k/count; x1=lo+(hi-lo)*(k+1)/count
        y=main_y((x0+x1)/2)
        box('Video - downhill block border',x0,x1-.007,8.96,9.14,y-.24,y+.16,(.27,.26,.23))
    if hi>20.35:
        for h in (.53,1.00):
            member('Video - upper approach rails',(lo,main_y(lo)+h,9.22),(hi,main_y(hi)+h,9.22))
        for x in (lo,hi):
            box('Video - upper approach rails',x-.06,x+.06,9.16,9.28,main_y(x)-.20,main_y(x)+1.06)

def wall(name,x0,x1,z0,z1,base,top):
    along_x=x1-x0>z1-z0
    length=x1-x0 if along_x else z1-z0
    for row in range(math.ceil((top-base)/.2)):
        count=math.ceil(length/.40)
        for k in range(count):
            a=length*k/count; b=length*(k+1)/count-.008
            if along_x: box(name,x0+a,x0+b,z0,z1,base+row*.2,min(top,base+(row+1)*.2)-.008,(.25,.245,.22))
            else: box(name,x0,x1,z0+a,z0+b,base+row*.2,min(top,base+(row+1)*.2)-.008,(.25,.245,.22))

# Uphill wall and bench shown in frames 46-50. Keep clear of the measured trunk
# at cabin-local (15.33,4.82); the wall stops short of that tree.
wall('Video - junction retaining wall',14.74,15.06,5.55,7.60,level-.28,14.77)
for z in (6.0,7.2):
    for x in (14.18,14.58): box('Video - junction bench',x-.035,x+.035,z-.035,z+.035,level,level+.43,(.055,.065,.055))
for x in (14.18,14.28,14.38,14.48,14.58):
    box('Video - junction bench',x-.038,x+.038,5.83,7.37,level+.42,level+.47,(.07,.075,.06))
for h in (.64,.79,.94):
    box('Video - junction bench',14.60,14.66,5.83,7.37,level+h,level+h+.065,(.07,.075,.06))
for z in (5.88,7.32): member('Video - junction bench',(14.63,level+.3,z),(14.63,level+1.04,z),.05,.05,(.055,.065,.055))

# Shed gable/doors and the separate branch seen at 16-18 seconds. The branch
# is not substituted for the main route followed by the camera.
shed_y=17.10
paving_rect('Video - shed door branch',20.40,21.45,4.60,7.85,shed_y)
plate('Video - shed plinth',[(17.60,4.75),(20.40,4.75),(20.40,7.05),(17.60,7.05)],shed_y-.02,.3)
# The unseen support arrangement is provisional; these piers meet the source
# ground rather than leaving the level shed floor floating over the bank.
for x in (17.8,20.2):
    for z in (4.95,6.85):
        box('Video - shed support piers',x-.12,x+.12,z-.12,z+.12,
            min(shed_y-.4,ground(x,z)-.12),shed_y-.32,(.25,.245,.22))
wood_uv=[(610/1920,1-400/1080),(865/1920,1-456/1080),
         (865/1920,1-96/1080),(610/1920,1-40/1080)]
for k in range(2):
    box('Video - shed walls',17.60,20.40,4.75,7.05,shed_y+k*.97,shed_y+(k+1)*.97,(1,1,1),wood,wood_uv)
    for z in (5.16,6.06):
        box('Video - shed double doors',20.40,20.425,z,z+.89,shed_y+.04+k*.935,shed_y+.04+(k+1)*.935,(1,1,1),wood,wood_uv)
for z in (5.13,6.045,6.98):
    box('Video - shed door framing',20.427,20.455,z-.025,z+.025,shed_y+.02,shed_y+1.96,(.19,.16,.125))
box('Video - shed door framing',20.455,20.495,6.00,6.10,shed_y+.92,shed_y+1.05,(.04,.045,.038))
for x in (17.59,20.41):
    face('Video - shed gables',[(x,shed_y+1.94,4.75),(x,shed_y+2.37,5.90),(x,shed_y+1.94,7.05)],(.18,.15,.115))
for a,b in [(4.60,5.90),(5.90,7.20)]:
    def roof_y(z): return shed_y+2.37-abs(z-5.90)*(.43/1.15)
    face('Video - shed roof',[(17.42,roof_y(a),a),(20.58,roof_y(a),a),
        (20.58,roof_y(b),b),(17.42,roof_y(b),b)],(.075,.077,.063))
    for z in (a,b): member('Video - shed fascia',(17.42,roof_y(z)-.04,z),(20.58,roof_y(z)-.04,z),.09,.10,(.16,.13,.10))
branch_top=18.10
for k in range(7):
    z_hi=4.60-k*(2.2/7); z_lo=4.60-(k+1)*(2.2/7)
    y=shed_y+(k+1)*(branch_top-shed_y)/7
    plate('Video - shed side steps',[(20.40,z_lo),(21.45,z_lo),(21.45,z_hi),(20.40,z_hi)],y,.3)
wall('Video - shed branch retaining wall',21.47,21.79,2.40,7.85,16.75,18.55)

# The low planting beds give the paths their photographed edges. Small meshes
# represent the observed foliage masses; individual plant locations are estimates.
random.seed(90)
def tuft(x,z,y,scale=1,flowers=False):
    for k in range(7):
        angle=k*math.tau/7
        dx,dz=math.cos(angle),math.sin(angle)
        face('Video - garden planting',[(x,y,z),(x+dx*.22*scale-dz*.045,y+.42*scale,z+dz*.22*scale+dx*.045),
            (x+dx*.38*scale,y+.62*scale,z+dz*.38*scale),
            (x+dx*.22*scale+dz*.045,y+.42*scale,z+dz*.22*scale-dx*.045)],(.10,.155,.055))
    if flowers:
        for k in range(4):
            a=random.random()*math.tau
            xx,zz=x+math.cos(a)*.20,z+math.sin(a)*.20
            h=y+(.48+random.random()*.24)*scale
            member('Video - garden planting',(xx,y,zz),(xx,h,zz),.012,.012,(.12,.18,.065))
            face('Video - garden flowers',[(xx-.055,h,zz),(xx,h,zz+.055),(xx+.055,h,zz),(xx,h,zz-.055)],(.85,.82,.65))
for x in (14.5,15.7,16.9,18.0,19.0,22.0,23.5,24.8):
    for z in (7.42,9.55):
        if 17.3<x<20.7 and z<7.85: continue
        if x<15.1 and z<7.85: continue  # keep the bench alcove free of planting
        tuft(x,z,min(ground(x,z),main_y(x)+.25),.7,True)
for z in (5.8,6.8): tuft(15.3,z,max(ground(15.3,z),14.77),.9,True)

# A round deck table and three simple chairs are visible in the final frames.
table_x,table_z=-5.3,-1.9
for i in range(16):
    a,b=i*math.tau/16,(i+1)*math.tau/16
    face('Video - deck table',[(table_x,11.17,table_z),
        (table_x+math.cos(a)*.60,11.17,table_z+math.sin(a)*.60),
        (table_x+math.cos(b)*.60,11.17,table_z+math.sin(b)*.60)],(.25,.28,.27))
for dx,dz in [(-.35,-.35),(.35,-.35),(.35,.35),(-.35,.35)]:
    member('Video - deck table',(table_x+dx,10.45,table_z+dz),(table_x+dx,11.17,table_z+dz),.035,.035,(.05,.055,.05))
for x,z in [(-6.40,-1.90),(-5.30,-.80),(-4.20,-1.90)]:
    box('Video - deck chairs',x-.22,x+.22,z-.22,z+.22,10.88,10.92,(.19,.22,.20))
    for dx,dz in [(-.2,-.2),(.2,-.2),(.2,.2),(-.2,.2)]:
        member('Video - deck chairs',(x+dx,10.45,z+dz),(x+dx,10.9,z+dz),.025,.025,(.05,.055,.05))
    # Orient the back away from the table.
    outward=Vector((x-table_x,0,z-table_z)).normalized()
    across=Vector((-outward.z,0,outward.x))
    back=Vector((x,11.15,z))+outward*.22
    member('Video - deck chairs',tuple(back-across*.22),tuple(back+across*.22),.05,.32,(.15,.18,.16))

for name,part in groups.items():
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(part['vertices'],[],part['faces'])
    mesh.update()
    attr=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
    attr.data.foreach_set('color',[x for rgba in part['colors'] for x in rgba])
    uv=mesh.uv_layers.new(name='UVMap')
    uv.data.foreach_set('uv',[x for pair in part['uvs'] for x in pair])
    mesh.validate(clean_customdata=False)
    obj=bpy.data.objects.new(name,mesh)
    obj.data.materials.append(part['mat'])
    obj['evidence']='VID_20170718_072727~2.mp4; frame mapping in walkthrough-evidence.json'
    model.objects.link(obj)

validation={'stations':stations,'pathZ':8.4,'pathWidth':1.1,'junctionLevel':level,
    'junctionNorth':z1,'headEdge':edge,'shedBase':shed_y,'branchTop':branch_top,
    'frames':69,'newObjects':list(groups),'texturedFrames':[34,47],
    'estimates':'Geographic path, shed dimensions and levels use road/lidar/stair anchors; no camera solve.'}
scene['walkthrough_validation']=json.dumps(validation)
bpy.data.collections['CONTEXT - original survey'].hide_viewport=True
bpy.data.collections['CONTROLS - approach stair and entrance'].hide_viewport=True
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'authoring/cabin/cabin.blend'),compress=True)
(ROOT/'authoring/cabin/walkthrough-layout.json').write_text(json.dumps(validation,indent=2)+'\n')
print('Added',len(groups),'editable video-derived objects; total clearance polygons',len(clearances.objects))
