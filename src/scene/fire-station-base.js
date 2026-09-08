import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { box,tint,gableRoof } from "./parts.js";
import { fromWorld } from "../geo.js";
import { disposeArea } from "./area-view.js";
import { FIRE_STATION as P,fireStationFrame as F,fireStationPoint,fireStationRing,fireStationWings,fireStationDoors,fireStationAerial } from "./fire-station-plan.js";
export function fireStationTransform(g){g.translate(F.origin.x,0,F.origin.z);return g}
export function fireStationBox(x0,x1,z0,z1,y,h,color){return fireStationTransform(box(x1-x0,z1-z0,h,(x0+x1)/2,y,(z0+z1)/2,color))}
export function fireStationMerge(parts,group,name){const g=mergeGeometries(parts,false);for(const p of parts)p.dispose();const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,side:THREE.DoubleSide}));m.name=name;group.add(m);return m}
export function fireStationHeight(sample,x,z){const p=fireStationPoint(x,z),ll=fromWorld(p.x,p.z);return sample(ll.lat,ll.lon)}
function prism(ring,bottom,height){const shape=new THREE.Shape(ring.map(p=>new THREE.Vector2(p.x,-p.z))),g=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false});g.rotateX(-Math.PI/2);g.translate(0,bottom,0);return fireStationTransform(tint(g,0xb7b9b2))}
function roof(x0,x1,z0,z1,y,rise,across=false){const w=across?z1-z0:x1-x0,d=across?x1-x0:z1-z0,g=gableRoof(w/2,d/2,y,rise,.55,0x474d50),c=new THREE.Color(0xb7b9b2),a=g.attributes.color;
  // The helper's last two triangles close the gables; they carry siding color.
  for(let i=a.count-6;i<a.count;i++)a.setXYZ(i,c.r,c.g,c.b);
  if(across)g.rotateY(Math.PI/2);g.translate((x0+x1)/2,0,(z0+z1)/2);return fireStationTransform(g);
}
function drape(pixels,sample,color,offset){const ring=pixels.map(p=>fireStationAerial(...p)),flat=ring.map(p=>new THREE.Vector2(p.x,p.z)),pos=[];
  function tri(a,b,c){const dist=(p,q)=>Math.hypot(p.x-q.x,p.z-q.z),mid=(p,q)=>({x:(p.x+q.x)/2,z:(p.z+q.z)/2});if(Math.max(dist(a,b),dist(b,c),dist(c,a))>3){const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);tri(a,ab,ca);tri(ab,b,bc);tri(ca,bc,c);tri(ab,bc,ca);return}for(const p of [a,b,c])pos.push(p.x,fireStationHeight(sample,p.x,p.z)+offset,p.z)}
  for(const f of THREE.ShapeUtils.triangulateShape(flat,[]))tri(...f.map(i=>ring[i]));const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();return fireStationTransform(tint(g,color));
}
export function buildFireStationBase(scene,sample){
  const group=new THREE.Group();group.name="fire-station-base";
  const ground=fireStationRing.map(p=>fireStationHeight(sample,p.x,p.z)),floor=Math.max(...fireStationDoors.map(d=>fireStationHeight(sample,d.x,d.z)))+.10,bottom=Math.min(...ground)-.12,rings=fireStationWings();
  const building=fireStationMerge([prism(rings.low,bottom,floor+P.lowHeight-bottom),prism(rings.high,bottom,floor+P.highHeight-bottom)],group,"fire-station-walls");building.userData.landmark={name:"Station 58 / Point Roberts Fire Department",kind:"building"};
  const roofs=[roof(0,F.split,F.north,F.front,floor+P.lowHeight,P.lowRise,true),
    roof(F.bayWest,F.bayEast,(F.north+F.front)/2,F.length,floor+P.lowHeight,P.lowRise),
    roof(F.split,F.width,F.highNorth,F.front,floor+P.highHeight,P.highRise),
    fireStationBox(fireStationRing[11].x,F.split,-.25,F.north+.3,floor+P.lowHeight,.12,0x474d50)];
  // Red doors remain readable in the distant silhouette as well as close detail.
  for(const d of fireStationDoors)roofs.push(fireStationBox(d.x-d.width/2,d.x+d.width/2,d.z+.025,d.z+.06,floor+.08,d.height,0xb6232e));
  fireStationMerge(roofs,group,"fire-station-roofs-and-bays");
  fireStationMerge([drape(P.apron,sample,0x727777,.055),drape(P.concrete,sample,0xaaa99a,.075)],group,"fire-station-apron");
  scene.add(group);return{group,building,floor,bottom,update(){},dispose:()=>disposeArea(group)};
}
