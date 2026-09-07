// Fixed marina structures: webcam appearance, county 2022 aerial placement.
// Dimensions/elevations are estimates; see CONTINUE-webcams.md and #48 / #49.
// These are scene details, not independent controls for camera calibration.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toWorld, fromWorld, headingToYaw } from "../geo.js";
import { box, tint, gableRoof } from "./parts.js";
import { DOCK_PLAN } from "./marina-dock-plan.js";

import { MARINA } from "./marina-layout.js";
export { MARINA, obsoleteMarinaBlock } from "./marina-layout.js";
const WOOD = 0x827b68, DARK = 0x3b413d, ROOF = 0x424e50;
const material = () => new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.9, side: THREE.DoubleSide,
});

function beam(a, b, width, color, depth = width) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const delta = end.clone().sub(start);
  const g = new THREE.BoxGeometry(width, delta.length(), depth);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), delta.normalize()));
  g.translate(...start.add(end).multiplyScalar(0.5).toArray());
  return tint(g, color);
}
function merge(parts, parent, name) {
  const geom = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  const mesh = new THREE.Mesh(geom, material());
  mesh.name = name;
  parent.add(mesh);
  return mesh;
}
function anchor(parent, at, y, heading, name) {
  const w = toWorld(...at);
  const group = new THREE.Group();
  group.name = name;
  group.position.set(w.x, y, w.z);
  group.rotation.y = headingToYaw(heading);
  parent.add(group);
  return group;
}
function roof(parts, w, d, top, rise, color=ROOF) {
  parts.push(gableRoof(w/2, d/2, top, rise, 0.25, color));
  // Standing seams on both slopes, visible in the shelter reference.
  for (let z = -d/2 - 0.2; z <= d/2 + 0.2; z += 0.35) {
    for (const s of [-1, 1]) parts.push(beam(
      [0, top + rise + 0.02, z],
      [s*(w/2 + 0.25), top - rise*0.25/(w/2) + 0.02, z], 0.025, DARK));
  }
}
function hut(parent, at, y, heading, blue = false) {
  const group = anchor(parent, at, y, heading, blue ? 'marina-blue-dock-hut' : 'marina-white-dock-hut');
  const w = blue ? 6.6 : 2.8, d = blue ? 6.0 : 3.4, top = 2.5;
  const parts = [box(w,d,top,0,0,0,blue ? 0x315f89 : 0xd5d7ce)];
  roof(parts,w,d,top,0.5,blue ? 0x776e5b : ROOF);
  // Pale casings and dark glazing; the white hut has a red side door.
  for (const x of [-0.65,0.65]) {
    parts.push(box(0.92,0.05,1.02,x,1.03,d/2+0.03,0xe8e7db));
    parts.push(box(0.74,0.06,0.83,x,1.12,d/2+0.07,0x344b50));
    parts.push(box(0.045,0.07,0.83,x,1.12,d/2+0.11,0xd6dbd6));
  }
  parts.push(box(0.06,0.95,2.05,w/2+0.03,0.03,0,blue ? 0xe1dfd1 : 0xa33e37));
  parts.push(box(0.07,0.50,0.65,w/2+0.07,1.22,0,0x344b50));
  merge(parts,group,group.name+'-mesh');
  return group;
}

export function buildMarina(scene, sample) {
  if (!sample) throw new Error('Marina structures require the ground sampler');
  const root = new THREE.Group(); root.name = 'marina-structures'; scene.add(root);
  const ground = at => sample(...at);
  const shelter = anchor(root,MARINA.shelter,ground(MARINA.shelter),160,'marina-open-shelter');
  const parts = [];
  const w = 5.0, d = 5.0;
  // John confirmed one plane, high at the south and low at the north.
  // Use world south (+Z), accounting for the footprint's 160-degree rotation.
  // The 2.5 m low edge and 0.65 m rise remain visual estimates.
  const yaw=shelter.rotation.y;
  const south=(x,z)=>-Math.sin(yaw)*x+Math.cos(yaw)*z;
  const halfSpan=(Math.abs(Math.sin(yaw))*w+Math.abs(Math.cos(yaw))*d)/2;
  const height=(x,z)=>2.5+0.65*(south(x,z)+halfSpan)/(2*halfSpan);
  for (const x of [-w/2,w/2]) for (const z of [-d/2,d/2]) {
    const top=height(x,z)-0.08, inner=x-Math.sign(x)*0.7;
    parts.push(box(0.18,0.18,top,x,0,z,WOOD));
    parts.push(beam([x,top-0.8,z],[inner,height(inner,z)-0.17,z],0.12,WOOD));
  }
  for (const x of [-w/2,w/2]) parts.push(beam(
    [x,height(x,-d/2)-0.17,-d/2],[x,height(x,d/2)-0.17,d/2],0.18,WOOD));
  for (const z of [-d/2,d/2]) parts.push(beam(
    [-w/2,height(-w/2,z)-0.17,z],[w/2,height(w/2,z)-0.17,z],0.18,WOOD));
  const panel=new THREE.BoxGeometry(w+0.5,0.08,d+0.5);
  const vertices=panel.attributes.position;
  for(let i=0;i<vertices.count;i++) vertices.setY(i,
    vertices.getY(i)+height(vertices.getX(i),vertices.getZ(i))-0.04);
  panel.computeVertexNormals();
  parts.push(tint(panel,ROOF));
  for(let x=-w/2-0.2;x<=w/2+0.2;x+=0.35) parts.push(beam(
    [x,height(x,-d/2-0.25)+0.02,-d/2-0.25],
    [x,height(x,d/2+0.25)+0.02,d/2+0.25],0.025,DARK));
  merge(parts,shelter,'marina-shelter-frame-and-roof');

  const pole = anchor(root,MARINA.flagpole,ground(MARINA.flagpole),0,'marina-flagpole');
  const flagParts = [box(0.5,0.5,0.16,0,0,0,0xb9b8aa)];
  const mast = new THREE.CylinderGeometry(0.035,0.10,13,10);
  mast.translate(0,6.5,0); flagParts.push(tint(mast,0xc7cecf));
  // Static draped US flag: an appearance cue, not a live wind indicator.
  const flagW = 1.85, flagH = 0.98, flagTop = 9.0;
  for (let i=0;i<13;i++) flagParts.push(box(flagW,0.025,flagH/13,
    flagW/2,flagTop-(i+1)*flagH/13,0,i%2 ? 0xe3dfd4 : 0x9d4645));
  flagParts.push(box(flagW*0.4,0.035,flagH*7/13,flagW*0.2,
    flagTop-flagH*7/13,0,0x344661));
  merge(flagParts,pole,'marina-flag-and-mast');

  const deckY = ground(MARINA.pier)+0.12;
  const pier = anchor(root,MARINA.pier,deckY,251,'marina-fixed-pier');
  const pierParts = [box(3.2,10,0.3,0,-0.3,-5,WOOD),box(9,7,0.3,0,-0.3,-13.5,WOOD)];
  const rails = [
    [[-1.6,0],[-1.6,-10]], [[1.6,0],[1.6,-10]],
    [[-4.5,-10],[-1.6,-10]], [[1.6,-10],[4.5,-10]],
    [[-4.5,-10],[-4.5,-17]],
    [[4.5,-10],[4.5,-12.75]], [[4.5,-14.25],[4.5,-17]],
    [[-4.5,-17],[4.5,-17]],
  ];
  for (const [[ax,az],[bx,bz]] of rails) {
    for (const y of [0.5,1.0]) pierParts.push(beam([ax,y,az],[bx,y,bz],0.09,DARK));
    const n = Math.ceil(Math.hypot(bx-ax,bz-az)/2);
    for(let i=0;i<=n;i++) pierParts.push(box(0.12,0.12,1.1,ax+(bx-ax)*i/n,0,az+(bz-az)*i/n,DARK));
  }
  for (const z of [-3,-7,-11,-16]) for (const x of [-1.3,1.3]) {
    pierParts.push(box(0.3,0.3,deckY+2,x,-deckY-2,z,DARK));
  }
  for (const x of [-4.1,4.1]) {
    for (const z of [-11,-16]) pierParts.push(box(0.3,0.3,deckY+2,x,-deckY-2,z,DARK));
    pierParts.push(beam([x,-deckY-1.5,-11],[x,-0.3,-16],0.18,DARK));
    pierParts.push(beam([x,-deckY-1.5,-16],[x,-0.3,-11],0.18,DARK));
  }
  // Thin joints make the deck read as timber without adding separate draw calls.
  for(let z=-16.9;z<0;z+=0.3) pierParts.push(box(z<-10?8.9:3.1,0.018,0.012,0,0.003,z,DARK));
  merge(pierParts,pier,'marina-pier-deck-rails-and-piles');
  hut(root,MARINA.hut,Math.max(deckY,ground(MARINA.hut)),160);

  // Shore-parallel float, dogleg and narrow fuel T; no berth fingers or boats.
  // These decks float. Their guide piles and the shore landing do not.
  const floats = new THREE.Group(); floats.name = 'marina-floating-docks'; root.add(floats);
  const points=Object.fromEntries(Object.entries(DOCK_PLAN.points).map(([k,v])=>[k,toWorld(...v)]));
  const {south:A,north:B,elbow:E,fuelJoin:J,fuelWest:W,fuelEast:F,hut:C,shore:S}=points;
  const floatParts=[], pileParts=[];
  function deck(a,b,width) {
    const length=Math.hypot(b.x-a.x,b.z-a.z), yaw=Math.atan2(b.x-a.x,b.z-a.z);
    const put=g=>{g.rotateY(yaw);g.translate((a.x+b.x)/2,0,(a.z+b.z)/2);floatParts.push(g);};
    // Small overlap at connections keeps a gangway end on the deck despite
    // Float32 rounding of world coordinates and angled adjoining segments.
    put(box(width,length+0.05,0.36,0,-0.36,0,0xa19b88));
    for(const x of [-width/2,width/2]) put(box(0.10,length,0.20,x,-0.30,0,DARK));
    for(let z=-length/2+0.15;z<length/2;z+=0.45) put(box(width-0.1,0.018,0.01,0,0.003,z,0x777463));
  }
  const {mainWidth,elbowWidth,fuelStemWidth,fuelBarWidth}=DOCK_PLAN;
  for(const [a,b,width] of [[A,B,mainWidth],[B,E,elbowWidth],[E,J,fuelStemWidth],[W,F,fuelBarWidth]]) deck(a,b,width);
  // Hut apron is aligned with the fuel crossbar, on its shoreward side.
  const barLength=Math.hypot(F.x-W.x,F.z-W.z);
  const bx=(F.x-W.x)/barLength,bz=(F.z-W.z)/barLength;
  const platformA={x:C.x-bx*4.3,z:C.z-bz*4.3},platformB={x:C.x+bx*4.3,z:C.z+bz*4.3};
  deck(platformA,platformB,8.2);
  function pile(at,top=6) {
    const w=toWorld(...at),bottom=Math.min(-2,sample(...at)-0.5);
    const g=new THREE.CylinderGeometry(0.12,0.16,top-bottom,8);
    g.translate(w.x,(bottom+top)/2,w.z);pileParts.push(tint(g,0x858a7f));
    const cap=new THREE.CylinderGeometry(0.14,0.14,0.15,8);
    cap.translate(w.x,top-0.075,w.z);pileParts.push(tint(cap,0xc7ccbf));
  }
  for(const at of DOCK_PLAN.mainPiles) pile(at);
  // Low guide posts on the fuel dock's outer edge; spacing is approximate.
  for(const t of [0.03,0.26,0.74,0.97]) {
    const x=W.x+(F.x-W.x)*t-bz*(fuelBarWidth/2+0.2);
    const z=W.z+(F.z-W.z)*t+bx*(fuelBarWidth/2+0.2);
    const at=fromWorld(x,z);pile([at.lat,at.lon],4.8);
  }
  merge(floatParts,floats,'marina-float-decks');
  merge(pileParts,root,'marina-fixed-guide-piles');
  const hutHeading=Math.atan2(bz,bx)*180/Math.PI;
  // local X follows the crossbar; the local Z axis is its perpendicular.
  hut(floats,MARINA.fuelHut,0,hutHeading,true);

  const shoreY=ground(DOCK_PLAN.points.shore)+0.12;
  const rampHeading=Math.atan2(B.x-S.x,S.z-B.z)*180/Math.PI;
  const landing=anchor(root,DOCK_PLAN.points.shore,shoreY,rampHeading,'marina-north-landing');
  merge([box(3.4,2.0,0.25,0,-0.25,0,WOOD)],landing,'marina-north-landing-deck');
  function gangwayBetween(name,start,endAt,width) {
    const group=new THREE.Group();group.name=name;root.add(group);
    const span=Math.hypot(start.x-endAt.x,start.z-endAt.z);
    const posts=Math.ceil(span/2.5);
    const unit=[box(width,1,0.15,0,-0.15,0,0x969b96)];
    for(const x of [-width/2,width/2]) {
      for(const y of [0.48,0.96]) unit.push(box(0.07,1,0.07,x,y,0,0x9fa7a5));
      for(let i=0;i<=posts;i++) unit.push(box(0.07,0.07/span,0.96,x,0,-0.5+i/posts,0x9fa7a5));
    }
    merge(unit,group,name+'-deck-and-rails');
    return {group,start,end:new THREE.Vector3(endAt.x,0,endAt.z)};
  }
  pier.updateMatrixWorld(true);
  const start=pier.localToWorld(new THREE.Vector3(4.5,0,-13.5));
  const links=[gangwayBetween('marina-gangway',start,A,1.5),
    gangwayBetween('marina-north-gangway',new THREE.Vector3(S.x,shoreY,S.z),B,DOCK_PLAN.shoreRampWidth)];
  const direction=new THREE.Vector3(),axis=new THREE.Vector3(0,0,1);
  let lastLevel;
  function update(level) {
    if(!Number.isFinite(level)||level===lastLevel)return;
    lastLevel=level; floats.position.y=level+DOCK_PLAN.freeboard;
    for(const {group,start,end} of links) {
      end.y=floats.position.y;direction.subVectors(start,end);
      group.position.copy(start).add(end).multiplyScalar(0.5);
      group.scale.z=direction.length();
      group.quaternion.setFromUnitVectors(axis,direction.normalize());
    }
  }
  update(0);
  return {group:root,floats,pier,gangway:links[0].group,northGangway:links[1].group,update};
}
