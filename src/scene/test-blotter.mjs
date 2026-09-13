// Putting the Sheriff's calls on the ground.
//
// Run:
//     node src/scene/test-blotter.mjs
//
// His rows give a street and nothing finer — GULF RD, or a junction like APA RD
// & BOUNDARY BAY RD — so all of this is the arithmetic between his spelling and
// the road network's. It is checked against the real baked roads, because the
// only failure that matters is a street that cannot be found on the ground.

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

// blotter.js imports three for the markers. Only the matching is under test, so
// the module is read and the parts that need a scene are left out of it.
const src = fs.readFileSync(path.join(here, "blotter.js"), "utf8")
  .replace(/^import \* as THREE.*$/m, "")
  .replace(/^import \{ toWorld, fromWorld \}.*$/m, "")
  .replace(/export function buildBlotter[\s\S]*?\n}\n/, "")
  + `
export { index, alongRoad, junction, locate };
const M = 111320, COS = Math.cos(48.989009 * Math.PI / 180);
export function toWorld(lat, lon) {
  return { x: (lon + 123.085318) * M * COS, y: 0, z: -(lat - 48.989009) * M };
}
`;
const blotter = await import(
  "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"));

const roads = JSON.parse(
  fs.readFileSync(path.join(root, "assets/osm/features.json"), "utf8")).roads;
const named = roads.filter(r => r.name);

// ---- his spelling against theirs --------------------------------------------

const { tidyStreet } = blotter;

function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { console.log(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

test("a suffix is the same street however it is abbreviated", () => {
  assert.equal(tidyStreet("GULF RD"), tidyStreet("Gulf Road"));
  assert.equal(tidyStreet("CEDAR POINT AV"), tidyStreet("Cedar Point Avenue"));
  assert.equal(tidyStreet("MARINE DR"), tidyStreet("Marine Drive"));
  assert.equal(tidyStreet("PELICAN PL"), tidyStreet("Pelican Place"));
  assert.equal(tidyStreet("BURNS WA"), tidyStreet("Burns Way"));
  assert.equal(tidyStreet("REX ST"), tidyStreet("Rex Street"));
});

test("a compass point at the front is spelled out too", () => {
  assert.equal(tidyStreet("S BEACH RD"), tidyStreet("South Beach Road"));
  assert.equal(tidyStreet("N SHORE RD"), tidyStreet("North Shore Road"));
});

test("a street that is only a suffix is not mangled", () => {
  // "ST" alone is a street called St, not a suffix with nothing in front.
  assert.equal(tidyStreet("ST"), "STREET");
  assert.equal(tidyStreet(""), "");
  assert.equal(tidyStreet(null), "");
});

test("the roads carry names at all", () => {
  assert.ok(named.length > 200,
    `${named.length} named roads in the bake; the OSM build is dropping them`);
});

// ---- every street the log has used in the last month ------------------------
//
// These are his, verbatim, off thirty days of reports. A street that stops
// matching is a call that cannot be put on the ground.
const SEEN = [
  "BOUNDARY BAY RD", "PELICAN PL", "S BEACH RD", "PROVINCE RD", "TYEE DR",
  "GULF RD", "BENSON RD", "MARINE DR", "CEDAR POINT AV", "CEDAR ST",
  "JAMES RD", "CRYSTAL BEACH ROAD", "MCLAREN RD", "MONTE DR", "REX ST",
  "JOHNSON RD", "APA RD & BOUNDARY BAY RD", "BURNS WA & JOHNSON RD",
];

const streets = blotter.index(named);

test("every street the Sheriff has named is on the map", () => {
  for (const raw of SEEN) {
    for (const part of raw.split("&")) {
      const key = tidyStreet(part);
      assert.ok(streets.has(key), `${raw}: no road called ${key}`);
    }
  }
});

test("a junction is where the two streets actually meet", () => {
  const apa = streets.get(tidyStreet("APA RD"));
  const bay = streets.get(tidyStreet("BOUNDARY BAY RD"));
  const at = blotter.junction(apa, bay);
  assert.ok(at, "APA Road and Boundary Bay Road were not found to meet");
  // Both roads run near it, or it is not their junction.
  for (const ways of [apa, bay]) {
    const near = Math.min(...ways.flatMap(r => r.coords).map(([lat, lon]) => {
      const p = blotter.toWorld(lat, lon);
      return Math.hypot(p.x - at.x, p.z - at.z);
    }));
    assert.ok(near < 70, `the junction is ${near.toFixed(0)} m off one of them`);
  }
});

test("two streets that never meet are not called a junction", () => {
  const gulf = streets.get(tidyStreet("GULF RD"));
  const maple = streets.get(tidyStreet("BOUNDARY BAY RD"));
  // These two are at opposite ends of the peninsula.
  const at = blotter.junction(gulf, maple);
  assert.equal(at, null, "two streets a mile apart were called a junction");
});

test("several calls on one street stand apart, not on top of each other", () => {
  const used = new Map();
  const spots = [];
  for (let i = 0; i < 6; i++) {
    spots.push(blotter.locate({ street: "BOUNDARY BAY RD" }, streets, used));
  }
  assert.ok(spots.every(Boolean), "a call could not be placed");
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      const gap = Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z);
      assert.ok(gap > 12, `two of six calls stand ${gap.toFixed(0)} m apart`);
    }
  }
});

test("a call with no street is not placed anywhere", () => {
  assert.equal(blotter.locate({ street: null }, streets, new Map()), null);
  assert.equal(blotter.locate({ street: "" }, streets, new Map()), null);
  assert.equal(
    blotter.locate({ street: "NOWHERE BOULEVARD" }, streets, new Map()), null,
    "a street that is not on the peninsula was placed on it anyway");
});

test("a marker stands off the carriageway", () => {
  const road = streets.get(tidyStreet("TYEE DR"))[0];
  const on = blotter.alongRoad(road, 0.5);
  const at = blotter.locate({ street: "TYEE DR" }, streets, new Map());
  const off = Math.hypot(at.x - on.x, at.z - on.z);
  assert.ok(off > 2 && off < 6,
    `the marker stands ${off.toFixed(1)} m off the middle of the road`);
});

if (!process.exitCode) {
  console.log(`\nPASS: ${SEEN.length} streets off thirty days of reports, all of `
    + `them found among ${named.length} named roads, junctions included.`);
}
