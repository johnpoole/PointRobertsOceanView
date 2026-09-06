// node src/scene/test-roof-notch.mjs
// Check the resulting surface, including triangles that cross both cut edges.
import assert from "node:assert/strict";
import fs from "node:fs";
const src = fs.readFileSync(new URL("./roof-notch.js", import.meta.url), "utf8");
const { cutRoofNotch, notchedStorey } = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

const nx = 1.6326346365434663, nz = 1.6450670260282065;
const hw = 4.085, hl = 4.245, ridge = -.9;
const height = (x) => 13.39 - (x > ridge ? 2.11 / 12 : 3.15 / 12) * Math.abs(x - ridge);
const surface = [];
for (const [a,b] of [[-hw,ridge],[ridge,hw]]) {
  const p = [[a,height(a),-hl],[b,height(b),-hl],[b,height(b),hl],[a,height(a),hl]];
  surface.push(...p[0],...p[1],...p[2], ...p[0],...p[2],...p[3]);
}
const out = cutRoofNotch(new Float32Array(surface), nx, nz);
let area = 0;
for (let i = 0; i < out.length; i += 9) {
  const [ax,ay,az,bx,by,bz,cx,cy,cz] = out.slice(i,i+9);
  const twice = (bx-ax)*(cz-az)-(cx-ax)*(bz-az);
  assert.ok(twice > 1e-8, "surface triangles retain their winding and are not degenerate");
  area += twice / 2;
  for (const [x,y,z] of [[ax,ay,az],[bx,by,bz],[cx,cy,cz]]) {
    assert.ok(Number.isFinite(y));
    assert.ok(Math.abs(y-height(x)) < 2e-6, "clipping preserves the measured roof planes");
    assert.ok(x <= nx+1e-6 || z <= nz+1e-6, "no roof vertex inside the cut");
  }
}
const expected = 4*hw*hl - (hw-nx)*(hl-nz);
assert.ok(Math.abs(area-expected) < 2e-5, "remaining plan area equals roof minus notch");

// Independently sample coverage, so a triangle bridging the concave corner or
// overlapping its neighbour cannot pass just by having the right total area.
function hits(x,z,positions=out) {
  let count=0;
  for (let i=0;i<positions.length;i+=9) {
    const [ax,,az,bx,,bz,cx,,cz]=positions.slice(i,i+9);
    const d=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
    const a=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/d;
    const b=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/d;
    if(a>1e-7 && b>1e-7 && 1-a-b>1e-7) count++;
  }
  return count;
}
for(let x=-hw+.031;x<hw;x+=.113) for(let z=-hl+.047;z<hl;z+=.127) {
  assert.equal(hits(x,z), x>nx && z>nz ? 0 : 1, `roof coverage at ${x},${z}`);
}
// Fascia/gable faces lie in vertical planes. Boundary faces must be retained
// once, even when their projected area is zero.
const vertical=[nx,10,0,nx,12,0,nx,12,3];
assert.equal(cutRoofNotch(vertical,nx,nz).length,9,"boundary face not duplicated");
assert.equal(cutRoofNotch([3,10,3,4,10,3,4,12,3],nx,nz).length,0,"face wholly in notch removed");
const crossing=cutRoofNotch([3,10,0,3,12,0,3,12,3],nx,nz);
assert.ok(crossing.length>0);
for(let i=2;i<crossing.length;i+=3) assert.ok(crossing[i]<=nz+1e-6,"vertical crossing face stops at notch");
console.log(`Roof notch checks passed: ${area.toFixed(3)} m² retained; ${(4*hw*hl-area).toFixed(3)} m² removed.`);

// The whole upper level must have the opening, not just the roof above a box.
const wallHW=6.47/2,wallHL=6.79/2,bottom=10.45,h=2.26;
const body=notchedStorey(wallHW,wallHL,bottom,h,nx,nz);
const edges=new Map(),top=[];
let volume=0,insetX=0,insetZ=0;
const key=p=>p.map(v=>v.toFixed(5)).join(',');
for(let i=0;i<body.length;i+=9){
  const a=Array.from(body.slice(i,i+3)),b=Array.from(body.slice(i+3,i+6)),c=Array.from(body.slice(i+6,i+9));
  for(const p of [a,b,c]){
    assert.ok(p[0]<=nx+1e-6 || p[2]<=nz+1e-6,"upper wall/cap vertex clears notch");
    assert.ok(p[1]>=bottom-1e-6 && p[1]<=bottom+h+1e-6,"upper storey stays within its floor levels");
  }
  for(const [p,q] of [[a,b],[b,c],[c,a]]){
    const edge=[key(p),key(q)].sort().join('|');edges.set(edge,(edges.get(edge)||0)+1);
  }
  const ab=b.map((v,k)=>v-a[k]),ac=c.map((v,k)=>v-a[k]);
  const normal=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
  volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
  if([a,b,c].every(p=>Math.abs(p[1]-bottom-h)<1e-6))top.push(...a,...b,...c);
  if([a,b,c].every(p=>Math.abs(p[0]-nx)<1e-6)){
    assert.ok(normal[0]>0,"inset X wall faces the recess");insetX+=Math.hypot(...normal)/2;
  }
  if([a,b,c].every(p=>Math.abs(p[2]-nz)<1e-6)){
    assert.ok(normal[2]>0,"inset Z wall faces the recess");insetZ+=Math.hypot(...normal)/2;
  }
}
assert.ok([...edges.values()].every(n=>n===2),"upper storey is closed at every edge");
const wallArea=4*wallHW*wallHL-(wallHW-nx)*(wallHL-nz);
assert.ok(Math.abs(volume-wallArea*h)<1e-4,"upper storey volume excludes the entire notch");
assert.ok(Math.abs(insetX-(wallHL-nz)*h)<1e-5,"full-height X wall closes the recess");
assert.ok(Math.abs(insetZ-(wallHW-nx)*h)<1e-5,"full-height Z wall closes the recess");
for(let x=-wallHW+.031;x<wallHW;x+=.113)for(let z=-wallHL+.047;z<wallHL;z+=.127){
  assert.equal(hits(x,z,top),x>nx && z>nz?0:1,"upper cap does not fill or bridge the notch");
}
console.log('Upper-storey checks passed: closed inset walls, open notch, correct volume and outward normals.');
