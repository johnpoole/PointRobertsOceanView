"""Issue #96: one-time upper-deck edit of the saved Blender source.
Owner establishes the outward angle and tree notch; dimensions are estimates.
The November 2021 photo establishes a three-sided railing around an open notch.
"""
import bpy, json, math
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2];scene=bpy.context.scene
if scene.get('upper_deck_correction_96'):raise RuntimeError('Already applied; edit the saved source')
model=bpy.data.collections['MODEL - exported cabin and access']
clear=bpy.data.collections['CLEARANCE - edit with walking surfaces']
material=bpy.data.materials['Cabin vertex colours']
c,s=math.cos(.318),math.sin(.318)
def point(x,y,z):return Vector((x*c+z*s,x*s-z*c,y))
tree=min(json.loads((ROOT/'assets/site/389-trees.json').read_text())['trees'],
    key=lambda t:(t['lat']-48.9890535)**2+(t['lon']+123.0858436)**2)
wx=(tree['lon']+123.085318)*111320*math.cos(math.radians(48.989009));wz=-(tree['lat']-48.989009)*111320
tx=(wx+34.17)*c-(wz+7.03)*s;tz=(wx+34.17)*s+(wz+7.03)*c
west,wall,east,north,south,level=-7.135,-3.235,3.235,-3.395,3.395,10.45
back=tx+.68;zn,zs=tz-.78,tz+.78
# Owner-selected PXL_20211108_174949325.MP shows the taper from the narrow
# entrance to the table-width seaward end. Estimate 2.40 m projection there,
# retaining the 0.91 m entrance return. These are not rectified measurements.
outer_e,outer_w=4.305,5.795
polygons=[[(west,north),(wall,north),(wall,zn),(west,zn)],
          [(back,zn),(wall,zn),(wall,zs),(back,zs)],
          [(west,zs),(wall,zs),(wall,south),(west,south)],
          [(west,south),(east,south),(east,outer_e),(west,outer_w)]]
boundary=[(wall,north),(west,north),(west,zn),(back,zn),(back,zs),(west,zs),(west,outer_w),(east,outer_e)]
groups={};timber=(.25,.24,.215);frame=(.44,.46,.44);wire=(.32,.35,.34)
deck='Upper deck and wire rails';support='Deck posts beams and braces'
def face(name,pts,color):
    g=groups.setdefault(name,{'v':[],'f':[],'col':[]});n=len(g['v'])
    g['v'].extend([point(*p) for p in pts]);g['f'].append(list(range(n,n+len(pts))))
    g['col'].extend([(*color,1)]*len(pts))
def prism(name,poly,base,top,color):
    lo=[(x,base,z) for x,z in poly];hi=[(x,top,z) for x,z in poly]
    face(name,list(reversed(lo)),color);face(name,hi,color)
    for i in range(len(poly)):
        j=(i+1)%len(poly);face(name,[lo[i],lo[j],hi[j],hi[i]],color)
def member(name,a,b,width,depth,color=timber):
    a,b=Vector(a),Vector(b);along=(b-a).normalized();across=along.cross(Vector((0,1,0)))
    if across.length<.01:across=Vector((1,0,0))
    across.normalize();other=along.cross(across).normalized()
    pts=[tuple(end+across*i*width/2+other*j*depth/2) for end in (a,b) for i,j in [(-1,-1),(1,-1),(1,1),(-1,1)]]
    for ids in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:face(name,[pts[i] for i in ids],color)
for p in polygons:prism(deck,p,level-.14,level,timber)
posts=set()
for a,b in zip(boundary,boundary[1:]):
    dx,dz=b[0]-a[0],b[1]-a[1];run=math.hypot(dx,dz)
    # Rim and header stop at every notch corner, not across the tree opening.
    member(support,(a[0],10.20,a[1]),(b[0],10.20,b[1]),.14,.22)
    member(deck,(a[0],11.53,a[1]),(b[0],11.53,b[1]),.095,.065,frame)
    member(deck,(a[0],10.56,a[1]),(b[0],10.56,b[1]),.06,.06,frame)
    for k in range(1,9):
        y=10.56+k*.108
        member(deck,(a[0],y,a[1]),(b[0],y,b[1]),.008,.008,wire)
    count=math.ceil(run/.11)
    for i in range(count+1):
        t=i/count;x,z=a[0]+t*dx,a[1]+t*dz
        member(deck,(x,10.56,z),(x,11.50,z),.008,.008,wire)
    count=max(1,math.ceil(run/1.85))
    for i in range(count+1):posts.add((round(a[0]+dx*i/count,6),round(a[1]+dz*i/count,6)))
for x,z in posts:member(deck,(x,10.45,z),(x,11.55,z),.07,.07,frame)

# Carry the deck around the opening. The former beam and joists must not keep
# bridging the now-empty notch. Feet are estimated from the existing bank.
terrain=json.loads((ROOT/'data/cabin-blender/current-terrain.json').read_text());g=terrain['grid'];h=terrain['heights']
def ground(x,z):
    p=point(x,0,z);lat=48.989009+(p.y-7.03)/111320;lon=-123.085318+(p.x-34.17)/(111320*math.cos(math.radians(48.989009)))
    r=(g['north_lat']-lat)/g['cellsize_deg'];col=(lon-g['west_lon'])/g['cellsize_deg'];i=max(0,min(g['nrows']-2,math.floor(r)));j=max(0,min(g['ncols']-2,math.floor(col)))
    u=max(0,min(1,col-j));v=max(0,min(1,r-i));n=g['ncols']
    return (h[i*n+j]*(1-u)+h[i*n+j+1]*u)*(1-v)+(h[(i+1)*n+j]*(1-u)+h[(i+1)*n+j+1]*u)*v
px=west+.40
for a,b in [(north,zn),(zs,south)]:member(support,(px,10.10,a),(px,10.10,b),.20,.22)
for z in [north+.30,zn-.35,zs+.35,south-.30]:
    member(support,(px,ground(px,z)-.18,z),(px,10.10,z),.16,.16,(.075,.11,.09))
    member(support,(west,10.10,z),(wall,10.10,z),.18,.22)
    member(support,(px,9.38,z),(px+.72,10.10,z),.10,.13)
for z in [zn-.09,zs+.09]:member(support,(west,10.10,z),(wall,10.10,z),.18,.22)
member(support,(back+.09,10.10,zn),(back+.09,10.10,zs),.18,.22)
# Joists below the splayed south return follow its new perimeter.
for i in range(13):
    x=west+(east-west)*i/12;end=outer_w+(outer_e-outer_w)*(x-west)/(east-west)
    member(support,(x,10.20,south),(x,10.20,end),.065,.20)

for name,data in groups.items():
    mesh=bpy.data.meshes.new(name+' upper deck correction');mesh.from_pydata(data['v'],[],data['f']);mesh.update()
    attr=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
    attr.data.foreach_set('color',[v for rgba in data['col'] for v in rgba]);mesh.materials.append(material)
    obj=bpy.data.objects[name];obj.data=mesh;obj['evidence']='Issue #96; owner angle/notch correction, November 2021 tree-rail photo. Dimensions estimated.'
# Replace only the two upper deck helpers, retaining all other walking surfaces.
for name,polys in [('Cabin clearance 01',polygons[:3]),('Cabin clearance 02',polygons[3:])]:
    verts=[];faces=[]
    for p in polys:
        start=len(verts);verts.extend([point(x,9.91,z) for x,z in p]);faces.append(list(range(start,len(verts))))
    mesh=bpy.data.meshes.new(name+' corrected footprint');mesh.from_pydata(verts,[],faces);bpy.data.objects[name].data=mesh

# Inspection-only trunk uses the same site anchor as the web trees. Never
# export it: the application already renders that tree from 389-trees.json.
context=bpy.data.collections.new('CONTEXT - deck tree');scene.collection.children.link(context)
bpy.ops.mesh.primitive_cone_add(vertices=16,radius1=.456,radius2=.30,depth=10,location=point(tx,tree['ground_m']+5,tz))
trunk=bpy.context.object;trunk.name='Deck tree reference - not exported'
for col in list(trunk.users_collection):col.objects.unlink(trunk)
context.objects.link(trunk)
mat=bpy.data.materials.new('Reference bark');mat.diffuse_color=(.14,.10,.07,1);trunk.data.materials.append(mat)
layout={'issue':96,'photos':['images/PXL_20211108_174949325.MP.jpg','images/Photos-1-001/PXL_20211115_192928437.jpg','images/Photos-1-001/PXL_20260808_202820423.jpg'],
    'floor':level,'polygons':polygons,'railBoundary':boundary,
    'tree':{'lat':tree['lat'],'lon':tree['lon'],'x':tx,'z':tz,'radiusEnvelope':.456},
    'notch':{'west':west,'back':back,'north':zn,'south':zs},
    'southEdge':{'east':[east,outer_e],'west':[west,outer_w]},
    'limits':'Owner-selected November 8 image establishes south return widening westward; November 15 shows the tree notch. Projections of 2.40m west and 0.91m east, and notch dimensions around the existing tree anchor, remain estimates. No new survey/camera solve.'}
(ROOT/'authoring/cabin/upper-deck-layout.json').write_text(json.dumps(layout,indent=2)+'\n')
scene['upper_deck_correction_96']=json.dumps(layout)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'authoring/cabin/cabin.blend'),compress=True)
print('Upper deck revised:',layout['notch'])
