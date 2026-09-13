// The beats of a recreation, and the ground it is played on.
//
// Run:
//     node src/scene/test-recreation.mjs
//
// What a call looked like, as far as the record says: a car comes down the road,
// stops at the kerb, a deputy gets out and attends, gets back in, and it goes.
// The arithmetic is the order of those, the speeds they imply, and where the
// camera stands. All of it was wrong at least once while it was being written.

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

// recreation.js builds three.js groups. Only the timeline and the geometry are
// under test, so the module is read and the part that needs a scene is left out.
const src = fs.readFileSync(path.join(here, "recreation.js"), "utf8")
  .replace(/^import .*$/gm, "")
  .replace(/export function buildRecreation[\s\S]*?\n}\n/, "")
  .replace(/^\/\/ The county's cars[\s\S]*$/m, "")
  .replace(/function patrolCar[\s\S]*$/m, "")
  + "\nexport { BEATS, PERCHES, ARC_SWEEP, ARC_FROM_DEFAULT, APPROACH_M, lerp, ease };\n";
const r = await import(
  "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"));

function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { console.log(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

const { BEATS, PERCHES, lerp, ease, APPROACH_M } = r;

// ---- the order of it --------------------------------------------------------

test("the beats happen in the order a call happens in", () => {
  const order = ["approach", "arrive", "out", "at", "back", "in", "away", "done"];
  for (let i = 1; i < order.length; i++) {
    assert.ok(BEATS[order[i]] > BEATS[order[i - 1]],
      `${order[i]} at ${BEATS[order[i]]}s is not after ${order[i - 1]}`);
  }
});

test("the deputy is out of the car only while it is stopped", () => {
  assert.ok(BEATS.out >= BEATS.arrive, "somebody got out while it was moving");
  assert.ok(BEATS.in <= BEATS.away, "it drove off with a door open");
});

test("nobody moves faster than the thing they are in", () => {
  // The car covers the approach between approach and arrive.
  const carMs = APPROACH_M / (BEATS.arrive - BEATS.approach);
  assert.ok(carMs > 5 && carMs < 25,
    `the car does ${carMs.toFixed(1)} m/s down a residential road`);
});

test("there is time to attend something", () => {
  const standing = BEATS.back - BEATS.at;
  assert.ok(standing >= 5,
    `${standing}s at the door is not attending a call, it is a drive-by`);
});

// ---- the shape of the moves -------------------------------------------------

test("an ease starts and ends still", () => {
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  assert.ok(ease(0.5) > 0.49 && ease(0.5) < 0.51, "the middle is not the middle");
  // and it is clamped, because a beat can overrun by a frame
  assert.equal(ease(-1), 0);
  assert.equal(ease(2), 1);
});

test("a lerp is clamped at both ends", () => {
  const a = { x: 0, z: 0 }, b = { x: 10, z: 20 };
  assert.deepEqual(lerp(a, b, 0), { x: 0, z: 0 });
  assert.deepEqual(lerp(a, b, 1), { x: 10, z: 20 });
  assert.deepEqual(lerp(a, b, -3), { x: 0, z: 0 });
  assert.deepEqual(lerp(a, b, 3), { x: 10, z: 20 });
});

// ---- where the camera stands ------------------------------------------------

test("the perches go outward and upward together", () => {
  assert.ok(PERCHES.length >= 3, "one perch is a guess, not a choice");
  for (let i = 1; i < PERCHES.length; i++) {
    assert.ok(PERCHES[i].radius > PERCHES[i - 1].radius,
      "a later perch is not further out");
    assert.ok(PERCHES[i].height > PERCHES[i - 1].height,
      "a later perch is not higher");
  }
});

test("the first perch is close enough to see a person", () => {
  const { radius } = PERCHES[0];
  // A 1.7 m figure through the page's 25 degree lens on a 760 px window.
  const px = (1.7 / radius) * (760 / (2 * Math.tan(12.5 * Math.PI / 180)));
  assert.ok(px > 40, `a deputy is ${px.toFixed(0)} px tall from the first perch`);
});

test("the last perch looks down rather than along", () => {
  const last = PERCHES[PERCHES.length - 1];
  const down = Math.atan2(last.height, last.radius) * 180 / Math.PI;
  assert.ok(down > 35,
    `the fallback perch looks down ${down.toFixed(0)}°, which is still along a street`);
});

test("the swing goes far enough round to be a swing", () => {
  assert.ok(Math.abs(r.ARC_SWEEP) >= 60,
    `${r.ARC_SWEEP}° is a camera that shifts, not one that goes round`);
  assert.ok(Math.abs(r.ARC_SWEEP) <= 300,
    `${r.ARC_SWEEP}° puts the camera through the subject`);
});

// ---- against the ground it is played on -------------------------------------

test("a call's road has room for the approach", () => {
  const roads = JSON.parse(
    fs.readFileSync(path.join(root, "assets/osm/features.json"), "utf8")).roads;
  const M = 111320, COS = Math.cos(48.989009 * Math.PI / 180);
  const span = (road) => {
    let run = 0;
    for (let i = 1; i < road.coords.length; i++) {
      const a = road.coords[i - 1], b = road.coords[i];
      run += Math.hypot((b[1] - a[1]) * M * COS, (b[0] - a[0]) * M);
    }
    return run;
  };
  // The streets the Sheriff has actually named, and the car needs APPROACH_M of
  // road to come down. A cul-de-sac shorter than that is a car appearing in
  // somebody's garden.
  const wanted = ["Gulf Road", "Tyee Drive", "Boundary Bay Road", "Marine Drive"];
  for (const name of wanted) {
    const longest = Math.max(...roads.filter(r => r.name === name).map(span));
    assert.ok(longest > APPROACH_M,
      `${name} is ${longest.toFixed(0)} m and the approach is ${APPROACH_M} m`);
  }
});

if (!process.exitCode) {
  console.log(`\nPASS: ${BEATS.done}s of beats in order, ${PERCHES.length} perches `
    + `from ${PERCHES[0].radius} m out to ${PERCHES[PERCHES.length - 1].radius} m, `
    + `and every street named in the log longer than the ${APPROACH_M} m approach.`);
}
