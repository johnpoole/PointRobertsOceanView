import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
globalThis.location={protocol:"http:",host:"localhost"};
function load(file){const source=fs.readFileSync(file,"utf8").replace(/from\s+"([^"]+)"/g,(_,ref)=>`from "${load(path.resolve(path.dirname(file),ref))}"`);return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`}
const {MARINA_BUILDING:plan,marinaBuildingFrame:f,marinaBuildingPoint:point,marinaBuildingLocal:local,marinaBuildingAerial:aerial,isMarinaMainBuilding:match}=await import(load(path.join(here,"marina-building-plan.js")));
const {toWorld,fromWorld}=await import(load(path.join(here,"../geo.js")));
const data=JSON.parse(fs.readFileSync(path.join(here,"../../assets/osm/features.json"),"utf8"));
assert.deepEqual(data.buildings.map((b,i)=>match(b)?i:null).filter(i=>i!==null),[0,4439],"replace the main building and the overlapping corner-bay trace only");
assert.deepEqual(plan.footprint,data.buildings[0].coords.slice(0,-1));
const corners=[[0,0],[f.width,0],[f.width,f.length],[0,f.length]];
for(let i=0;i<4;i++){const p=point(...corners[i]),q=toWorld(...plan.footprint[i]);assert.ok(Math.hypot(p.x-q.x,p.z-q.z)<.05,"oriented walls stay within 5 cm of mapped corners")}
for(const x of [-4,0,f.width])for(const z of [0,30,f.length+3]){const p=local(point(x,z));assert.ok(Math.abs(p.x-x)<1e-8&&Math.abs(p.z-z)<1e-8,"world/local round trip")}
const c=fromWorld(aerial(640,360).x,aerial(640,360).z);assert.ok(Math.abs(c.lat-48.97722)<1e-9&&Math.abs(c.lon+123.0632)<1e-9,"county crop registration");
assert.ok(point(-1,30).x<point(0,30).x,"canopy is on the waterside west face");
assert.ok(plan.split>0&&plan.split<plan.canopyStart&&plan.canopyEnd<f.length,"canopy belongs to the southern club wing");
for(const pixel of plan.equipment){const p=local(aerial(...pixel));assert.ok(p.x>0&&p.x<f.width&&p.z>plan.split&&p.z<f.length,"aerial equipment stays on club roof")}
const cBay=plan.corner;
assert.ok(cBay.width>0&&cBay.width<f.width&&cBay.northInset>0&&cBay.southProjection>0,"bay is inset into SW corner and projects south");
assert.ok(cBay.wallHeight<plan.wallHeight&&cBay.wallHeight+cBay.rise>plan.wallHeight,"hip eaves are below and ridge above the main roof");
for(const pixel of plan.equipment){const p=local(aerial(...pixel));assert.ok(p.x>cBay.width+cBay.eave||p.z<f.length-cBay.northInset-cBay.eave,"equipment does not float over the corner roof cutout")}
console.log(`PASS: main/corner replacement, OSM corner alignment, world/local and aerial registration, southwest bay, waterside canopy and rooftop equipment. ${f.width.toFixed(2)} × ${f.length.toFixed(2)} m.`);
