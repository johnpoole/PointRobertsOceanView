import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
globalThis.location={protocol:"http:",host:"localhost"};
function load(file){const source=fs.readFileSync(file,"utf8").replace(/from\s+"([^"]+)"/g,(_,ref)=>`from "${load(path.resolve(path.dirname(file),ref))}"`);return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`}
const {POST_OFFICE:p,postOfficeFrame:f,postOfficePoint:point,postOfficeLocal:local,postOfficeRing:ring,postOfficeAerial:aerial,postOfficeWings:wings,isPostOfficeBuilding:match}=await import(load(path.join(here,"post-office-plan.js")));
const {toWorld}=await import(load(path.join(here,"../geo.js")));
const data=JSON.parse(fs.readFileSync(path.join(here,"../../assets/osm/features.json"),"utf8"));

assert.deepEqual(data.buildings.map((b,i)=>match(b)?i:null).filter(i=>i!==null),[1],"only the post office footprint is replaced");
assert.deepEqual(p.footprint,data.buildings[1].coords.slice(0,-1),"the exact baked outline, corner for corner");
for(let i=0;i<ring.length;i++){const a=point(ring[i].x,ring[i].z),b=toWorld(...p.footprint[i]);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<1e-8,"exact mapped wall outline")}
for(const [x,z] of [[-4,-4],[0,0],[f.east,f.baySouth]]){const q=local(point(x,z));assert.ok(Math.abs(q.x-x)<1e-8&&Math.abs(q.z-z)<1e-8,"the frame inverts")}

// The building as measured: about 23.7 m across including the west wing, 15.5 m
// deep, and the front squared to the compass within a degree.
assert.ok(Math.abs(f.east-f.westX-23.68)<.2,`width ${(f.east-f.westX).toFixed(2)}`);
assert.ok(Math.abs(f.baySouth-f.north-15.48)<.2,`depth ${(f.baySouth-f.north).toFixed(2)}`);
assert.ok(Math.abs(f.angle*180/Math.PI-(-.7))<1.5,`front bearing ${(90-f.angle*180/Math.PI).toFixed(1)}`);

// The eastern nine and a half metres of the front step forward, and that step is
// the entrance bay the sign hangs on.
assert.ok(f.baySouth>f.mainSouth,"the bay stands proud of the main wall");
assert.ok(Math.abs(f.baySouth-f.mainSouth-1.81)<.1,`bay projection ${(f.baySouth-f.mainSouth).toFixed(2)}`);
assert.ok(Math.abs(f.east-f.bayWest-9.47)<.1,`bay width ${(f.east-f.bayWest).toFixed(2)}`);
// The west wing hangs off the other end and its roof is the lower one.
assert.ok(f.westX<f.mainWest&&Math.abs(f.mainWest-f.westX-3.81)<.1,`west wing ${(f.mainWest-f.westX).toFixed(2)}`);
assert.ok(p.westHeight<p.wallHeight,"the west wing is lower than the block it hangs off");

// Everything on the front sits inside the wall it is fixed to.
for(const [x0,x1] of [p.doors,...p.bayWindows,p.bench]) assert.ok(x0>f.bayWest&&x1<f.east,`${x0} ${x1} inside the bay`);
assert.ok(p.window[0]>f.mainWest&&p.window[1]<f.bayWest,"the wide window is on the main wall");
assert.ok(p.bollard>p.doors[0]-2&&p.bollard<p.doors[1],"the bollard stands by the door");
assert.ok(p.doors[0]>p.bench[1],"the bench sits west of the doors, as photographed");

// South is the parking lot: the front of the building faces it.
assert.ok(point(f.east/2,f.baySouth).z>point(f.east/2,f.north).z,"the entrance faces south onto the lot");
// The flagpole stands clear of the building, east of it.
const pole=aerial(...p.flagpole);
assert.ok(pole.x>f.east,`flagpole ${pole.x.toFixed(2)} m east of the wall`);
assert.ok(pole.z>f.north&&pole.z<f.baySouth+6,"flagpole beside the building, not out in the road");
// The lamp standard stands out in the lot, south of the front.
const lamp=aerial(...p.lamp);
assert.ok(lamp.z>f.baySouth,"the lamp standard is out in the parking lot");

// The outline splits in two at the step, and no corner is lost doing it.
const {west,main}=wings();
assert.ok(west.length>=4&&main.length>=6,`wings ${west.length} ${main.length}`);
for(const q of west) assert.ok(q.x<=f.mainWest+1e-9,"west wing stays west of the step");
for(const q of main) assert.ok(q.x>=f.mainWest-1e-9,"main block stays east of the step");

console.log(`PASS: exact post office replacement, mapped wall outline, ${(f.east-f.westX).toFixed(2)} x ${(f.baySouth-f.north).toFixed(2)} m, entrance bay ${(f.east-f.bayWest).toFixed(2)} m proud by ${(f.baySouth-f.mainSouth).toFixed(2)} m.`);
