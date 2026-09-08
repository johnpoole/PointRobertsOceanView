import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));globalThis.location={protocol:"http:",host:"localhost"};
function load(file){const source=fs.readFileSync(file,"utf8").replace(/from\s+"([^"]+)"/g,(_,ref)=>`from "${load(path.resolve(path.dirname(file),ref))}"`);return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`}
const {FIRE_STATION:p,fireStationFrame:f,fireStationPoint:point,fireStationRing:ring,fireStationWings:wings,fireStationDoors:doors,isFireStationBuilding:match,isFireStationClearing:clear,fireStationAerial:aerial}=await import(load(path.join(here,"fire-station-plan.js")));
const {toWorld}=await import(load(path.join(here,"../geo.js"))),data=JSON.parse(fs.readFileSync(path.join(here,"../../assets/osm/features.json"),"utf8"));
assert.deepEqual(data.buildings.map((b,i)=>match(b)?i:null).filter(i=>i!==null),[133],"only main station is replaced; rear structure retained");
assert.deepEqual(p.footprint,data.buildings[133].coords.slice(0,-1));
for(let i=0;i<ring.length;i++){const a=point(ring[i].x,ring[i].z),b=toWorld(...p.footprint[i]);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<1e-8)}
const area=r=>Math.abs(r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a.x*b.z-b.x*a.z},0))/2;
const w=wings();assert.ok(Math.abs(area(w.low)+area(w.high)-area(ring))<1e-6,"low/high split conserves exact footprint area");
assert.equal(doors.length,4);for(let i=0;i<doors.length;i++){const d=doors[i],lo=i<2?f.bayWest:f.split,hi=i<2?f.bayEast:f.width;assert.ok(d.x-d.width/2>lo&&d.x+d.width/2<hi,"bay fits its wing");assert.ok(d.height<p.lowHeight);assert.ok(d.z>f.highNorth,"bays face the southern apron")}
assert.ok(p.highHeight>p.lowHeight+p.lowRise,"tall wing rises above low roof");
assert.ok(doors[3].x+doors[3].width/2+.2<f.width-1,"east personnel entrance stays clear of apparatus door frame");
for(const q of [point(20,10),point(30,35)])assert.ok(clear(q.x,q.z),"building and apron exclude scattered trees");
for(const pixel of [[600,200],[900,350],[350,300]]){const q=aerial(...pixel),v=point(q.x,q.z);assert.equal(clear(v.x,v.z),false,"surrounding forest stays outside clearing")}
console.log(`PASS: station-only replacement, exact wall outline/wing areas, four south-facing bays. ${f.width.toFixed(2)} x ${f.length.toFixed(2)} m; ${area(ring).toFixed(1)} m².`);
