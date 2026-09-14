"""Issue #98: narrower decks and one sparse tree leaning seaward.
Run on current cabin.blend. Geometry and root/shape data remain photo estimates.
"""
import bpy,json,math,struct,runpy
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];scene=bpy.context.scene
if scene.get('deck_width_tree_98'):raise RuntimeError('Already applied')
if not scene.get('deck_tree_correction_97'):raise RuntimeError('Requires shallow notch correction')
c,s=math.cos(.318),math.sin(.318);wall=-3.235
def point(x,y,z):return Vector((x*c+z*s,x*s-z*c,y))
def local(p):return Vector((p.x*c+p.y*s,p.z,p.x*s-p.y*c))
def world_offset(x,y,z):return [x*c+z*s,y,-x*s+z*c]
def coords(x,z):
    p=point(x,0,z)
    return 48.989009+(p.y+7.03)/111320,-123.085318+(p.x-34.17)/(111320*math.cos(math.radians(48.989009)))
g=json.loads((ROOT/'assets/terrain/meta_fine.json').read_text())['grid'];raw=(ROOT/'assets/terrain/heightmap_fine.bin').read_bytes()
def ground(x,z):
    lat,lon=coords(x,z);r=(g['north_lat']-lat)/g['cellsize_deg'];col=(lon-g['west_lon'])/g['cellsize_deg'];i=math.floor(r);j=math.floor(col);u=col-j;v=r-i
    assert 0<=i<g['nrows']-1 and 0<=j<g['ncols']-1
    def h(a,b):return struct.unpack_from('<h',raw,(a*g['ncols']+b)*2)[0]*g['scale_m']
    return (h(i,j)*(1-u)+h(i,j+1)*u)*(1-v)+(h(i+1,j)*(1-u)+h(i+1,j+1)*u)*v

# Narrow the lower seaward projection with the upper one, keeping it just
# inside the upper rim. Cabin walls and both fixed access flights stay in place.
factor=(2.1-(wall-2.1))/(2.1-(wall-3.2))
def narrow(x):return 2.1+(x-2.1)*factor
for name in ['Lower deck and lattice','Cabin clearance 03','Cabin clearance 04']:
    obj=bpy.data.objects[name];inv=obj.matrix_world.inverted()
    for v in obj.data.vertices:
        x,y,z=local(obj.matrix_world@v.co);v.co=inv@point(narrow(x),y,z)
    obj.data.update()
# Move the door bay with the revised lower rim without narrowing the door.
layout_path=ROOT/'authoring/cabin/green-door-layout.json';door_layout=json.loads(layout_path.read_text());door=door_layout['door']
oldx,oldz,olda=door['x'],door['z'],door['angle'];newx=oldx+1.10
west=wall-2.1;newa=math.atan2(2.75,2.1-west);newz=4.305+(newx-west)*2.75/(2.1-west)-.14
angle=newa-olda;ca,sa=math.cos(angle),math.sin(angle)
for name in ['Photo - underdeck storage door','Photo - underdeck storage frame','Photo - underdeck storage panels',
             'Photo - storage threshold','Photo - storage enclosure','Photo - storage entrance apron',
             'Photo - storage side lattice','Photo - storage rock shelf','Photo - storage apron clearance']:
    obj=bpy.data.objects[name];inv=obj.matrix_world.inverted()
    for v in obj.data.vertices:
        x,y,z=local(obj.matrix_world@v.co);dx,dz=x-oldx,z-oldz
        v.co=inv@point(newx+ca*dx-sa*dz,y,newz+sa*dx+ca*dz)
    obj.data.update()
obj=bpy.data.objects['Photo - lower enclosure return'];obj.location+=point(1.10,0,0)
door.update(x=newx,z=newz,angle=newa)
door_layout['widthCorrection98']='Door width retained; bay follows narrowed lower deck (2.1m projection).'
layout_path.write_text(json.dumps(door_layout,indent=2)+'\n')

tree_path=ROOT/'assets/site/389-trees.json';data=json.loads(tree_path.read_text());tree=next(t for t in data['trees'] if t.get('id')=='cabin-deck-tree')
plan=json.loads((ROOT/'authoring/cabin/upper-deck-layout.json').read_text());tz=plan['tree']['z'];contact_x=wall-2.4+.15
lean=math.tan(math.radians(6));rootx=contact_x+.5
for _ in range(8):rootx=contact_x+lean*(10.45-ground(rootx,tz))
base=ground(rootx,tz);lat,lon=coords(rootx,tz);height=tree['height_m']
shape={'source':'Owner images/20190112_130800.jpg; sparse leaning tree, dimensions and branch layout estimated',
       'lean_degrees':6,'deckContactOffset':world_offset(-lean*(10.45-base),10.45-base,0),
       'trunk':[],'branches':[],'foliage':[]}
nodes=[(0,0,0),(10.45-base,0,0),(9,.10,.06),(13,-.18,-.08),(17,.13,.10),(height,-.08,-.04)]
for h,dx,dz in sorted(nodes):
    shape['trunk'].append({'at':world_offset(-lean*h+dx,h,dz),'radius':.456*(1-.9*h/height)})
def trunk_at(h):
    for a,b in zip(sorted(nodes),sorted(nodes)[1:]):
        if a[0]<=h<=b[0]:
            t=(h-a[0])/(b[0]-a[0]);return (-lean*h+a[1]*(1-t)+b[1]*t,h,a[2]*(1-t)+b[2]*t)
# Uneven, forked limbs retain open sky between small clusters. The photo shows
# a bare low branch and foliage farther out, not a stack of horizontal boughs.
for i,(h,reach,dz,dy) in enumerate([(7.2,2.8,-.9,-.3),(9.1,2.1,1.7,.9),(11.8,2.9,-1.6,.4),(14.3,1.8,1.1,-.6),
                                   (16.1,2.3,-1.4,1.2),(18.8,1.4,1.5,.7),(20.2,1.6,-1.2,-.1),(21.9,.9,.8,.6)]):
    start=trunk_at(h);elbow=(start[0]-reach*.52,h+dy*.25-.12,start[2]+dz*.35)
    tip=(start[0]-reach,h+dy,start[2]+dz);fork=(start[0]-reach*.68,h+dy+.65,start[2]+dz*.4-(-1)**i*.65)
    radius=.085*(1-i*.08)
    for a,b,r in [(start,elbow,radius),(elbow,tip,radius*.65),(elbow,fork,radius*.42)]:
        shape['branches'].append({'from':world_offset(*a),'to':world_offset(*b),'radius':r})
    # The lowest limb is almost bare; clusters become a little fuller aloft.
    for j,at in enumerate([tip,fork]):
        size=(.45 if i==0 else 1)*(.85+(i%3)*.13)
        shape['foliage'].append({'at':world_offset(*at),'scale':[(.64+.11*j)*size,(.28+.09*(i%2))*size,(.48+.1*((i+j)%3))*size]})
tree['placement_history']=tree.get('placement_history',[])+[{'issue':97,'lat':tree['lat'],'lon':tree['lon'],'ground_m':tree['ground_m']}]
tree.update(lat=lat,lon=lon,ground_m=base,shape_override=shape)
tree['position_override']['issue']=98
tree['position_override']['method']='Narrower deck: root fitted to original fine terrain; 6-degree seaward lean puts trunk centre 0.15m inside new upper rim at deck height. Photo-guided estimate.'
tree_path.write_text(json.dumps(data,indent=2)+'\n')
runpy.run_path(str(ROOT/'authoring/cabin/refine_upper_deck.py'),init_globals={'REFINE_WIDTH_TREE_98':True})

# Render the exact same authored skeleton and foliage data as the web tree.
context=bpy.data.collections['CONTEXT - deck tree'];old=bpy.data.objects['Deck tree reference - not exported']
old.name='Archived vertical trunk #97';old.hide_render=True;old.hide_viewport=True
origin=point(rootx,base,tz);objects=[]
def p(v):return origin+Vector((v[0],-v[2],v[1]))
bark=bpy.data.materials.new('Photo tree bark');bark.diffuse_color=(.08,.065,.045,1)
leaves=bpy.data.materials.new('Photo tree sparse foliage');leaves.diffuse_color=(.047,.082,.035,1)
def adopt(obj,mat):
    for col in list(obj.users_collection):col.objects.unlink(obj)
    context.objects.link(obj);obj.data.materials.append(mat);objects.append(obj)
def branch(a,b,ra,rb):
    a,b=p(a),p(b);d=b-a
    bpy.ops.mesh.primitive_cone_add(vertices=7,radius1=ra,radius2=rb,depth=d.length,location=(a+b)/2)
    obj=bpy.context.object;obj.rotation_euler=d.to_track_quat('Z','Y').to_euler();adopt(obj,bark)
for a,b in zip(shape['trunk'],shape['trunk'][1:]):branch(a['at'],b['at'],a['radius'],b['radius'])
for b in shape['branches']:branch(b['from'],b['to'],b['radius'],b['radius']*.3)
for f in shape['foliage']:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=p(f['at']))
    obj=bpy.context.object;obj.scale=(f['scale'][0],f['scale'][2],f['scale'][1]);adopt(obj,leaves)
bpy.ops.object.select_all(action='DESELECT')
for obj in objects:obj.select_set(True)
bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();bpy.context.object.name='Deck tree reference - not exported'
scene['deck_width_tree_98']=json.dumps({'upperProjection':2.4,'lowerProjection':2.1,'leanDegrees':6,'photo':'images/20190112_130800.jpg'})
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'authoring/cabin/cabin.blend'),compress=True)
