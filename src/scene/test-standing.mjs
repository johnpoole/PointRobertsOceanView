// Run: node src/scene/test-standing.mjs
import assert from "node:assert/strict";
import { EASE_S, walkWeight } from "./standing.js";

const FRAME = 1 / 60;

// A golfer walks to the ball and stops over it. Half a second on, they stand.
let w = 1;
for (let t = 0; t < 0.5; t += FRAME) w = walkWeight(w, false, FRAME);
assert.equal(w, 0, "still part way through a stride half a second after stopping");

// They do not snap: one frame after stopping they are still mostly walking.
assert.ok(walkWeight(1, false, FRAME) > 0.9);

// Setting off, they are walking again inside the same time.
w = 0;
for (let t = 0; t < EASE_S + FRAME; t += FRAME) w = walkWeight(w, true, FRAME);
assert.equal(w, 1);

// Someone who never stops never leaves the walk.
w = 1;
for (let i = 0; i < 600; i++) w = walkWeight(w, true, FRAME);
assert.equal(w, 1);

// A long gap between looks does not overshoot either way.
assert.equal(walkWeight(0.4, false, 5), 0);
assert.equal(walkWeight(0.4, true, 5), 1);

console.log("PASS: a figure that stops comes to a stand, and one that sets off walks.");
