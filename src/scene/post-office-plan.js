// Point Roberts Post Office, 1582 Gulf Road. OSM geographic anchor; façade,
// roof and site estimates: CONTINUE-post-office.md.
import { toWorld } from "../geo.js";
export const POST_OFFICE={
  footprint:[[48.9850727,-123.0686868],[48.9850342,-123.068686],[48.9850338,-123.0687367],
    [48.9849889,-123.0687358],[48.9849894,-123.0686836],[48.9849501,-123.0686829],
    [48.9849513,-123.0685406],[48.984935,-123.0685403],[48.9849361,-123.0684107],
    [48.985075,-123.0684135]],
  wallHeight:3.1,mainRise:1.8,entryRise:2.5,westHeight:2.6,westRise:.9,eave:.7,
  // Aerial pixels, 1200 px over the 90 m web-mercator box in the notes.
  lot:[[0,715],[420,715],[420,752],[700,752],[700,878],[975,878],[975,1010],[0,1010]],
  walk:[[700,752],[975,752],[975,872],[700,872]],
  bed:[[10,995],[880,995],[930,1085],[10,1085]],
  flagpole:[945,735],
  lamp:[865,940],
  // South wall, west of the entrance bay: one wide window.
  window:[7.24,8.81,1.2,1.15],
  // Entrance bay, west to east: two windows, then the doors.
  bayWindows:[[12.59,14.02],[14.87,16.57]],
  doors:[16.57,18.37],
  bench:[14.68,15.9],
  bollard:16.0,
};
const ring=POST_OFFICE.footprint.map(p=>toWorld(...p)),origin=ring[0],east=ring[9];
export const postOfficeFrame={origin,angle:Math.atan2(-(east.z-origin.z),east.x-origin.x),width:Math.hypot(east.x-origin.x,east.z-origin.z)};
export function postOfficePoint(x,z,y=0){const {origin:o,angle:a}=postOfficeFrame;return{x:o.x+Math.cos(a)*x+Math.sin(a)*z,y,z:o.z-Math.sin(a)*x+Math.cos(a)*z}}
export function postOfficeLocal(p){const {origin:o,angle:a}=postOfficeFrame,x=p.x-o.x,z=p.z-o.z;return{x:Math.cos(a)*x-Math.sin(a)*z,z:Math.sin(a)*x+Math.cos(a)*z}}
export const postOfficeRing=POST_OFFICE.footprint.map(p=>postOfficeLocal(toWorld(...p)));
const r=postOfficeRing;
// The west wing steps out past the north-west corner; the eastern nine metres of
// the front step forward, and that projection is the entrance bay.
Object.assign(postOfficeFrame,{
  westX:r[2].x,westNorth:r[1].z,westSouth:r[3].z,
  mainWest:r[4].x,mainSouth:r[5].z,
  bayWest:r[6].x,baySouth:r[7].z,east:r[8].x,north:r[0].z,
});
export function postOfficeAerial(px,py){const x=-13699980.9421446+px*.075,y=6272362.200787939-py*.075;return postOfficeLocal(toWorld((2*Math.atan(Math.exp(y/6378137))-Math.PI/2)*180/Math.PI,x/6378137*180/Math.PI))}
export function isPostOfficeBuilding(b){const p=b.coords?.[0];return !!p&&Math.abs(p[0]-48.9850727)<1e-8&&Math.abs(p[1]+123.0686868)<1e-8}
// The west wing carries a lower roof than the block it hangs off, so the outline
// is cut in two at the corner where the front wall steps out.
export function postOfficeWings(){
  const f=postOfficeFrame;
  function clip(west){const out=[],inside=p=>west?p.x<=f.mainWest+1e-9:p.x>=f.mainWest-1e-9;
    for(let i=0;i<postOfficeRing.length;i++){const a=postOfficeRing[i],b=postOfficeRing[(i+1)%postOfficeRing.length];
      if(inside(a))out.push(a);
      if(inside(a)!==inside(b)){const t=(f.mainWest-a.x)/(b.x-a.x);out.push({x:f.mainWest,z:a.z+t*(b.z-a.z)})}}
    return out}
  return{west:clip(true),main:clip(false)};
}
