// The golf course, checked against the bake it is drawn from.
//
// Run:
//     node src/scene/test-golf.mjs
//
// Nothing here is traced, so what is worth guarding is that the bake still holds
// a whole course, that every surface lands where the course is rather than in
// the sea, and that a hole with no par in the map does not grow one.

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const course = JSON.parse(fs.readFileSync(path.join(here, "../../assets/osm/golf.json"), "utf8"));

const by = (kind) => course.features.filter(f => f.kind === kind);

// A whole course, not half of one.
assert.equal(by("hole").length, 18, "eighteen holes");
assert.equal(by("green").length, 18, "eighteen greens");
assert.equal(by("tee").length, 18, "eighteen tees");
assert.equal(by("pin").length, 18, "eighteen pins");
assert.ok(by("fairway").length >= 17, `${by("fairway").length} fairways`);
assert.ok(by("bunker").length >= 60, `${by("bunker").length} bunkers`);
assert.equal(by("clubhouse").length, 1, "the clubhouse footprint");

// Every hole is numbered once, one to eighteen, and named.
const refs = by("hole").map(h => h.ref).sort((a, b) => a - b);
assert.deepEqual(refs, Array.from({ length: 18 }, (_, i) => i + 1), "holes 1 to 18, none twice");
for (const hole of by("hole")) {
  assert.ok(hole.name && hole.name.length > 2, `hole ${hole.ref} has a name`);
  // The map carries par for thirteen of them. The other five must stay null:
  // the card says "par not mapped" rather than inventing a number.
  assert.ok(hole.par === null || (hole.par >= 3 && hole.par <= 5),
    `hole ${hole.ref} par ${hole.par}`);
  assert.ok(hole.metres === null, "no hole in the map carries a length");
}
const mapped = by("hole").filter(h => h.par !== null).length;
assert.equal(mapped, 13, `${mapped} holes carry a par`);

// Everything sits inside the box the bake was pulled for, and the course is
// inland: nothing here should be sitting out on the water.
const [south, west, north, east] = course.bbox;
for (const feature of course.features) {
  for (const [lat, lon] of feature.coords) {
    assert.ok(lat > south && lat < north, `${feature.kind} at ${lat}`);
    assert.ok(lon > west && lon < east, `${feature.kind} at ${lon}`);
  }
}

// The course covers ground rather than being a handful of points: greens are
// closed rings and fairways run for a distance.
const metres = (a, b) => Math.hypot((b[1] - a[1]) * 111320 * Math.cos(a[0] * Math.PI / 180),
                                    (b[0] - a[0]) * 111320);
for (const green of by("green")) {
  assert.ok(green.coords.length >= 4, `a green with ${green.coords.length} corners`);
}
const runs = by("hole").map(h => metres(h.coords[0], h.coords[h.coords.length - 1]));
assert.ok(Math.min(...runs) > 60, `shortest hole runs ${Math.min(...runs).toFixed(0)} m`);
assert.ok(Math.max(...runs) < 600, `longest hole runs ${Math.max(...runs).toFixed(0)} m`);

// The pins stand on their greens, so a card put at the pin stands over the hole
// it names rather than out in the rough.
for (const pin of by("pin")) {
  const gap = Math.min(...by("green").map(g =>
    Math.min(...g.coords.map(c => metres(pin.coords[0], c)))));
  assert.ok(gap < 40, `a pin ${gap.toFixed(0)} m from the nearest green`);
}

console.log(`PASS: ${by("hole").length} holes, ${mapped} with a par, ` +
  `${by("green").length} greens, ${by("bunker").length} bunkers, ` +
  `${by("fairway").length} fairways, ${by("cartpath").length} cart paths.`);
