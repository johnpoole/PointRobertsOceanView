import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
globalThis.location={protocol:"http:",host:"localhost"};
function load(file){const source=fs.readFileSync(file,"utf8").replace(/from\s+"([^"]+)"/g,(_,ref)=>`from "${load(path.resolve(path.dirname(file),ref))}"`);return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`}
const {BORDER:p,borderFrame:f,borderPoint:point,borderLocal:local,borderRing:ring,borderPart:part,isBorderBuilding:match}=await import(load(path.join(here,"border-plan.js")));
const {toWorld}=await import(load(path.join(here,"../geo.js")));
const data=JSON.parse(fs.readFileSync(path.join(here,"../../assets/osm/features.json"),"utf8"));

assert.deepEqual(data.buildings.map((b,i)=>match(b)?i:null).filter(i=>i!==null),[5],"only the border station footprint is replaced");
assert.deepEqual(p.footprint,data.buildings[5].coords.slice(0,-1),"the exact baked outline, all 35 corners");
for(let i=0;i<ring.length;i++){const a=point(ring[i].x,ring[i].z),b=toWorld(...p.footprint[i]);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<1e-8,"exact mapped outline")}
for(const [x,z] of [[0,0],[19,10],[-4,-18]]){const q=local(point(x,z));assert.ok(Math.abs(q.x-x)<1e-8&&Math.abs(q.z-z)<1e-8,"the frame inverts")}
// The site is skewed about nine degrees off the compass and the frame carries it.
assert.ok(Math.abs(f.angle*180/Math.PI-9.37)<.3,`frame ${(f.angle*180/Math.PI).toFixed(2)} deg`);

function area(ring){let a=0;for(let i=0;i<ring.length;i++){const q=ring[i],r=ring[(i+1)%ring.length];a+=q.x*r.z-r.x*q.z}return Math.abs(a/2)}
const whole=area(ring),pieces=["canopy","office","middle","wing"].map(n=>area(part(n)));
// The four parts tile the outline: no piece counted twice and none left out.
assert.ok(Math.abs(pieces.reduce((a,b)=>a+b,0)-whole)<1,`parts ${pieces.map(n=>n.toFixed(0))} against ${whole.toFixed(0)}`);
assert.ok(Math.abs(whole-924)<3,`traced area ${whole.toFixed(0)} m2`);

const canopy=part("canopy"),xs=canopy.map(q=>q.x),zs=canopy.map(q=>q.z);
assert.ok(Math.abs(Math.max(...xs)-Math.min(...xs)-19.2)<.2,"canopy 19.2 m across the lanes");
assert.ok(Math.abs(Math.max(...zs)-Math.min(...zs)-10.65)<.2,"canopy 10.6 m deep");
// The canopy is a roof on posts, so it stands taller than nothing and lower
// than the office it hangs off.
assert.ok(p.canopyDeck<p.officeHeight&&p.canopyDeck>p.middleHeight,"the canopy sits between the two roofs");
for(const [x,z] of p.posts) assert.ok(x>Math.min(...xs)-.1&&x<Math.max(...xs)+.1&&z>Math.min(...zs)-.1&&z<Math.max(...zs)+.1,"a post under its own canopy");
for(const [x,z] of p.booths) assert.ok(x>Math.min(...xs)&&x<Math.max(...xs)&&z>Math.min(...zs)&&z<Math.max(...zs),"a booth under the canopy");
for(const x of p.gates) assert.ok(x>Math.min(...xs)&&x<Math.max(...xs),"a gate across the lanes");

// North is Canada. The flag, the mast and the road sign all stand on that side
// of the building, facing what is coming in.
assert.ok(p.flag[1]<f.officeNorth,"the flag stands in front of the office");
assert.ok(p.sign[1]<f.officeNorth,"the road sign stands out toward the line");
assert.ok(point(0,f.officeNorth).z<point(0,f.wingSouth).z,"the wing runs away from the line, southward");
// The glazing looks out over the lanes, and the lettering is on the wall that
// steps forward of it.
assert.ok(f.stepNorth>f.officeNorth,"the glazed wall is set back from the lettered one");
assert.ok(p.glazing.north[0]>f.stepWest&&p.glazing.north[1]<f.letterWest,"north glazing inside its own wall");
assert.ok(p.glazing.west[0]>f.canopyNorth-14&&p.glazing.west[1]<f.canopySouth,"west glazing along the lane face");

console.log(`PASS: exact border station replacement, 35 corners, ${whole.toFixed(0)} m2 in four parts `+
  `(canopy ${pieces[0].toFixed(0)}, office ${pieces[1].toFixed(0)}, middle ${pieces[2].toFixed(0)}, wing ${pieces[3].toFixed(0)}), frame ${(f.angle*180/Math.PI).toFixed(2)} deg.`);
