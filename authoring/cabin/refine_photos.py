"""Issue #93: edit the existing Blender source against the still photographs.

Run once on the saved post-#90 source, not on the procedural bootstrap.
The backup in data/cabin-blender permits visual iteration without accumulating edits.
"""
import bpy, math, random, json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
scene = bpy.context.scene
if scene.get('photo_refinement_93'):
    raise RuntimeError('Photo refinement already applied; edit the saved source')
model = bpy.data.collections['MODEL - exported cabin and access']
paint = bpy.data.materials['Cabin vertex colours']
wood = bpy.data.materials['Video frame 034 - weathered shed boards']
c, s = math.cos(.318), math.sin(.318)
rng = random.Random(93)
groups = {}

def point(x,y,z): return (x*c+z*s, x*s-z*c, y)
def face(name, pts, color=(.23,.21,.18), mat=paint, uv=None):
    g=groups.setdefault(name,dict(v=[],f=[],col=[],uv=[],mat=mat))
    n=len(g['v']); g['v'] += [point(*p) for p in pts]
    g['f'].append(list(range(n,n+len(pts))))
    g['col'] += [(*color,1)]*len(pts)
    g['uv'] += uv or [(0,0)]*len(pts)

def box(name,x0,x1,z0,z1,y0,y1,color=(.23,.21,.18)):
    p=[(x0,y0,z0),(x1,y0,z0),(x1,y0,z1),(x0,y0,z1),
       (x0,y1,z0),(x1,y1,z0),(x1,y1,z1),(x0,y1,z1)]
    for ids in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:
        face(name,[p[i] for i in ids],color)

def member(name,a,b,width=.05,depth=.05,color=(.23,.21,.18)):
    a,b=Vector(a),Vector(b); along=(b-a).normalized()
    across=along.cross(Vector((0,1,0)))
    if across.length<.01: across=Vector((1,0,0))
    across.normalize(); other=along.cross(across).normalized()
    p=[tuple(end+across*i*width/2+other*j*depth/2) for end in (a,b)
       for i,j in [(-1,-1),(1,-1),(1,1),(-1,1)]]
    for ids in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:
        face(name,[p[i] for i in ids],color)

def wood_uv(row):
    # Sample individual clear boards from frame 034. Match the photographed
    # board's slant in UV space so its grain lies along a horizontal model board.
    k=row%5; top=50+k*68; bottom=top+53
    return [(610/1920,1-bottom/1080),(865/1920,1-(bottom+54)/1080),
            (865/1920,1-(top+54)/1080),(610/1920,1-top/1080)]

# The still shows two full-width doors, no wide fixed panel on one side, and
# roughly twelve horizontal courses rather than two stretched picture panels.
base,eave,ridge=17.10,19.04,19.47
box('Photo - shed wall backing',17.605,20.414,4.755,7.045,base,eave,(.13,.12,.105))
for row in range(12):
    lo=base+.015+row*1.925/12; hi=lo+1.925/12-.003
    for z0,z1 in [(4.80,5.888),(5.902,7.00)]:
        face('Video - shed double doors',[(20.438,lo,z1),(20.438,lo,z0),
             (20.418,hi,z0),(20.418,hi,z1)],mat=wood,uv=wood_uv(row))
        face('Video - shed double doors',[(20.418,lo,z1),(20.438,lo,z1),
             (20.438,lo,z0),(20.418,lo,z0)],(.16,.15,.13))
    for z,sign in [(4.75,-1),(7.05,1)]:
        for i in range(3):
            x0=17.6+i*2.8/3; x1=17.6+(i+1)*2.8/3
            face('Video - shed walls',[(x0,lo,z+sign*.021),(x1,lo,z+sign*.021),
                 (x1,hi,z),(x0,hi,z)],mat=wood,uv=wood_uv(row+i))
            face('Video - shed walls',[(x0,lo,z),(x1,lo,z),
                 (x1,lo,z+sign*.021),(x0,lo,z+sign*.021)],(.16,.15,.13))
    face('Video - shed walls',[(17.58,lo,4.75),(17.58,lo,7.05),
         (17.60,hi,7.05),(17.60,hi,4.75)],mat=wood,uv=wood_uv(row))
trim=(.24,.215,.185)
for z in (4.765,7.035):
    box('Video - shed door framing',20.423,20.465,z-.026,z+.026,base,eave,trim)
box('Video - shed door framing',20.434,20.462,5.883,5.907,base+.015,eave-.01,trim)
box('Video - shed door framing',20.43,20.47,4.75,7.05,eave-.035,eave+.015,trim)
# Small hinge straps on the outer edges and a latch, not an oversized black handle.
for z,side in [(4.82,1),(6.98,-1)]:
    for y in (17.47,18.62):
        box('Photo - shed hardware',20.464,20.48,min(z,z+side*.14),max(z,z+side*.14),y,y+.025,(.095,.085,.075))
box('Photo - shed hardware',20.465,20.49,5.86,5.96,18.0,18.024,(.095,.085,.075))
# Oval name plaque visible over the doors in the 2021 still.
for k in range(24):
    a,b=k*math.tau/24,(k+1)*math.tau/24
    face('Photo - shed name plaque',[(20.447,19.205,5.9),
        (20.447,19.205+.082*math.sin(a),5.9+.235*math.cos(a)),
        (20.447,19.205+.082*math.sin(b),5.9+.235*math.cos(b))],(.34,.285,.20))
for x in (17.595,20.415):
    for row in range(3):
        lo=eave+row*.143; hi=min(ridge,lo+.14)
        w0=(ridge-lo)/(.43/1.15); w1=(ridge-hi)/(.43/1.15)
        face('Video - shed gables',[(x,lo,5.9+w0),(x,lo,5.9-w0),
             (x,hi,5.9-w1),(x,hi,5.9+w1)],mat=wood,uv=wood_uv(row))

# Shallow overlapping asphalt courses and staggered tab seams, seen clearly in
# the 2021 still. The cabin's newer standing-seam roof is not changed.
def roof_y(z): return ridge-abs(z-5.9)*(.43/1.15)
for side in (-1,1):
    for row in range(8):
        za=5.9+side*(1.3-row*1.3/8); zb=5.9+side*(1.3-(row+1)*1.3/8)
        x=17.42-(.15 if row%2 else 0)
        while x<20.58:
            a=max(17.42,x); b=min(20.58,x+.30)-.002
            tone=rng.uniform(.045,.070)
            color=(tone*1.03,tone,tone*.91)
            face('Video - shed roof',[(a,roof_y(za)+.009,za),(b,roof_y(za)+.009,za),
                 (b,roof_y(zb)+.006,zb),(a,roof_y(zb)+.006,zb)],color)
            face('Video - shed roof',[(a,roof_y(za),za),(b,roof_y(za),za),
                 (b,roof_y(za)+.009,za),(a,roof_y(za)+.009,za)],color)
            x+=.30
    for x in (17.44,20.56):
        member('Video - shed fascia',(x,roof_y(5.9+side*1.3)-.05,5.9+side*1.3),
               (x,ridge-.05,5.9),.065,.115,trim)
    member('Video - shed fascia',(17.42,roof_y(5.9+side*1.3)-.06,5.9+side*1.3),
           (20.58,roof_y(5.9+side*1.3)-.06,5.9+side*1.3),.06,.10,trim)

# Retaining blocks have staggered joints, small broken edges, varied weathering
# and a cap following the branch rather than a level, monolithic parapet.
def rough_wall(name,x0,x1,z0,z1,base,top):
    row=0; y=base
    while y<max(top(z0),top(z1)):
        h=.185+rng.uniform(-.013,.013)
        z=z0-(.21 if row%2 else 0)
        while z<z1:
            end=z+rng.uniform(.32,.48); a=max(z0,z); b=min(z1,end)-.008
            hi=min(y+h-.008,top((a+b)/2))
            if b>a and hi>y+.025:
                v=rng.uniform(.24,.37)
                box(name,x0+rng.uniform(-.012,.009),x1,a,b,y,hi,(v*1.02,v,v*.91))
            z=end
        y+=h; row+=1
rough_wall('Video - junction retaining wall',14.74,15.06,5.55,7.60,13.1832,lambda z:14.77)
rough_wall('Video - shed branch retaining wall',21.47,21.79,2.4,7.85,16.75,
           lambda z:18.55 if z<4.6 else 18.55-(z-4.6)*.17)

# Replace the rectangular flower cards with rounded leaf clumps, bent grass
# blades and small daisies in the photographed upper approach beds.
surveycol=bpy.data.collections['CONTEXT - original survey']; surveycol.hide_viewport=False
bpy.context.view_layer.update(); survey=bpy.data.objects['Original survey reference']
def ground(x,z):
    hit,p,*_=survey.ray_cast(Vector(point(x,100,z)),Vector((0,0,-1)))
    if not hit: raise RuntimeError('Missing survey')
    return p.z
def clump(name,x,y,z,r,h,color):
    rings=[]
    for t in (0,.24,.57,.84,1):
        rr=max(.04,math.sin(t*math.pi))
        rings.append([(x+math.cos(k*math.tau/7)*r*rr,y+t*h,
                       z+math.sin(k*math.tau/7)*r*rr) for k in range(7)])
    for a,b in zip(rings,rings[1:]):
        for k in range(7):
            gain=rng.uniform(.86,1.13)
            face(name,[a[k],a[(k+1)%7],b[(k+1)%7],b[k]],tuple(v*gain for v in color))
def bed(x,z,y,scale=1,flowers=True):
    for k in range(8):
        a=rng.random()*math.tau; r=rng.uniform(.08,.28)*scale
        xx,zz=x+math.cos(a)*r,z+math.sin(a)*r
        clump('Video - garden planting',xx,y-.025,zz,rng.uniform(.11,.19)*scale,
              rng.uniform(.16,.34)*scale,(.075,.12,.035))
    for k in range(16):
        a=rng.random()*math.tau; dx,dz=math.cos(a),math.sin(a)
        length=rng.uniform(.28,.52)*scale; width=.012*scale
        pts=[(x,y,z),(x+dx*.15-dz*width,y+length*.82,z+dz*.15+dx*width),
             (x+dx*.36*scale,y+length*.5,z+dz*.36*scale),
             (x+dx*.15+dz*width,y+length*.82,z+dz*.15-dx*width)]
        face('Video - garden planting',pts,(.14,.19,.055))
    if flowers:
        for k in range(6):
            xx=x+rng.uniform(-.25,.25)*scale; zz=z+rng.uniform(-.25,.25)*scale
            yy=y+rng.uniform(.24,.44)*scale; radius=.025*scale
            member('Video - garden planting',(xx,y,zz),(xx,yy,zz),.004,.004,(.10,.15,.045))
            for p in range(12):
                a=p*math.tau/12; b=a+.24
                face('Video - garden flowers',[(xx,yy-.006,zz),
                    (xx+radius*math.cos(a),yy,zz+radius*math.sin(a)),
                    (xx+radius*math.cos(b),yy+.004,zz+radius*math.sin(b))],(.77,.75,.67))
            face('Video - garden flowers',[(xx-.006,yy+.003,zz),(xx,yy+.003,zz-.006),
                 (xx+.006,yy+.003,zz),(xx,yy+.003,zz+.006)],(.48,.32,.035))
stations=json.loads(scene['walkthrough_validation'])['stations']
def path_y(x):
    for (a,ya),(b,yb) in zip(stations,stations[1:]):
        if b<=x<=a:return yb+(ya-yb)*(x-b)/(a-b)
    return stations[-1][1]
for x in (14.6,15.5,16.5,17.5,18.5,19.5,20.5,22,23,24,25):
    for z in (7.36,9.53):
        if z<8 and x<15.1:continue
        if z<8 and 17.3<x<21.9:continue
        bed(x,z,min(ground(x,z),path_y(x)+.20),.9)
for z in (5.85,6.75): bed(15.32,z,max(ground(15.32,z),14.77),.9)
for z in (3.2,4.5,5.7,6.8,7.6): bed(21.99,z,ground(21.99,z),1.1)

# The six-panel green storage door is visible in the August 2026 south views.
# It sits under the south return, beside (not across) the beach stair.
doorx,doorz,floor=-2.90,5.42,6.32
green=(.20,.28,.12)
box('Photo - underdeck storage door',doorx-.45,doorx+.45,doorz-.06,doorz,floor,floor+1.96,green)
for x in (doorx-.49,doorx+.49):
    box('Photo - underdeck storage frame',x-.04,x+.04,doorz-.07,doorz+.024,floor-.03,floor+2.03,(.27,.25,.22))
box('Photo - underdeck storage frame',doorx-.53,doorx+.53,doorz-.07,doorz+.024,floor+1.96,floor+2.04,(.27,.25,.22))
for x in (doorx-.225,doorx+.225):
    for a,b in [(.14,.77),(.91,1.50),(1.65,1.83)]:
        box('Photo - underdeck storage panels',x-.17,x+.17,doorz,doorz+.012,floor+a,floor+b,(.245,.325,.155))
        for edge in (x-.178,x+.178):
            box('Photo - underdeck storage panels',edge-.008,edge+.008,doorz+.012,doorz+.026,floor+a-.008,floor+b+.008,green)
        for y in (floor+a,floor+b):
            box('Photo - underdeck storage panels',x-.178,x+.178,doorz+.012,doorz+.026,y-.008,y+.008,green)
box('Photo - underdeck storage frame',doorx-.41,doorx-.36,doorz+.015,doorz+.075,floor+.93,floor+.98,(.10,.095,.08))
# Recess the storage apron below the deck. Without this height
# constraint the coarse bank passes straight through the photographed door.
clear=bpy.data.collections['CLEARANCE - edit with walking surfaces']
poly=[(-3.52,5.10),(-2.30,5.10),(-2.30,7.52),(-3.52,7.52)]
mesh=bpy.data.meshes.new('Storage apron clearance')
mesh.from_pydata([point(x,floor-.10,z) for x,z in poly],[],[[0,1,2,3]])
obj=bpy.data.objects.new('Photo - storage apron clearance',mesh);clear.objects.link(obj);obj.display_type='WIRE'
box('Photo - storage threshold',doorx-.53,doorx+.53,doorz-.12,doorz+.26,floor-.11,floor,(.32,.31,.285))
# Weathered vertical enclosure boards flank the door under the deck edge.
for x0,x1 in [(doorx-.83,doorx-.53),(doorx+.53,doorx+.75)]:
    for k in range(3):
        a=x0+k*(x1-x0)/3; b=x0+(k+1)*(x1-x0)/3-.007
        box('Photo - storage enclosure',a,b,doorz-.10,doorz-.02,floor,8.39,(.21,.205,.18))
# Three stepped retaining tiers along the uphill side of the beach flight.
# The existing stair pitch/count remains unchanged; these hold back its bank.
for a,b,top in [(-3.3,-1.5,6.55),(-1.5,.3,7.55),(.3,2.10,8.48)]:
    x=a
    while x<b-.01:
        end=min(b,x+rng.uniform(.42,.67)); y=5.45
        while y<top-.02:
            hi=min(top,y+.29); tone=rng.uniform(.30,.43)
            box('Photo - beach stair retaining tiers',x+.007,end-.007,7.22,7.55,y,hi-.008,(tone,tone*.98,tone*.89))
            y=hi
        x=end

# Replace only the named meshes. Keep all other authoring objects and controls.
for name,g in groups.items():
    mesh=bpy.data.meshes.new(name+' photo revision')
    mesh.from_pydata(g['v'],[],g['f']); mesh.update()
    attr=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
    attr.data.foreach_set('color',[v for rgba in g['col'] for v in rgba])
    uv=mesh.uv_layers.new(name='UVMap'); uv.data.foreach_set('uv',[v for pair in g['uv'] for v in pair])
    mesh.materials.append(g['mat'])
    obj=bpy.data.objects.get(name)
    if obj:obj.data=mesh
    else:
        obj=bpy.data.objects.new(name,mesh); model.objects.link(obj)
    obj['evidence']='Photo refinement #93; see photo-review.json'
    if 'retaining wall' in name:
        mod=obj.modifiers.new('Worn block arrises','BEVEL'); mod.width=.012; mod.segments=1

# Convert the plaque lettering to an ordinary painted mesh for the same GLB
# batch; the .blend still retains its semantic name and photo evidence.
from mathutils import Matrix
curve=bpy.data.curves.new('Pooles plaque lettering','FONT');curve.body='Pooles'
curve.align_x='CENTER';curve.align_y='CENTER';curve.size=.105;curve.extrude=.001
obj=bpy.data.objects.new('Photo - Pooles lettering',curve);model.objects.link(obj)
obj.location=point(20.45,19.205,5.9)
obj.rotation_euler=Matrix(((-s,0,c),(c,0,s),(0,1,0))).to_euler()
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
bpy.ops.object.convert(target='MESH');obj=bpy.context.object;obj.data.materials.append(paint)
attr=obj.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
for item in attr.data:item.color=(.085,.067,.045,1)

# Original east passage wall: retain its measured footprint, but vary blocks
# individually and bevel their sharp edges to match the 2021 passage close-up.
obj=bpy.data.objects['East retaining blocks']; mesh=obj.data
adj=[[] for _ in mesh.vertices]
for e in mesh.edges:
    a,b=e.vertices; adj[a].append(b); adj[b].append(a)
seen=set(); color_by_vertex={}
for i in range(len(adj)):
    if i in seen:continue
    stack=[i]; seen.add(i); tone=rng.uniform(.26,.41)
    color=(tone*1.01,tone,tone*.94,1)
    while stack:
        v=stack.pop(); color_by_vertex[v]=color
        for n in adj[v]:
            if n not in seen:seen.add(n);stack.append(n)
attr=mesh.color_attributes.get('Color')
for loop in mesh.loops:attr.data[loop.index].color=color_by_vertex[loop.vertex_index]
mod=obj.modifiers.new('Weathered passage blocks','BEVEL');mod.width=.008;mod.segments=1

# Both the May 2025 north view and August 2026 south views show pale fascia
# bordering the current metal roof, with natural timber exposed underneath.
fascia=bpy.data.objects['Fascia and open soffits'].data.color_attributes['Color']
for item in fascia.data:
    if max(item.color[:3])<.10:item.color=(.64,.64,.61,1)
# Keep green structural posts, glazing and wire infill; gray only the original
# cedar colour (0x9c8a72 converted to linear RGB by the procedural bootstrap).
def linear(v):
    v=v/255
    return v/12.92 if v<.04045 else ((v+.055)/1.055)**2.4
cedar=tuple(linear(v) for v in (156,138,114))
for obj in model.objects:
    if obj.type!='MESH' or obj.name.startswith(('Video -','Photo -')):continue
    attr=obj.data.color_attributes.get('Color')
    if not attr:continue
    for item in attr.data:
        if max(abs(item.color[i]-cedar[i]) for i in range(3))<.002:
            item.color=(.25,.24,.215,1)

scene['photo_refinement_93']=json.dumps({'photos':['PXL_20211108_174924421.jpg',
    'PXL_20211108_175012789.jpg','PXL_20250517_150947629.MP.jpg',
    'PXL_20260808_202820423.jpg','PXL_20260808_202908454.jpg','PXL_20260808_202937782.MP.jpg'],
    'frames':[34,47],'changes':list(groups),'dimensions':'Visual estimates, not a camera or survey solve'})
surveycol.hide_viewport=True
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'authoring/cabin/cabin.blend'),compress=True)
print('Photo refinement saved:',len(groups),'edited/added meshes')
