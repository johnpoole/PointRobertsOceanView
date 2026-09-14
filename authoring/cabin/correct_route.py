"""Owner correction: the 22-25 s northward pan is not a physical dogleg.

Run once on the saved post-photo-refinement source. Keep removed geometry in a
hidden, non-exported archive so the authoring change remains reversible.
"""
import bpy, math, json
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
scene=bpy.context.scene
if scene.get('route_pan_corrected'):raise RuntimeError('Route already corrected')
model=bpy.data.collections['MODEL - exported cabin and access']
clear=bpy.data.collections['CLEARANCE - edit with walking surfaces']
archive=bpy.data.collections.new('ARCHIVE - rejected camera-pan dogleg')
scene.collection.children.link(archive);archive.hide_render=True;archive.hide_viewport=True
c,s=math.cos(.318),math.sin(.318)
def p(x,y,z):return (x*c+z*s,x*s-z*c,y)
def local(v):return Vector((v.x*c+v.y*s,v.z,v.x*s-v.y*c))
layout=json.loads(scene['walkthrough_validation'])
edge=layout['headEdge']; headx=sum(v[0] for v in edge)/2; headz=sum(v[1] for v in edge)/2
join=20.35; span=join-headx
head_slope=-(edge[1][0]-edge[0][0])/(edge[1][1]-edge[0][1])
def z_at(x):
    if x>=join:return 8.4
    t=max(0,min(1,(x-headx)/span))
    return headz+(8.4-headz)*t*t*(3-2*t)+head_slope*span*t*(1-t)**2+.35*math.sin(math.pi*t)**2
def slope(x):
    if x>=join:return 0
    t=max(0,min(1,(x-headx)/span))
    return ((8.4-headz)*6*t*(1-t)+head_slope*span*(1-4*t+3*t*t)+.35*math.pi*math.sin(2*math.pi*t))/span
def height(x):
    for (a,ya),(b,yb) in zip(layout['stations'],layout['stations'][1:]):
        if b<=x<=a:return yb+(ya-yb)*(x-b)/(a-b)
    return layout['junctionLevel']

def retire(obj,col):
    archive.objects.link(obj);col.objects.unlink(obj)
for obj in list(model.objects):
    if obj.name.startswith(('Video - shed-side path ','Video - head junction',
                           'Video - widened turn','Video - bench alcove')):
        retire(obj,model)
for obj in list(clear.objects):
    if obj.name.startswith(('Video - shed-side path ','Video - head junction',
                           'Video - widened turn','Video - bench alcove')):
        retire(obj,clear)

paint=bpy.data.materials['Cabin vertex colours']
stone=bpy.data.materials['Video frame 047 - paving surface']
groups={}
def face(name,pts,mat=paint,uv=None,color=(.24,.23,.21)):
    g=groups.setdefault(name,dict(v=[],f=[],uv=[],col=[],mat=mat)); n=len(g['v'])
    g['v'] += [p(*a) for a in pts];g['f'].append(list(range(n,n+len(pts))))
    g['uv'] += uv or [(0,0)]*len(pts);g['col'] += [(*color,1)]*len(pts)
def ceiling(name,poly,y):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata([p(x,y,z) for x,z in poly],[],[list(range(len(poly)))])
    obj=bpy.data.objects.new(name,mesh);clear.objects.link(obj);obj.display_type='WIRE'
def plate(name,pts):
    low=[(x,y-.20,z) for x,y,z in pts]
    face(name,pts);face(name,list(reversed(low)))
    for i in range(len(pts)):
        j=(i+1)%len(pts);face(name,[pts[i],low[i],low[j],pts[j]])
    ceiling(name+' clearance '+str(len(clear.objects)),[(x,z) for x,y,z in pts],min(y for x,y,z in pts)-.28)
uv=[(470/1920,1-425/1080),(650/1920,1-425/1080),(650/1920,1-570/1080),(470/1920,1-570/1080)]

# Each cross-section follows the route normal. The first section is the exact
# existing stair-head edge, so no connector leg or right-angle corner is needed.
anchors=sorted({headx,*[a for a,y in layout['stations']]})
xs=[headx]
for a,b in zip(anchors,anchors[1:]):
    count=math.ceil((b-a)/.16)
    xs.extend(b if i==count else a+(b-a)*i/count for i in range(1,count+1))
sections=[]
for x in sorted(xs):
    t=max(0,min(1,(x-headx)/span));w=1.2-.1*t; dz=slope(x)
    norm=math.hypot(1,dz);ox=-dz/norm*w/2;oz=w/2/norm
    sections.append(dict(x=x,z=z_at(x),y=height(x),width=w,
        left=[x-ox,z_at(x)-oz],right=[x+ox,z_at(x)+oz]))
sections[0]['left']=edge[0];sections[0]['right']=edge[1]
for a,b in zip(sections,sections[1:]):
    pts=[(a['left'][0],a['y'],a['left'][1]),(b['left'][0],b['y'],b['left'][1]),
         (b['right'][0],b['y'],b['right'][1]),(a['right'][0],a['y'],a['right'][1])]
    plate('Video - continuous west approach foundation',[(x,y-.006,z) for x,y,z in pts])
    face('Video - continuous west approach paving',pts,stone,uv)

# Border and path-side plants follow the corrected alignment. The roadward
# segment, shed and separate shed branch keep their existing placement.
for name in ('Video - downhill block border','Video - garden planting','Video - garden flowers'):
    obj=bpy.data.objects[name]
    for v in obj.data.vertices:
        x,y,z=local(v.co)
        if headx<=x<join:v.co=p(x,y,z+z_at(x)-8.4)
    obj.data.update()

# Put the existing bench on a side pad beside the level head approach. Its
# absolute position remains approximate; it is not a through-route segment.
bench=bpy.data.objects['Video - junction bench']
for v in bench.data.vertices:
    x,y,z=local(v.co);v.co=p(13.05+(z-6.60),y,6.47+(x-14.42))
bench.data.update()
# Share the route's actual edge, rather than overlapping coplanar paving faces.
pad=[(a['right'][0],13.4632,a['right'][1]) for a in sections if a['x']<=14.05]
pad += [(14.15,13.4632,6.85),(12.15,13.4632,6.85),(12.15,13.4632,5.72)]
plate('Video - bench side pad foundation',[(x,y-.006,z) for x,y,z in pad])
pad_uv=[((470+(x-12.15)/2*180)/1920,1-(425+(z-5.6)/1.25*145)/1080) for x,y,z in pad]
face('Video - bench side pad paving',pad,stone,pad_uv)
# The retaining edge belongs on the bank side of the path. It no longer forms
# the crosswise end of a northbound corridor.
wall=bpy.data.objects['Video - junction retaining wall']
for v in wall.data.vertices:
    x,y,z=local(v.co);v.co=p(13.25+(z-6.575),y,4.02-(x-14.90))
wall.data.update()

for name,g in groups.items():
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(g['v'],[],g['f']);mesh.update()
    attr=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
    attr.data.foreach_set('color',[v for color in g['col'] for v in color])
    layer=mesh.uv_layers.new(name='UVMap');layer.data.foreach_set('uv',[v for pair in g['uv'] for v in pair])
    mesh.materials.append(g['mat']);obj=bpy.data.objects.new(name,mesh);model.objects.link(obj)
layout['centerline']=sections
layout['routeCorrection']={'source':'Owner clarification, 2026-09-14',
    'excludedDirectionIntervalSeconds':[22,25],
    'interpretation':'Camera pans north and returns west. This does not establish a pair of path turns.',
    'shape':'Continuous westward approach with gentle lateral variation; anchored stair head retained.',
    'estimates':'Curve and side-pad placement are estimates between retained anchors; no camera solve.'}
layout['newObjects']=[o.name for o in model.objects if o.name.startswith('Video -')]
scene['walkthrough_validation']=json.dumps(layout);scene['route_pan_corrected']=True
(ROOT/'authoring/cabin/walkthrough-layout.json').write_text(json.dumps(layout,indent=2)+'\n')
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'authoring/cabin/cabin.blend'),compress=True)
print('Corrected route:',len(sections),'cross-sections; old dogleg archived outside export')
