// Close detail from the Jan 2026 drone panorama and official exterior photo.
import * as THREE from "three";
import { box, tint } from "./parts.js";
import { toWorld } from "../geo.js";
import { MARKET, marketPoint } from "./marketplace-plan.js";
import { buildMarketplaceBase, marketMerge, marketHeight, marketDrape } from "./marketplace-base.js";
export function buildMarketplace(scene,sample){
  const model=buildMarketplaceBase(scene,sample),{group,floor,front,back,rings}=model;
  group.name="marketplace-detailed-model";const parts=[],white=0xdedfd6,glass=0x39565e;
  function glazing(x,z,width,bottom,height,columns,rows){
    parts.push(box(.08,width,height,x,floor+bottom,z,white),box(.10,width-.15,height-.15,x-.05,floor+bottom+.075,z,glass));
    for(let c=1;c<columns;c++)parts.push(box(.14,.045,height,x-.11,floor+bottom,z-width/2+c*width/columns,white));
    for(let r=1;r<rows;r++)parts.push(box(.14,width,.045,x-.11,floor+bottom+r*height/rows,z,white));
  }
  for(const [a,b,type] of MARKET.bays){
    const z0=marketPoint(637,a).z,z1=marketPoint(637,b).z,w=z1-z0,cz=(z0+z1)/2;
    if(type==="windows"){
      for(const z of [cz-w*.255,cz+w*.255])glazing(front-.055,z,w*.43,4.02,1.85,4,3);
      // Fine siding courses on the upper white window bays.
      for(let y=3.12;y<6.75;y+=.14){
        if(y>=4.02&&y<=5.87)continue;
        parts.push(box(.024,w,.015,front-.035,floor+y,cz,0xb5b9ad));
      }
      if(a===403)glazing(front-.10,cz+w*.24,w*.43,.06,3.05,4,4);
      if(a===310)glazing(back-.04,cz,3.2,.03,2.75,4,2);
    }
    if(type==="tower")glazing(front-.04,cz,w*.60,4.20,.82,3,2);
    if(type==="canopy"){
      for(let z=z0+.35;z<z1;z+=.46){
        const beam=box(back-front,.035,.025,(front+back)/2,0,z,0x345b75),p=beam.attributes.position;
        for(let i=0;i<p.count;i++)p.setY(i,p.getY(i)+floor+4.18+1.15*(p.getX(i)-front)/(back-front));
        beam.computeVertexNormals();parts.push(beam);
      }
      // Recessed glazed storefront behind the open colonnade.
      glazing(back-.03,cz,w*.70,.15,2.70,Math.max(4,Math.round(w/1.4)),2);
    }
  }
  // Low parapets follow the actual irregular roof outline, including east steps.
  function beam(a,b,y,width,height,color){const g=box(width,Math.hypot(b.x-a.x,b.z-a.z),height,0,y,0,color);g.rotateY(Math.atan2(b.x-a.x,b.z-a.z));g.translate((a.x+b.x)/2,0,(a.z+b.z)/2);return g}
  for(const [ring,y] of [[rings.north,6.98],[rings.south,5.58]])for(let i=0;i<ring.length;i++)parts.push(beam(ring[i],ring[(i+1)%ring.length],floor+y,.14,.26,0xc9cbc2));
  for(const pixel of MARKET.hvac){const p=marketPoint(...pixel),y=floor+(pixel[1]<376?7.05:5.65);parts.push(box(1.3,1.7,.85,p.x,y,p.z,0x8d9895),box(1.40,1.80,.09,p.x,y+.85,p.z,0x667575))}
  // Central roof has small equipment either side of the blue hip.
  for(const py of [360,398]){const p=marketPoint(645,py);parts.push(box(.9,1.2,.7,p.x,floor+8.32,p.z,0x798983))}
  // Public entrance posts and sparse wall lights are stable visual cues.
  for(const py of [315,350,405,439]){const p=marketPoint(637,py);parts.push(box(.23,.22,.4,front-.18,floor+3.1,p.z,0x687773))}
  // Four double rows: cars face north/south, separated by east/west drive aisles.
  // Project onto the paving triangles, not a second independent terrain mesh.
  const grounds=group.getObjectByName("marketplace-grounds"),paintCache=new Map(),paintParts=[],cells=new Map();
  const positions=grounds.geometry.attributes.position;
  // Index the ground triangles into 8 m cells once. A stripe vertex then tests
  // only its local triangles instead of raycasting the entire lot thousands of times.
  for(let i=0;i<positions.count;i+=3){
    const t=[0,1,2].map(j=>({x:positions.getX(i+j),y:positions.getY(i+j),z:positions.getZ(i+j)}));
    for(let x=Math.floor(Math.min(...t.map(p=>p.x))/8);x<=Math.floor(Math.max(...t.map(p=>p.x))/8);x++)
      for(let z=Math.floor(Math.min(...t.map(p=>p.z))/8);z<=Math.floor(Math.max(...t.map(p=>p.z))/8);z++){
        const key=`${x},${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(t);
      }
  }
  function paintHeight(lat,lon){
    const key=`${lat.toFixed(10)},${lon.toFixed(10)}`;if(paintCache.has(key))return paintCache.get(key);
    const p=toWorld(lat,lon);let y=-Infinity;
    for(const [a,b,c] of cells.get(`${Math.floor(p.x/8)},${Math.floor(p.z/8)}`)??[]){
      const d=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);if(Math.abs(d)<1e-9)continue;
      const u=((b.z-c.z)*(p.x-c.x)+(c.x-b.x)*(p.z-c.z))/d;
      const v=((c.z-a.z)*(p.x-c.x)+(a.x-c.x)*(p.z-c.z))/d,w=1-u-v;
      if(Math.min(u,v,w)>=-1e-6)y=Math.max(y,u*a.y+v*b.y+w*c.y);
    }
    if(!Number.isFinite(y))y=sample(lat,lon);paintCache.set(key,y);return y;
  }
  const paint=(pixels,color)=>paintParts.push(marketDrape(pixels,paintHeight,color,.035,2));
  for(const [x0,x1,y0,y1] of MARKET.parkingRows){
    for(let px=x0;px<=x1;px+=9.1)paint([[px,y0],[px+.30,y0],[px+.30,y1],[px,y1]],0xd5d2bc);
    const mid=(y0+y1)/2;paint([[x0,mid],[x1,mid],[x1,mid+.30],[x0,mid+.30]],0xd5d2bc);
  }
  // Paired yellow access-aisle lines, visible in both aerial and drone references.
  for(const [y0,y1] of [[241,279],[392,420]])for(const px of [605,609])paint([[px,y0],[px+.45,y0],[px+.45,y1],[px,y1]],0xc8b45a);
  marketMerge(paintParts,group,"marketplace-parking-paint");
  // Red curb follows the storefront; short segments remain grounded.
  for(let py=247;py<499;py+=5){const p=marketPoint(625,py),q=marketPoint(625,Math.min(499,py+5));parts.push(beam(p,q,Math.min(marketHeight(sample,p),marketHeight(sample,q))+.06,.18,.12,0x9c4d48))}
  marketMerge(parts,group,"marketplace-windows-roof-and-lot-detail");
  // Draw recognizable lettering locally, without embedding reference imagery.
  const canvas=document.createElement("canvas");canvas.width=1024;canvas.height=256;
  const ctx=canvas.getContext("2d");ctx.textAlign="center";ctx.textBaseline="middle";
  ctx.strokeStyle="#53524c";ctx.fillStyle="#a6434c";ctx.lineWidth=4;
  ctx.font="bold 76px sans-serif";ctx.strokeText("MARKETPLACE",512,199);ctx.fillText("MARKETPLACE",512,199);
  ctx.font="italic bold 46px Georgia, serif";ctx.fillText("International",512,122);
  ctx.strokeStyle="#a6434c";ctx.lineWidth=9;ctx.beginPath();ctx.moveTo(320,77);ctx.lineTo(466,77);ctx.lineTo(512,29);ctx.lineTo(558,77);ctx.lineTo(704,77);ctx.stroke();
  ctx.fillStyle="#31596d";ctx.fillRect(486,61,52,37);ctx.fillStyle="#e9e7da";ctx.font="bold 30px serif";ctx.fillText("M",512,80);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(8.8,2.2),new THREE.MeshStandardMaterial({map:texture,transparent:true,alphaTest:.1,roughness:.85}));
  sign.name="marketplace-main-sign";sign.rotation.y=-Math.PI/2;sign.position.set(front-.12,floor+6.52,marketPoint(637,379.5).z);group.add(sign);
  return model;
}
