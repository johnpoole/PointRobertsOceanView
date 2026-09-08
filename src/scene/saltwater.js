import * as THREE from "three";
import { box,tint } from "./parts.js";
import { SALTWATER as P,saltwaterFrame as F,saltwaterPoint } from "./saltwater-plan.js";
import { buildSaltwaterBase,saltwaterBox,saltwaterMerge,saltwaterTransform,saltwaterHeight } from "./saltwater-base.js";
export function buildSaltwater(scene,sample){
  const model=buildSaltwaterBase(scene,sample),{group,floor}=model,parts=[],blue=0x31536b,trim=0xd8d7bf,glass=0x364c50;
  const b=(x0,x1,z0,z1,y,h,color)=>parts.push(saltwaterBox(x0,x1,z0,z1,floor+y,h,color));
  function window(x0,x1,y,h,n){b(x0,x1,-.09,-.01,y,h,trim);b(x0+.08,x1-.08,-.115,-.095,y+.08,h-.16,glass);for(let i=1;i<n;i++){const x=x0+(x1-x0)*i/n;b(x-.03,x+.03,-.14,-.12,y,h,trim)}b(x0,x1,-.14,-.12,y+h*.72,.05,trim)}
  window(.45,3.15,.7,1.65,3);window(5.65,F.width-.45,.7,1.65,3);
  b(3.65,5.3,-.07,.02,.08,2.3,blue);window(3.82,4.95,.2,2.02,1);
  for(const x of [.12,3.38,5.4,F.width-.12])b(x-.075,x+.075,-.13,.02,0,3,blue);
  // Horizontal siding is geometry, so no building photo is used as a texture.
  for(let y=.15;y<3;y+=.20)b(.05,F.width-.05,-.018,-.012,y,.012,0x9c552f);
  // Blue verge boards follow the observed low front gable.
  for(const side of [-1,1]){
    const a=new THREE.Vector3(side<0?-.28:F.width+.28,floor+P.wallHeight-.085,-.31),c=new THREE.Vector3(F.width/2,floor+P.wallHeight+P.roofRise,-.31),g=box(.14,.15,a.distanceTo(c),0,0,0,blue);
    g.translate(0,-a.distanceTo(c)/2,0);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),c.clone().sub(a).normalize()));g.translate(...a.clone().add(c).multiplyScalar(.5).toArray());parts.push(saltwaterTransform(g));
  }
  // Sparse representative seating/three turquoise parasols, visible May 2023.
  for(const [x,z] of P.tables){const y=saltwaterHeight(sample,x,z);
    parts.push(saltwaterBox(x-.65,x+.65,z-.4,z+.4,y+.72,.08,0x6d7777),saltwaterBox(x-.05,x+.05,z-.05,z+.05,y,.73,blue));
    for(const s of [-1,1]){parts.push(saltwaterBox(x-.26,x+.26,z+s*.83-.23,z+s*.83+.23,y+.42,.08,blue),saltwaterBox(x-.04,x+.04,z+s*.83-.04,z+s*.83+.04,y,.42,blue));}
    const umbrella=new THREE.ConeGeometry(1.45,.42,8,1,true);umbrella.translate(x,y+2.45,z);parts.push(saltwaterTransform(tint(umbrella,0x61bdcc)),saltwaterBox(x-.035,x+.035,z-.035,z+.035,y+.8,1.65,0x657175));
  }
  const [sx,sz]=P.sign,sy=saltwaterHeight(sample,sx,sz);parts.push(saltwaterBox(sx-.06,sx+.06,sz-.06,sz+.06,sy,2.15,blue));
  saltwaterMerge(parts,group,"saltwater-frontage-and-patio");
  function sign(x,z,y,w,h,roadside=false){
    const canvas=document.createElement("canvas");canvas.width=512;canvas.height=256;const ctx=canvas.getContext("2d");
    ctx.fillStyle="#e1e4db";ctx.beginPath();ctx.ellipse(256,128,251,122,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#456c7e";ctx.lineWidth=7;ctx.stroke();
    ctx.fillStyle="#3d6475";ctx.textAlign="center";ctx.font="bold 47px Georgia, serif";ctx.fillText("SALTWATER",256,120);ctx.font="bold 35px Georgia, serif";ctx.fillText("CAFÉ",256,170);
    ctx.strokeStyle="#7993a0";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(212,61);ctx.quadraticCurveTo(232,48,253,61);ctx.quadraticCurveTo(274,74,295,61);ctx.stroke();
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const geo=new THREE.PlaneGeometry(w,h),mat=new THREE.MeshStandardMaterial({map:texture,transparent:true,alphaTest:.3,roughness:.9});
    for(const side of roadside?[-1,1]:[-1]){const face=new THREE.Mesh(geo,mat),p=saltwaterPoint(x,z+side*.09);face.position.set(p.x,y,p.z);face.rotation.y=F.angle+(side<0?Math.PI:0);group.add(face)}
  }
  sign(F.width/2,-.18,floor+3.33,2.3,1.10);sign(sx,sz,sy+2.12,1.5,1.35,true);
  return model;
}
