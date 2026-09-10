import * as THREE from "three";
import { CLUBHOUSE as P,clubhouseFrame as F } from "./clubhouse-plan.js";
import { buildClubhouseBase,clubhouseBox,clubhouseMerge,clubhouseHeight,
  LOG,SHINGLE,TIMBER,GLASS,DECK } from "./clubhouse-base.js";
export function buildClubhouse(scene,sample){
  const model=buildClubhouseBase(scene,sample),{group,floor}=model,parts=[];
  const b=(x0,x1,z0,z1,y,h,color)=>parts.push(clubhouseBox(x0,x1,z0,z1,floor+y,h,color));
  const top=P.wallHeight,course=P.logCourse;
  // The walls are stacked logs, and the round of each course is what tells the
  // building apart from a shed at any distance. A shallow ridge every course
  // rather than a cylinder each: the same line, at a fraction of the geometry.
  for(let y=course/2;y<top-.1;y+=course){
    b(-.06,F.width+.06,F.depth-.02,F.depth+.06,y-.05,.1,0x7c452e);
    b(-.06,F.width+.06,-.06,.02,y-.05,.1,0x7c452e);
    b(F.width-.02,F.width+.06,0,F.depth,y-.05,.1,0x7c452e);
  }
  for(let y=course/2;y<P.wing.height-.1;y+=course)
    b(P.wing.x0,P.wing.x1,P.wing.z1-.02,P.wing.z1+.06,y-.05,.1,0x7c452e);
  // The log ends that stand proud at the corners, which is what a log building
  // does and a framed one does not.
  for(const [x,z] of [[0,0],[F.width,0],[0,F.depth],[F.width,F.depth]])
    for(let y=course;y<top-.2;y+=course*2)
      b(x-.28,x+.28,z-.28,z+.28,y-.11,.22,0x63341f);

  // The gable end that faces the course: the balcony across it, on its brackets.
  {
    const q=P.balcony;
    b(q.x0,q.x1,q.z,q.z+q.depth,q.y,.14,DECK);
    b(q.x0,q.x1,q.z+q.depth-.08,q.z+q.depth,q.y+.14,.92,TIMBER);
    for(let x=q.x0;x<=q.x1;x+=.42) b(x-.03,x+.03,q.z+q.depth-.07,q.z+q.depth-.01,q.y+.2,.72,TIMBER);
    for(const x of [q.x0+.2,(q.x0+q.x1)/2,q.x1-.2]) b(x-.08,x+.08,q.z,q.z+q.depth,q.y-.7,.7,TIMBER);
    // Doors out onto it, and the window above in the gable.
    b(q.x0+1.5,q.x0+3.3,q.z-.05,q.z+.04,q.y+.16,2.1,TIMBER);
    b(q.x0+1.62,q.x0+3.18,q.z+.01,q.z+.05,q.y+.28,1.86,GLASS);
    b(F.width/2-1.1,F.width/2+1.1,q.z-.05,q.z+.03,top+.4,1.5,TIMBER);
    b(F.width/2-.95,F.width/2+.95,q.z-.01,q.z+.03,top+.52,1.26,GLASS);
  }
  // Windows on the ground floor of the same face.
  for(const x of [1.6,5.0,8.4,11.6]){
    b(x-.75,x+.75,F.depth-.05,F.depth+.04,1.15,1.55,TIMBER);
    b(x-.62,x+.62,F.depth+.01,F.depth+.05,1.27,1.31,GLASS);
  }
  // The entry porch: posts, the beam across them, and the brackets under it.
  {
    const p=P.porch;
    for(const z of [p.z0+.3,p.z1-.3]){
      b(p.x+p.out-.36,p.x+p.out-.14,z-.11,z+.11,0,p.height,TIMBER);
      b(p.x+p.out-.5,p.x+p.out,z-.16,z+.16,p.height-.36,.3,TIMBER);
    }
    b(p.x,p.x+p.out,p.z0+.2,p.z0+.42,p.height-.34,.28,TIMBER);
    b(p.x,p.x+p.out,p.z1-.42,p.z1-.2,p.height-.34,.28,TIMBER);
    // The door under it.
    b(p.x-.05,p.x+.04,(p.z0+p.z1)/2-.9,(p.z0+p.z1)/2+.9,0,2.35,TIMBER);
    b(p.x+.01,p.x+.05,(p.z0+p.z1)/2-.74,(p.z0+p.z1)/2+.74,.12,2.05,GLASS);
    // The paved apron it stands on.
    const g=clubhouseHeight(sample,p.x+p.out+1.2,(p.z0+p.z1)/2)-floor;
    b(p.x,p.x+p.out+2.4,p.z0-.6,p.z1+.6,g,.06,0x9a978d);
  }
  // The deck rail off the south-west end.
  {
    const d=P.deck,y=d.height;
    for(const [x0,x1,z0,z1] of [[d.x0,d.x1,d.z1-.08,d.z1],[d.x0,d.x0+.08,d.z0,d.z1],
        [d.x1-.08,d.x1,d.z0,d.z1]]){
      b(x0,x1,z0,z1,y,.94,TIMBER);
    }
    for(let x=d.x0+.4;x<d.x1;x+=.4) b(x-.03,x+.03,d.z1-.07,d.z1-.01,y+.06,.8,TIMBER);
  }
  // The glazed room's frame, so it reads as a room and not a block of water.
  {
    const s=P.sunroom;
    for(const x of [s.x0,s.x1]) b(x-.05,x+.05,s.z0,s.z1,0,s.height,TIMBER);
    for(const z of [s.z0,s.z1]) b(s.x0,s.x1,z-.05,z+.05,0,s.height,TIMBER);
    for(let x=s.x0+.9;x<s.x1;x+=.9) b(x-.04,x+.04,s.z1-.06,s.z1+.02,0,s.height,TIMBER);
    b(s.x0-.08,s.x1+.08,s.z0-.08,s.z1+.08,s.height,.12,SHINGLE);
  }
  clubhouseMerge(parts,group,"clubhouse-frontage");
  return model;
}
