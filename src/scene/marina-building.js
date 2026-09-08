// Close detail estimated from inspected 2022/2023 references; see source notes.
import { MARINA_BUILDING as PLAN, marinaBuildingFrame as FRAME, marinaBuildingAerial, marinaBuildingLocal } from "./marina-building-plan.js";
import { buildMarinaBuildingBase, marinaBuildingMerge, marinaBuildingBox } from "./marina-building-base.js";
export function buildMarinaBuilding(scene,sample){
  const model=buildMarinaBuildingBase(scene,sample),{group,floor}=model;group.name="marina-building-detailed-model";
  const parts=[],w=FRAME.width,l=FRAME.length,white=0xe3e5de,glass=0x354f59;
  const b=(x0,x1,z0,z1,y,h,color)=>parts.push(marinaBuildingBox(x0,x1,z0,z1,floor+y,h,color));
  // Opaque low-cost glazing: pale frames, inset dark panes, no transparent sorting.
  function westWindow(x,z0,z1,y,h,n){
    b(x-.07,x+.03,z0,z1,y,h,white);b(x-.10,x-.075,z0+.10,z1-.10,y+.1,h-.2,glass);
    for(let i=1;i<n;i++){const z=z0+(z1-z0)*i/n;b(x-.13,x-.10,z-.028,z+.028,y,h,white)}
    b(x-.13,x-.10,z0,z1,y+h*.72,.045,white);
  }
  function southWindow(z,x0,x1,y,h,n){
    b(x0,x1,z-.03,z+.07,y,h,white);b(x0+.10,x1-.10,z+.075,z+.10,y+.10,h-.20,glass);
    for(let i=1;i<n;i++){const x=x0+(x1-x0)*i/n;b(x-.028,x+.028,z+.10,z+.13,y,h,white)}
    b(x0,x1,z+.10,z+.13,y+h*.72,.045,white);
  }
  for(const [z0,z1,n] of PLAN.westUpper)westWindow(0,z0,z1,4.35,1.35,n);
  for(const [z0,z1,n] of PLAN.westLower)westWindow(0,z0,z1,.2,2.5,n);
  westWindow(-1.35,l-4.8,l-.15,.18,2.7,3);westWindow(-1.35,l-4.8,l-.15,3.7,2.25,3);
  southWindow(l,-1.25,3.7,.18,2.7,3);southWindow(l,-1.25,3.7,3.7,2.25,3);
  // Smaller south-end office windows and a ground-level double entry.
  for(const [a,c] of [[6.3,9.8],[12.6,16.1],[18.8,22.3]])southWindow(l,a,c,4.15,1.55,3);
  southWindow(l,6.8,9.7,.15,2.55,2);southWindow(l,13,16,.95,1.6,3);southWindow(l,19,22,.95,1.6,3);
  // Large west workshop opening, with segmented overhead door under a deep eave.
  b(-.10,-.015,19.2,28.0,.10,5.85,0xe1e0d4);b(-.135,-.11,19.45,27.75,.12,5.58,0x8a8980);
  for(let y=.7;y<5.7;y+=.62)b(-.16,-.14,19.45,27.75,y,.035,0x696d69);
  westWindow(0,31.2,33.0,4.35,1.35,1);
  // Canopy support posts and a clearly framed entrance under it.
  for(const z of [35.2,39.1,43.1,47.1,50.8])b(-3.23,-3.09,z-.07,z+.07,.07,2.78,0xd9d9ce);
  b(-.17,-.14,45.5,45.56,.35,2.1,white);
  // Roof perimeter caps retain the two distinct roof materials.
  for(const [z0,z1,color] of [[-.7,PLAN.split,0xadb2ac],[PLAN.split,l+.65,0xe7e8df]]){
    b(-.8,-.63,z0,z1,6.56,.18,color);b(w+.63,w+.8,z0,z1,6.56,.18,color);
  }
  b(-.8,w+.8,-.7,-.52,6.56,.18,0xadb2ac);b(-.65,w+.65,l+.48,l+.65,6.56,.18,0xe7e8df);
  b(-1.6,-1.4,l-5.2,l+.3,6.56,.18,white);
  // Horizontal storey band and corner posts are stronger cues than fine siding.
  b(-1.5,-1.36,l-5,l,3.05,.30,white);b(-1.35,w,l+.03,l+.12,3.05,.25,white);
  for(const z of [l-4.95,l-.1])b(-1.54,-1.36,z-.07,z+.07,.05,6.35,white);
  // Pale open railing around the exposed terrace, with a south entrance gap.
  function westRail(z0,z1){for(let z=z0;z<=z1;z+=1.7)b(-3.68,-3.59,z-.045,z+.045,.1,1.03,white);for(const y of [.48,1.10])b(-3.71,-3.56,z0,z1,y,.065,white)}
  westRail(PLAN.canopyStart,l+3.1);
  for(const [x0,x1] of [[-3.68,5.6],[9.9,w*.5]]){
    for(let x=x0;x<=x1;x+=1.7)b(x-.045,x+.045,l+3.01,l+3.10,.1,1.03,white);
    for(const y of [.48,1.10])b(x0,x1,l+3.0,l+3.12,y,.065,white);
  }
  // Six rooftop groups from the county image; dimensions remain visual estimates.
  for(const pixel of PLAN.equipment){const p=marinaBuildingLocal(marinaBuildingAerial(...pixel));b(p.x-.7,p.x+.7,p.z-.9,p.z+.9,6.57,.68,0x8c9896);b(p.x-.76,p.x+.76,p.z-.96,p.z+.96,7.25,.07,0x687777)}
  marinaBuildingMerge(parts,group,"marina-building-windows-canopy-and-roof-detail");
  return model;
}
