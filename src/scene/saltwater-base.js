import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { box,tint,gableRoof } from "./parts.js";
import { fromWorld } from "../geo.js";
import { disposeArea } from "./area-view.js";
import { SALTWATER as P,saltwaterFrame as F,saltwaterPoint,saltwaterRing } from "./saltwater-plan.js";
export function saltwaterTransform(g){g.rotateY(F.angle);g.translate(F.origin.x,0,F.origin.z);return g}
export function saltwaterBox(x0,x1,z0,z1,y,h,color){return saltwaterTransform(box(x1-x0,z1-z0,h,(x0+x1)/2,y,(z0+z1)/2,color))}
export function saltwaterMerge(parts,group,name){const g=mergeGeometries(parts,false);for(const p of parts)p.dispose();const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,side:THREE.DoubleSide}));m.name=name;group.add(m);return m}
export function saltwaterHeight(sample,x,z){const p=saltwaterPoint(x,z),ll=fromWorld(p.x,p.z);return sample(ll.lat,ll.lon)}
function paving(sample){
  const ring=P.forecourt.map(p=>new THREE.Vector2(...p)),pos=[];
  function tri(a,b,c){const dist=(p,q)=>p.distanceTo(q);if(Math.max(dist(a,b),dist(b,c),dist(c,a))>2){const ab=a.clone().add(b).multiplyScalar(.5),bc=b.clone().add(c).multiplyScalar(.5),ca=c.clone().add(a).multiplyScalar(.5);tri(a,ab,ca);tri(ab,b,bc);tri(ca,bc,c);tri(ab,bc,ca);return}for(const p of [a,b,c])pos.push(p.x,saltwaterHeight(sample,p.x,p.y)+.055,p.y)}
  for(const f of THREE.ShapeUtils.triangulateShape(ring,[]))tri(...f.map(i=>ring[i]));const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();return saltwaterTransform(tint(g,0x939286));
}
export function buildSaltwaterBase(scene,sample){
  const group=new THREE.Group();group.name="saltwater-base";
  // Set the entrance at the street-facing ground. The sampled terrain falls
  // behind the café, so the rear walls extend down to meet it.
  const ground=saltwaterRing.map(p=>saltwaterHeight(sample,p.x,p.z)),floor=Math.max(ground[0],ground[5])+.07,bottom=Math.min(...ground)-.08;
  const shape=new THREE.Shape(saltwaterRing.map(p=>new THREE.Vector2(p.x,-p.z))),walls=new THREE.ExtrudeGeometry(shape,{depth:floor+P.wallHeight-bottom,bevelEnabled:false});walls.rotateX(-Math.PI/2);walls.translate(0,bottom,0);
  const building=saltwaterMerge([saltwaterTransform(tint(walls,0xbe703b))],group,"saltwater-walls");building.userData.landmark={name:"Saltwater Café",kind:"building"};
  const roofs=[];
  for(const [x0,x1,z0,z1,rise] of [[0,F.width,0,F.step,P.roofRise],[F.inset,F.width,F.step,F.length,1.2]]){
    const g=gableRoof((x1-x0)/2,(z1-z0)/2,floor+P.wallHeight,rise,.28,0x51534e);g.translate((x0+x1)/2,0,(z0+z1)/2);roofs.push(saltwaterTransform(g));
  }
  // Orange front gable covers the generic roof helper's gray end triangle.
  const triangle=new THREE.BufferGeometry();triangle.setAttribute("position",new THREE.Float32BufferAttribute([0,floor+P.wallHeight,-.012,F.width,floor+P.wallHeight,-.012,F.width/2,floor+P.wallHeight+P.roofRise,-.012],3));triangle.computeVertexNormals();roofs.push(saltwaterTransform(tint(triangle,0xbe703b)));
  saltwaterMerge(roofs,group,"saltwater-gabled-roofs");
  saltwaterMerge([paving(sample)],group,"saltwater-forecourt");
  scene.add(group);return{group,building,floor,bottom,update(){},dispose:()=>disposeArea(group)};
}
