import * as THREE from "three";
import { box, tint } from "./parts.js";
import { toWorld } from "../geo.js";
import { COMMUNITY, communityPoint } from "./community-plan.js";
import { buildCommunityBase, communityMerge, communityHeight, communityBeam, communityDrape } from "./community-base.js";

// Local triangle index keeps all painted lines on the rendered paving surface.
function pavingSampler(mesh,fallback){
  const cells=new Map(),p=mesh.geometry.attributes.position;
  for(let i=0;i<p.count;i+=3){const t=[0,1,2].map(j=>({x:p.getX(i+j),y:p.getY(i+j),z:p.getZ(i+j)}));
    for(let x=Math.floor(Math.min(...t.map(v=>v.x))/5);x<=Math.floor(Math.max(...t.map(v=>v.x))/5);x++)for(let z=Math.floor(Math.min(...t.map(v=>v.z))/5);z<=Math.floor(Math.max(...t.map(v=>v.z))/5);z++){
      const k=`${x},${z}`;if(!cells.has(k))cells.set(k,[]);cells.get(k).push(t);
    }
  }
  return(lat,lon)=>{const p=toWorld(lat,lon);let y=-Infinity;
    for(const [a,b,c] of cells.get(`${Math.floor(p.x/5)},${Math.floor(p.z/5)}`)??[]){const d=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);if(Math.abs(d)<1e-9)continue;
      const u=((b.z-c.z)*(p.x-c.x)+(c.x-b.x)*(p.z-c.z))/d,v=((c.z-a.z)*(p.x-c.x)+(a.x-c.x)*(p.z-c.z))/d,w=1-u-v;
      if(Math.min(u,v,w)>=-1e-6)y=Math.max(y,u*a.y+v*b.y+w*c.y);
    }return Number.isFinite(y)?y:fallback(lat,lon);
  };
}
export function buildCommunity(scene,sample){
  const model=buildCommunityBase(scene,sample),{group,floors}=model;group.name="community-detailed-model";
  const parts=[],paint=[],f=floors.center,l=floors.library,trim=0xdddcd0,glass=0x3e5659;
  const north=communityPoint(610,431).z,libNorth=communityPoint(427,429).z;
  function window(x,z,width,height,bottom,columns,rows,east=false){
    const pieces=[box(width,.10,height,0,bottom,0,trim),box(width-.12,.12,height-.12,0,bottom+.06,.065,glass)];
    for(let c=1;c<columns;c++)pieces.push(box(.035,.16,height,-width/2+c*width/columns,bottom,.10,trim));
    for(let r=1;r<rows;r++)pieces.push(box(width,.16,.035,0,bottom+r*height/rows,.10,trim));
    for(const g of pieces){g.rotateY(east?Math.PI/2:Math.PI);g.translate(x,0,z);parts.push(g)}
  }
  // Five tall divided lights either side of the Center's main entrance.
  for(const px of [565,574,583,592,601,618,627,636,645,654])window(communityPoint(px,431).x,north-.06,1.33,2.50,f+.70,3,7);
  const door=communityPoint(609.5,431);window(door.x,north-.30,2.0,2.85,f+.05,2,2);
  parts.push(box(2.5,.30,.30,door.x,f+2.98,north-.15,0xd4cbb6));
  // Brick courses and subtle horizontal bands, avoiding a photo texture.
  const x0=communityPoint(555.7,431).x,x1=communityPoint(664.3,431).x;
  for(let y=.1;y<5.2;y+=.17){if(y>.65&&y<3.25)continue;parts.push(box(x1-x0,.025,.012,(x0+x1)/2,f+y,north-.027,0x6b4940))}
  for(const y of [.30,3.50,4.65])parts.push(box(x1-x0,.07,.065,(x0+x1)/2,f+y,north-.045,0x9c7560));
  // Divided windows on the east side and the lower projecting annex.
  for(const py of [448,464,525])window(communityPoint(664.4,py).x+.03,communityPoint(664.4,py).z,2.2,2.3,f+.70,4,6,true);
  const annex=communityPoint(681.7,500);window(annex.x+.04,annex.z,1.7,2.4,f+.12,2,3,true);
  for(const [px,py,big] of COMMUNITY.roofUnits){const p=communityPoint(px,py);parts.push(box(big?1.0:.65,big?1.45:.65,big?.9:.25,p.x,f+5.29,p.z,0xbbc1b7));if(big)parts.push(box(.72,1.1,.06,p.x,f+6.19,p.z,0x676f6a))}
  // Library: the old garage openings form the large north-facing lights.
  for(const px of [414,441])window(communityPoint(px,429).x,libNorth-.045,3.65,2.65,l+.18,4,4);
  const libEntry=communityPoint(467.3,456);window(libEntry.x+.03,libEntry.z,3.5,2.65,l+.04,3,3,true);
  for(const py of [485,514])window(communityPoint(454.5,py).x+.02,communityPoint(454.5,py).z,1.75,.60,l+2.13,3,1,true);
  // White entrance canopy fascia and eaves make the separate roof parts legible.
  for(const [a,b] of [[[399,429],[455,429]],[[455,437],[469,437]],[[469,437],[469,474]],[[400,534],[455,534]]])parts.push(communityBeam(communityPoint(...a),communityPoint(...b),.16,.14,l+3.2,trim));
  const book=communityPoint(468,486);parts.push(box(.65,.75,1.1,book.x,communityHeight(sample,book),book.z,0x315e85),box(.70,.80,.08,book.x,communityHeight(sample,book)+1.1,book.z,0x657d8c));

  const paintHeight=pavingSampler(group.getObjectByName("community-grounds"),sample);
  const line=(a,b,color=0xddd9c9)=>{const d=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=-(b[1]-a[1])/d*.25,dy=(b[0]-a[0])/d*.25;
    paint.push(communityDrape([[a[0]+dx,a[1]+dy],[b[0]+dx,b[1]+dy],[b[0]-dx,b[1]-dy],[a[0]-dx,a[1]-dy]],paintHeight,color,.035,2));
  };
  // Two permanent pickleball outlines; no portable nets are assumed permanent.
  for(const [a,b,c,d] of COMMUNITY.courts){for(const pair of [[[a,b],[c,b]],[[c,b],[c,d]],[[c,d],[a,d]],[[a,d],[a,b]],[[a,b+22],[c,b+22]],[[a,d-22],[c,d-22]]])line(...pair);line([(a+c)/2,b],[(a+c)/2,b+22]);line([(a+c)/2,d-22],[(a+c)/2,d])}
  for(const px of [468,481,494,507,520,533])line([px,469],[px,529]);
  for(const px of [701,715,729,743,757,771,785,799,813,827,841])line([px,393],[px,423]);
  // Hatched entrance clearance is visible in the Jan 2026 panorama.
  line([586,389],[635,389]);line([635,389],[635,417]);line([635,417],[586,417]);line([586,417],[586,389]);
  for(let px=586;px<635;px+=7)line([px,417],[Math.min(635,px+18),Math.max(389,417-(635-px)*1.55)]);
  communityMerge(paint,group,"community-court-and-parking-markings");
  // Eight raised beds in two rows, south of the space between the buildings.
  for(const pixel of COMMUNITY.gardenBeds){const p=communityPoint(...pixel),y=communityHeight(sample,p)+.05;
    parts.push(box(2.1,1.25,.20,p.x,y,p.z,0x7d7862),box(1.89,1.04,.03,p.x,y+.20,p.z,0x554735));
  }
  // Low planted beds bordering the north wall and the road-facing island.
  for(const [a,b] of [[[558,420],[598,420]],[[620,420],[663,420]],[[557,385],[651,385]]]){
    const p=communityPoint(...a),q=communityPoint(...b),y=Math.min(communityHeight(sample,p),communityHeight(sample,q));parts.push(communityBeam(p,q,.7,.26,y+.07,0x9b8c6d));
    const n=Math.ceil(Math.hypot(q.x-p.x,q.z-p.z));for(let i=0;i<=n;i++){const x=p.x+(q.x-p.x)*i/n,z=p.z+(q.z-p.z)*i/n,g=new THREE.SphereGeometry(.38,5,3);g.scale(1,.7,1);g.translate(x,communityHeight(sample,{x,z})+.43,z);parts.push(tint(g,i%4?0x667448:0x7c8254))}
  }
  function bar(a,b,r,color){const aa=new THREE.Vector3(...a),bb=new THREE.Vector3(...b),g=new THREE.CylinderGeometry(r,r,aa.distanceTo(bb),5);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),bb.clone().sub(aa).normalize()));g.translate(...aa.add(bb).multiplyScalar(.5).toArray());parts.push(tint(g,color))}
  // Pole and backboard at the rear edge of the paved play courts.
  const hoop=communityPoint(778,524),hy=communityHeight(sample,hoop);bar([hoop.x,hy,hoop.z],[hoop.x,hy+3.8,hoop.z],.08,0x555d52);
  parts.push(box(1.8,.12,1.05,hoop.x,hy+2.95,hoop.z-.12,0xd7d8ce));const rim=new THREE.TorusGeometry(.23,.022,4,12);rim.rotateX(Math.PI/2);rim.translate(hoop.x,hy+3.05,hoop.z-.46);parts.push(tint(rim,0x9b5836));
  // Playground pad and simple observed climbing/sliding/swing silhouettes.
  const play=communityPoint(850,597),py=communityHeight(sample,play)+.1,green=0x50634b;
  for(const dx of [-.8,.8])for(const dz of [-.8,.8])bar([play.x+dx,py,play.z+dz],[play.x+dx,py+2.4,play.z+dz],.06,green);
  parts.push(box(1.8,1.8,.10,play.x,py+1.10,play.z,0x938970));
  const cap=new THREE.ConeGeometry(1.5,.65,4);cap.rotateY(Math.PI/4);cap.translate(play.x,py+2.65,play.z);parts.push(tint(cap,0x9a906d));
  bar([play.x+.85,py+1.15,play.z],[play.x+2.8,py+.20,play.z],.22,0xa9ada0);
  const swing=communityPoint(873,604),sy=communityHeight(sample,swing)+.1;
  for(const dx of [-1.5,1.5])for(const dz of [-.9,.9])bar([swing.x+dx,sy,swing.z+dz],[swing.x+dx,sy+2.4,swing.z],.055,green);
  bar([swing.x-1.5,sy+2.4,swing.z],[swing.x+1.5,sy+2.4,swing.z],.065,green);
  for(const dx of [-.6,.6]){for(const side of [-.23,.23])bar([swing.x+dx+side,sy+2.3,swing.z],[swing.x+dx+side,sy+.45,swing.z],.013,0x777d77);parts.push(box(.55,.25,.055,swing.x+dx,sy+.43,swing.z,0x646553))}
  const dome=communityPoint(802,585),dy=communityHeight(sample,dome);
  for(let angle=0;angle<Math.PI;angle+=Math.PI/3){const g=new THREE.TorusGeometry(1.15,.035,4,10,Math.PI);g.rotateY(angle);g.translate(dome.x,dy+.1,dome.z);parts.push(tint(g,0x9d6951))}
  // Street bicycle rack and two flagpoles. Flags are static low-cost approximations.
  const rack=communityPoint(613,386),ry=communityHeight(sample,rack);
  for(let i=0;i<4;i++){const g=new THREE.TorusGeometry(.30,.035,4,8,Math.PI);g.translate(rack.x+i*.65,ry+.45,rack.z);parts.push(tint(g,0x35474a));for(const dx of [-.3,.3])bar([rack.x+i*.65+dx,ry,rack.z],[rack.x+i*.65+dx,ry+.45,rack.z],.035,0x35474a)}
  for(const [px,canada] of [[609,true],[627,false]]){const p=communityPoint(px,387),y=communityHeight(sample,p);bar([p.x,y,p.z],[p.x,y+6.5,p.z],.035,0xbfc4c1);
    parts.push(box(1.15,.035,.65,p.x+.6,y+5.45,p.z,0xe6e4d8));if(canada){for(const dx of [.16,1.04])parts.push(box(.27,.04,.65,p.x+dx,y+5.45,p.z,0xa94243));parts.push(box(.22,.045,.30,p.x+.60,y+5.62,p.z,0xa94243))}
    else{for(let i=0;i<7;i++)parts.push(box(1.15,.04,.047,p.x+.6,y+5.45+i*.095,p.z,0xa54c46));parts.push(box(.50,.05,.36,p.x+.28,y+5.74,p.z,0x344f76))}
  }
  communityMerge(parts,group,"community-facades-and-grounds-detail");
  // One shared atlas for the two permanent building signs.
  const canvas=document.createElement("canvas");canvas.width=1024;canvas.height=512;const ctx=canvas.getContext("2d");ctx.textAlign="center";ctx.textBaseline="middle";
  ctx.fillStyle="#343e36";ctx.fillRect(0,0,1024,256);ctx.fillStyle="#ece8d5";ctx.font="bold 62px serif";ctx.fillText("POINT ROBERTS",512,75);ctx.font="bold 57px serif";ctx.fillText("COMMUNITY CENTER",512,160);
  ctx.fillStyle="#d4cbae";ctx.fillRect(0,256,1024,256);ctx.fillStyle="#354f4a";ctx.font="bold 78px sans-serif";ctx.fillText("POINT ROBERTS",512,333);ctx.fillText("LIBRARY",512,433);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;const material=new THREE.MeshStandardMaterial({map:texture,roughness:.9});
  for(const [name,w,h,x,y,z,east,top] of [["community-center-sign",2.65,.67,door.x,f+3.8,north-.32,false,true],["community-library-sign",1.5,.72,libEntry.x+.12,l+2.3,communityPoint(467.3,444).z,true,false]]){
    const g=new THREE.PlaneGeometry(w,h),uv=g.attributes.uv;for(let i=0;i<uv.count;i++)uv.setY(i,uv.getY(i)*.5+(top?.5:0));
    const sign=new THREE.Mesh(g,material);sign.name=name;sign.rotation.y=east?Math.PI/2:Math.PI;sign.position.set(x,y,z);group.add(sign);
  }
  return model;
}
