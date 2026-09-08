import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { box, tint } from "./parts.js";
import { fromWorld } from "../geo.js";
import { COMMUNITY, communityPoint, communityRings } from "./community-plan.js";
import { disposeArea } from "./area-view.js";
export function communityMerge(parts,parent,name){
  const g=mergeGeometries(parts,false);for(const p of parts)p.dispose();
  const mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,side:THREE.DoubleSide}));mesh.name=name;parent.add(mesh);return mesh;
}
export function communityHeight(sample,p){const q=fromWorld(p.x,p.z);return sample(q.lat,q.lon)}
export function communityPrism(ring,y,height,color){
  const shape=new THREE.Shape(ring.map(p=>new THREE.Vector2(p.x,-p.z)));
  const g=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false});g.rotateX(-Math.PI/2);g.translate(0,y,0);return tint(g,color);
}
export function communityBeam(a,b,width,height,y,color){const g=box(width,Math.hypot(b.x-a.x,b.z-a.z),height,0,y,0,color);g.rotateY(Math.atan2(b.x-a.x,b.z-a.z));g.translate((a.x+b.x)/2,0,(a.z+b.z)/2);return g}
export function communityDrape(pixels,sample,color,lift=.08,step=5){
  const ring=pixels.map(p=>communityPoint(...p)),faces=THREE.ShapeUtils.triangulateShape(ring.map(p=>new THREE.Vector2(p.x,p.z)),[]),pos=[];
  function tri(a,b,c){const d=(p,q)=>Math.hypot(p.x-q.x,p.z-q.z),mid=(p,q)=>({x:(p.x+q.x)/2,z:(p.z+q.z)/2});
    if(Math.max(d(a,b),d(b,c),d(c,a))>step){const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);tri(a,ab,ca);tri(ab,b,bc);tri(ca,bc,c);tri(ab,bc,ca);return}
    for(const p of [a,b,c])pos.push(p.x,communityHeight(sample,p)+lift,p.z);
  }
  for(const f of faces)tri(...f.map(i=>ring[i]));const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();return tint(g,color);
}
function roofFaces(vertices,faces,color){const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(faces.flatMap(f=>f.flatMap(i=>vertices[i])),3));g.computeVertexNormals();return tint(g,color)}
export function communityHip(a,b,y,rise,color){
  const x=(a.x+b.x)/2,inset=Math.min((b.x-a.x)/2,(b.z-a.z)/2);
  return roofFaces([[a.x,y,a.z],[b.x,y,a.z],[b.x,y,b.z],[a.x,y,b.z],[x,y+rise,a.z+inset],[x,y+rise,b.z-inset]],[[0,1,4],[1,2,5],[1,5,4],[2,3,5],[3,0,4],[3,4,5]],color);
}
// East/west ridge over the library's former garage frontage, with orange gable ends.
function libraryCrossGable(a,b,y,rise){const z=(a.z+b.z)/2,v=[[a.x,y,a.z],[b.x,y,a.z],[b.x,y,b.z],[a.x,y,b.z],[a.x,y+rise,z],[b.x,y+rise,z]];
  return[roofFaces(v,[[0,1,5],[0,5,4],[2,3,4],[2,4,5]],0x6d7165),roofFaces(v,[[0,4,3],[1,2,5]],0xbc633f)];
}
export function buildCommunityBase(scene,sample){
  const group=new THREE.Group();group.name="community-base";const rings=communityRings(),floors={},bottoms={},buildings=[];
  for(const kind of ["center","library"]){const h=rings[kind].map(p=>communityHeight(sample,p));floors[kind]=Math.max(...h)+.08;bottoms[kind]=Math.min(...h)-.08}
  const f=floors.center,l=floors.library;
  const centerParts=[communityPrism(rings.main,bottoms.center,f+5.2-bottoms.center,0x845344),communityPrism(rings.annex,bottoms.center,f+3.5-bottoms.center,0x86574b)];
  const entry=communityPoint(609.5,431);centerParts.push(box(3.5,.32,5.62,entry.x,f,entry.z-.12,0x8d5848));
  const center=communityMerge(centerParts,group,"community-center-walls");center.userData.landmark={name:"Point Roberts Community Center",kind:"building"};buildings.push(center);
  const library=communityMerge([communityPrism(rings.library,bottoms.library,l+3.2-bottoms.library,0xbc633f)],group,"community-library-walls");library.userData.landmark={name:"Point Roberts Library",kind:"building"};buildings.push(library);
  const roofs=[communityPrism(rings.main,f+5.2,.08,0x373d3e),communityPrism(rings.annex,f+3.5,.08,0x434747)];
  // Light parapet caps around the brick building and its lower east annex.
  for(const [ring,y] of [[rings.main,f+5.28],[rings.annex,f+3.58]])for(let i=0;i<ring.length;i++)roofs.push(communityBeam(ring[i],ring[(i+1)%ring.length],.16,.10,y,0xd8dad4));
  roofs.push(box(3.58,.42,.10,entry.x,f+5.62,entry.z-.12,0xd8dad4));
  roofs.push(communityHip(communityPoint(399,450),communityPoint(456,535),l+3.25,2.0,0x74796b));
  roofs.push(...libraryCrossGable(communityPoint(399,428),communityPoint(456,474),l+3.25,2.0));
  for(const [x0,z0,x1,z1] of [[363,436,401,470],[454,437,469,474],[409,533,447,560]]){
    const a=communityPoint(x0,z0),b=communityPoint(x1,z1);roofs.push(box(b.x-a.x,b.z-a.z,.12,(a.x+b.x)/2,l+3.22,(a.z+b.z)/2,0xd5d8d2));
  }
  communityMerge(roofs,group,"community-and-library-roofs");
  communityMerge([communityDrape(COMMUNITY.paving,sample,0x92938c),communityDrape(COMMUNITY.westParking,sample,0x96958c),
    communityDrape(COMMUNITY.sidewalk,sample,0xc2beb1,.18,4),communityDrape(COMMUNITY.playPad,sample,0xc4c1ad,.10,4),
    communityDrape([[465,475],[475,475],[475,540],[557,540],[557,548],[465,548]],sample,0xb6b2a2,.10,4)],group,"community-grounds");
  scene.add(group);return{group,buildings,rings,floors,bottoms,update(){},dispose:()=>disposeArea(group)};
}
