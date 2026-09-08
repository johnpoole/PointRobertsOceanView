import { FIRE_STATION as P,fireStationFrame as F,fireStationDoors } from "./fire-station-plan.js";
import { buildFireStationBase,fireStationBox,fireStationMerge,fireStationHeight } from "./fire-station-base.js";
export function buildFireStation(scene,sample){
  const model=buildFireStationBase(scene,sample),{group,floor}=model,parts=[],trim=0xd7d9d0,glass=0x283a40;
  const b=(x0,x1,z0,z1,y,h,color)=>parts.push(fireStationBox(x0,x1,z0,z1,floor+y,h,color));
  function window(x,z,w,h,y,n=2){b(x-w/2-.08,x+w/2+.08,z+.01,z+.10,y-.08,h+.16,trim);b(x-w/2,x+w/2,z+.11,z+.14,y,h,glass);for(let i=1;i<n;i++){const a=x-w/2+w*i/n;b(a-.035,a+.035,z+.145,z+.17,y,h,trim)}}
  for(const d of fireStationDoors){
    for(const x of [d.x-d.width/2-.1,d.x+d.width/2+.1])b(x-.09,x+.09,d.z+.07,d.z+.16,0,d.height+.22,trim);
    b(d.x-d.width/2-.2,d.x+d.width/2+.2,d.z+.07,d.z+.16,d.height+.09,.13,trim);
    for(let y=.32;y<d.height;y+=.28)b(d.x-d.width/2+.04,d.x+d.width/2-.04,d.z+.065,d.z+.08,y,.018,0x8a242b);
    for(const dx of [-d.width*.31,0,d.width*.31]){b(d.x+dx-.39,d.x+dx+.39,d.z+.09,d.z+.12,1.65,.24,0x555c59);b(d.x+dx-.32,d.x+dx+.32,d.z+.13,d.z+.15,1.69,.15,glass)}
  }
  // Four upper windows in the taller east wing, plus the low west-wing frontage.
  for(let i=0;i<4;i++)window(F.split+1.8+i*(F.width-F.split-3.6)/3,F.front,1.45,1.55,5.05);
  for(const x of [2.1,5.7,8.9])window(x,F.front,2,1.3,1.35);
  const entryX=F.bayWest-1.65;window(entryX,F.front,1.2,2.25,.12,1);
  window(F.bayEast+.75,F.front,1.5,.55,2.75);
  // The far east personnel door is red in the January 2026 reference.
  b(F.width-1,F.width-.15,F.front+.07,F.front+.12,.08,2.25,0xb6232e);window(F.width-.58,F.front+.13,.44,.48,1.52,1);
  // Horizontal siding and white corner trim; no speculative hidden windows.
  for(const [x0,x1,z,h] of [[0,F.bayWest,F.front,P.lowHeight],[F.bayWest,F.bayEast,F.length,P.lowHeight],[F.bayEast,F.split,F.front,P.lowHeight],[F.split,F.width,F.front,P.highHeight]]){
    for(let y=.3;y<h;y+=.28)b(x0,x1,z+.012,z+.023,y,.014,0x929a97);
    for(const x of [x0+.05,x1-.05])b(x-.06,x+.06,z+.025,z+.07,0,h,trim);
  }
  // Central gable louver and taller-wing vent, visible above the windows.
  for(const [x,z,y] of [[(F.bayWest+F.bayEast)/2,F.length,5.35],[(F.split+F.width)/2,F.front,8.05]]){b(x-.42,x+.42,z+.02,z+.08,y,.75,0x6b7473);for(let dy=.08;dy<.75;dy+=.1)b(x-.4,x+.4,z+.085,z+.11,y+dy,.022,trim)}
  // Door approach bollards, antenna and the white pole beside the low wing.
  for(const x of [F.split+6.15,F.split+7.1]){const z=F.front+3.4,y=fireStationHeight(sample,x,z);parts.push(fireStationBox(x-.075,x+.075,z-.075,z+.075,y,.9,0xd2bd62))}
  const poleX=7.4,poleZ=F.front+2,ground=fireStationHeight(sample,poleX,poleZ);
  parts.push(fireStationBox(poleX-.065,poleX+.065,poleZ-.065,poleZ+.065,ground,8.3,0xcdd1ca));
  b(F.split+.85,F.split+.93,F.highNorth+6,F.highNorth+6.08,7.7,6.5,0x8a9698);
  // Modest parking-space marks on the west apron, traced from the aerial.
  for(let x=-21;x<-2;x+=3){const z=F.front+6,y=fireStationHeight(sample,x,z)+.08;parts.push(fireStationBox(x-.045,x+.045,z,z+4.8,y,.015,0xb9bcb1))}
  fireStationMerge(parts,group,"fire-station-doors-windows-and-site-detail");
  return model;
}
