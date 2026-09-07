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
const {REEF,reefPoint,reefLatLon,reefFootprints,isReefBuilding}=await import(load(path.join(here,"reef-plan.js")));
const {toWorld}=await import(load(path.join(here,"../geo.js")));
const centre=reefLatLon(640,360);
assert.ok(Math.abs(centre.lat-48.98458)<1e-9 && Math.abs(centre.lon+123.08346)<1e-9,"aerial georeferencing");
assert.ok(reefPoint(641,360).x>reefPoint(640,360).x,"image right is east");
assert.ok(reefPoint(640,361).z>reefPoint(640,360).z,"image down is south");
const area=ring=>Math.abs(ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p.x*q.z-q.x*p.z},0)/2);
const rings=reefFootprints(),original=REEF.footprint.map(p=>toWorld(...p));
assert.ok(area(rings.main)>0 && area(rings.west)>0);
assert.ok(Math.abs(area(rings.main)+area(rings.west)-area(original))<1e-7,"roof split preserves exact outline");
function inside(p,ring) {
  let yes=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if((a.z>p.z)!==(b.z>p.z) && p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)yes=!yes;
  }
  return yes;
}
assert.ok(!inside(reefPoint(435,354),original),"patio centre is outside the building");
for(const p of REEF.tables)assert.ok(inside(reefPoint(...p),REEF.patio.map(p=>reefPoint(...p))),"seating stays in observed patio");
const osm=JSON.parse(fs.readFileSync(path.join(here,"../../assets/osm/features.json"),"utf8"));
const matches=osm.buildings.filter(isReefBuilding);
assert.equal(matches.length,1);assert.equal(matches[0].name,"Kiniski's Reef");
assert.deepEqual(matches[0].coords.slice(0,-1),REEF.footprint);
assert.equal(isReefBuilding({...matches[0],coords:matches[0].coords.map(([lat,lon])=>[lat+.001,lon])}),false);
console.log("PASS: aerial projection, footprint partition, open patio, seating bounds and exact Reef building match.");
