// Run: node src/scene/test-golf-play.mjs
import assert from "node:assert/strict";
import { playing } from "./golf-play.js";

// No two of a group stand in one body at any moment of a hole. For a fifth of
// every hole all four were at the same spot, on the tee and on the green.
const HOLE_M = 150;   // a short hole, where a difference down the line is least
let nearest = Infinity, when = null;
for (let step = 0; step <= 1000; step++) {
  const t = step / 1000;
  const spots = [0, 1, 2, 3].map(p => playing(t, p));
  for (let a = 0; a < 4; a++) {
    for (let b = a + 1; b < 4; b++) {
      const apart = Math.hypot((spots[a].along - spots[b].along) * HOLE_M,
                               spots[a].off - spots[b].off);
      if (apart < nearest) { nearest = apart; when = { t, a, b }; }
    }
  }
}
assert.ok(nearest >= 1.2,
  `players ${when.a} and ${when.b} are ${nearest.toFixed(2)} m apart at ${when.t} of the hole`);

// On the tee they stand in a row across it, not strung down the fairway.
const tee = [0, 1, 2, 3].map(p => playing(0.05, p));
assert.ok(tee.every(s => s.along === tee[0].along));
assert.ok(Math.max(...tee.map(s => Math.abs(s.off))) <= 3, "the row is wider than a tee");

// Out at their balls each is still on their own line.
assert.equal(playing(0.3, 0).off, -13);
assert.equal(playing(0.3, 3).off, 15);

console.log(`PASS: no two golfers closer than ${nearest.toFixed(2)} m anywhere on a hole.`);
