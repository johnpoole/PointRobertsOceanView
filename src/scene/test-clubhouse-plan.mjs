import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
globalThis.location={protocol:"http:",host:"localhost"};
function load(file){const source=fs.readFileSync(file,"utf8").replace(/from\s+"([^"]+)"/g,(_,ref)=>`from "${load(path.resolve(path.dirname(file),ref))}"`);return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`}
const {CLUBHOUSE:p,clubhouseFrame:f,clubhousePoint:point,clubhouseLocal:local,clubhouseRing:ring,isClubhouseBuilding:match}=await import(load(path.join(here,"clubhouse-plan.js")));
const {toWorld}=await import(load(path.join(here,"../geo.js")));
const data=JSON.parse(fs.readFileSync(path.join(here,"../../assets/osm/features.json"),"utf8"));
const golf=JSON.parse(fs.readFileSync(path.join(here,"../../assets/osm/golf.json"),"utf8"));

assert.deepEqual(data.buildings.map((b,i)=>match(b)?i:null).filter(i=>i!==null),[84],"only the clubhouse footprint is replaced");
assert.deepEqual(p.footprint,data.buildings[84].coords.slice(0,-1),"the exact baked outline, corner for corner");
for(let i=0;i<ring.length;i++){const a=point(ring[i].x,ring[i].z),b=toWorld(...p.footprint[i]);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<1e-8,"exact mapped outline")}
for(const [x,z] of [[0,0],[13,12],[-6,16]]){const q=local(point(x,z));assert.ok(Math.abs(q.x-x)<1e-8&&Math.abs(q.z-z)<1e-8,"the frame inverts")}

// The core as traced: a rectangle 13.44 by 12.26 m, square to itself.
assert.ok(Math.abs(f.width-13.44)<.1,`width ${f.width.toFixed(2)}`);
assert.ok(Math.abs(f.depth-12.26)<.1,`depth ${f.depth.toFixed(2)}`);
assert.ok(Math.abs(ring[1].z)<.02&&Math.abs(ring[3].x)<.02,"the frame runs along its own walls");
// The building stands north-east: the frame carries that turn.
assert.ok(Math.abs(f.angle*180/Math.PI-58.29)<.5,`frame ${(f.angle*180/Math.PI).toFixed(2)} deg`);

// The golf bake says the same building is the clubhouse, at the same place.
const club=golf.features.find(g=>g.kind==="clubhouse");
assert.ok(club,"the golf bake carries a clubhouse");
const mid=club.coords.reduce((a,c)=>[a[0]+c[0]/club.coords.length,a[1]+c[1]/club.coords.length],[0,0]);
const here2=p.footprint.reduce((a,c)=>[a[0]+c[0]/p.footprint.length,a[1]+c[1]/p.footprint.length],[0,0]);
assert.ok(Math.hypot((mid[0]-here2[0])*111320,(mid[1]-here2[1])*73000)<3,"the two bakes agree where it stands");

// The roof is steep, which is what the club's photograph shows and what a hip
// would not be: the rise is most of the half-depth.
assert.ok(p.ridgeRise/(f.depth/2)>0.8,`roof pitch ${(p.ridgeRise/(f.depth/2)).toFixed(2)}`);
assert.ok(p.wallHeight>4.5&&p.wallHeight<6.5,`two storeys of log at ${p.wallHeight} m`);

// The balcony crosses the gable end that faces the course, and stands over the
// ground floor rather than through it.
assert.equal(p.balcony.z,f.depth,"the balcony is on the gable end");
assert.ok(p.balcony.x0>0&&p.balcony.x1<f.width,"and inside that wall");
assert.ok(p.balcony.y>2.4&&p.balcony.y<p.wallHeight,`balcony at ${p.balcony.y} m`);

// The porch is off the north-east end, the wing and deck off the south-west, so
// they cannot be standing in each other.
assert.ok(p.porch.x>=f.width,"the porch is beyond the north-east wall");
assert.ok(p.wing.x1<=0&&p.wing.x0<0,"the wing is beyond the south-west wall");
assert.ok(p.deck.z0>=f.depth,"the deck is out on the course side");
assert.ok(p.sunroom.x0>=p.wing.x0&&p.sunroom.x1<=p.wing.x1,"the glazed room is inside the wing");
assert.ok(p.wing.height<p.wallHeight,"the wing is lower than the core");
assert.ok(p.chimney.height>p.wallHeight+p.ridgeRise-1,"the chimney clears the ridge");
assert.ok(p.chimney.x>0&&p.chimney.x<f.width&&p.chimney.z>0&&p.chimney.z<f.depth,
  "the chimney rises through the core, not beside it");

console.log(`PASS: clubhouse ${f.width.toFixed(2)} x ${f.depth.toFixed(2)} m core at ${(f.angle*180/Math.PI).toFixed(2)} deg, `+
  `balcony on the course gable, porch north-east, wing and deck south-west.`);
