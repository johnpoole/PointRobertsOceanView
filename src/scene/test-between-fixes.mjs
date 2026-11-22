// Run: node src/scene/test-between-fixes.mjs
import assert from "node:assert/strict";
import { LAG_S, addFix, placeAt } from "./between-fixes.js";

// A jet at 130 m/s heading east, a fix every 6 s, each heard a second late.
const SPEED = 130, POLL = 6;
const fixes = [];
let heard = 0;
const drawn = [];
for (let now = 0; now <= 40; now += 1 / 60) {
  // Fix n was made at 6n and reaches the page at 6n + 1.
  while (heard * POLL + 1 <= now) {
    addFix(fixes, { t: heard * POLL, x: heard * POLL * SPEED, y: 900, z: 0 });
    heard++;
  }
  if (fixes.length) drawn.push({ now, x: placeAt(fixes, now - LAG_S).x });
}

// Once it is under way it never jumps and never sits still.
const moving = drawn.filter(d => d.now > 14);
let biggest = 0, smallest = Infinity;
for (let i = 1; i < moving.length; i++) {
  const step = moving[i].x - moving[i - 1].x;
  biggest = Math.max(biggest, step);
  smallest = Math.min(smallest, step);
}
const perFrame = SPEED / 60;
assert.ok(biggest < perFrame * 1.01, `it jumped ${biggest.toFixed(2)} m in a frame`);
assert.ok(smallest > perFrame * 0.99, `it stood still: ${smallest.toFixed(3)} m in a frame`);

// It is never anywhere it has not been: never ahead of its newest fix.
for (const d of drawn) {
  const newest = Math.floor((d.now - 1) / POLL) * POLL * SPEED;
  assert.ok(d.x <= newest + 1e-6, `drawn at ${d.x} with nothing past ${newest}`);
}

// The same position sent twice is one fix.
const one = [];
addFix(one, { t: 5, x: 1, y: 2, z: 3 });
addFix(one, { t: 5, x: 1, y: 2, z: 3 });
addFix(one, { t: 4, x: 9, y: 9, z: 9 });
assert.equal(one.length, 1);
assert.deepEqual(placeAt(one, 100), { x: 1, y: 2, z: 3 });

// A feed that stops leaves it at its last real position.
const stopped = [{ t: 0, x: 0, y: 0, z: 0 }, { t: 6, x: 600, y: 0, z: 0 }];
assert.equal(placeAt(stopped, 60).x, 600);
assert.equal(placeAt(stopped, 3).x, 300);
assert.equal(placeAt(stopped, -5).x, 0);

console.log("PASS: it slides between real positions, never ahead of the last, never still.");
