"""Two inspection views for the tapered upper deck and open tree notch.
Run on the saved cabin.blend; output stays under ignored data/cabin-blender.
Approximately 20-40 seconds per view on CPU; no photo-camera solve is claimed.
"""
import bpy,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];scene=bpy.context.scene
c,s=math.cos(.318),math.sin(.318)
def local(x,y,z):return Vector((x*c+z*s,x*s-z*c,y))
scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True
scene.render.resolution_x=1200;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.world.use_nodes=True;bg=scene.world.node_tree.nodes['Background'];bg.inputs['Color'].default_value=(.65,.72,.82,1);bg.inputs['Strength'].default_value=.7
light=bpy.data.lights.new('Upper deck inspection sun','SUN');light.energy=2;light.angle=.2
sun=bpy.data.objects.new('Upper deck inspection sun',light);scene.collection.objects.link(sun);sun.rotation_euler=(.45,-.5,-.8)
for name,eye,target,orthographic in [
    ('upper-deck-angle',(10,19,10),(-2,10.5,2.4),False),
    ('upper-deck-notch',(-12,24,7),(-4.7,10.45,1.0),True)]:
    cam=bpy.data.cameras.new(name);cam.sensor_fit='VERTICAL';cam.angle=math.radians(52)
    if orthographic:cam.type='ORTHO';cam.ortho_scale=12
    obj=bpy.data.objects.new(name,cam);scene.collection.objects.link(obj);obj.location=local(*eye)
    obj.rotation_euler=(local(*target)-obj.location).to_track_quat('-Z','Y').to_euler();scene.camera=obj
    scene.render.filepath=str(ROOT/'data/cabin-blender'/f'{name}.png');bpy.ops.render.render(write_still=True)
