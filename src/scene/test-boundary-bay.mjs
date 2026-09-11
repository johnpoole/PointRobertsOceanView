// The Canadian side of the crossing, checked against where it was measured.
//
// Run:
//     node src/scene/test-boundary-bay.mjs
//
// All three were pulled off the county aerial by colour, so what is worth
// guarding is that they stay north of the line, keep the sizes that came out of
// the pixels, and do not stand inside one another.

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "boundary-bay.js"), "utf8");
// The module needs three for its geometry; the numbers do not, so they are read
// out of the source with the import lines stripped.
const numbers = source
  .slice(source.indexOf("export const BOUNDARY_BAY"), source.indexOf("export function buildBoundaryBay"))
  .replace(/\/\/[^\n]*/g, "");
const BOUNDARY_BAY = (await import(
  "data:text/javascript;base64," + Buffer.from(numbers, "utf8").toString("base64"))).BOUNDARY_BAY;

const metres = (a, b) => Math.hypot((b[1] - a[1]) * 111320 * Math.cos(a[0] * Math.PI / 180),
                                    (b[0] - a[0]) * 111320);

const { laneCanopy, parkCanopy, office } = BOUNDARY_BAY;

// The 49th parallel is the line. Everything here is Canada, so everything is
// north of it — and the US station it faces is south of it.
for (const [name, spec] of Object.entries({ laneCanopy, parkCanopy, office })) {
  assert.ok(spec.at[0] > 49.0, `${name} is at ${spec.at[0]}, which is not in Canada`);
  assert.ok(spec.at[0] < 49.004, `${name} is at ${spec.at[0]}, too far north to be the station`);
  assert.ok(spec.at[1] < -123.067 && spec.at[1] > -123.070, `${name} is at ${spec.at[1]}`);
}

// The sizes that came off the aerial, and the shapes they imply.
assert.ok(Math.abs(laneCanopy.long - 19.8) < 0.5 && Math.abs(laneCanopy.across - 7.9) < 0.5,
  "the lane canopy is the one the pixels measured");
assert.ok(Math.abs(parkCanopy.long - 27.9) < 0.5, "the parking canopy is the longer of the two");
assert.ok(parkCanopy.long > laneCanopy.long, "and longer than the one over the lanes");
assert.ok(office.long > 15 && office.across > 15, "the office is the square one");

// Both canopies stand on posts and the office does not.
for (const canopy of [laneCanopy, parkCanopy]) {
  assert.ok(canopy.deck > 4 && canopy.deck < 6, `a canopy ${canopy.deck} m to its eave`);
  assert.ok(canopy.rise > 0 && canopy.rise < canopy.across / 2, "a shallow hip, not a spire");
  assert.ok(canopy.eave > 0, "it hangs past its posts");
}
assert.ok(office.height > 3 && office.height < 7, `the office is ${office.height} m`);
assert.equal(office.rise, undefined, "the office roof is flat");

// They are beside one another, not inside one another.
const gap = (a, b) => metres(a.at, b.at);
assert.ok(gap(laneCanopy, parkCanopy) > (laneCanopy.across + parkCanopy.across) / 2,
  "the two canopies overlap");
assert.ok(gap(office, laneCanopy) > 8, `the office is ${gap(office, laneCanopy).toFixed(1)} m from the lane canopy`);
assert.ok(gap(office, parkCanopy) > 8, "the office stands clear of the parking canopy");

// The booths are under the canopy they belong to.
assert.ok(BOUNDARY_BAY.booths.length >= 2, "two booths at least");
for (const [x, z] of BOUNDARY_BAY.booths) {
  assert.ok(Math.abs(x) < laneCanopy.long / 2, `a booth ${x} m along a ${laneCanopy.long} m canopy`);
  assert.ok(Math.abs(z) < laneCanopy.across / 2, `a booth ${z} m across a ${laneCanopy.across} m canopy`);
}

console.log(`PASS: lane canopy ${laneCanopy.long} x ${laneCanopy.across} m, parking canopy ` +
  `${parkCanopy.long} x ${parkCanopy.across} m, office ${office.long} x ${office.across} m, ` +
  `all north of the line and clear of each other.`);
