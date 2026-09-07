// Fixed marina structures: webcam appearance, county 2022 aerial placement.
// Dimensions/elevations are estimates; see CONTINUE-webcams.md and issue #48.
// These are scene details, not independent controls for camera calibration.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toWorld, fromWorld, headingToYaw } from "../geo.js";
import { box, tint, gableRoof } from "./parts.js";

export const MARINA = {
  flagpole: [48.97680028, -123.06330009],
  shelter: [48.97700763, -123.06348424],
  hut: [48.97681698, -123.06359653],
  pier: [48.97684450, -123.06362198],
  floatSouth: [48.97687987, -123.06388399],
  floatNorth: [48.97726313, -123.06429422],
  fuelHut: [48.97713145, -123.06447987],
};
const WOOD = 0x827b68, DARK = 0x3b413d, ROOF = 0x424e50;
const material = () => new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.9, side: THREE.DoubleSide,
});

// This baked footprint is a solid block over open water in the 2022 aerial
// and both webcam views. Match only this exact trace, not nearby buildings.
export function obsoleteMarinaBlock(building) {
  const p=building.coords?.[0];
  return p && Math.abs(p[0]-48.9770208)<1e-8 && Math.abs(p[1]+123.0642513)<1e-8;
}

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
function roof(parts, w, d, top, rise) {
  parts.push(gableRoof(w/2, d/2, top, rise, 0.25, ROOF));
  // Standing seams on both slopes, visible in the shelter reference.
  for (let z = -d/2 - 0.2; z <= d/2 + 0.2; z += 0.35) {
    for (const s of [-1, 1]) parts.push(beam(
      [0, top + rise + 0.02, z],
      [s*(w/2 + 0.25), top - rise*0.25/(w/2) + 0.02, z], 0.025, DARK));
  }
}
function hut(parent, at, y, heading, blue = false) {
  const group = anchor(parent, at, y, heading, blue ? 'marina-blue-dock-hut' : 'marina-white-dock-hut');
  const w = blue ? 3.4 : 2.8, d = blue ? 3.6 : 3.4, top = 2.5;
  const parts = [box(w,d,top,0,0,0,blue ? 0x315f89 : 0xd5d7ce)];
  roof(parts,w,d,top,0.5);
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
  const w = 5.0, d = 5.0, eaves = 2.5;
  for (const x of [-w/2,w/2]) for (const z of [-d/2,d/2]) {
    parts.push(box(0.18,0.18,eaves,x,0,z,WOOD));
    parts.push(beam([x,1.65,z],[x-Math.sign(x)*0.7,eaves,z],0.12,WOOD));
  }
  for (const x of [-w/2,w/2]) parts.push(box(0.18,d,0.18,x,eaves-0.18,0,WOOD));
  for (const z of [-d/2,d/2]) parts.push(box(w,0.18,0.18,0,eaves-0.18,z,WOOD));
  roof(parts,w,d,eaves,0.65);
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

  // The long walkway and its fuel-dock branch float. Their guide piles do not.
  const floats = new THREE.Group(); floats.name = 'marina-floating-docks'; root.add(floats);
  const A=toWorld(...MARINA.floatSouth), B=toWorld(...MARINA.floatNorth), C=toWorld(...MARINA.fuelHut);
  const floatParts=[], pileParts=[];
  for (const [a,b,width] of [[A,B,2.2],[B,C,2.5]]) {
    const deck=new THREE.BoxGeometry(width,0.36,Math.hypot(b.x-a.x,b.z-a.z));
    deck.rotateY(Math.atan2(b.x-a.x,b.z-a.z));
    deck.translate((a.x+b.x)/2,-0.18,(a.z+b.z)/2);
    floatParts.push(tint(deck,WOOD));
    const n=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/9);
    for(let i=0;i<=n;i++) {
      const len=Math.hypot(b.x-a.x,b.z-a.z), edge=width/2+0.25;
      const x=a.x+(b.x-a.x)*i/n-(b.z-a.z)/len*edge;
      const z=a.z+(b.z-a.z)*i/n+(b.x-a.x)/len*edge;
      const at=fromWorld(x,z), bottom=Math.min(-2,sample(at.lat,at.lon)-0.5);
      const g=new THREE.CylinderGeometry(0.12,0.16,6-bottom,8);
      g.translate(x,(bottom+6)/2,z); pileParts.push(tint(g,DARK));
    }
  }
  floatParts.push(box(7,6,0.36,C.x,-0.36,C.z,WOOD));
  merge(floatParts,floats,'marina-float-decks');
  merge(pileParts,root,'marina-fixed-guide-piles');
  hut(floats,MARINA.fuelHut,0,160,true);

  // Gangway joins the north side of the fixed pier head to the float's end.
  pier.updateMatrixWorld(true);
  const start=pier.localToWorld(new THREE.Vector3(4.5,0,-13.5));
  const gangway=new THREE.Group(); gangway.name='marina-gangway'; root.add(gangway);
  const unit=[box(1.5,1,0.15,0,-0.15,0,WOOD)];
  for(const x of [-0.75,0.75]) {
    unit.push(box(0.07,1,0.07,x,0.92,0,DARK));
    for(const z of [-0.5,0,0.5]) unit.push(box(0.07,0.035,0.92,x,0,z,DARK));
  }
  merge(unit,gangway,'marina-gangway-deck-and-rails');
  const end=new THREE.Vector3(A.x,0,A.z), direction=new THREE.Vector3();
  let lastLevel;
  function update(level) {
    if(!Number.isFinite(level)||level===lastLevel)return;
    lastLevel=level; floats.position.y=level+0.55;
    end.y=floats.position.y;
    direction.subVectors(start,end);
    gangway.position.copy(start).add(end).multiplyScalar(0.5);
    gangway.scale.z=direction.length();
    gangway.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),direction.normalize());
  }
  update(0);
  return {group:root,floats,pier,gangway,update};
}
