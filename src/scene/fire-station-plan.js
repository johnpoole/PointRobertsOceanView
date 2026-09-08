// Station 58. Geographic anchor and source/estimate notes: CONTINUE-fire-station.md.
import { toWorld } from "../geo.js";
export const FIRE_STATION={
  footprint:[[48.9889611,-123.0438757],[48.9889309,-123.0438756],[48.9889311,-123.0436967],
    [48.9887613,-123.0436961],[48.988761,-123.043896],[48.9887484,-123.043896],
    [48.9887481,-123.0440998],[48.9887606,-123.0440998],[48.9887604,-123.0442757],
    [48.9889413,-123.0442763],[48.9889417,-123.0440001],[48.9889609,-123.0440001]],
  lowHeight:4.1,highHeight:7.6,lowRise:2.2,highRise:1.9,
  apron:[[382,331],[531,331],[531,398],[760,398],[760,290],[800,290],[800,583],[385,583]],
  concrete:[[592,398],[760,398],[760,462],[592,462]],
  // Owner-confirmed low landscaping between the apron and Benson Road.
  frontage:[[375,582],[803,582],[803,634],[375,634]],
  frontageShrubs:[[466,603],[490,608],[520,602],[551,607],[581,602],[611,608],[643,605],[681,604],[733,605],[765,602]],
};
export const fireStationFrame={origin:toWorld(48.9889611,-123.0442763),angle:0};
export function fireStationPoint(x,z,y=0){return{x:fireStationFrame.origin.x+x,y,z:fireStationFrame.origin.z+z}}
export function fireStationLocal(p){return{x:p.x-fireStationFrame.origin.x,z:p.z-fireStationFrame.origin.z}}
export const fireStationRing=FIRE_STATION.footprint.map(p=>fireStationLocal(toWorld(...p)));
Object.assign(fireStationFrame,{width:fireStationRing[3].x,length:fireStationRing[6].z,split:fireStationRing[0].x,
  front:fireStationRing[8].z,north:fireStationRing[9].z,highNorth:fireStationRing[2].z,
  bayWest:fireStationRing[6].x,bayEast:fireStationRing[5].x});
const f=fireStationFrame;
export const fireStationWalkway=[[0,f.front],[f.bayWest,f.front],[f.bayWest,f.front+2.5],[0,f.front+2.5]];
export const fireStationDoors=[
  {x:f.bayWest+3.6,z:f.length,width:5.5,height:3.65},
  {x:f.bayEast-3.6,z:f.length,width:5.5,height:3.65},
  {x:f.split+3.35,z:fireStationRing[3].z,width:4.8,height:3.8},
  {x:f.width-3.75,z:fireStationRing[3].z,width:4.8,height:3.8},
];
export function fireStationAerial(px,py){const x=-13697300.425167553+(px-280)/720*210,y=6273069.594786848-py/720*210;return fireStationLocal(toWorld((2*Math.atan(Math.exp(y/6378137))-Math.PI/2)*180/Math.PI,x/6378137*180/Math.PI))}
const clearedRings=[fireStationRing,FIRE_STATION.apron.map(p=>fireStationAerial(...p)),FIRE_STATION.frontage.map(p=>fireStationAerial(...p)),fireStationWalkway.map(([x,z])=>({x,z}))];
const clearBounds={minX:Math.min(...clearedRings.flat().map(p=>p.x)),maxX:Math.max(...clearedRings.flat().map(p=>p.x)),minZ:Math.min(...clearedRings.flat().map(p=>p.z)),maxZ:Math.max(...clearedRings.flat().map(p=>p.z))};
export function isFireStationClearing(x,z){
  const p=fireStationLocal({x,z});if(p.x<clearBounds.minX||p.x>clearBounds.maxX||p.z<clearBounds.minZ||p.z>clearBounds.maxZ)return false;
  return clearedRings.some(ring=>{let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)inside=!inside}return inside});
}
export function isFireStationBuilding(b){const p=b.coords?.[0];return !!p&&Math.abs(p[0]-48.9889611)<1e-8&&Math.abs(p[1]+123.0438757)<1e-8}
export function fireStationWings(){
  function clip(west){const out=[],inside=p=>west?p.x<=f.split:p.x>=f.split;for(let i=0;i<fireStationRing.length;i++){const a=fireStationRing[i],b=fireStationRing[(i+1)%fireStationRing.length];if(inside(a))out.push(a);if(inside(a)!==inside(b)){const t=(f.split-a.x)/(b.x-a.x);out.push({x:f.split,z:a.z+t*(b.z-a.z)})}}return out}
  return{low:clip(true),high:clip(false)};
}
