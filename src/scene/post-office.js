import * as THREE from "three";
import { POST_OFFICE as P,postOfficeFrame as F,postOfficePoint,postOfficeAerial } from "./post-office-plan.js";
import { buildPostOfficeBase,postOfficeBox,postOfficeMerge,postOfficeTransform,postOfficeHeight,drape,TRIM,GLASS } from "./post-office-base.js";
import { tint } from "./parts.js";

// The batten reads as a line of shadow down cream siding rather than as another
// colour: the same paint, one step darker.
const BATTEN=0xd8c795;
export function buildPostOffice(scene,sample){
  const model=buildPostOfficeBase(scene,sample),{group,floor}=model,parts=[];
  const b=(x0,x1,z0,z1,y,h,color)=>parts.push(postOfficeBox(x0,x1,z0,z1,floor+y,h,color));
  const top=P.wallHeight,westTop=P.westHeight;
  // Board and batten: the siding is vertical boards with a batten over every
  // joint, which is geometry rather than a photograph stretched over a wall.
  function battens(x0,x1,z,face,y,h){for(let x=x0+.34;x<x1-.05;x+=.34)b(x-.035,x+.035,z,z+face*.035,y,h,BATTEN)}
  // South wall of the main block, then the two faces of the entrance bay.
  battens(F.mainWest,F.bayWest,F.mainSouth,1,0,top);
  battens(F.bayWest,F.east,F.baySouth,1,0,top);
  battens(F.westX,F.mainWest,F.westSouth,1,0,westTop);
  // The dark band under the eave, the corner boards and the posts either side of
  // the entrance: every one of them is the same brown in both photographs.
  b(F.mainWest,F.bayWest,F.mainSouth-.04,F.mainSouth+.05,top-.34,.34,TRIM);
  b(F.bayWest,F.east,F.baySouth-.04,F.baySouth+.05,top-.34,.34,TRIM);
  b(F.westX,F.mainWest,F.westSouth-.04,F.westSouth+.05,westTop-.3,.3,TRIM);
  b(F.east-.05,F.east+.05,F.north,F.baySouth,top-.34,.34,TRIM);
  for(const x of [F.mainWest,F.bayWest-.12,F.bayWest,F.east-.14]) b(x-.07,x+.07,F.mainSouth-.05,F.mainSouth+.06,0,top,TRIM);
  for(const x of [F.bayWest,F.east-.14]) b(x-.07,x+.07,F.baySouth-.05,F.baySouth+.06,0,top,TRIM);
  // Windows. Dark glass in a cream frame, sills about waist high.
  function window(x0,x1,z,sill,h){
    b(x0,x1,z-.05,z+.06,sill,h,0xd8c795);
    b(x0+.09,x1-.09,z+.02,z+.075,sill+.09,h-.18,GLASS);
  }
  window(...P.window.slice(0,2),F.mainSouth,P.window[2],P.window[3]);
  for(const [x0,x1] of P.bayWindows) window(x0,x1,F.baySouth,.95,1.45);
  // The doors, and the recess they stand in.
  const [d0,d1]=P.doors;
  b(d0,d1,F.baySouth-.02,F.baySouth+.05,0,2.42,TRIM);
  b(d0+.1,d1-.1,F.baySouth+.02,F.baySouth+.07,.06,2.28,GLASS);
  b((d0+d1)/2-.035,(d0+d1)/2+.035,F.baySouth+.02,F.baySouth+.08,.06,2.28,TRIM);
  // Two lamps on the beam over the front, where the photographs show them.
  for(const x of [12.1,15.0,18.9]) b(x-.16,x+.16,F.baySouth-.02,F.baySouth+.22,top-.62,.2,0x3b3129);
  // The bench under the window and the bollard beside the door.
  const [q0,q1]=P.bench,benchY=postOfficeHeight(sample,(q0+q1)/2,F.baySouth+.7)-floor;
  b(q0,q1,F.baySouth+.35,F.baySouth+.86,benchY+.43,.06,0x7fb4d6);
  b(q0,q1,F.baySouth+.33,F.baySouth+.39,benchY+.49,.42,0x7fb4d6);
  for(const x of [q0+.12,q1-.12]) b(x-.04,x+.04,F.baySouth+.4,F.baySouth+.8,benchY,.43,0x7fb4d6);
  b(P.bollard-.09,P.bollard+.09,F.baySouth+.55,F.baySouth+.73,benchY,.92,0xd7b23c);
  // The flagpole and the lamp standard, both off the aerial.
  for(const [pixel,height,thick,colour] of [[P.flagpole,9.2,.07,0xd8d8d2],[P.lamp,6.4,.09,0x3b3129]]){
    const p=postOfficeAerial(...pixel),ground=postOfficeHeight(sample,p.x,p.z)-floor;
    b(p.x-thick,p.x+thick,p.z-thick,p.z+thick,ground,height,colour);
  }
  {
    const p=postOfficeAerial(...P.lamp),ground=postOfficeHeight(sample,p.x,p.z)-floor;
    b(p.x-.14,p.x+.5,p.z-.16,p.z+.16,ground+6.28,.18,0x3b3129);
  }
  {
    const p=postOfficeAerial(...P.flagpole),ground=postOfficeHeight(sample,p.x,p.z)-floor;
    // Stripes, then the canton over them on the hoist half. Each panel stands
    // just clear of the one behind it or the near face is a fight for the pixel.
    b(p.x+.07,p.x+1.28,p.z-.02,p.z+.02,ground+7.35,.64,0xb9313a);
    b(p.x+.07,p.x+1.28,p.z-.03,p.z+.03,ground+7.55,.11,0xe8e6de);
    b(p.x+.07,p.x+1.28,p.z-.03,p.z+.03,ground+7.79,.11,0xe8e6de);
    b(p.x+.07,p.x+.56,p.z-.04,p.z+.04,ground+7.65,.34,0x2c3f75);
  }
  // Lavender along the parking lot, in rows down the bed the aerial shows and
  // the photographs stand in front of.
  const bed=P.bed.map(px=>postOfficeAerial(...px)),x0=Math.min(...bed.map(p=>p.x)),x1=Math.max(...bed.map(p=>p.x)),
    z0=Math.min(...bed.map(p=>p.z)),z1=Math.max(...bed.map(p=>p.z));
  parts.push(drape(P.bed,sample,0x4a3f33,.06));
  let n=0;
  for(let z=z0+.6;z<z1-.3;z+=.95) for(let x=x0+.5;x<x1-.4;x+=.9){
    const g=new THREE.IcosahedronGeometry(1,0),h=.44+(n%3)*.07,ground=postOfficeHeight(sample,x,z);
    g.scale(.34+(n%2)*.06,h/2,.32);g.translate(x,ground+h/2-.05,z);
    parts.push(postOfficeTransform(tint(g,[0x66714f,0x6d6a7c,0x5c6a49][n%3])));n++;
  }
  postOfficeMerge(parts,group,"post-office-frontage");
  // The sign on the gable face. Drawn here rather than sampled off a photograph.
  {
    const canvas=document.createElement("canvas");canvas.width=1024;canvas.height=256;const ctx=canvas.getContext("2d");
    ctx.fillStyle="#3b2f26";ctx.textAlign="center";
    ctx.font="bold 78px Arial, Helvetica, sans-serif";ctx.fillText("UNITED STATES POST OFFICE",560,96);
    ctx.font="bold 58px Arial, Helvetica, sans-serif";ctx.fillText("POINT ROBERTS, WASHINGTON 98281",560,178);
    ctx.fillStyle="#e9e6dc";ctx.fillRect(24,44,132,132);ctx.strokeStyle="#3b2f26";ctx.lineWidth=6;ctx.strokeRect(24,44,132,132);
    ctx.fillStyle="#6f7a86";ctx.beginPath();ctx.moveTo(52,142);ctx.quadraticCurveTo(90,58,128,142);ctx.lineTo(90,120);ctx.closePath();ctx.fill();
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const width=F.east-F.bayWest-1.1,face=new THREE.Mesh(new THREE.PlaneGeometry(width,width/4),
      new THREE.MeshStandardMaterial({map:texture,transparent:true,alphaTest:.35,roughness:.9}));
    const p=postOfficePoint((F.bayWest+F.east)/2-.1,F.baySouth+.08);
        // The wall faces south and a plane faces +Z, so the frame's own angle is the
    // whole of the turn. Half a turn more puts the lettering inside the building.
    face.position.set(p.x,floor+P.wallHeight+.62,p.z);face.rotation.y=F.angle;
    group.add(face);
  }
  return model;
}
