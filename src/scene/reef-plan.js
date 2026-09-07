// Digitized from the county 2022 orthophoto. Pixel coordinates refer to its
// 720px display at x=280 in a 1280px browser screenshot; see CONTINUE-reef.md.
// They describe observed features, not surveyed boundaries or current furniture.
import { toWorld } from "../geo.js";
export const REEF = {
  footprint: [[48.9846873,-123.0836764],[48.9845352,-123.0836748],
    [48.984535,-123.0837129],[48.984451,-123.083712],
    [48.9844515,-123.083593],[48.9844721,-123.0835932],
    [48.9844739,-123.0831956],[48.9846894,-123.0831979]],
  patio: [[395,313],[515,313],[532,331],[532,393],[515,393],[515,403],[395,403]],
  lawn: [[361,210],[530,210],[531,301],[395,301],[395,403],[377,403]],
  paving: [[396,412],[514,412],[514,458],[580,458],[580,441],[783,441],
    [783,292],[847,287],[876,333],[891,588],[426,588]],
  roofVents: [[549,300],[577,325],[579,381],[624,357],[665,315],[716,362],[748,327]],
  tables: [[494,328],[510,344],[503,365],[489,387]],
  fence: [[375,405],[514,405]],
  sign: [599,544], // Roadside post in the aerial; cabinet runs north–south.
  seaEdge: [[359,209],[365,306],[376,405],[387,452],[411,558],[420,590]],
};
export function reefLatLon(px,py) {
  const x=-13701668.092274254+(px-280)/720*160;
  const y=6272325.347541674-py/720*160;
  return {lat:(2*Math.atan(Math.exp(y/6378137))-Math.PI/2)*180/Math.PI,lon:x/6378137*180/Math.PI};
}
export function reefPoint(px,py,y=0) {
  const ll=reefLatLon(px,py); return toWorld(ll.lat,ll.lon,y);
}
export function isReefBuilding(building) {
  const p=building.coords?.[0];
  return p && Math.abs(p[0]-48.9846873)<1e-8 && Math.abs(p[1]+123.0836764)<1e-8;
}
// Split the exact OSM outline at the visible join between the western wing and
// main roof. The union remains the footprint, including the southwest step.
export function reefFootprints() {
  const ring=REEF.footprint.map(([lat,lon])=>toWorld(lat,lon));
  const split=reefPoint(578,300).x;
  function clip(west) {
    const out=[];
    for(let i=0;i<ring.length;i++) {
      const a=ring[i],b=ring[(i+1)%ring.length],inside=p=>west?p.x<=split:p.x>=split;
      if(inside(a))out.push(a);
      if(inside(a)!==inside(b)) {
        const t=(split-a.x)/(b.x-a.x);out.push({x:split,z:a.z+(b.z-a.z)*t});
      }
    }
    return out;
  }
  return {west:clip(true),main:clip(false)};
}
