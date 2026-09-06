// node src/scene/test-roof-notch.mjs
// Check the resulting surface, including triangles that cross both cut edges.
import assert from "node:assert/strict";
import fs from "node:fs";
const src = fs.readFileSync(new URL("./roof-notch.js", import.meta.url), "utf8");
const { cutRoofNotch } = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

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
function hits(x,z) {
  let count=0;
  for (let i=0;i<out.length;i+=9) {
    const [ax,,az,bx,,bz,cx,,cz]=out.slice(i,i+9);
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
