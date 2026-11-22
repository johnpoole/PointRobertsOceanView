// Reading a baked run at an hour the page is standing at.
//
// Run:
//     node src/test-clock.mjs
//
// The proxy bakes each feed's forecast as an evenly stepped array and the page
// reads it by arithmetic on the index. Three ways out of one: a number, a word,
// and a bearing. The bearing is the one that was wrong — blended as a number,
// 350 to 10 reads 180, and the vane pointed due south in a northerly.

import assert from "node:assert/strict";
import { bearingAt, hourEndingAt, numberAt, offsetHours, sceneNow, setOffsetHours,
         shifted, slotAt, weatherAtHour } from "./clock.js";

function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { console.log(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) < tol, `${what}: ${a} is not ${b}`);

// An hourly run starting midnight GMT.
const RUN = { start: "2026-08-04 00:00Z", step_s: 3600 };
const at = (h, m = 0) => new Date(Date.UTC(2026, 7, 4, h, m));

// ---- a number ---------------------------------------------------------------

test("a number lands on its slot and between them", () => {
  const v = [10, 20, 30];
  assert.equal(numberAt(RUN, v, at(0)), 10);
  assert.equal(numberAt(RUN, v, at(2)), 30);
  assert.equal(numberAt(RUN, v, at(1, 30)), 25);
});

test("a run that does not reach is refused rather than extrapolated", () => {
  const v = [10, 20, 30];
  assert.equal(numberAt(RUN, v, at(3)), null, "past the end");
  assert.equal(numberAt(RUN, v, new Date(Date.UTC(2026, 7, 3, 23))), null,
    "before the start");
  assert.equal(numberAt(RUN, null, at(1)), null);
  assert.equal(numberAt(null, v, at(1)), null);
});

// ---- a word -----------------------------------------------------------------

test("a word takes the nearer slot and is never blended", () => {
  const w = ["Clear", "Overcast", "Light rain"];
  assert.equal(slotAt(RUN, w, at(0, 20)), "Clear");
  assert.equal(slotAt(RUN, w, at(0, 40)), "Overcast");
  assert.equal(slotAt(RUN, w, at(3)), null);
});

// ---- a bearing --------------------------------------------------------------

test("a bearing lands on its slot", () => {
  const b = [350, 10, 90];
  assert.equal(bearingAt(RUN, b, at(0)), 350);
  near(bearingAt(RUN, b, at(1)), 10, 1e-9, "the second slot");
  near(bearingAt(RUN, b, at(2)), 90, 1e-9, "the third slot");
});

test("a bearing crosses north the short way round", () => {
  // This is the bug. 350 to 10 is twenty degrees through north, and blended as
  // a number the half hour reads 180 — due south in a northerly.
  const b = [350, 10];
  near(bearingAt(RUN, b, at(0, 30)), 0, 1e-9, "halfway from 350 to 10");
  near(bearingAt(RUN, b, at(0, 15)), 355, 1e-9, "a quarter of the way");
  near(bearingAt(RUN, b, at(0, 45)), 5, 1e-9, "three quarters of the way");
});

test("a bearing crossing north the other way is the same twenty degrees", () => {
  near(bearingAt(RUN, [10, 350], at(0, 30)), 0, 1e-9, "10 to 350");
});

test("a bearing that does not cross north is the plain average", () => {
  near(bearingAt(RUN, [80, 100], at(0, 30)), 90, 1e-9, "80 to 100");
  near(bearingAt(RUN, [200, 240], at(0, 30)), 220, 1e-9, "200 to 240");
});

test("a bearing always comes back inside the circle", () => {
  for (let lo = 0; lo < 360; lo += 17) {
    for (let step = -170; step <= 170; step += 17) {
      const hi = (lo + step + 360) % 360;
      const got = bearingAt(RUN, [lo, hi], at(0, 30));
      assert.ok(got >= 0 && got < 360, `${lo} to ${hi} gave ${got}`);
      // and it is on the short arc: no more than half the step from either end
      const away = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
      near(away(got, lo), Math.abs(step) / 2, 1e-6, `${lo} to ${hi} off the start`);
    }
  }
});

test("two bearings dead opposite turn one way, always the same way", () => {
  // Half a circle apart is the same distance either way round and the answer
  // has to come out somewhere. It comes out the same place every time rather
  // than depending on which slot is which.
  assert.equal(bearingAt(RUN, [0, 180], at(0, 30)), 270);
  assert.equal(bearingAt(RUN, [180, 0], at(0, 30)), 90);
  // and it still lands on the ends
  assert.equal(bearingAt(RUN, [0, 180], at(0)), 0);
  assert.equal(bearingAt(RUN, [0, 180], at(1)), 180);
});

test("a bearing run that does not reach is refused", () => {
  assert.equal(bearingAt(RUN, [350, 10], at(3)), null);
  assert.equal(bearingAt(RUN, null, at(1)), null);
});

test("a gap in the bearings takes the side that has one", () => {
  assert.equal(bearingAt(RUN, [null, 10], at(0, 30)), 10);
  assert.equal(bearingAt(RUN, [350, null], at(0, 30)), 350);
});

// ---- the weather at another hour ----------------------------------------------

const NOW_WX = {
  station_id: "CWVF", temperature_c: 9, wind_speed_mps: 4, wind_direction_degrees: 200,
  description: "overcast", cloud_cover_percent: 90, wave_height_m: 0.4,
  series: { ...RUN, temperature_c: [5, 6, 7], wind_speed_mps: [1, 2, 3],
            wind_direction_degrees: [350, 10, 30], description: ["clear", "fog", "rain"] },
};

test("inside the run the weather is the run's, marked a forecast", () => {
  const w = weatherAtHour(NOW_WX, at(1));
  assert.equal(w.predicted, true);
  assert.ok(!w.beyond);
  assert.equal(w.temperature_c, 6);
  assert.equal(w.wind_speed_mps, 2);
  assert.equal(w.wind_direction_degrees, 10);
  assert.equal(w.description, "fog");
  assert.equal(w.station_id, "CWVF");
});

test("an hour the run does not reach has no reading in it and says so", () => {
  // Three months back. This used to be the present nine degrees and overcast,
  // with forecast written over it.
  for (const when of [new Date(Date.UTC(2026, 4, 4, 12)), at(5)]) {
    const w = weatherAtHour(NOW_WX, when);
    assert.equal(w.beyond, true);
    assert.equal(w.predicted, true);
    for (const k of ["temperature_c", "wind_speed_mps", "wind_direction_degrees",
                     "description", "cloud_cover_percent", "wave_height_m"]) {
      assert.equal(w[k], undefined, `${k} is still the present reading`);
    }
  }
});

test("rainfall is the total for the hour the scene stands in, not blended", () => {
  // Dry to one o'clock, wet from one to two.
  const mm = [0, 0, 1.2];
  assert.equal(hourEndingAt(RUN, mm, at(0, 30)), 0);
  assert.equal(hourEndingAt(RUN, mm, at(1)), 0);
  assert.equal(hourEndingAt(RUN, mm, at(1, 5)), 1.2);
  assert.equal(hourEndingAt(RUN, mm, at(2)), 1.2);
  assert.equal(hourEndingAt(RUN, mm, at(2, 5)), null, "past the end");
});

test("the rain at another hour is that hour's, not what is falling now", () => {
  const wet = { ...NOW_WX, precipitation_mm: 3,
                series: { ...NOW_WX.series, precipitation_mm: [0, 0, 1.2] } };
  assert.equal(weatherAtHour(wet, at(0, 30)).precipitation_mm, 0);
  assert.equal(weatherAtHour(wet, at(1, 30)).precipitation_mm, 1.2);
  // A run that carries no rainfall leaves it unknown and does not keep the 3.
  assert.equal(weatherAtHour({ ...NOW_WX, precipitation_mm: 3 }, at(1)).precipitation_mm, null);
});

test("a reading with no run comes back as it is", () => {
  const bare = { temperature_c: 9 };
  assert.equal(weatherAtHour(bare, at(1)), bare);
});

// ---- the offset itself ------------------------------------------------------

test("the offset moves the scene's clock and nothing else", () => {
  setOffsetHours(0);
  const real = Date.now();
  setOffsetHours(-3);
  near(sceneNow().getTime() - real, -3 * 3600000, 2000, "three hours back");
  assert.equal(offsetHours(), -3);
  assert.equal(shifted(), true);
  setOffsetHours(0);
  assert.equal(shifted(), false);
});

if (!process.exitCode) {
  console.log("\nPASS: numbers blend, words snap, bearings cross north the "
    + "short way, and a run that does not reach is refused.");
}
