// One photo-modeled tree, with visible branches and separated foliage clusters.
// Geometry coordinates are world-axis offsets from the corrected site-tree root.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toWorld } from "../geo.js";

export function buildPhotoTree(parent, tree) {
  const shape=tree.shape_override, group=new THREE.Group();group.name='cabin-photo-tree';
  const root=toWorld(tree.lat,tree.lon,tree.ground_m);group.position.set(root.x,root.y,root.z);
  const parts=[],up=new THREE.Vector3(0,1,0);
  function limb(a,b,ra,rb) {
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),dir=end.clone().sub(start);
    const g=new THREE.CylinderGeometry(rb,ra,dir.length(),7,1,false);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up,dir.normalize()));
    g.translate(...start.add(end).multiplyScalar(.5).toArray());parts.push(g);
  }
  for(let i=1;i<shape.trunk.length;i++)limb(shape.trunk[i-1].at,shape.trunk[i].at,shape.trunk[i-1].radius,shape.trunk[i].radius);
  for(const b of shape.branches)limb(b.from,b.to,b.radius,b.radius*.3);
  function mesh(color) {
    const g=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());parts.length=0;
    group.add(new THREE.Mesh(g,new THREE.MeshStandardMaterial({color,roughness:1})));
  }
  mesh(0x514739);
  for(const f of shape.foliage) {
    const g=new THREE.IcosahedronGeometry(1,0);g.scale(...f.scale);g.translate(...f.at);parts.push(g);
  }
  mesh(0x3d5135);parent.add(group);group.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(group),sphere=bounds.getBoundingSphere(new THREE.Sphere());
  const frustum=new THREE.Frustum(),matrix=new THREE.Matrix4();
  return {group,update(camera,show=true) {
    camera.updateMatrixWorld();matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix);
    group.visible=show && camera.position.distanceTo(sphere.center)<2500 && frustum.intersectsSphere(sphere);
  }};
}
