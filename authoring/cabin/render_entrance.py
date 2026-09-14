"""Connected entrance inspection, about 20-40 seconds per CPU view."""
import bpy,math
from pathlib import Path
from mathutils import Vector
root=Path(__file__).resolve().parents[2];scene=bpy.context.scene;c,s=math.cos(.318),math.sin(.318)
def local(x,y,z):return Vector((x*c+z*s,x*s-z*c,y))
scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True
scene.render.resolution_x=1200;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.world.use_nodes=True;bg=scene.world.node_tree.nodes['Background'];bg.inputs['Color'].default_value=(.65,.72,.82,1);bg.inputs['Strength'].default_value=.7
light=bpy.data.lights.new('Entrance inspection sun','SUN');light.energy=2;light.angle=.2
sun=bpy.data.objects.new('Entrance inspection sun',light);scene.collection.objects.link(sun);sun.rotation_euler=(.45,-.5,-.8)
for name,eye,target in [('entrance-connected',(7.5,16.5,10),(3.8,10.8,3.5)),('entrance-descending',(9,14.6,5),(2,10.7,2.9))]:
    cam=bpy.data.cameras.new(name);cam.sensor_fit='VERTICAL';cam.angle=math.radians(58)
    obj=bpy.data.objects.new(name,cam);scene.collection.objects.link(obj);obj.location=local(*eye)
    obj.rotation_euler=(local(*target)-obj.location).to_track_quat('-Z','Y').to_euler();scene.camera=obj
    scene.render.filepath=str(root/'data/cabin-blender'/f'{name}.png');bpy.ops.render.render(write_still=True)
