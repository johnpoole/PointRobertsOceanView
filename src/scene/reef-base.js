import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { box, tint } from "./parts.js";
import { fromWorld } from "../geo.js";
import { REEF, reefPoint, reefFootprints } from "./reef-plan.js";
import { disposeArea } from "./area-view.js";
import { reefSignParts, positionReefSign } from "./reef-sign.js";

export function reefMerge(parts,parent,name) {
  const geometry=mergeGeometries(parts,false);for(const p of parts)p.dispose();
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,side:THREE.DoubleSide}));
  mesh.name=name;parent.add(mesh);return mesh;
}
export function reefHeight(sample,p) {const ll=fromWorld(p.x,p.z);return sample(ll.lat,ll.lon)}
export function reefBeam(a,b,width,height,bottom,color) {
  const g=box(width,Math.hypot(b.x-a.x,b.z-a.z),height,0,bottom,0,color);
  g.rotateY(Math.atan2(b.x-a.x,b.z-a.z));g.translate((a.x+b.x)/2,0,(a.z+b.z)/2);return g;
}
function prism(ring,bottom,height,color) {
  const shape=new THREE.Shape(ring.map(p=>new THREE.Vector2(p.x,-p.z)));
  const g=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false});
  g.rotateX(-Math.PI/2);g.translate(0,bottom,0);return tint(g,color);
}
function drape(pixels,sample,color) {
  const ring=pixels.map(p=>reefPoint(...p)),flat=ring.map(p=>new THREE.Vector2(p.x,p.z));
  const faces=THREE.ShapeUtils.triangulateShape(flat,[]),pos=[];
  function tri(a,b,c) {
    const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
    if(Math.max(distance(a,b),distance(b,c),distance(c,a))>5) {
      const mid=(a,b)=>({x:(a.x+b.x)/2,z:(a.z+b.z)/2});
      const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);
      tri(a,ab,ca);tri(ab,b,bc);tri(ca,bc,c);tri(ab,bc,ca);return;
    }
    for(const p of [a,b,c])pos.push(p.x,reefHeight(sample,p)+.055,p.z);
  }
  for(const f of faces)tri(...f.map(i=>ring[i]));
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();return tint(g,color);
}
export function buildReefBase(scene,sample) {
  const group=new THREE.Group();group.name="reef-base";
  const rings=reefFootprints();
  // Heights are visual estimates; the ground comes from the application's sampler.
  const floor=Math.max(...[...rings.main,...rings.west].map(p=>reefHeight(sample,p)))+.08;
  const walls=[prism(rings.main,floor,4.15,0xb7ae96),prism(rings.west,floor,3.30,0x9c9786)];
  const building=reefMerge(walls,group,"reef-walls");
  building.userData.landmark={name:"Kiniski's Reef",kind:"building"};
  const roofs=[prism(rings.main,floor+4.15,.10,0x424540),prism(rings.west,floor+3.30,.10,0x545851)];
  // White sloped street canopy over the red sign band, confirmed by exterior photo.
  const a=reefPoint(578,442),b=reefPoint(778,459);
  const width=b.x-a.x,depth=b.z-a.z;
  const canopy=new THREE.BoxGeometry(width,.10,depth),v=canopy.attributes.position;
  for(let i=0;i<v.count;i++)v.setY(i,v.getY(i)+3.48+.70*(.5-v.getZ(i)/depth));
  canopy.computeVertexNormals();canopy.translate((a.x+b.x)/2,floor,(a.z+b.z)/2);
  roofs.push(tint(canopy,0xdadbd2),box(width,.12,.68,(a.x+b.x)/2,floor+2.80,b.z,0xb92e47));
  reefMerge(roofs,group,"reef-roofs-and-canopy");
  reefMerge([drape(REEF.paving,sample,0x8f9089),drape(REEF.patio,sample,0xaca999),drape(REEF.lawn,sample,0x748451)],group,"reef-grounds");
  // The patio is open. Its fence is not another wall-and-roof building volume.
  const fence=REEF.fence.map(p=>reefPoint(...p));
  const fenceY=Math.max(...fence.map(p=>reefHeight(sample,p)));
  reefMerge([reefBeam(...fence,.12,1.4,fenceY,0x9e5a32)],group,"reef-patio-fence");
  const roadsideSign=new THREE.Group();roadsideSign.name="reef-roadside-sign";
  reefMerge(reefSignParts(),roadsideSign,"reef-sign-cabinet-post-base");
  positionReefSign(roadsideSign,reefHeight(sample,reefPoint(...REEF.sign))+.06);group.add(roadsideSign);
  scene.add(group);
  return {group,floor,building,rings,update(){},dispose:()=>disposeArea(group)};
}
