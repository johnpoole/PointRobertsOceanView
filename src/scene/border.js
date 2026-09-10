import * as THREE from "three";
import { BORDER as P,borderFrame as F,borderPoint } from "./border-plan.js";
import { buildBorderBase,borderBox,borderMerge,borderTransform,borderHeight,drape,
  CONCRETE,SLAT,GLASS,STEEL,DARK } from "./border-base.js";
import { tint } from "./parts.js";
export function buildBorder(scene,sample){
  const model=buildBorderBase(scene,sample),{group,floor}=model,parts=[];
  const b=(x0,x1,z0,z1,y,h,color)=>parts.push(borderBox(x0,x1,z0,z1,floor+y,h,color));
  const north=F.officeNorth,step=F.stepNorth,west=F.canopyEast;
  // The office is board-formed concrete to the west of its front and vertical
  // wood slats to the east of it, and the slats are geometry rather than a
  // photograph stretched over a wall.
  for(let x=F.letterWest+.2;x<F.letterEast-.1;x+=.28) b(x-.05,x+.05,north-.06,north-.01,2.9,P.officeHeight-2.9,SLAT);
  b(F.letterWest,F.letterEast,north-.07,north,2.86,.1,DARK);
  // The glazing: a long band on the step and round the west face over the lanes.
  {
    const [x0,x1]=P.glazing.north;
    b(x0,x1,step-.05,step+.04,.85,2.35,DARK);
    b(x0+.1,x1-.1,step-.02,step+.02,.95,2.15,GLASS);
    for(let x=x0+1.35;x<x1-.5;x+=1.35) b(x-.05,x+.05,step-.06,step+.02,.95,2.15,DARK);
    b(x0,x1,step-.06,step+.02,0,.85,CONCRETE);
  }
  {
    const [z0,z1]=P.glazing.west;
    b(west-.04,west+.05,z0,z1,.85,2.35,DARK);
    b(west-.02,west+.02,z0+.1,z1-.1,.95,2.15,GLASS);
    for(let z=z0+1.35;z<z1-.5;z+=1.35) b(west-.06,west+.02,z-.05,z+.05,.95,2.15,DARK);
    b(west-.06,west+.02,z0,z1,0,.85,CONCRETE);
  }
  // Bollards along the walk, and the low kerb it stands on.
  for(let z=P.glazing.west[0];z<P.glazing.west[1];z+=2.4){
    const g=borderHeight(sample,west+1.5,z)-floor;
    b(west+1.4,west+1.62,z-.11,z+.11,g,.95,0x8c8c84);
  }
  // The flagpole in front of the office, and the light mast behind the canopy.
  {
    const [x,z]=P.flag,g=borderHeight(sample,x,z)-floor;
    b(x-.06,x+.06,z-.06,z+.06,g,10.5,0xdededa);
    b(x+.07,x+1.5,z-.02,z+.02,g+8.6,.78,0xb9313a);
    b(x+.07,x+1.5,z-.03,z+.03,g+8.85,.13,0xe8e6de);
    b(x+.07,x+1.5,z-.03,z+.03,g+9.14,.13,0xe8e6de);
    b(x+.07,x+.68,z-.04,z+.04,g+8.98,.4,0x2c3f75);
  }
  {
    const [x,z]=P.mast,g=borderHeight(sample,x,z)-floor;
    b(x-.13,x+.13,z-.13,z+.13,g,12.2,DARK);
    for(const y of [9.4,11.1]) b(x-1.15,x+1.15,z-.09,z+.09,g+y,.14,DARK);
  }
  // The gates across the lanes: a yellow arm on a yellow post, with the stop
  // plate hanging off it, and a signal head under the canopy above each.
  for(const x of P.gates){
    const z=P.gateZ,g=borderHeight(sample,x,z)-floor;
    b(x-.14,x+.14,z-.14,z+.14,g,1.35,0xd8b13a);
    b(x-.05,x+3.7,z-.06,z+.06,g+1.02,.14,0xd8b13a);
    b(x+1.5,x+2.1,z-.08,z-.02,g+.55,.6,0xb2322c);
    b(x-.18,x+.18,z-.2,z+.2,P.canopyDeck-1.05,.62,DARK);
    b(x-.1,x+.1,z-.22,z-.18,P.canopyDeck-.9,.16,0xb2322c);
    b(x-.1,x+.1,z-.22,z-.18,P.canopyDeck-1.32,.16,0x3f8f4e);
  }
  // Two booths under the canopy, glass over a low base.
  for(const [x,z] of P.booths){
    const g=borderHeight(sample,x,z)-floor;
    b(x-1.05,x+1.05,z-.85,z+.85,g,.95,CONCRETE);
    b(x-1.05,x+1.05,z-.85,z+.85,g+.95,1.75,GLASS);
    b(x-1.1,x+1.1,z-.9,z+.9,g+2.7,.16,DARK);
  }
  borderMerge(parts,group,"border-frontage");
  // The two signs. Both drawn here rather than sampled off a photograph.
  function plate(canvas,x,z,y,width,height,face){
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,height),
      new THREE.MeshStandardMaterial({map:texture,transparent:true,alphaTest:.35,roughness:.9,side:THREE.DoubleSide})),
      p=borderPoint(x,z);
    mesh.position.set(p.x,floor+y,p.z);mesh.rotation.y=F.angle+face;group.add(mesh);
  }
  {
    // POINT ROBERTS, USA, in raised letters low on the concrete.
    const canvas=document.createElement("canvas");canvas.width=1024;canvas.height=176;
    const ctx=canvas.getContext("2d");
    ctx.fillStyle="#5d5d55";ctx.textAlign="center";
    ctx.font="bold 96px Arial, Helvetica, sans-serif";ctx.fillText("POINT ROBERTS, USA",512,120);
    plate(canvas,(F.letterWest+F.letterEast)/2,north-.08,2.05,5.4,.93,Math.PI);
  }
  {
    // The sign standing in the grass by the road, facing the traffic coming in.
    const canvas=document.createElement("canvas");canvas.width=512;canvas.height=384;
    const ctx=canvas.getContext("2d");
    ctx.fillStyle="#f2f1ea";ctx.fillRect(0,0,512,384);
    ctx.fillStyle="#24408e";ctx.textAlign="center";ctx.font="bold 54px Arial, Helvetica, sans-serif";
    for(const [i,line] of ["BE PREPARED TO","SHOW IDENTIFICATION","DECLARE ALL ARTICLES","ACQUIRED OUTSIDE USA"].entries())
      ctx.fillText(line,256,86+i*76);
    const [x,z]=P.sign,g=borderHeight(sample,x,z)-floor;
    plate(canvas,x,z,g+2.35,2.9,2.18,Math.PI);
    parts.length=0;
    for(const dx of [-1.05,1.05]) parts.push(borderBox(x+dx-.08,x+dx+.08,z-.08,z+.08,floor+g,2.4,0x7d6a4f));
    borderMerge(parts,group,"border-sign-posts");
  }
  return model;
}
