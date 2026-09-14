"""Render the owner's saved south comparison camera, about 20 seconds on CPU.

blender --background authoring/cabin/cabin.blend --python authoring/cabin/render_green_door.py
Camera coordinates and vertical FOV are exact to the supplied link; the 4:3
inspection canvas matches the reference photo, not a claimed camera solve.
"""
import bpy, math, json
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
scene=bpy.context.scene;origin=list(scene['world_origin'])
pose=json.loads((ROOT/'authoring/cabin/green-door-layout.json').read_text())['camera']
def geo(lat,lon,h):
    return Vector(((lon+123.085318)*111320*math.cos(math.radians(48.989009))-origin[0],
                   (lat-48.989009)*111320+origin[2],h-origin[1]))
scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True
scene.render.resolution_x=1200;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.65,.72,.82,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.7
light=bpy.data.lights.new('Inspection sun','SUN');light.energy=2;light.angle=.2
sun=bpy.data.objects.new('Inspection sun',light);scene.collection.objects.link(sun)
sun.rotation_euler=(.49,-.44,-.79)
cam=bpy.data.cameras.new('Owner south comparison');cam.sensor_fit='VERTICAL';cam.angle=math.radians(pose['fov'])
obj=bpy.data.objects.new('Owner south comparison',cam);scene.collection.objects.link(obj)
obj.location=geo(*pose['eye']);obj.rotation_euler=(geo(*pose['aim'])-obj.location).to_track_quat('-Z','Y').to_euler()
scene.camera=obj;scene.render.filepath=str(ROOT/'data/cabin-blender/photo-south-owner.png')
bpy.ops.render.render(write_still=True)
