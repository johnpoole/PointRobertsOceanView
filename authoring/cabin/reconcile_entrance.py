"""Issue #101: reconcile entrance, wall and bank from overlapping ground views.
Retire the disconnected scenic bank solids; grade the actual terrain instead.
Run once on #100. Cabin and stair anchors are not changed.
"""
import bpy,json,math,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];scene=bpy.context.scene
if scene.get('entrance_reconciled_101'):raise RuntimeError('Already applied')
c,s=math.cos(.318),math.sin(.318)
model=bpy.data.collections['MODEL - exported cabin and access'];clear=bpy.data.collections['CLEARANCE - edit with walking surfaces']
archive=bpy.data.collections.new('ARCHIVE - rejected separate entrance bank solids');scene.collection.children.link(archive);archive.hide_render=True;archive.hide_viewport=True
retired=['Photo - east bank soil','Photo - east bank brush','Photo - east bank grass',
         'Photo - stair-base wall return','Photo - stair-base soil','Photo - stair-base planting']
for name in retired+['Photo - east bank clearance']:
    obj=bpy.data.objects[name];archive.objects.link(obj)
    for col in list(obj.users_collection):
        if col!=archive:col.objects.unlink(obj)
# The photo-supported original wall, broad stump and lower left rail remain.
g=json.loads((ROOT/'assets/terrain/meta_fine.json').read_text())['grid'];raw=(ROOT/'assets/terrain/heightmap_fine.bin').read_bytes()
def world(x,y,z):return [x*c+z*s-34.17,y,-x*s+z*c-7.03]
def survey(x,z):
    wx,_,wz=world(x,0,z);lat=48.989009-wz/111320;lon=-123.085318+wx/(111320*math.cos(math.radians(48.989009)))
    r=(g['north_lat']-lat)/g['cellsize_deg'];j=(lon-g['west_lon'])/g['cellsize_deg'];i=int(r);k=int(j);u=j-k;t=r-i
    def h(a,b):return struct.unpack_from('<h',raw,(a*g['ncols']+b)*2)[0]*g['scale_m']
    return (h(i,k)*(1-u)+h(i,k+1)*u)*(1-t)+(h(i+1,k)*(1-u)+h(i+1,k+1)*u)*t
# Photos establish a retained bank immediately east of the wall, and the stair
# cut to its south. Interior grade estimates blend back to the survey uphill.
xs=[4.94,5.7,7.3,9.5];zs=[-2.995,-1.5,0,1.5,2.7,3.395]
rows=[]
for z in zs:
    crest=11.85 if z<-.9 else 12.05 if z<.9 else 12.25
    row=[]
    for x in xs:
        t=(x-xs[0])/(xs[-1]-xs[0]);y=(crest-.04)*(1-t)+survey(xs[-1],z)*t
        row.append([x,y,z])
    rows.append(row)
triangles=[]
for j in range(len(zs)-1):
    for i in range(len(xs)-1):
        a,b,d,e=rows[j][i],rows[j][i+1],rows[j+1][i],rows[j+1][i+1]
        triangles.extend([[world(*p) for p in [a,b,e]],[world(*p) for p in [a,e,d]]])
scene['entrance_grade']=json.dumps({'triangles':triangles,'fade':1.0})
# Record connected routes at the existing 10.45m level. These are verification
# lines, not newly invented paths or landing extensions.
layout={'issue':101,'photos':['images/20190731_104156.jpg','images/PXL_20211108_174949325.MP.jpg','images/Photos-1-001/PXL_20211108_175009151.jpg','images/PXL_20211108_175012789.jpg','images/Photos-1-001/PXL_20260808_202937782.MP.jpg'],
 'video':'frames 051-068 reviewed for final descent and cabin/deck context; 22-25s pan excluded as route evidence; video ends above the landing',
 'retired':retired,'level':10.45,'routes':[[[6.25,4.835],[4.385,3.85],[3.05,3.85],[2.45,3.05],[1.9,2.6]],[[4.385,3.85],[3.81,3.85],[3.81,4.28]],[[3.81,3.85],[3.81,2.9],[3.81,1.8]]],
 'bank':{'x':xs,'z':zs,'heights':[[p[1] for p in row] for row in rows]},
 'limits':'Ground-photo topology and existing anchors retained. Bank grade between wall and survey is estimated; no new survey or recovered camera pose. Landing connections were already level; removed unsupported scenic solids rather than relocating confirmed stairs.'}
(ROOT/'authoring/cabin/entrance-layout.json').write_text(json.dumps(layout,indent=2)+'\n');scene['entrance_reconciled_101']=json.dumps(layout)
# Bank is no longer an exported mesh. Keep the wall plan as provenance, but
# mark the former bank mesh record superseded by the terrain grade.
p=ROOT/'authoring/cabin/east-wall-layout.json';wall=json.loads(p.read_text());wall['bankSupersededBy']=101;p.write_text(json.dumps(wall,indent=2)+'\n')
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'authoring/cabin/cabin.blend'),compress=True)
