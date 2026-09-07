// Distant marina silhouette. Uses the same mapped deck/hut positions, without
// close-up rails, piles, joints, glazing or roof seams. No detailed-module import.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toWorld, headingToYaw } from "../geo.js";
import { box, tint, gableRoof } from "./parts.js";
import { MARINA } from "./marina-layout.js";
import { DOCK_PLAN } from "./marina-dock-plan.js";
import { disposeArea } from "./area-view.js";

export function buildMarinaBase(scene, sample) {
  const group = new THREE.Group(); group.name = "marina-base";
  const floats = new THREE.Group(); group.add(floats);
  const fixed = [], floating = [];
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  function place(parts, at, y, heading, into) {
    const p = toWorld(...at);
    for (const geometry of parts) {
      geometry.rotateY(headingToYaw(heading)); geometry.translate(p.x, y, p.z); into.push(geometry);
    }
  }
  function mesh(parts, parent) {
    const geometry = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    const result = new THREE.Mesh(geometry, material); parent.add(result); return result;
  }
  const wood = 0x827b68, roof = 0x424e50;
  const deckY = sample(...MARINA.pier) + 0.12;
  place([box(3.2,10,0.3,0,-0.3,-5,wood), box(9,7,0.3,0,-0.3,-13.5,wood)], MARINA.pier, deckY, 251, fixed);
  const points = Object.fromEntries(Object.entries(DOCK_PLAN.points).map(([k, at]) => [k, toWorld(...at)]));
  const { south:A, north:B, elbow:E, fuelJoin:J, fuelWest:W, fuelEast:F, hut:C, shore:S } = points;
  function deck(a,b,width) {
    const geometry = box(width,Math.hypot(b.x-a.x,b.z-a.z)+0.05,0.36,0,-0.36,0,0xa19b88);
    geometry.rotateY(Math.atan2(b.x-a.x,b.z-a.z));
    geometry.translate((a.x+b.x)/2,0,(a.z+b.z)/2); floating.push(geometry);
  }
  for (const [a,b,width] of [[A,B,DOCK_PLAN.mainWidth],[B,E,DOCK_PLAN.elbowWidth],
    [E,J,DOCK_PLAN.fuelStemWidth],[W,F,DOCK_PLAN.fuelBarWidth]]) deck(a,b,width);
  const length = Math.hypot(F.x-W.x,F.z-W.z), bx=(F.x-W.x)/length, bz=(F.z-W.z)/length;
  deck({x:C.x-bx*4.3,z:C.z-bz*4.3},{x:C.x+bx*4.3,z:C.z+bz*4.3},8.2);
  for (const [at,y,heading,w,d,color,into,roofColor] of [
    [MARINA.hut,Math.max(deckY,sample(...MARINA.hut)),160,2.8,3.4,0xd5d7ce,fixed,roof],
    [MARINA.fuelHut,0,Math.atan2(bz,bx)*180/Math.PI,6.6,6,0x315f89,floating,0x776e5b]]) {
    place([box(w,d,2.5,0,0,0,color),gableRoof(w/2,d/2,2.5,0.5,0.25,roofColor)],at,y,heading,into);
  }
  // Keep the owner-confirmed single roof slope: world south is the high edge.
  const yaw=headingToYaw(160), halfSpan=(Math.abs(Math.sin(yaw))+Math.abs(Math.cos(yaw)))*2.5;
  const height=(x,z)=>2.5+0.65*(-Math.sin(yaw)*x+Math.cos(yaw)*z+halfSpan)/(2*halfSpan);
  const panel = new THREE.BoxGeometry(5.5,0.08,5.5), vertices=panel.attributes.position;
  for (let i=0;i<vertices.count;i++) vertices.setY(i,vertices.getY(i)+height(vertices.getX(i),vertices.getZ(i))-0.04);
  panel.computeVertexNormals();
  const shelter=[tint(panel,roof)];
  for (const x of [-2.5,2.5]) for (const z of [-2.5,2.5]) shelter.push(box(.18,.18,height(x,z)-.08,x,0,z,wood));
  place(shelter,MARINA.shelter,sample(...MARINA.shelter),160,fixed);
  place([box(.12,.12,13,0,0,0,0xc7cecf)],MARINA.flagpole,sample(...MARINA.flagpole),0,fixed);
  const shoreY=sample(...DOCK_PLAN.points.shore)+.12;
  place([box(3.4,2,.25,0,-.25,0,wood)],DOCK_PLAN.points.shore,shoreY,Math.atan2(B.x-S.x,S.z-B.z)*180/Math.PI,fixed);
  mesh(fixed,group); mesh(floating,floats);
  const pierOrigin=toWorld(...MARINA.pier,deckY);
  const start=new THREE.Vector3(4.5,0,-13.5).applyAxisAngle(new THREE.Vector3(0,1,0),headingToYaw(251))
    .add(new THREE.Vector3(pierOrigin.x,pierOrigin.y,pierOrigin.z));
  const links = [[start,A,1.5],[new THREE.Vector3(S.x,shoreY,S.z),B,DOCK_PLAN.shoreRampWidth]].map(([start,end,width]) => ({
    start, end:new THREE.Vector3(end.x,0,end.z), mesh:mesh([box(width,1,.15,0,-.15,0,0x969b96)],group) }));
  const axis=new THREE.Vector3(0,0,1), direction=new THREE.Vector3();
  let lastLevel;
  function update(level) {
    if (!Number.isFinite(level) || level===lastLevel) return;
    lastLevel=level; floats.position.y=level+DOCK_PLAN.freeboard;
    for (const link of links) {
      link.end.y=floats.position.y; direction.subVectors(link.start,link.end);
      link.mesh.position.copy(link.start).add(link.end).multiplyScalar(.5);
      link.mesh.scale.z=direction.length();
      link.mesh.quaternion.setFromUnitVectors(axis,direction.normalize());
    }
  }
  update(0); scene.add(group);
  return { group, floats, links, update, dispose: () => disposeArea(group) };
}
