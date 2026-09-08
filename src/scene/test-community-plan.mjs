import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
globalThis.location={protocol:"http:",host:"localhost"};
function load(file) {
  const text=fs.readFileSync(file,"utf8").replace(/from\s+"([^"]+)"/g,(_,ref)=>`from "${load(path.resolve(path.dirname(file),ref))}"`);
  return `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
}
const {COMMUNITY,communityPoint,communityLatLon,communityRings,communityBuildingKind}=await import(load(path.join(here,"community-plan.js")));
const c=communityLatLon(640,360);assert.ok(Math.abs(c.lat-48.98465)<1e-9&&Math.abs(c.lon+123.07675)<1e-9);
assert.ok(communityPoint(641,360).x>communityPoint(640,360).x&&communityPoint(640,361).z>communityPoint(640,360).z);
const area=r=>Math.abs(r.reduce((s,p,i)=>{const q=r[(i+1)%r.length];return s+p.x*q.z-q.x*p.z},0)/2);
const rings=communityRings();assert.ok(Math.abs(area(rings.main)+area(rings.annex)-area(rings.center))<1e-7,'center partition preserves footprint');
assert.ok(Math.max(...rings.library.map(p=>p.x))<Math.min(...rings.center.map(p=>p.x)),'buildings remain separate');
const os=JSON.parse(fs.readFileSync(path.join(here,"../../assets/osm/features.json"),'utf8'));
assert.deepEqual(os.buildings.map((b,i)=>communityBuildingKind(b)?i:null).filter(i=>i!==null),[45,184]);
assert.deepEqual(os.buildings[45].coords.slice(0,-1),COMMUNITY.center);assert.deepEqual(os.buildings[184].coords.slice(0,-1),COMMUNITY.library);
assert.equal(communityBuildingKind(os.buildings[185]),null,'neighbor is retained');
console.log('PASS: aerial projection, separate exact footprints, center/annex partition and two-building matching.');
