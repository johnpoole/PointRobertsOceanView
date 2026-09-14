"""CPU inspection views of the east wall and hillside, about 20 seconds each."""
import bpy,math
from pathlib import Path
from mathutils import Vector
root=Path(__file__).resolve().parents[2];scene=bpy.context.scene;c,s=math.cos(.318),math.sin(.318)
def local(x,y,z):return Vector((x*c+z*s,x*s-z*c,y))
scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True
scene.render.resolution_x=1200;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.65,.72,.82,1);scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.7
light=bpy.data.lights.new('Wall inspection sun','SUN');light.energy=2;light.angle=.2
sun=bpy.data.objects.new('Wall inspection sun',light);scene.collection.objects.link(sun);sun.rotation_euler=(.45,-.5,-.8)
for name,eye,target,fov in [('photo-passage',(4.1,13.7,5.1),(4.4,11.8,-.4),62),('photo-east-bank',(12,19,10),(5,12.3,0),52)]:
    cam=bpy.data.cameras.new(name);cam.sensor_fit='VERTICAL';cam.angle=math.radians(fov)
    obj=bpy.data.objects.new(name,cam);scene.collection.objects.link(obj);obj.location=local(*eye)
    obj.rotation_euler=(local(*target)-obj.location).to_track_quat('-Z','Y').to_euler();scene.camera=obj
    scene.render.filepath=str(root/'data/cabin-blender'/f'{name}.png');bpy.ops.render.render(write_still=True)
