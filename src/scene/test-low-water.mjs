// The novel's route: seven chapters, each somewhere on the peninsula at an hour
// of its own.
//
// Run:
//     node src/scene/test-low-water.mjs

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "low-water.js"), "utf8")
  .replace(/^import[^\n]*\n/gm, "")
  .replace(/export function chapterPoints[\s\S]*$/, "");
const { CHAPTERS, DWELL_S, TRAVEL_S } = await import(
  "data:text/javascript;base64," + Buffer.from(source, "utf8").toString("base64"));

const box = { south: 48.96, north: 49.005, west: -123.10, east: -123.02 };

assert.equal(CHAPTERS.length, 7, "seven chapters");
assert.deepEqual(CHAPTERS.map(c => c.n), [1, 2, 3, 4, 5, 6, 7], "numbered in order");

for (const c of CHAPTERS) {
  assert.ok(c.title && c.title.length > 3, `chapter ${c.n} is somewhere`);
  assert.ok(c.line && c.line.length > 20, `chapter ${c.n} says what happens`);
  assert.ok(c.hour >= 0 && c.hour < 24, `chapter ${c.n} at ${c.hour}`);
  for (const [name, p] of [["eye", c.eye], ["aim", c.aim]]) {
    assert.equal(p.length, 3, `${name} is lat, lon, height`);
    assert.ok(p[0] > box.south && p[0] < box.north, `chapter ${c.n} ${name} at ${p[0]}`);
    assert.ok(p[1] > box.west && p[1] < box.east, `chapter ${c.n} ${name} at ${p[1]}`);
    assert.ok(p[2] > -2 && p[2] < 120, `chapter ${c.n} ${name} at ${p[2]} m`);
  }
  // You have to be able to see what you are aimed at, and be somewhere else.
  const gap = Math.hypot((c.aim[1] - c.eye[1]) * 111320 * Math.cos(c.eye[0] * Math.PI / 180),
                         (c.aim[0] - c.eye[0]) * 111320);
  assert.ok(gap > 25 && gap < 600, `chapter ${c.n} looks ${gap.toFixed(0)} m`);
  assert.ok(c.eye[2] >= c.aim[2] - 2, `chapter ${c.n} looks up from below the ground`);
}

// The route opens and closes at the border, which is the book's shape.
assert.ok(CHAPTERS[0].title.includes("border"), "it opens at the line");
assert.ok(CHAPTERS[CHAPTERS.length - 1].title.includes("border"), "and closes there");
// Chapter six is the night one: that is the whole mechanism of the book.
assert.ok(CHAPTERS[5].hour < 5, `chapter six is at ${CHAPTERS[5].hour}, which is not the small hours`);

assert.ok(DWELL_S > 5 && DWELL_S < 60, `a ${DWELL_S} second hold`);
assert.ok(TRAVEL_S > 1 && TRAVEL_S < DWELL_S, "the travel is shorter than the hold");

console.log(`PASS: ${CHAPTERS.length} chapters, ${TRAVEL_S}s across and ${DWELL_S}s held, ` +
  `all of them on the peninsula.`);
