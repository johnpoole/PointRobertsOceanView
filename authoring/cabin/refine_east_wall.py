"""Issue #99: one-time wall/bank refinement on the saved #98 Blender source.

Owner photo PXL_20211108_175012789.jpg supplies wall and hill evidence only.
Dimensions, stump shape and planting are visual estimates; cabin is unchanged.
"""
import bpy, math, json, random
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2];scene=bpy.context.scene
if scene.get('east_wall_99'):raise RuntimeError('Already applied; edit saved source')
model=bpy.data.collections['MODEL - exported cabin and access']
clear=bpy.data.collections['CLEARANCE - edit with walking surfaces']
paint=bpy.data.materials['Cabin vertex colours'];rng=random.Random(99)
c,s=math.cos(.318),math.sin(.318);groups={}
def point(x,y,z):return (x*c+z*s,x*s-z*c,y)
def face(name,pts,color):
    g=groups.setdefault(name,{'v':[],'f':[],'col':[]});n=len(g['v'])
    g['v'] += [point(*p) for p in pts];g['f'].append(list(range(n,n+len(pts))))
    g['col'] += [(*color,1)]*len(pts)
def box(name,x0,x1,z0,z1,y0,y1,color):
    p=[(x0,y0,z0),(x1,y0,z0),(x1,y0,z1),(x0,y0,z1),(x0,y1,z0),(x1,y1,z0),(x1,y1,z1),(x0,y1,z1)]
    for ids in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:face(name,[p[i] for i in ids],color)
def limb(name,a,b,ra,rb,color,sides=6):
    a,b=Vector(a),Vector(b);d=(b-a).normalized();u=d.cross(Vector((0,0,1)))
    if u.length<.01:u=d.cross(Vector((0,1,0)))
    u.normalize();v=d.cross(u);rings=[]
    for end,r in [(a,ra),(b,rb)]:rings.append([end+r*(u*math.cos(k*2*math.pi/sides)+v*math.sin(k*2*math.pi/sides)) for k in range(sides)])
    for k in range(sides):
        tone=1+rng.uniform(-.15,.15);face(name,[rings[0][k],rings[0][(k+1)%sides],rings[1][(k+1)%sides],rings[1][k]],tuple(tone*t for t in color))
    face(name,rings[0],color);face(name,list(reversed(rings[1])),tuple(t*.65 for t in color))

# Continuous complete courses replace the noisy lidar-driven towers. The
# uphill setback is 25 mm per 200 mm course; the lowest face stays off boards.
z0,z1=-2.995,3.395;base=10.25
def courses(z):return 8 if z<-.9 else 9 if z<.9 else 10
def crest(z):return base+courses(z)*.2
for row in range(10):
    z=z0-(row%2)*.2
    while z<z1:
        a,b=max(z,z0),min(z+.4,z1);mid=(a+b)/2
        if row<courses(mid) and b-a>.02:
            x=4.46+row*.025;y=base+row*.2;t=rng.uniform(.235,.34)
            box('East retaining blocks',x,x+.38,a+.004,b-.004,y+.003,y+.197,(t,t*1.015,t*.95))
            # Small irregular surface patches break up uniform block faces.
            for k in range(2):
                zz=rng.uniform(a+.02,b-.02);yy=y+rng.uniform(.035,.16);w=min(.07,(b-a)*.18)
                col=(.13,.16,.095) if rng.random()<.55 else (.38,.385,.345)
                face('Photo - east wall weathering',[(x-.002,yy,zz-w),(x-.002,yy+.035,zz-w*.5),(x-.002,yy+.022,zz+w),(x-.002,yy-.008,zz+w*.6)],col)
        z+=.4

# A local non-walking bank skin joins the wall crest to the actual cleared
# terrain. It is exported model geometry; original elevation tiles stay intact.
terrain=json.loads((ROOT/'data/cabin-blender/current-terrain.json').read_text());grid=terrain['grid'];heights=terrain['heights']
def ground(x,z):
    bx,by,_=point(x,0,z);lat=48.989009+(by+7.03)/111320;lon=-123.085318+(bx-34.17)/(111320*math.cos(math.radians(48.989009)))
    r=(grid['north_lat']-lat)/grid['cellsize_deg'];j=(lon-grid['west_lon'])/grid['cellsize_deg'];i=int(r);k=int(j);t=r-i;u=j-k;n=grid['ncols']
    return (heights[i*n+k]*(1-u)+heights[i*n+k+1]*u)*(1-t)+(heights[(i+1)*n+k]*(1-u)+heights[(i+1)*n+k+1]*u)*t
xs=[5.08,5.5,6,6.6,7.3,8,8.8,9.5];zs=[z0,-2.2,-1.4,-.6,.2,1,1.8,2.6,z1]
def bank(x,z):
    t=max(0,min(1,(x-xs[0])/(xs[-1]-xs[0])))
    # End edges blend back into existing ground, keeping the final stair open.
    blend=min(1,max(0,(z-z0)/.65),max(0,(z1-z)/.65))
    profile=crest(z)-.04+(ground(xs[-1],z)-crest(z)+.04)*t+.25*math.sin(t*math.pi)
    return ground(x,z)*(1-blend)+profile*blend
bankpoints=[[Vector((x,bank(x,z),z)) for x in xs] for z in zs]
ceilings=[]
for j in range(len(zs)-1):
    for i in range(len(xs)-1):
        p=[bankpoints[j][i],bankpoints[j][i+1],bankpoints[j+1][i+1],bankpoints[j+1][i]]
        for ids in [(0,1,2),(0,2,3)]:
            pts=[p[k] for k in ids];t=rng.uniform(.85,1.13)
            face('Photo - east bank soil',pts,(.15*t,.135*t,.085*t))
            y=min(v.y for v in pts)-.08
            ceilings.append([(v.x,y,v.z) for v in pts])
# Close the bank's edge behind the stepped wall; no open crack into the hill.
for j in range(len(zs)-1):
    a,b=zs[j:j+2]
    face('Photo - east bank soil',[(4.82,crest(a)-.04,a),(5.08,bank(5.08,a),a),(5.08,bank(5.08,b),b),(4.82,crest(b)-.04,b)],(.16,.145,.095))

# Bleached, split stump/root buttresses sitting on the bank above the wall.
wood=(.34,.33,.29);hub=(5.65,13.05,1.05)
limb('Photo - east bank stump',hub,(6.40,13.90,.7),.44,.32,wood,9)
for tip,r in [((4.78,12.35,1.7),.22),((4.95,12.12,.15),.18),((5.15,12.3,2.1),.15),((6.65,13.25,1.75),.16),((5.9,12.7,-.05),.15)]:
    limb('Photo - east bank stump',hub,tip,.26,r,wood,7)
# Long splinters make the exposed end uneven rather than a flat cut log.
for k in range(7):
    a=k*math.tau/7;p=(6.4+math.cos(a)*.27,13.9+math.sin(a)*.27,.7)
    limb('Photo - east bank stump',p,(p[0]+rng.uniform(.12,.4),p[1]+rng.uniform(.1,.45),p[2]+rng.uniform(-.16,.16)),.065,.009,wood,5)

def leaf(at,size,color):
    x,y,z=at;a=rng.random()*math.tau;dx=math.cos(a)*size;dz=math.sin(a)*size
    face('Photo - east bank brush',[(x-dx,y,z-dz),(x-dz*.42,y+size*.3,z+dx*.42),(x+dx,y,z+dz),(x+dz*.42,y-size*.15,z-dx*.42)],color)
for k in range(58):
    x=rng.uniform(5.2,9.15);z=rng.uniform(-2.75,3.05);y=bank(x,z)
    height=rng.uniform(.35,1.3);tip=(x+rng.uniform(-.2,.2),y+height,z+rng.uniform(-.2,.2))
    limb('Photo - east bank brush',(x,y,z),tip,.012,.004,(.13,.105,.065),4)
    for j in range(3):
        h=height*(.35+j*.2);a=(x,y+h,z);b=(x+rng.uniform(-.35,.35),y+h+.2,z+rng.uniform(-.4,.4))
        limb('Photo - east bank brush',a,b,.006,.002,(.15,.12,.065),4)
        for u in [.4,.7,1]:
            at=tuple(a[i]*(1-u)+b[i]*u for i in range(3));leaf(at,rng.uniform(.05,.12),rng.choice([(.14,.19,.065),(.23,.245,.07),(.09,.14,.055)]))
for k in range(32):
    x=rng.uniform(5.15,8.8);z=rng.uniform(-2.8,3);y=bank(x,z)
    for j in range(7):
        a=rng.random()*math.tau;dx=math.cos(a)*rng.uniform(.1,.25);dz=math.sin(a)*rng.uniform(.1,.25)
        face('Photo - east bank grass',[(x-.012,y,z),(x+.012,y,z),(x+dx,y+rng.uniform(.15,.4),z+dz)],(.18,.21,.07))

def weather_stump(obj):
    """Long split-grain strips distinguish bleached wood from smooth concrete."""
    mesh=obj.data;verts=[];faces=[];colors=[];wood_rng=random.Random(199)
    for poly in mesh.polygons:
        p=[mesh.vertices[i].co.copy() for i in poly.vertices]
        if len(p)==4:
            for k in range(5):
                a,b=k/5,(k+1)/5
                q=[p[0].lerp(p[1],a),p[0].lerp(p[1],b),p[3].lerp(p[2],b),p[3].lerp(p[2],a)]
                # Narrow darker grooves and varied pale fibres along the limb.
                t=wood_rng.uniform(.16,.43) if k%2 else wood_rng.uniform(.32,.49)
                n=len(verts);verts.extend(q);faces.append(list(range(n,n+4)));colors.extend([(t,t*.98,t*.9,1)]*4)
        else:
            n=len(verts);verts.extend(p);faces.append(list(range(n,n+len(p))));colors.extend([(.19,.17,.13,1)]*len(p))
    new=bpy.data.meshes.new('Weathered split root fibres');new.from_pydata(verts,[],faces);new.update()
    col=new.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER');col.data.foreach_set('color',[x for rgba in colors for x in rgba])
    new.materials.append(bpy.data.materials['Cabin vertex colours']);obj.data=new

def seal_bank(obj,rows):
    # Carving has a transition margin. Bury the perimeter skirt below that
    # margin so the scenic soil never reads as a floating sheet at its edge.
    ring=rows[0]+[r[-1] for r in rows[1:]]+list(reversed(rows[-1][:-1]))+[r[0] for r in reversed(rows[1:-1])]
    mesh=obj.data;v=[p.co.copy() for p in mesh.vertices];f=[list(p.vertices) for p in mesh.polygons]
    colors=[tuple(a.color) for a in mesh.color_attributes['Color'].data]
    for a,b in zip(ring,ring[1:]+ring[:1]):
        n=len(v);v.extend([point(*a),point(*b),point(b[0],b[1]-2.5,b[2]),point(a[0],a[1]-2.5,a[2])]);f.append([n,n+1,n+2,n+3]);colors.extend([(.145,.13,.085,1)]*4)
    new=bpy.data.meshes.new('East bank with buried edge');new.from_pydata(v,[],f);new.update()
    col=new.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER');col.data.foreach_set('color',[x for rgba in colors for x in rgba]);new.materials.append(bpy.data.materials['Cabin vertex colours']);obj.data=new

for name,g in groups.items():
    old=bpy.data.objects.get(name)
    if old:bpy.data.objects.remove(old,do_unlink=True)
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(g['v'],[],g['f']);mesh.update()
    attr=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER');attr.data.foreach_set('color',[v for col in g['col'] for v in col])
    mesh.materials.append(paint);obj=bpy.data.objects.new(name,mesh);model.objects.link(obj)
    if name=='East retaining blocks':
        mod=obj.modifiers.new('Worn block edges','BEVEL');mod.width=.008;mod.segments=1
    if name=='Photo - east bank stump':weather_stump(obj)
    if name=='Photo - east bank soil':seal_bank(obj,bankpoints)
mesh=bpy.data.meshes.new('East bank clearance');mesh.from_pydata([point(*p) for tri in ceilings for p in tri],[],[[i*3,i*3+1,i*3+2] for i in range(len(ceilings))]);mesh.update()
obj=bpy.data.objects.new('Photo - east bank clearance',mesh);clear.objects.link(obj);obj.display_type='WIRE'
layout={'issue':99,'photo':'images/PXL_20211108_175012789.jpg','wall':{'base':base,'course':.2,'blockLength':.4,'setbackPerCourse':.025,'passageFace':4.46,'north':z0,'south':z1,'courseCounts':[8,9,10]},'bank':{'x':xs,'z':zs,'heights':[[v.y for v in row] for row in bankpoints]},'limits':'Photo-guided dimensions and planting; non-walking bank skin is visual geometry, not a new elevation survey. Historical cabin appearance is excluded.'}
(ROOT/'authoring/cabin/east-wall-layout.json').write_text(json.dumps(layout,indent=2)+'\n');scene['east_wall_99']=json.dumps(layout)
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'authoring/cabin/cabin.blend'),compress=True)
