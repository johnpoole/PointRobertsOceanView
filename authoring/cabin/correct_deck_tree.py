"""Issue #97: correct the site tree and shallow notch on the current source.

Run with Blender on cabin.blend. Preserve the rejected coordinates as provenance;
the live Three scene reads the corrected row from assets/site/389-trees.json.
"""
import bpy,json,math,struct,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];scene=bpy.context.scene
if scene.get('deck_tree_correction_97'):raise RuntimeError('Correction already applied')
if not scene.get('upper_deck_correction_96'):raise RuntimeError('Requires the existing upper deck model')
path=ROOT/'assets/site/389-trees.json';data=json.loads(path.read_text())
tree=next((t for t in data['trees'] if t.get('id')=='cabin-deck-tree'),None)
if tree is None:
    tree=next(t for t in data['trees'] if t['lat']==48.9890535 and t['lon']==-123.0858436)
original=tree.get('position_override',{}).get('original',
    {k:tree[k] for k in ['lat','lon','ground_m']})
plan=json.loads((ROOT/'authoring/cabin/upper-deck-layout.json').read_text())
x=plan['notch']['west']+.15;z=plan['tree']['z'];c,s=math.cos(.318),math.sin(.318)
wx=x*c+z*s-34.17;wz=-x*s+z*c-7.03
lat=48.989009-wz/111320;lon=-123.085318+wx/(111320*math.cos(math.radians(48.989009)))
# The relocated trunk must meet the bank. Sample the original fine elevation
# file, not the deck's lowered clearance grid. Crown dimensions stay unchanged.
meta=json.loads((ROOT/'assets/terrain/meta_fine.json').read_text());g=meta['grid']
raw=(ROOT/'assets/terrain/heightmap_fine.bin').read_bytes()
r=(g['north_lat']-lat)/g['cellsize_deg'];col=(lon-g['west_lon'])/g['cellsize_deg'];i=math.floor(r);j=math.floor(col);u=col-j;v=r-i
assert 0<=i<g['nrows']-1 and 0<=j<g['ncols']-1
def h(a,b):return struct.unpack_from('<h',raw,(a*g['ncols']+b)*2)[0]*g['scale_m']
ground=(h(i,j)*(1-u)+h(i,j+1)*u)*(1-v)+(h(i+1,j)*(1-u)+h(i+1,j+1)*u)*v
tree.update(id='cabin-deck-tree',lat=lat,lon=lon,ground_m=round(ground,4))
tree['position_override']={'issue':97,'date':'2026-09-14','photo':'images/PXL_20220615_171325558.jpg',
    'original':original,'method':'Owner identifies trunk barely inside upper deck edge. Estimated centre 0.15m inside west edge; north/south position retained. Ground resampled from original fine terrain at corrected position.',
    'limits':'Photo-guided placement, not a surveyed trunk position. Original crown height/radius retained.'}
data['position_override_note']='The cabin-deck-tree row has an owner/photo correction (#97). Preserve its override and original values when refreshing the lidar bake.'
path.write_text(json.dumps(data,indent=2)+'\n')
runpy.run_path(str(ROOT/'authoring/cabin/refine_upper_deck.py'),init_globals={'CORRECT_DECK_TREE_97':True})
