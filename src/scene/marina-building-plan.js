// Main shore building, separate from the docks. Sources: CONTINUE-marina-building.md.
import { toWorld } from "../geo.js";
export const MARINA_BUILDING = {
  footprint:[[48.9774121,-123.0634696],[48.9774911,-123.0631625],
    [48.9770109,-123.062876],[48.976932,-123.0631831]],
  // Metres estimated from the March 2023 aerial panorama, not surveyed heights.
  wallHeight:6.4, split:30, canopyStart:35, canopyEnd:51,
  westUpper:[[35,41,4],[43,50,5]],
  westLower:[[35.5,41,4],[42.5,49.5,5]],
  equipment:[[622,411],[639,425],[679,402],[714,465],[685,496],[639,491]],
  apron:[[398,220],[530,259],[583,437],[474,475]],
};
const [nw,ne,,sw]=MARINA_BUILDING.footprint.map(p=>toWorld(...p));
export const marinaBuildingFrame={
  origin:nw, width:Math.hypot(ne.x-nw.x,ne.z-nw.z), length:Math.hypot(sw.x-nw.x,sw.z-nw.z),
  angle:Math.atan2(-(ne.z-nw.z),ne.x-nw.x),
};
export function marinaBuildingPoint(x,z,y=0){
  const {origin,angle}=marinaBuildingFrame,c=Math.cos(angle),s=Math.sin(angle);
  return {x:origin.x+c*x+s*z,y,z:origin.z-s*x+c*z};
}
export function marinaBuildingLocal(p){
  const {origin,angle}=marinaBuildingFrame,c=Math.cos(angle),s=Math.sin(angle),x=p.x-origin.x,z=p.z-origin.z;
  return {x:c*x-s*z,z:s*x+c*z};
}
// County 2022 crop: EPSG:3857, 220 m square, displayed at 720 px at x=280.
export function marinaBuildingAerial(px,py){
  const x=-13699442.759390783+(px-280)/720*220,y=6271106.988185442-py/720*220;
  return toWorld((2*Math.atan(Math.exp(y/6378137))-Math.PI/2)*180/Math.PI,x/6378137*180/Math.PI);
}
export function isMarinaMainBuilding(b){const p=b.coords?.[0];return !!p&&Math.abs(p[0]-48.9774121)<1e-8&&Math.abs(p[1]+123.0634696)<1e-8}
