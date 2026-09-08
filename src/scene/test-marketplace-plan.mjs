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
const {MARKET,marketPoint,marketLatLon,marketRings,marketClip,isMarketplaceBuilding}=await import(load(path.join(here,"marketplace-plan.js")));
const centre=marketLatLon(640,360);
assert.ok(Math.abs(centre.lat-48.98555)<1e-9&&Math.abs(centre.lon+123.0664)<1e-9,"county aerial projection");
assert.ok(marketPoint(641,360).x>marketPoint(640,360).x&&marketPoint(640,361).z>marketPoint(640,360).z,"east/south axes");
const area=ring=>Math.abs(ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p.x*q.z-q.x*p.z},0)/2);
const rings=marketRings(),front=marketClip(rings.outline,"x",marketPoint(654,350).x,false);
assert.ok(Math.abs(area(rings.body)+area(front)-area(rings.outline))<1e-7,"body and covered frontage preserve OSM outline");
assert.ok(Math.abs(area(rings.north)+area(rings.south)-area(rings.body))<1e-7,"stepped roof partition preserves body");
const data=JSON.parse(fs.readFileSync(path.join(here,"../../assets/osm/features.json"),"utf8"));
assert.equal(data.buildings.filter(isMarketplaceBuilding).length,1);assert.ok(isMarketplaceBuilding(data.buildings[2]));assert.deepEqual(data.buildings[2].coords.slice(0,-1),MARKET.footprint);
assert.ok(!isMarketplaceBuilding(data.buildings[66]),"neighbor is retained");
console.log("PASS: aerial georeferencing, exact OSM replacement and area-preserving body/frontage/roof partitions.");
