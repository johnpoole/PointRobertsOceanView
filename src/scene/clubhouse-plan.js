// The golf clubhouse, 1350 Pelican Place. OSM geographic anchor; elevation and
// wing estimates: CONTINUE-clubhouse.md.
import { toWorld } from "../geo.js";
export const CLUBHOUSE={
  footprint:[[48.9960338,-123.0825126],[48.9961365,-123.0824159],
    [48.9960786,-123.0822732],[48.9959759,-123.0823698]],
  // The core is what OSM traced: 13.44 by 12.26 m. Everything below hangs off it
  // and is read off the county aerial, not surveyed.
  wallHeight:5.4,ridgeRise:5.6,eave:.85,
  // The gable end faces the course, and the balcony is across it. Whatever sits
  // on a traced wall takes its line from the trace below rather than repeating
  // the number here, which is how the balcony ended up two millimetres inside
  // the wall it hangs on.
  balcony:{z:0,x0:3.2,x1:10.2,y:4.15,depth:1.35},
  // The entry porch on the north-east end, under its own gable.
  porch:{x:0,z0:6.4,z1:11.4,out:3.2,height:3.4,rise:2.1},
  // The lower wing off the south-west end, with the deck in front of it.
  wing:{x0:-6.4,x1:0,z0:3.4,z1:0,height:3.3,rise:1.1},
  deck:{x0:-6.4,x1:1.2,z0:0,z1:0,height:1.05},
  // The glazed room at the far end of the wing.
  sunroom:{x0:-6.4,x1:-2.6,z0:6.6,z1:11.6,height:2.9},
  // The ridge stands at wallHeight + ridgeRise, and the photograph shows the
  // chimney well clear of it.
  chimney:{x:9.2,z:4.6,side:1.25,height:11.9},
  logCourse:.34,
};
const ring=CLUBHOUSE.footprint.map(p=>toWorld(...p)),origin=ring[0],east=ring[1];
export const clubhouseFrame={origin,
  angle:Math.atan2(-(east.z-origin.z),east.x-origin.x),
  width:Math.hypot(east.x-origin.x,east.z-origin.z)};
export function clubhousePoint(x,z,y=0){const {origin:o,angle:a}=clubhouseFrame;return{x:o.x+Math.cos(a)*x+Math.sin(a)*z,y,z:o.z-Math.sin(a)*x+Math.cos(a)*z}}
export function clubhouseLocal(p){const {origin:o,angle:a}=clubhouseFrame,x=p.x-o.x,z=p.z-o.z;return{x:Math.cos(a)*x-Math.sin(a)*z,z:Math.sin(a)*x+Math.cos(a)*z}}
export const clubhouseRing=CLUBHOUSE.footprint.map(p=>clubhouseLocal(toWorld(...p)));
Object.assign(clubhouseFrame,{depth:clubhouseRing[3].z,ridge:clubhouseRing[3].z/2});
// The walls the trace gives, written back into the parts that hang off them.
CLUBHOUSE.balcony.z=clubhouseFrame.depth;
CLUBHOUSE.porch.x=clubhouseFrame.width;
CLUBHOUSE.wing.z1=clubhouseFrame.depth;
CLUBHOUSE.deck.z0=clubhouseFrame.depth;
CLUBHOUSE.deck.z1=clubhouseFrame.depth+4.15;
export function isClubhouseBuilding(b){const p=b.coords?.[0];return !!p&&Math.abs(p[0]-48.9960338)<1e-8&&Math.abs(p[1]+123.0825126)<1e-8}
