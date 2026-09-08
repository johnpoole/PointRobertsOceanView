import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { box, tint } from "./parts.js";
import { toWorld, fromWorld } from "../geo.js";
import { disposeArea } from "./area-view.js";
import { MARINA_BUILDING as PLAN, marinaBuildingFrame as FRAME, marinaBuildingAerial } from "./marina-building-plan.js";
export function marinaBuildingMerge(parts,parent,name){
  const geometry=mergeGeometries(parts,false);for(const part of parts)part.dispose();
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,side:THREE.DoubleSide}));
  mesh.name=name;parent.add(mesh);return mesh;
}
export function marinaBuildingHeight(sample,p){const q=fromWorld(p.x,p.z);return sample(q.lat,q.lon)}
export function marinaBuildingBox(x0,x1,z0,z1,y,h,color){
  const g=box(x1-x0,z1-z0,h,(x0+x1)/2,y,(z0+z1)/2,color);
  g.rotateY(FRAME.angle);g.translate(FRAME.origin.x,0,FRAME.origin.z);return g;
}
export function marinaBuildingCanopy(floor){
  const g=box(3.45,PLAN.canopyEnd-PLAN.canopyStart,.15,-1.625,0,(PLAN.canopyStart+PLAN.canopyEnd)/2,0x55504b),p=g.attributes.position;
  for(let i=0;i<p.count;i++)p.setY(i,p.getY(i)+floor+2.8+(p.getX(i)+3.35)*.19);
  g.computeVertexNormals();g.rotateY(FRAME.angle);g.translate(FRAME.origin.x,0,FRAME.origin.z);return g;
}
function apron(sample){
  const ring=PLAN.apron.map(p=>marinaBuildingAerial(...p)),faces=THREE.ShapeUtils.triangulateShape(ring.map(p=>new THREE.Vector2(p.x,p.z)),[]),pos=[];
  function tri(a,b,c){const dist=(p,q)=>Math.hypot(p.x-q.x,p.z-q.z),mid=(p,q)=>({x:(p.x+q.x)/2,z:(p.z+q.z)/2});
    if(Math.max(dist(a,b),dist(b,c),dist(c,a))>3){const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);tri(a,ab,ca);tri(ab,b,bc);tri(ca,bc,c);tri(ab,bc,ca);return}
    for(const p of [a,b,c])pos.push(p.x,marinaBuildingHeight(sample,p)+.055,p.z);
  }
  for(const f of faces)tri(...f.map(i=>ring[i]));const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();return tint(g,0x898b84);
}
export function buildMarinaBuildingBase(scene,sample){
  const group=new THREE.Group();group.name="marina-building-base";
  const heights=PLAN.footprint.map(p=>marinaBuildingHeight(sample,toWorld(...p)));
  const floor=Math.max(...heights)+.08,bottom=Math.min(...heights)-.08,w=FRAME.width,l=FRAME.length,h=PLAN.wallHeight,split=PLAN.split;
  const b=(...args)=>marinaBuildingBox(...args),parts=[];
  // Northern service workshop and southern two-storey office/club share one roofline.
  parts.push(b(0,w,0,split,bottom,floor+h-bottom,0xbfc0b7));
  parts.push(b(0,w,split,l,bottom,floor+h-bottom,0xd9dcd5));
  // The southwest glazed corner projects slightly beyond the main west wall.
  parts.push(b(-1.35,.05,l-5,l,floor,6.4,0xdde0d9));
  const building=marinaBuildingMerge(parts,group,"marina-main-building-walls");
  building.userData.landmark={name:"Point Roberts Marina / The Pier",kind:"building"};
  const roofs=[b(-.8,w+.8,-.7,split,floor+h,.16,0x656966),b(-.65,w+.65,split,l+.65,floor+h,.16,0xdde0d8),b(-1.55,.2,l-5.2,l+.3,floor+h,.16,0xe0e1da)];
  roofs.push(marinaBuildingCanopy(floor));
  // Reddish waterside terrace visible beside the canopy and corner windows.
  roofs.push(b(-3.7,0,PLAN.canopyStart,l+3.1,floor-.15,.22,0x997868),b(0,w*.5,l,l+3.1,floor-.15,.22,0x997868));
  marinaBuildingMerge(roofs,group,"marina-building-roofs-and-terrace");
  marinaBuildingMerge([apron(sample)],group,"marina-building-service-apron");
  scene.add(group);return {group,building,floor,bottom,update(){},dispose:()=>disposeArea(group)};
}
