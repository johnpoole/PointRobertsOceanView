"""East-facing view from just below the retained flight; approximate camera."""
import bpy,math
from pathlib import Path
from mathutils import Vector
root=Path(__file__).resolve().parents[2];scene=bpy.context.scene;c,s=math.cos(.318),math.sin(.318)
def local(x,y,z):return Vector((x*c+z*s,x*s-z*c,y))
scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True
scene.render.resolution_x=1200;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.7
light=bpy.data.lights.new('Stair east sun','SUN');light.energy=2;light.angle=.2
sun=bpy.data.objects.new('Stair east sun',light);scene.collection.objects.link(sun);sun.rotation_euler=(.45,-.5,-.8)
cam=bpy.data.cameras.new('Stair east photo comparison');cam.sensor_fit='VERTICAL';cam.angle=math.radians(65)
obj=bpy.data.objects.new('Stair east photo comparison',cam);scene.collection.objects.link(obj);obj.location=local(4.5,12.1,5.2)
obj.rotation_euler=(local(7.8,12.7,3.2)-obj.location).to_track_quat('-Z','Y').to_euler();scene.camera=obj
scene.render.filepath=str(root/'data/cabin-blender/photo-stair-east.png');bpy.ops.render.render(write_still=True)
