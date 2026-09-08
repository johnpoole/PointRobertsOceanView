// 2022 county aerial displayed at 720 square, left x=280, top y=0.
// Building 2 in the baked OSM data. See CONTINUE-marketplace.md.
import { toWorld } from "../geo.js";
export const MARKET = {
  footprint:[[48.9858558,-123.0663436],[48.9858712,-123.0663436],[48.985871,-123.0658543],
    [48.9858025,-123.0658544],[48.9858025,-123.0657919],[48.9856748,-123.065792],
    [48.9856385,-123.0656948],[48.985585,-123.0657412],[48.9855115,-123.0657396],
    [48.9855101,-123.0658893],[48.9852845,-123.0658843],[48.9852849,-123.0658371],
    [48.9852638,-123.0657932],[48.985236,-123.0657932],[48.9852361,-123.0658857],
    [48.98518,-123.0658857],[48.9851801,-123.0664117],[48.9858559,-123.0664114]],
  paving:[[485,209],[774,209],[837,219],[864,271],[834,352],[845,479],[818,557],
    [765,587],[601,581],[532,559],[490,559],[509,510],[502,472],[483,445],[478,409],[479,294]],
  drives:[[[312,258],[485,258],[479,294],[326,293]],[[310,418],[483,418],[493,451],[311,451]]],
  // Frontage north to south: end tower, blue canopy, window bay, sign bay,
  // window bay, blue canopy, end tower. Heights are photo estimates in metres.
  bays:[[247,261,"tower"],[261,310,"canopy"],[310,356,"windows"],
    [356,403,"sign"],[403,446,"windows"],[446,484,"canopy"],[484,497,"tower"]],
  hvac:[[655,358],[655,399],[668,352],[735,446],[775,354],[765,300]],
  parkingRows:[[535,615,239,279],[512,616,311,353],[514,616,385,425],[532,616,456,496]],
};
export function marketLatLon(px,py) {
  const x=-13699853.981761321+(px-280)/720*330;
  const y=6272574.886913513-py/720*330;
  return {lat:(2*Math.atan(Math.exp(y/6378137))-Math.PI/2)*180/Math.PI,lon:x/6378137*180/Math.PI};
}
export function marketPoint(px,py,y=0){const p=marketLatLon(px,py);return toWorld(p.lat,p.lon,y)}
export function isMarketplaceBuilding(b){const p=b.coords?.[0];return !!p&&Math.abs(p[0]-48.9858558)<1e-8&&Math.abs(p[1]+123.0663436)<1e-8}
export function marketClip(ring,axis,value,greater) {
  const out=[],inside=p=>greater?p[axis]>=value:p[axis]<=value;
  for(let i=0;i<ring.length;i++) {
    const a=ring[i],b=ring[(i+1)%ring.length];if(inside(a))out.push(a);
    if(inside(a)!==inside(b)){const t=(value-a[axis])/(b[axis]-a[axis]);out.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t})}
  }
  return out;
}
export function marketRings(){
  const outline=MARKET.footprint.map(p=>toWorld(...p));
  const body=marketClip(outline,"x",marketPoint(654,350).x,true),join=marketPoint(700,376).z;
  return {outline,body,north:marketClip(body,"z",join,false),south:marketClip(body,"z",join,true)};
}
