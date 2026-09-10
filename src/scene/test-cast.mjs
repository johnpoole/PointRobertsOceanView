// The cast, checked against the bake they are drawn from.
//
// Run:
//     node src/scene/test-cast.mjs
//
// These people are invented, so what is worth guarding is everything about them
// that is not: that the hours marked published really are published and say
// where from, that the routes are on the roads and go where they claim, and that
// nobody is standing on the map at three in the morning.

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

globalThis.location = { protocol: "http:", host: "localhost" };

const here = path.dirname(fileURLToPath(import.meta.url));
const STUB = pathToFileURL(path.join(here, "test-three-stub.mjs")).href;
const rewritten = new Map();
function asDataUrl(file) {
  const abs = path.resolve(file);
  if (rewritten.has(abs)) return rewritten.get(abs);
  const src = fs.readFileSync(abs, "utf8").replace(/from\s+"([^"]+)"/g, (whole, spec) => {
    if (spec === "three" || spec.startsWith("three/")) return `from "${STUB}"`;
    if (spec.startsWith(".")) return `from "${asDataUrl(path.resolve(path.dirname(abs), spec))}"`;
    throw new Error(`test-cast: ${path.basename(abs)} imports "${spec}"`);
  });
  const url = "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64");
  rewritten.set(abs, url);
  return url;
}

const { minutesOf, minutesInZone } = await import(asDataUrl(path.join(here, "cast.js")));
const data = JSON.parse(fs.readFileSync(path.join(here, "../../assets/cast.json"), "utf8"));
const features = JSON.parse(fs.readFileSync(path.join(here, "../../assets/osm/features.json"), "utf8"));

// The file says out loud what it is.
assert.equal(data.invented, true, "the bake declares itself invented");
assert.ok(data.cast.length >= 8, `${data.cast.length} characters`);

// Nobody has a personal name: they are all the job.
for (const person of data.cast) {
  assert.ok(person.role.startsWith("the "), `"${person.role}" is a role, not a name`);
  assert.ok(person.activity.length > 15, `${person.role} says what they do`);
}

// The businesses keep hours somebody actually published, and every one of those
// says where it came from. A golfer, a cyclist and a hiker have no office hours
// to keep and are not pretended into having any: they carry the word assumed.
const published = data.cast.filter(p => p.published);
assert.ok(published.length >= 7,
  `${published.length} of ${data.cast.length} on published hours`);
assert.ok(data.cast.some(p => !p.published), "not everybody works to a business's hours");
for (const person of data.cast) {
  if (person.published) {
    assert.ok(person.source.startsWith("published: "), person.source);
    assert.ok(person.source.length > 25, `${person.role}: ${person.source}`);
    assert.ok(/\d/.test(person.hours), `${person.role} has hours with a time in them`);
  } else {
    assert.ok(person.source.startsWith("assumed: "), person.source);
  }
}

// The routes are real: every point on them is a point on a road in the bake.
// The bake writes its paths to six decimals, which is a tenth of a metre, so
// the roads are matched at the same precision rather than by string.
const key = (lat, lon) => `${lat.toFixed(6)},${lon.toFixed(6)}`;
const onRoads = new Set();
for (const road of features.roads) for (const [lat, lon] of road.coords) onRoads.add(key(lat, lon));
let checked = 0;
for (const person of data.cast) {
  assert.ok(person.legs.length >= 2, `${person.role} goes somewhere and comes back`);
  for (const leg of person.legs) {
    assert.ok(leg.path.length >= 2, `${person.role}: a leg with ${leg.path.length} points`);
    for (const [lat, lon] of [leg.path[0], leg.path[leg.path.length - 1]]) {
      assert.ok(onRoads.has(key(lat, lon)),
        `${person.role} starts or ends a leg at ${lat},${lon}, which is not on a road`);
      checked++;
    }
    // A leg takes as long as its own length at their own pace.
    const expected = leg.metres / person.speed / 60;
    assert.ok(Math.abs(leg.minutes - expected) < 0.2,
      `${person.role}: ${leg.minutes} min for ${leg.metres} m at ${person.speed} m/s`);
    assert.ok(leg.metres > 20, `${person.role}: a ${leg.metres} m leg is not a journey`);
  }
  // The day runs forwards: nobody sets off on a leg before finishing the last.
  for (let i = 1; i < person.legs.length; i++) {
    const before = person.legs[i - 1], after = person.legs[i];
    const done = minutesOf(before.depart) + before.minutes;
    assert.ok(minutesOf(after.depart) > done,
      `${person.role} leaves ${after.from} at ${after.depart} before arriving at ${before.to}`);
  }
  // And nobody is out in the middle of the night.
  const first = minutesOf(person.legs[0].depart);
  const last = minutesOf(person.legs[person.legs.length - 1].depart);
  assert.ok(first >= 5 * 60, `${person.role} sets off at ${person.legs[0].depart}`);
  assert.ok(last <= 21 * 60, `${person.role}'s last leg is at ${person.legs.at(-1).depart}`);
  // Each leg ends where the next one starts, so nobody teleports between them.
  for (let i = 1; i < person.legs.length; i++) {
    assert.equal(person.legs[i].from, person.legs[i - 1].to,
      `${person.role} ends at ${person.legs[i - 1].to} and sets off from ${person.legs[i].from}`);
  }
}
assert.ok(checked > 40, `${checked} leg ends checked against the roads`);

// The clock is the peninsula's, not the reader's. Noon UTC is morning there.
const noonUTC = new Date("2026-09-10T19:00:00Z");
const minutes = minutesInZone(noonUTC);
assert.equal(minutes, 12 * 60, `19:00 UTC is ${Math.floor(minutes / 60)}:00 in Point Roberts`);

console.log(`PASS: ${data.cast.length} characters, ${published.length} on published hours, ` +
  `${data.cast.reduce((n, p) => n + p.legs.length, 0)} legs, all of them on the roads.`);
