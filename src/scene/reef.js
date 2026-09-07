// Close-up detail observed in the 2022 aerial, winter drone panorama and
// exterior photo. See CONTINUE-reef.md for dates and dimensional uncertainty.
import * as THREE from "three";
import { box, tint } from "./parts.js";
import { buildReefBase, reefMerge, reefBeam, reefHeight } from "./reef-base.js";
import { REEF, reefPoint } from "./reef-plan.js";

export function buildReef(scene,sample) {
  const model=buildReefBase(scene,sample),{group,floor}=model;group.name="reef-detailed-model";
  const parts=[],trim=0xdbd8c7,glass=0x344c55,wood=0x795b40;
  const south=reefPoint(650,442).z;
  // Slender pale-framed windows and two street doors. Spacing is estimated
  // from the exterior photo, not an interior floor plan.
  for(const px of [619,639,659,731,751]) {
    const x=reefPoint(px,442).x;
    parts.push(box(.94,.10,1.75,x,floor+.68,south+.07,trim));
    parts.push(box(.72,.12,1.52,x,floor+.80,south+.13,glass));
    parts.push(box(.74,.14,.055,x,floor+1.48,south+.16,trim));
  }
  for(const px of [602,698]) {
    const x=reefPoint(px,442).x;
    parts.push(box(1.5,.10,2.25,x,floor,south+.08,trim),box(1.25,.12,2.03,x,floor+.07,south+.14,glass));
    parts.push(box(.06,.15,2.03,x,floor+.07,south+.20,trim));
  }
  // The long frontage has pale brick courses, visible close to the building.
  const left=reefPoint(578,442).x,right=reefPoint(772,442).x;
  for(let y=.12;y<2.8;y+=.15)parts.push(box(right-left,.018,.012,(left+right)/2,floor+y,south+.025,0x928e7e));
  // Low parapet edges and the visible dogleg roof duct.
  for(const ring of [model.rings.main,model.rings.west]) {
    const top=floor+(ring===model.rings.main?4.25:3.40);
    for(let i=0;i<ring.length;i++)parts.push(reefBeam(ring[i],ring[(i+1)%ring.length],.12,.16,top,0xa3a297));
  }
  for(const pixel of REEF.roofVents) {
    const p=reefPoint(...pixel),top=floor+(pixel[0]<578?3.40:4.25);
    const stem=new THREE.CylinderGeometry(.17,.20,.5,8);stem.translate(p.x,top+.25,p.z);parts.push(tint(stem,0x9a9c94));
    const cap=new THREE.CylinderGeometry(.35,.35,.14,10);cap.translate(p.x,top+.52,p.z);parts.push(tint(cap,0xc2c4b9));
  }
  const duct=[[654,294],[654,363],[721,405]].map(p=>reefPoint(...p));
  for(let i=1;i<duct.length;i++)parts.push(reefBeam(duct[i-1],duct[i],.40,.24,floor+4.26,0xbfc0b1));
  const hvac=reefPoint(747,293);parts.push(box(1.5,1.0,.6,hvac.x,floor+4.25,hvac.z,0xa3a698));

  // Dark glazing on the west wing facing the patio and a small entry canopy.
  const west=reefPoint(532,340).x;
  for(const py of [337,353,369,385]) {
    const p=reefPoint(532,py);
    parts.push(box(.12,1.65,1.45,west-.03,floor+.9,p.z,trim),box(.14,1.43,1.20,west-.10,floor+1.02,p.z,glass));
  }
  const awA=reefPoint(507,298),awB=reefPoint(533,328);
  const entry=reefPoint(532,313);
  parts.push(box(.12,1.4,2.15,west-.03,floor,entry.z,trim),box(.14,1.15,1.94,west-.10,floor+.10,entry.z,glass));
  parts.push(box(awB.x-awA.x,awB.z-awA.z,.13,(awA.x+awB.x)/2,floor+2.85,(awA.z+awB.z)/2,0x535e57));
  for(const z of [awA.z,awB.z])parts.push(box(.15,.15,2.85,awA.x,floor,z,wood));

  const fence=REEF.fence.map(p=>reefPoint(...p)),fenceY=Math.max(...fence.map(p=>reefHeight(sample,p)));
  for(let x=fence[0].x;x<fence[1].x;x+=.18)parts.push(box(.012,.14,1.38,x,fenceY,fence[0].z,0x744127));
  const northA=reefPoint(361,210),northB=reefPoint(530,210),northY=Math.max(reefHeight(sample,northA),reefHeight(sample,northB));
  for(const y of [.45,.9])parts.push(reefBeam(northA,northB,.08,.09,northY+y,wood));
  for(let x=northA.x;x<=northB.x;x+=2)parts.push(box(.14,.14,1.1,x,northY,northA.z,wood));
  // Concrete shore edge follows the sampled ground rather than changing terrain.
  const edge=REEF.seaEdge.map(p=>reefPoint(...p));
  for(let i=1;i<edge.length;i++) {
    const a=edge[i-1],b=edge[i],n=Math.ceil(Math.hypot(a.x-b.x,a.z-b.z)/2);
    for(let j=0;j<n;j++) {
      const point=t=>({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
      const p=point(j/n),q=point((j+1)/n),y=Math.max(reefHeight(sample,p),reefHeight(sample,q));
      parts.push(reefBeam(p,q,.30,.55,y-.4,0x93958c));
    }
  }
  // Four small round tables are representative of the clustered patio seating
  // visible in the winter panorama; furniture layout is not a live inventory.
  for(const pixel of REEF.tables) {
    const p=reefPoint(...pixel),y=reefHeight(sample,p)+.07;
    const top=new THREE.CylinderGeometry(.65,.65,.08,10);top.translate(p.x,y+.75,p.z);parts.push(tint(top,0xb3a993));
    parts.push(box(.12,.12,.72,p.x,y,p.z,wood));
    for(const side of [-1,1])parts.push(box(.45,.45,.08,p.x+side*.95,y+.43,p.z,wood),box(.08,.08,.43,p.x+side*.95,y,p.z,wood));
  }
  // Front wheel stops, excluding parked vehicles which change from day to day.
  for(const px of [609,642,678,714,747]) {
    const p=reefPoint(px,468);parts.push(box(1.8,.18,.12,p.x,reefHeight(sample,p)+.06,p.z,0xc0bfb0));
  }
  reefMerge(parts,group,"reef-facade-roof-patio-detail");
  // Text is redrawn locally; no source photograph is downloaded into the model.
  const canvas=document.createElement("canvas");canvas.width=1024;canvas.height=64;
  const ctx=canvas.getContext("2d");ctx.fillStyle="#b92e47";ctx.fillRect(0,0,1024,64);
  ctx.fillStyle="#eee9db";ctx.font="36px sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";
  ctx.fillText("KINISKI'S REEF TAVERN",512,33);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(14,.55),new THREE.MeshStandardMaterial({map:texture,roughness:.9}));
  const p=reefPoint(678,459);sign.position.set(p.x,floor+3.14,p.z+.075);group.add(sign);
  // Locally drawn approximation of the roadside script, shared by both faces.
  // Separate front-facing planes keep the lettering readable from either direction.
  const logo=document.createElement("canvas");logo.width=512;logo.height=256;
  const ink=logo.getContext("2d");ink.lineJoin="round";ink.lineCap="round";
  const reefLettering=()=>{
    ink.beginPath();ink.moveTo(74,17);ink.lineTo(63,168);
    ink.moveTo(35,34);ink.bezierCurveTo(242,40,197,120,70,91);
    ink.moveTo(79,96);ink.lineTo(191,177);ink.stroke();
    ink.font="italic 146px Georgia, serif";ink.strokeText("eef",174,171);
  };
  ink.strokeStyle="#302d29";ink.lineWidth=13;reefLettering();
  ink.strokeStyle="#b44149";ink.lineWidth=5;reefLettering();
  ink.font="bold 45px Georgia, serif";ink.textAlign="center";
  ink.strokeStyle="#3c3a35";ink.lineWidth=5;ink.strokeText("TAVERN",256,238);
  ink.fillStyle="#f0eee0";ink.fillText("TAVERN",256,238);
  const logoTexture=new THREE.CanvasTexture(logo);logoTexture.colorSpace=THREE.SRGBColorSpace;
  const logoMaterial=new THREE.MeshStandardMaterial({map:logoTexture,transparent:true,alphaTest:.1,roughness:.85});
  const logoGeometry=new THREE.PlaneGeometry(3.8,1.90);
  const roadside=group.getObjectByName("reef-roadside-sign");
  for(const side of [-1,1]) {
    const face=new THREE.Mesh(logoGeometry,logoMaterial);face.name=side===1?"reef-sign-east-lettering":"reef-sign-west-lettering";
    face.position.set(0,4.91,side*.162);face.rotation.y=side===1?0:Math.PI;roadside.add(face);
    if(side===-1){face.scale.setScalar(.9);face.position.y=4.80;} // Fit below the reversed slope.
  }
  return model;
}
