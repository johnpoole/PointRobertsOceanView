import bpy,math
from pathlib import Path
from mathutils import Vector
root=Path.cwd(); scene=bpy.context.scene
c,s=math.cos(.318),math.sin(.318)
def local(x,y,z): return Vector((x*c+z*s,x*s-z*c,y))
scene.render.engine='CYCLES'
scene.cycles.device='CPU'
scene.cycles.samples=12
scene.cycles.use_denoising=True
scene.render.resolution_x=1280;scene.render.resolution_y=720
scene.render.resolution_percentage=100
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.65,.72,.82,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.7
light=bpy.data.lights.new('Inspection sun','SUN');light.energy=2.0;light.angle=.2
sun=bpy.data.objects.new('Inspection sun',light);scene.collection.objects.link(sun)
sun.rotation_euler=(math.radians(28),math.radians(-25),math.radians(-45))
scene.view_settings.view_transform='AgX'
for name,eye,target in [
 ('video-shed',(22.0,19.2,8.4),(20.0,18.0,5.8)),
 ('video-junction',(17.7,16.83,7.85),(12.43,13.15,5.075)),
 ('video-route-plan',(17.5,36,7),(17.5,13,7)),
 ('photo-south',(-9,7.5,15),(-1,9,3)),
 ('photo-passage',(4.1,12.5,4.4),(3.9,11.8,-1.0))]:
    cam=bpy.data.cameras.new(name);cam.sensor_fit='VERTICAL';cam.angle=math.radians(58)
    if name=='video-route-plan':cam.type='ORTHO';cam.ortho_scale=18
    obj=bpy.data.objects.new(name,cam);scene.collection.objects.link(obj)
    obj.location=local(*eye)
    obj.rotation_euler=(local(*target)-obj.location).to_track_quat('-Z','Y').to_euler()
    scene.camera=obj;scene.render.filepath=str(root/'data/cabin-blender'/f'{name}.png')
    bpy.ops.render.render(write_still=True)
