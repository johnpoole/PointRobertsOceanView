"""Issue #100: complementary 20190731_104156 east-facing stair-base photo.
Run once on #99. Flight controls and tread/riser planes stay fixed.
"""
import bpy,math,json,random,ast
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];scene=bpy.context.scene
if scene.get('stair_east_100'):raise RuntimeError('Already applied')
c,s=math.cos(.318),math.sin(.318);rng=random.Random(100);groups={}
model=bpy.data.collections['MODEL - exported cabin and access'];paint=bpy.data.materials['Cabin vertex colours']
# Reuse only geometry helpers, never execute the previous one-time migration.
module=ast.parse((ROOT/'authoring/cabin/refine_east_wall.py').read_text())
for name in ['point','face','box','limb']:
    fn=next(n for n in module.body if isinstance(n,ast.FunctionDef) and n.name==name)
    exec(compile(ast.Module(body=[fn],type_ignores=[]),'wall geometry helpers','exec'))
def local(p):return Vector((p.x*c+p.y*s,p.z,p.x*s-p.y*c))

# Raise the previously over-cut south lip into the short wall return beside
# the stairs. The existing cleared terrain remains underneath this scenic bank.
def lip_delta(x,z):
    return 2.02*max(0,min(1,(z-2.6)/.795))*max(0,min(1,(7.3-x)/1.3))
for name in ['Photo - east bank soil','Photo - east bank brush','Photo - east bank grass']:
    o=bpy.data.objects[name];inv=o.matrix_world.inverted()
    for v in o.data.vertices:
        x,y,z=local(o.matrix_world@v.co);delta=lip_delta(x,z)
        if name=='Photo - east bank soil':delta=min(delta,max(0,12.24-y))
        v.co=inv@Vector(point(x,y+delta,z))
    o.data.update()
path=ROOT/'authoring/cabin/east-wall-layout.json';wall=json.loads(path.read_text())
for j,z in enumerate(wall['bank']['z']):
    for i,x in enumerate(wall['bank']['x']):wall['bank']['heights'][j][i]+=min(lip_delta(x,z),max(0,12.24-wall['bank']['heights'][j][i]))
wall['stairBaseFollowUp']=100;path.write_text(json.dumps(wall,indent=2)+'\n')

# Angled block return meets the north side of the final flight without
# projecting into the approach. It connects the former free wall end.
a=Vector((4.65,0,3.36));b=Vector((6.06,0,4.04));d=b-a;length=d.length;along=d.normalized();back=Vector((along.z,0,-along.x))
for row in range(10):
    start=-(row%2)*.20
    while start<length:
        lo=max(0,start);hi=min(length,start+.4)
        if hi-lo>.02:
            p=a+along*(lo+.005)+back*(row*.025);q=a+along*(hi-.005)+back*(row*.025)
            y=10.25+row*.2;t=rng.uniform(.23,.33)
            v=[(p.x,y,p.z),(q.x,y,q.z),(q.x+back.x*.38,y,q.z+back.z*.38),(p.x+back.x*.38,y,p.z+back.z*.38)]
            v += [(x,y+.19,z) for x,_,z in v]
            for ids in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:face('Photo - stair-base wall return',[v[i] for i in ids],(t,t*1.02,t*.96))
        start+=.4
# Soil behind the return, with solid skirts buried below the terrain cut.
cap=[(4.96,12.23,3.27),(6.24,12.23,3.93),(6.42,12.20,3.30)]
face('Photo - stair-base soil',cap,(.17,.15,.09))
for p,q in zip(cap,cap[1:]+cap[:1]):face('Photo - stair-base soil',[p,q,(q[0],9.9,q[2]),(p[0],9.9,p[2])],(.15,.13,.08))

# The second photo reveals a broad rotten stump, with crumbly inner material
# exposed under ribbons of silver-grey wood. Replace the former upright log.
name='Photo - east bank stump';cx,cz=5.60,3.02;base=12.16;N=14
rings=[]
for h,r in [(0,.92),(.35,1),(.68,.78),(.98,.28)]:
    ring=[]
    for k in range(N):
        a=k*math.tau/N;rr=r*(1+.10*math.sin(k*2.4));height=base+h*(1+.15*math.sin(a))
        ring.append((cx+math.cos(a)*.55*rr,height,cz+math.sin(a)*.73*rr))
    rings.append(ring)
for j in range(3):
    for k in range(N):
        t=rng.uniform(.16,.29);face(name,[rings[j][k],rings[j][(k+1)%N],rings[j+1][(k+1)%N],rings[j+1][k]],(t,t*.93,t*.72))
face(name,rings[-1],(.20,.18,.13))
# Irregular peeling wood ribs, broad near the shoulder and split toward roots.
for k in [0,1,3,5,6,8,10,12,13]:
    a=k*math.tau/N;da=rng.uniform(.10,.21);pts=[]
    for h,r in [(.02,1.05),(.38,1.035),(.73,.82),(1.03,.30)]:
        for angle in [a-da,a+da]:pts.append((cx+math.cos(angle)*.56*r,base+h*(1+.15*math.sin(angle)),cz+math.sin(angle)*.74*r))
    for j in range(3):
        p,q,r0,t0=pts[j*2:j*2+2]+pts[(j+1)*2:(j+1)*2+2]
        for u in range(4):
            lo=u/4;hi=(u+1)/4;v=[Vector(p).lerp(Vector(q),lo),Vector(p).lerp(Vector(q),hi),Vector(r0).lerp(Vector(t0),hi),Vector(r0).lerp(Vector(t0),lo)]
            tone=rng.uniform(.27,.49);face(name,v,(tone,tone*.99,tone*.94))

# Leafy growth spills over the wall beside the left rail; keep all stems north
# of the flight. A few larger strap leaves sit farther up the bank.
for k in range(44):
    x=rng.uniform(5.55,6.08);z=rng.uniform(3.45,3.95);y=rng.uniform(10.95,12.6)
    start=(x,y,z);tip=(x+rng.uniform(-.18,.1),y+rng.uniform(.15,.5),z+rng.uniform(-.15,.06))
    limb('Photo - stair-base planting',start,tip,.008,.003,(.13,.12,.055),4)
    for j in range(4):
        t=(j+1)/4;at=Vector(start).lerp(Vector(tip),t);sz=rng.uniform(.045,.11);a=rng.random()*math.tau;dx=math.cos(a)*sz;dz=math.sin(a)*sz
        face('Photo - stair-base planting',[(at.x-dx,at.y,at.z-dz),(at.x-dz*.5,at.y+.025,at.z+dx*.5),(at.x+dx,at.y,at.z+dz),(at.x+dz*.5,at.y-.01,at.z-dx*.5)],rng.choice([(.12,.22,.045),(.22,.29,.075),(.08,.16,.04)]))
for k in range(18):
    x=rng.uniform(6.1,6.7);z=rng.uniform(3.3,3.85);y=12.15;h=rng.uniform(.35,.8);a=rng.random()*math.tau
    face('Photo - stair-base planting',[(x-.018,y,z),(x+.018,y,z),(x+math.cos(a)*.12,y+h,z+math.sin(a)*.25)],(.12,.23,.09))

# The photograph also exposes the short lower handrail on the north (left)
# side. Its posts stay outside the 1.2m flight and its top follows the risers.
module2=ast.parse((ROOT/'authoring/cabin/refine_photos.py').read_text())
fn=next(n for n in module2.body if isinstance(n,ast.FunctionDef) and n.name=='member');exec(compile(ast.Module(body=[fn],type_ignores=[]),'timber helper','exec'))
spec=json.loads((ROOT/'authoring/cabin/export-report.json').read_text())['stair'];bearing=math.radians(spec['bearing_deg'])
fx=(spec['bottom']['lon']+123.085318)*111320*math.cos(math.radians(48.989009));fz=-(spec['bottom']['lat']-48.989009)*111320
def rail_point(along,y):
    wx=fx+math.sin(bearing)*along-math.cos(bearing)*.70;wz=fz-math.cos(bearing)*along-math.sin(bearing)*.70
    return ((wx+34.17)*c-(wz+7.03)*s,y,(wx+34.17)*s+(wz+7.03)*c)
for t in [.02,1.25,2.5]:
    floor=10.45+max(0,math.floor(t/.254))*.1674
    member('Photo - lower north stair rail',rail_point(t,floor-.08),rail_point(t,10.45+t*.1674/.254+.93),.09,.10,(.28,.27,.23))
member('Photo - lower north stair rail',rail_point(-.15,11.38-.15*.1674/.254),rail_point(2.65,11.38+2.65*.1674/.254),.10,.15,(.31,.30,.27))

for name,g in groups.items():
    old=bpy.data.objects.get(name)
    if old:bpy.data.objects.remove(old,do_unlink=True)
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(g['v'],[],g['f']);mesh.update()
    attr=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER');attr.data.foreach_set('color',[v for col in g['col'] for v in col]);mesh.materials.append(paint)
    obj=bpy.data.objects.new(name,mesh);model.objects.link(obj)

# Subdivide existing planar concrete faces for mottled vertex colour. No tread
# height, edge, riser plane or stair control moves; no photo textures are added.
for name in ['Approach concrete treads and landings','Approach risers and paving joints']:
    obj=bpy.data.objects[name];old=obj.data;v=[];f=[];cols=[];div=4
    for poly in old.polygons:
        a,b,c0=[old.vertices[i].co for i in poly.vertices]
        def at(i,j):return a+(b-a)*(i/div)+(c0-a)*(j/div)
        for i in range(div):
            for j in range(div-i):
                tris=[[at(i,j),at(i+1,j),at(i,j+1)]]
                if i+j<div-1:tris.append([at(i+1,j),at(i+1,j+1),at(i,j+1)])
                for tri in tris:
                    n=len(v);v.extend(tri);f.append([n,n+1,n+2]);tone=rng.uniform(.25,.39);cols.extend([(tone,tone*1.01,tone*.97,1)]*3)
    mesh=bpy.data.meshes.new(name+' weathered');mesh.from_pydata(v,[],f);mesh.update();mesh.materials.append(old.materials[0]);attr=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER');attr.data.foreach_set('color',[v for col in cols for v in col]);obj.data=mesh
rails=bpy.data.objects['Approach timber handrails'].data.color_attributes['Color']
for item in rails.data:
    t=rng.uniform(.23,.31);item.color=(t,t*.96,t*.83,1)
layout={'issue':100,'photo':'images/20190731_104156.jpg','stump':{'centre':[cx,base,cz],'widthEW':1.16,'widthNS':1.55,'height':1.13},'wallReturn':{'from':[4.65,3.36],'to':[6.06,4.04]},'northRail':{'crossOffset':-.70,'along':[-.15,2.65],'height':.93},'limits':'Photo-guided root form, short wall return and planting; flight geometry and controls preserved. Scenic soil, not surveyed terrain. Mottled concrete uses vertex colours only.'}
(ROOT/'authoring/cabin/stair-east-layout.json').write_text(json.dumps(layout,indent=2)+'\n');scene['stair_east_100']=json.dumps(layout)
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'authoring/cabin/cabin.blend'),compress=True)
