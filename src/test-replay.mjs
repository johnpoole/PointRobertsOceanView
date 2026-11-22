// Where a ship or aircraft was, worked out from the record.
//
// Run:
//     node src/test-replay.mjs

import assert from "node:assert/strict";
import { Replay, stateAt } from "./replay.js";

function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => console.log(`ok   ${name}`))
    .catch((e) => { console.log(`FAIL ${name}: ${e.message}`); process.exitCode = 1; });
}

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) < tol, `${what}: ${a} is not ${b}`);

// A ship written a minute apart, heading north across north.
const SHIP = {
  infos: [[1000, { mmsi: "316001234", name: "QUEEN OF ALBERNI", vessel_type: 60 }]],
  points: [
    [1000, 49.00, -123.10, 10, 350, 350],
    [1060, 49.01, -123.10, 12, 10, 10],
  ],
};

await test("between two written positions it is on the line between them", () => {
  const s = stateAt(SHIP, "vessels", 1030, 900);
  near(s.latitude, 49.005, 1e-9, "latitude halfway");
  near(s.speed_over_ground_knots, 11, 1e-9, "speed halfway");
  assert.equal(s.name, "QUEEN OF ALBERNI");
});

await test("a heading across north turns the short way", () => {
  near(stateAt(SHIP, "vessels", 1030, 900).true_heading_degrees, 0, 1e-9, "350 to 10 at half");
});

await test("before its first written position it is not there", () => {
  assert.equal(stateAt(SHIP, "vessels", 999, 900), null);
});

await test("after its last position it stays a while and then is gone", () => {
  assert.ok(stateAt(SHIP, "vessels", 1060 + 200, 900), "a ship vanished two hundred seconds on");
  assert.equal(stateAt(SHIP, "vessels", 1060 + 400, 900), null);
});

await test("two positions too far apart are not joined across the hole", () => {
  const far = { infos: [], points: [[0, 49.0, -123.1, 5, 0, 0], [3600, 49.2, -123.1, 5, 0, 0]] };
  assert.equal(stateAt(far, "vessels", 1800, 900), null, "an hour-long hole was drawn as a voyage");
});

await test("an aircraft comes back with altitude and track", () => {
  const plane = { infos: [[0, { icao: "a1b2c3", callsign: "ACA553" }]],
                  points: [[0, 49.0, -123.2, 1000, 240, 90], [10, 49.0, -123.19, 1100, 250, 92]] };
  const s = stateAt(plane, "aircraft", 5, 120);
  near(s.altitude_m, 1050, 1e-9, "altitude");
  near(s.track_degrees, 91, 1e-9, "track");
  assert.equal(s.callsign, "ACA553");
  assert.equal(stateAt(plane, "aircraft", 10 + 45, 120), null, "a plane lingered past half a minute");
});

await test("the record comes back in the live feed's shape", async () => {
  const when = new Date(1030 * 1000);
  const r = new Replay(async (url) => {
    assert.match(url, /^\/api\/tracks\?kind=(vessels|aircraft)&start=.*&end=.*/);
    return url.includes("vessels")
      ? { gap_s: 900, tracks: { "316001234": SHIP } }
      : { gap_s: 120, tracks: {} };
  });
  r.ensure(when);
  await new Promise((done) => setTimeout(done, 0));
  const shown = r.feedAt(when);
  assert.ok(shown.vessels instanceof Map && shown.aircraft instanceof Map);
  assert.equal(shown.vessels.get("316001234").data.name, "QUEEN OF ALBERNI");
  assert.equal(shown.isStale(shown.vessels.get("316001234"), "vessels"), false);
});

await test("what it was is what it was at that moment", () => {
  // Airborne as one flight, then another, then on the ground as a third.
  const plane = {
    infos: [[0, { callsign: "HR100", on_ground: false }],
            [20, { callsign: "HR201", on_ground: false }],
            [40, { callsign: "HR209", on_ground: true }]],
    points: [[10, 49.0, -123.2, 900, 240, 90], [20, 49.0, -123.19, 900, 240, 90],
             [30, 49.0, -123.18, 900, 240, 90], [40, 49.0, -123.17, 0, 0, 90]],
  };
  assert.equal(stateAt(plane, "aircraft", 15, 120).callsign, "HR100");
  assert.equal(stateAt(plane, "aircraft", 20, 120).callsign, "HR201");
  const mid = stateAt(plane, "aircraft", 35, 120);
  assert.equal(mid.callsign, "HR201", "the day's last callsign was put on an earlier moment");
  assert.equal(mid.on_ground, false);
  assert.equal(stateAt(plane, "aircraft", 41, 120).on_ground, true);
});

await test("an hour with nothing written near it is told from an empty sea", async () => {
  const r = new Replay(async (url) => (url.includes("vessels")
    ? { gap_s: 900, tracks: { "316001234": SHIP } }
    : { gap_s: 120, tracks: {} }));
  const at = (s) => new Date(s * 1000);
  assert.equal(r.recordedNear("vessels", at(1030)), null, "nothing is in hand yet");
  r.ensure(at(1030));
  await new Promise((done) => setTimeout(done, 0));
  // The ship left ten minutes ago. Nobody is drawn, and it was being written.
  assert.equal(r.feedAt(at(1060 + 600)).vessels.size, 0);
  assert.equal(r.recordedNear("vessels", at(1060 + 600)), true);
  // Twenty minutes on, nothing was written within a gap either side.
  assert.equal(r.recordedNear("vessels", at(1060 + 1200)), false);
  assert.equal(r.recordedNear("aircraft", at(1030)), false);
  // The sky can be empty for longer than an aircraft's two minute gap and
  // still have been watched, so it is asked with a longer reach.
  const sky = new Replay(async (url) => (url.includes("aircraft")
    ? { gap_s: 120, tracks: { a1b2c3: { infos: [], points: [[1000, 49, -123.2, 900, 240, 90]] } } }
    : { gap_s: 900, tracks: {} }));
  sky.ensure(at(1600));
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(sky.recordedNear("aircraft", at(1600)), false);
  assert.equal(sky.recordedNear("aircraft", at(1600), 900), true);
  assert.equal(sky.recordedNear("aircraft", at(2000), 900), false);
  // Outside what was fetched it does not say.
  assert.equal(r.recordedNear("vessels", at(1030 + 7200)), null);
});

await test("a moment the record does not reach has nobody in it", async () => {
  const r = new Replay(async () => ({ gap_s: 900, tracks: {} }));
  const shown = r.feedAt(new Date());
  assert.equal(shown.vessels.size + shown.aircraft.size, 0);
});

if (!process.exitCode) console.log("\nPASS: ships and aircraft come back where the record puts them.");
