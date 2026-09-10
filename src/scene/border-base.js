import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { box,tint } from "./parts.js";
import { fromWorld } from "../geo.js";
import { disposeArea } from "./area-view.js";
import { BORDER as P,borderFrame as F,borderPoint,borderRing,borderPart } from "./border-plan.js";
export const CONCRETE=0x9a9a92,SLAT=0xa9803f,GLASS=0x2d3a3f,STEEL=0x6a6a63,DARK=0x45453f,WHITEROOF=0xc4c4bc,METAL=0x7d8079,PANEL=0x9d7a55;
export function borderTransform(g){g.rotateY(F.angle);g.translate(F.origin.x,0,F.origin.z);return g}
export function borderBox(x0,x1,z0,z1,y,h,color){return borderTransform(box(x1-x0,z1-z0,h,(x0+x1)/2,y,(z0+z1)/2,color))}
export function borderMerge(parts,group,name){const g=mergeGeometries(parts,false);for(const p of parts)p.dispose();const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,side:THREE.DoubleSide}));m.name=name;group.add(m);return m}
export function borderHeight(sample,x,z){const p=borderPoint(x,z),ll=fromWorld(p.x,p.z);return sample(ll.lat,ll.lon)}
function prism(ring,bottom,height,color){const shape=new THREE.Shape(ring.map(p=>new THREE.Vector2(p.x,-p.z))),g=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false});g.rotateX(-Math.PI/2);g.translate(0,bottom,0);return borderTransform(tint(g,color))}
// A roof over four corners given in order, sloping from the ridge that runs
// between the middles of the two end walls. Built from the corners themselves
// because the wing sits a few degrees off the frame and a turned box would miss.
export function slopedRoof(a,b,c,d,wallTop,rise,color){
  const mid=(p,q)=>({x:(p.x+q.x)/2,z:(p.z+q.z)/2}),r1=mid(a,d),r2=mid(b,c),pos=[],
    tri=(p,q,s)=>pos.push(...p,...q,...s),
    at=(p,y)=>[p.x,y,p.z],top=wallTop+rise;
  tri(at(a,wallTop),at(b,wallTop),at(r2,top));tri(at(a,wallTop),at(r2,top),at(r1,top));
  tri(at(d,wallTop),at(r1,top),at(r2,top));tri(at(d,wallTop),at(r2,top),at(c,wallTop));
  tri(at(a,wallTop),at(r1,top),at(d,wallTop));tri(at(b,wallTop),at(c,wallTop),at(r2,top));
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(new Float32Array(pos),3));g.computeVertexNormals();return borderTransform(tint(g,color));
}
export function drape(ring,sample,color,offset){
  const flat=ring.map(p=>new THREE.Vector2(p.x,p.z)),pos=[];
  function tri(a,b,c){const dist=(p,q)=>Math.hypot(p.x-q.x,p.z-q.z),mid=(p,q)=>({x:(p.x+q.x)/2,z:(p.z+q.z)/2});if(Math.max(dist(a,b),dist(b,c),dist(c,a))>4){const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);tri(a,ab,ca);tri(ab,b,bc);tri(ca,bc,c);tri(ab,bc,ca);return}for(const p of [a,b,c])pos.push(p.x,borderHeight(sample,p.x,p.z)+offset,p.z)}
  for(const f of THREE.ShapeUtils.triangulateShape(flat,[]))tri(...f.map(i=>ring[i]));
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();return borderTransform(tint(g,color));
}
// The lanes run north from the canopy toward the line, and the walk stands in
// front of the office glazing.
export const APRON=[{x:-3,z:-15},{x:21,z:-15},{x:21,z:13},{x:-3,z:13}];
export const WALK=[{x:19.6,z:-14},{x:22.4,z:-14},{x:22.4,z:10},{x:19.6,z:10}];
export function buildBorderBase(scene,sample){
  const group=new THREE.Group();group.name="border-base";
  const ground=borderRing.map(p=>borderHeight(sample,p.x,p.z)),
    floor=borderHeight(sample,F.officeEast-4,F.officeNorth+6)+.12,bottom=Math.min(...ground)-.15;
  const building=borderMerge([
    prism(borderPart("office"),bottom,floor+P.officeHeight-bottom,PANEL),
    prism(borderPart("middle"),bottom,floor+P.middleHeight-bottom,PANEL),
    prism(borderPart("wing"),bottom,floor+P.wingHeight-bottom,METAL),
  ],group,"border-walls");
  building.userData.landmark={name:"US Customs and Border Protection — Point Roberts",kind:"building"};
  const roofs=[];
  // The office roof is seamed grey, the middle section white, and the wing takes
  // the ribbed pitch built off its own four corners.
  for(const [part,height,color] of [["office",P.officeHeight,STEEL],["middle",P.middleHeight,WHITEROOF]]){
    const ring=borderPart(part),shape=new THREE.Shape(ring.map(p=>new THREE.Vector2(p.x,-p.z))),
      slab=new THREE.ExtrudeGeometry(shape,{depth:.22,bevelEnabled:false});
    slab.rotateX(-Math.PI/2);slab.translate(0,floor+height,0);roofs.push(borderTransform(tint(slab,color)));
  }
  // White membrane over the north end of the office, with the plant standing on
  // it, which is what the aerial shows and the oblique confirms.
  roofs.push(borderBox(F.letterWest-.2,F.officeEast,F.officeNorth,-2.4,floor+P.officeHeight+.22,.06,WHITEROOF));
  for(const [x,z,w,d,h] of [[27.4,-14.4,2.2,1.5,.9],[30.6,-11.2,1.6,1.2,.7],[27.9,-8.2,2.6,1.8,1.0],[31.4,-5.4,1.4,1.4,.6]])
    roofs.push(borderBox(x-w/2,x+w/2,z-d/2,z+d/2,floor+P.officeHeight+.28,h,0xa8a8a0));
  {
    const r=borderPart("wing");
    roofs.push(slopedRoof(r[0],r[4],r[5],r[9],floor+P.wingHeight,P.wingRise,METAL));
  }
  // The canopy: a deck over the lanes on six posts, with nothing under it.
  {
    const ring=borderPart("canopy"),shape=new THREE.Shape(ring.map(p=>new THREE.Vector2(p.x,-p.z))),
      deck=new THREE.ExtrudeGeometry(shape,{depth:P.canopyFascia,bevelEnabled:false});
    deck.rotateX(-Math.PI/2);deck.translate(0,floor+P.canopyDeck,0);roofs.push(borderTransform(tint(deck,STEEL)));
    for(const [x,z] of P.posts) roofs.push(borderBox(x-.16,x+.16,z-.16,z+.16,floor,P.canopyDeck,DARK));
  }
  borderMerge(roofs,group,"border-roofs-and-canopy");
  borderMerge([drape(APRON,sample,0x53565a,.05),drape(WALK,sample,0xa8a79b,.09)],group,"border-apron");
  scene.add(group);return{group,building,floor,bottom,update(){},dispose:()=>disposeArea(group)};
}
