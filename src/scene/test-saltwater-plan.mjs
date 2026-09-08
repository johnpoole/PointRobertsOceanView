import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
globalThis.location={protocol:"http:",host:"localhost"};
function load(file){const source=fs.readFileSync(file,"utf8").replace(/from\s+"([^"]+)"/g,(_,ref)=>`from "${load(path.resolve(path.dirname(file),ref))}"`);return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`}
const {SALTWATER:p,saltwaterFrame:f,saltwaterPoint:point,saltwaterLocal:local,saltwaterRing:ring,isSaltwaterBuilding:match}=await import(load(path.join(here,"saltwater-plan.js")));
const {toWorld}=await import(load(path.join(here,"../geo.js")));
const data=JSON.parse(fs.readFileSync(path.join(here,"../../assets/osm/features.json"),"utf8"));
assert.deepEqual(data.buildings.map((b,i)=>match(b)?i:null).filter(i=>i!==null),[46],"only the cafe footprint is replaced");
assert.deepEqual(p.footprint,data.buildings[46].coords.slice(0,-1));
for(let i=0;i<ring.length;i++){const a=point(ring[i].x,ring[i].z),b=toWorld(...p.footprint[i]);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<1e-8,"exact mapped wall outline")}
for(const [x,z] of [[-8,-8],[0,0],[f.width,f.length]]){const q=local(point(x,z));assert.ok(Math.abs(q.x-x)<1e-8&&Math.abs(q.z-z)<1e-8)}
assert.ok(f.inset>1&&f.inset<2&&f.step>6&&f.step<7&&f.length>15&&f.length<17,"mapped west step and depth");
for(const [x,z] of p.tables){assert.ok(x<-.3&&x>-7.8&&z>-6.8&&z<1.5,"seating on west patio");assert.ok(point(x,z).x<point(0,z).x,"patio faces Marine Drive")}
assert.ok(point(0,-8).z<point(0,0).z,"entrance and forecourt face Gulf Road to the north");
console.log(`PASS: exact café replacement, mapped wall outline, oriented frame, west patio and north frontage. ${f.width.toFixed(2)} x ${f.length.toFixed(2)} m.`);
