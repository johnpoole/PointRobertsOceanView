// Run: node src/scene/test-shore-at.mjs
import assert from "node:assert/strict";
import { shoreAt } from "./shore-at.js";

// A shore that runs north and then bends east, a point every 50 m, sea to the
// west and then to the north. z grows southward.
const STEP = 50;
const shore = [];
for (let i = 0; i <= 10; i++) {
  shore.push({ x: 0, z: -i * STEP, tx: 0, tz: -1, nx: -1, nz: 0, s: i * STEP });
}
for (let i = 1; i <= 10; i++) {
  shore.push({ x: i * STEP, z: -500, tx: 1, tz: 0, nx: 0, nz: -1, s: (10 + i) * STEP });
}

// A pod 300 m off the beach at 2.2 m/s, sixty frames a second, round the bend.
const SPEED = 2.2, OFF = 300, DT = 1 / 60;
let last = null, biggest = 0, still = 0, frames = 0;
for (let s = 100; s < 900; s += SPEED * DT) {
  const p = shoreAt(shore, s, STEP);
  const x = p.x + p.nx * OFF, z = p.z + p.nz * OFF;
  if (last) {
    const step = Math.hypot(x - last.x, z - last.z);
    biggest = Math.max(biggest, step);
    if (step === 0) still++;
    frames++;
  }
  last = { x, z };
}
// On the outside of a bend a pod has further to go, but it swims it.
assert.ok(biggest < 0.5, `it jumped ${biggest.toFixed(2)} m in one frame`);
assert.equal(still, 0, `it held still for ${still} of ${frames} frames`);

// On a kept point it is that point, and halfway it is halfway.
assert.deepEqual(shoreAt(shore, 100, STEP), shore[2]);
const half = shoreAt(shore, 125, STEP);
assert.equal(half.z, -125);
assert.equal(half.s, 125);
// The directions stay one long through the bend.
const bend = shoreAt(shore, 525, STEP);
assert.ok(Math.abs(Math.hypot(bend.nx, bend.nz) - 1) < 1e-9);
assert.ok(Math.abs(Math.hypot(bend.tx, bend.tz) - 1) < 1e-9);
// Off either end it is the end.
assert.equal(shoreAt(shore, -40, STEP).s, 0);
assert.equal(shoreAt(shore, 99999, STEP).x, 500);

console.log(`PASS: a pod swims the shore, ${biggest.toFixed(2)} m a frame at most.`);
