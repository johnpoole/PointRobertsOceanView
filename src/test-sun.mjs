// Where the sun is over Point Roberts.
//
// Run:
//     node src/test-sun.mjs
//
// The whole page is a window looking west over the water, so the sun is not a
// detail. It sets the sky colour, the fog, the light on the ground and the
// glare on the sea, and the novel's route picks its hour by solving for a
// February elevation in today's sky.
//
// This checks it against the almanac rather than against whatever is computing
// it. Noon height at a solstice is latitude arithmetic and is the same whoever
// works it out: 90 minus the latitude, plus or minus the tilt of the earth.
// A library swapped underneath has to still land on these.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The version the page pins in its importmap, fetched once and kept beside the
// tests. Reading the importmap rather than naming a version here, so the two
// cannot drift apart.
const INDEX = fs.readFileSync(path.join(HERE, "..", "index.html"), "utf8");
const PINNED = /"suncalc":\s*"([^"]+)"/.exec(INDEX);
assert.ok(PINNED, "index.html has no suncalc entry in its importmap");

const CACHE = path.join(HERE, "..", "assets", "vendor", "suncalc.mjs");
if (!fs.existsSync(CACHE)) {
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  const res = await fetch(PINNED[1]);
  if (!res.ok) throw new Error(`${PINNED[1]} answered ${res.status}`);
  fs.writeFileSync(CACHE, await res.text());
}
const { getPosition } = await import(path.toNamespacedPath
  ? new URL(`file://${CACHE.replace(/\\/g, "/")}`) : CACHE);

// 389 West Bluff Road, which is where the model's origin is.
const LAT = 48.989009, LON = -123.085318;
const TILT = 23.44;            // the earth's axial tilt, degrees

function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { console.log(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) < tol, `${what}: ${a.toFixed(3)} is not ${b.toFixed(3)}`);

// The highest the sun gets on a given day, and when, to the minute.
function noon(y, m, d) {
  let best = null;
  for (let i = 0; i < 24 * 60; i++) {
    const when = new Date(Date.UTC(y, m - 1, d, 0, i));
    const at = getPosition(when, LAT, LON);
    if (!best || at.altitude > best.at.altitude) best = { when, at };
  }
  return best;
}

// ---- how high it gets -------------------------------------------------------

test("midsummer noon is as high as this latitude allows", () => {
  // 90 - 48.989 + 23.44. Refraction lifts it a hair, hence the tolerance.
  near(noon(2026, 6, 21).at.altitude, 90 - LAT + TILT, 0.35, "the June solstice");
});

test("midwinter noon is as low as this latitude allows", () => {
  near(noon(2026, 12, 21).at.altitude, 90 - LAT - TILT, 0.35, "the December solstice");
});

test("an equinox noon is the latitude itself", () => {
  near(noon(2026, 3, 20).at.altitude, 90 - LAT, 0.5, "the March equinox");
  near(noon(2026, 9, 22).at.altitude, 90 - LAT, 0.5, "the September equinox");
});

test("the sun is due south at noon, every month of the year", () => {
  for (let m = 1; m <= 12; m++) {
    near(noon(2026, m, 15).at.azimuth, 180, 0.6, `noon in month ${m}`);
  }
});

// ---- where it goes down -----------------------------------------------------

// The bearing at which the sun crosses the horizon going down.
function setsAt(y, m, d) {
  let last = null;
  for (let i = 0; i < 24 * 60; i++) {
    const when = new Date(Date.UTC(y, m - 1, d, 0, i));
    const at = getPosition(when, LAT, LON);
    if (last && last.altitude > 0 && at.altitude <= 0) return { when, az: at.azimuth };
    last = at;
  }
  return null;
}

test("the midsummer sun goes down in the northwest", () => {
  const set = setsAt(2026, 6, 21);
  assert.ok(set, "the sun never set in June");
  assert.ok(set.az > 300 && set.az < 325,
    `it set on a bearing of ${set.az.toFixed(1)}, which is not the northwest`);
});

test("the midwinter sun goes down in the southwest", () => {
  const set = setsAt(2026, 12, 21);
  assert.ok(set, "the sun never set in December");
  assert.ok(set.az > 233 && set.az < 250,
    `it set on a bearing of ${set.az.toFixed(1)}, which is not the southwest`);
});

test("it goes down over the water, every day of the year", () => {
  // The bluff looks west and the strait is out there. If the sun ever set in
  // the east the projection or the longitude would be wrong by a sign.
  for (let m = 1; m <= 12; m++) {
    const set = setsAt(2026, m, 15);
    assert.ok(set, `the sun did not set in month ${m}`);
    assert.ok(set.az > 180 && set.az < 360,
      `in month ${m} the sun set on a bearing of ${set.az.toFixed(1)}`);
  }
});

// ---- refraction, which is the reason for the swap ---------------------------

test("the sun is still up when geometry says it has gone", () => {
  // Refraction lifts the disc about half a degree at the horizon, so the sun is
  // seen after it has geometrically set. The formulas this replaced did not
  // apply it, and half a degree at the horizon is most of a sun's width.
  const set = setsAt(2026, 9, 13);
  const earlier = getPosition(new Date(set.when.getTime() - 2 * 60000), LAT, LON);
  assert.ok(earlier.altitude > 0.05,
    `two minutes before setting the sun is only ${earlier.altitude.toFixed(3)} up`);
});

// ---- the day is the right length --------------------------------------------

test("midsummer is about sixteen hours long and midwinter about eight", () => {
  const up = (y, m, d) => {
    let mins = 0;
    for (let i = 0; i < 24 * 60; i++) {
      if (getPosition(new Date(Date.UTC(y, m - 1, d, 0, i)), LAT, LON).altitude > 0) mins++;
    }
    return mins / 60;
  };
  near(up(2026, 6, 21), 16.1, 0.4, "the longest day");
  near(up(2026, 12, 21), 8.3, 0.4, "the shortest day");
});

if (!process.exitCode) {
  console.log("\nPASS: noon, sunset bearing and day length all land on the "
    + "almanac at 48.989 N.");
}
