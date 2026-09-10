// The US border station at Point Roberts, Tyee Drive at the 49th parallel.
// OSM geographic anchor; elevation and site estimates: CONTINUE-border.md.
import { toWorld } from "../geo.js";
export const BORDER={
  footprint:[[49.0015587,-123.0681801],[49.0015491,-123.06827],[49.001521,-123.0682628],
    [49.0015118,-123.068347],[49.0013874,-123.0683167],[49.0013815,-123.0683714],
    [49.0013738,-123.0684402],[49.0013644,-123.0685233],[49.0013586,-123.0685758],
    [49.0012651,-123.068552],[49.0012707,-123.0685003],[49.0012797,-123.0684171],
    [49.0012869,-123.0683499],[49.0012929,-123.0682938],[49.0012456,-123.0682934],
    [49.0012458,-123.0682293],[49.0011993,-123.0682282],[49.001199,-123.0682451],
    [49.001158,-123.0682432],[49.0011085,-123.0682403],[49.0010539,-123.0682371],
    [49.0010064,-123.0682355],[49.0010084,-123.0680972],[49.001034,-123.0680978],
    [49.0010894,-123.0680983],[49.0011411,-123.0680988],[49.0011994,-123.0680989],
    [49.0011993,-123.0681815],[49.0012127,-123.0681849],[49.0012216,-123.0680991],
    [49.0013114,-123.0681207],[49.0013125,-123.0681092],[49.0013164,-123.0680698],
    [49.0014122,-123.0680911],[49.0014075,-123.0681424]],
  // The four parts, by their own corners in the traced outline. The canopy is a
  // roof on posts over the lanes; the other three are building.
  canopy:[4,5,6,7,8,9,10,11,12,13],
  office:[3,4,13,30,31,32,33,34,0,1,2],
  middle:[13,14,15,16,27,28,29,30],
  wing:[17,18,19,20,21,22,23,24,25,26,27],
  officeHeight:6.6,middleHeight:4.6,wingHeight:5.0,wingRise:.8,
  canopyDeck:5.4,canopyFascia:.55,canopyEave:.9,
  // Under the canopy, across the lanes, in the frame's own metres.
  posts:[[1.4,.9],[1.4,9.6],[9.5,.9],[9.5,9.6],[17.6,.9],[17.6,9.6]],
  gates:[3.4,11.5],gateZ:6.4,
  booths:[[6.2,3.4],[14.3,3.4]],
  // The glazed front of the office looks out over the lanes, west and north.
  glazing:{west:[-11.4,2.2],north:[19.9,25.1]},
  flag:[28.4,-20.2],mast:[17.4,3.6],
  // The sign standing in the grass by the road, and the small one by the door.
  sign:[33.2,-22.6],portSign:[21.9,-1.4],
};
const ring=BORDER.footprint.map(p=>toWorld(...p)),origin=ring[8];
export const borderFrame={origin,
  angle:Math.atan2(-(ring[10].z-ring[9].z),ring[10].x-ring[9].x)};
export function borderPoint(x,z,y=0){const {origin:o,angle:a}=borderFrame;return{x:o.x+Math.cos(a)*x+Math.sin(a)*z,y,z:o.z-Math.sin(a)*x+Math.cos(a)*z}}
export function borderLocal(p){const {origin:o,angle:a}=borderFrame,x=p.x-o.x,z=p.z-o.z;return{x:Math.cos(a)*x-Math.sin(a)*z,z:Math.sin(a)*x+Math.cos(a)*z}}
export const borderRing=BORDER.footprint.map(p=>borderLocal(toWorld(...p)));
export function borderPart(name){return BORDER[name].map(i=>borderRing[i])}
Object.assign(borderFrame,{
  canopyEast:borderRing[13].x,canopyNorth:borderRing[4].z,canopySouth:borderRing[9].z,
  officeNorth:borderRing[0].z,officeEast:borderRing[33].x,middleSouth:borderRing[27].z,
  // The north wall steps back three metres west of the block that carries the
  // lettering, and the glazing runs along that step and on round to the west.
  stepNorth:borderRing[2].z,stepWest:borderRing[3].x,letterWest:borderRing[1].x,letterEast:borderRing[0].x,
  wingSouth:borderRing[22].z,
});
export function isBorderBuilding(b){const p=b.coords?.[0];return !!p&&Math.abs(p[0]-49.0015587)<1e-8&&Math.abs(p[1]-(-123.0681801))<1e-8}
