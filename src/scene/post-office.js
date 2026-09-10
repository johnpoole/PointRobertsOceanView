import * as THREE from "three";
import { POST_OFFICE as P,postOfficeFrame as F,postOfficePoint,postOfficeAerial } from "./post-office-plan.js";
import { buildPostOfficeBase,postOfficeBox,postOfficeMerge,postOfficeTransform,postOfficeHeight,drape,TRIM,GLASS } from "./post-office-base.js";
import { box,tint } from "./parts.js";

// The batten reads as a line of shadow down cream siding rather than as another
// colour: the same paint, one step darker.
const BATTEN=0xd8c795;

// The panel under the trim line reads a shade lighter and greyer than the
// boards above it.
const WAINSCOT=0xd9cfae;
export function buildPostOffice(scene,sample){
  const model=buildPostOfficeBase(scene,sample),{group,floor}=model,parts=[];
  const b=(x0,x1,z0,z1,y,h,color)=>parts.push(postOfficeBox(x0,x1,z0,z1,floor+y,h,color));
  const top=P.wallHeight,westTop=P.westHeight;
  // Board and batten: the siding is vertical boards with a batten over every
  // joint, which is geometry rather than a photograph stretched over a wall.
  function battens(x0,x1,z,face,y,h){for(let x=x0+.34;x<x1-.05;x+=.34)b(x-.035,x+.035,z,z+face*.035,y,h,BATTEN)}
  // The front west of the porch: board and batten above a trim line about waist
  // high, with the panel under it a shade lighter, the length of the wall.
  battens(F.mainWest,F.bayWest,F.mainSouth,1,P.wainscot,top-P.wainscot);
  battens(F.westX,F.mainWest,F.westSouth,1,P.wainscot,westTop-P.wainscot);
  for(const [x0,x1,z,h] of [[F.mainWest,F.bayWest,F.mainSouth,top],[F.westX,F.mainWest,F.westSouth,westTop]]){
    b(x0,x1,z-.02,z+.045,0,P.wainscot-.07,WAINSCOT);
    b(x0,x1,z-.035,z+.055,P.wainscot-.07,.09,TRIM);
    b(x0,x1,z-.04,z+.05,h-.34,.34,TRIM);
  }
  for(const x of [F.mainWest,F.bayWest-.1]) b(x-.07,x+.07,F.mainSouth-.05,F.mainSouth+.06,0,top,TRIM);
  b(F.east-.05,F.east+.05,F.north,F.mainSouth,top-.34,.34,TRIM);
  // One window on that wall, set high.
  {
    const [x0,x1,sill,h]=P.window;
    b(x0,x1,F.mainSouth-.05,F.mainSouth+.06,sill,h,0xd8c795);
    b(x0+.09,x1-.09,F.mainSouth+.02,F.mainSouth+.075,sill+.09,h-.18,GLASS);
  }
  // The porch. The roof and its gable stand 1.81 m forward of the wall on two
  // posts, and everything else here happens underneath it.
  const porch=F.baySouth,wall=F.mainSouth;
  for(const x of P.posts) b(x-.09,x+.09,porch-.2,porch-.02,0,top,TRIM);
  b(F.bayWest,F.east,porch-.2,porch-.04,top-.36,.36,TRIM);
  // The front under the porch is glass, sill low, in bays between cream piers.
  for(const [x0,x1] of P.glazing){
    b(x0-.1,x1+.1,wall-.05,wall+.06,P.sill-.12,2.62,0xd8c795);
    b(x0,x1,wall+.01,wall+.07,P.sill,2.38,GLASS);
  }
  // The door at the east end of the run.
  const [d0,d1]=P.doors;
  b(d0,d1,wall-.02,wall+.06,0,2.5,TRIM);
  b(d0+.1,d1-.1,wall+.02,wall+.08,.06,2.34,GLASS);
  b((d0+d1)/2-.035,(d0+d1)/2+.035,wall+.03,wall+.09,.06,2.34,TRIM);
  // The blue plate on the pier between the glazing and the door.
  b(16.56,16.72,wall+.02,wall+.07,2.02,.28,0x2f6fa8);
  // Lamps on the porch beam.
  for(const x of [12.4,17.8]) b(x-.16,x+.16,porch-.34,porch-.16,top-.66,.2,0x3b3129);
  // Barge boards down both slopes of the gable, which is the dark line the
  // photograph shows against the sky.
  {
    const apex=new THREE.Vector3((F.bayWest+F.east)/2,floor+top+P.entryRise,porch+.06),
      eaveY=floor+top+P.entryRise-P.entryRise*((F.east-F.bayWest)/2+P.eave)/((F.east-F.bayWest)/2);
    for(const side of [-1,1]){
      const foot=new THREE.Vector3(apex.x+side*((F.east-F.bayWest)/2+P.eave),eaveY,porch+.06),
        run=apex.distanceTo(foot),g=box(.14,.2,run,0,0,0,TRIM);
      g.translate(0,-run/2,0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),foot.clone().sub(apex).normalize()));
      g.translate(...apex.clone().add(foot).multiplyScalar(.5).toArray());
      parts.push(postOfficeTransform(g));
    }
  }
  // The bench under the glazing and the bollard by the door, both standing on
  // the walk rather than on the floor of the building.
  const [q0,q1]=P.bench,walk=postOfficeHeight(sample,(q0+q1)/2,porch-.9)-floor;
  b(q0,q1,porch-1.15,porch-.66,walk+.43,.06,0x4f8ec4);
  b(q0,q1,porch-1.17,porch-1.11,walk+.49,.42,0x4f8ec4);
  for(const x of [q0+.12,q1-.12]) b(x-.04,x+.04,porch-1.1,porch-.7,walk,.43,0x4f8ec4);
  b(P.bollard-.09,P.bollard+.09,porch-1.0,porch-.82,walk,.92,0xd7b23c);
  // The pipe rail at the east end of the walk.
  {
    const [r0,r1]=P.rail,railZ=porch-.5,ground=postOfficeHeight(sample,(r0+r1)/2,railZ)-floor;
    for(const y of [.94,.62]) b(r0,r1,railZ-.03,railZ+.03,ground+y,.06,0x6d8478);
    for(const x of [r0,(r0+r1)/2,r1]) b(x-.03,x+.03,railZ-.03,railZ+.03,ground,1.0,0x6d8478);
  }
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
