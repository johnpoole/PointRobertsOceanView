"""Refresh Blender's terrain reference from verify.mjs after a geometry export.

The web terrain remains authoritative. This changes only the authoring reference.
Export again afterward to update the source hash stored in the GLB.
"""
import hashlib
import json
import math
from pathlib import Path
import bpy

root=Path(__file__).resolve().parents[2]
data=json.loads((root/'data/cabin-blender/current-terrain.json').read_text())
asset=root/'assets/site/389-cabin.glb'
if data['assetSha256']!=hashlib.sha256(asset.read_bytes()).hexdigest():
    raise RuntimeError('Terrain reference is stale; run verify.mjs first')
g=data['grid']; heights=data['heights']
obj=bpy.data.objects['Cleared terrain reference']
for v in obj.data.vertices:
    wx=v.co.x-34.17; wz=-v.co.y-7.03
    lat=48.989009-wz/111320
    lon=-123.085318+wx/(111320*math.cos(math.radians(48.989009)))
    r=(g['north_lat']-lat)/g['cellsize_deg']; col=(lon-g['west_lon'])/g['cellsize_deg']
    i=max(0,min(g['nrows']-2,math.floor(r))); j=max(0,min(g['ncols']-2,math.floor(col)))
    u=max(0,min(1,col-j)); t=max(0,min(1,r-i))
    a,b=heights[i*g['ncols']+j:i*g['ncols']+j+2]
    c,d=heights[(i+1)*g['ncols']+j:(i+1)*g['ncols']+j+2]
    v.co.z=(1-t)*(a*(1-u)+b*u)+t*(c*(1-u)+d*u)
obj.data.update()
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath,compress=True)
print('Refreshed',len(obj.data.vertices),'authoring terrain vertices from the actual app clearance')
