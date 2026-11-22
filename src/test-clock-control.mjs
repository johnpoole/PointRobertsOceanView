// The arithmetic of the scene clock: which day, which label, and what a link
// asks for.
//
// Run:
//     node src/test-clock-control.mjs
//
// The control itself wants a document, so what is tested here is the part that
// does not: the day arithmetic, the label, and reading an hour out of a hash.
// Those are what get a date wrong by one, or read "14:20 (-1823h)" at somebody.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// The module reaches for getElementById when the class is built, which is not
// what is under test, so only the free functions are pulled out of it.
const src = fs.readFileSync(path.join(here, "clock-control.js"), "utf8")
  .replace(/^import .*$/m, "")
  .replace(/export class ClockControl[\s\S]*$/m, "");
const c = await import(
  "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"));

function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { console.log(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

// ---- which day --------------------------------------------------------------

test("a day is a calendar day, not twenty-four hours", () => {
  const { daysBetween } = c;
  // One minute before midnight to one minute after is one day, not nothing.
  assert.equal(daysBetween(new Date(2026, 8, 11, 23, 59), new Date(2026, 8, 12, 0, 1)), -1);
  assert.equal(daysBetween(new Date(2026, 8, 12), new Date(2026, 8, 12)), 0);
  assert.equal(daysBetween(new Date(2026, 8, 5), new Date(2026, 8, 12)), -7);
});

test("a day is still a day across a month and a year", () => {
  const { daysBetween } = c;
  assert.equal(daysBetween(new Date(2026, 7, 31), new Date(2026, 8, 1)), -1);
  assert.equal(daysBetween(new Date(2025, 11, 31), new Date(2026, 0, 1)), -1);
});

test("a day is still a day across the clocks going back", () => {
  const { daysBetween } = c;
  // The peninsula turns its clocks back on the first Sunday of November, so the
  // day it happens on is twenty-five hours long. Counting hours would call this
  // nothing; counting days calls it one.
  assert.equal(daysBetween(new Date(2026, 10, 1), new Date(2026, 10, 2)), -1);
});

test("a date reads back the way the box writes it", () => {
  assert.equal(c.asDateValue(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(c.asDateValue(new Date(2026, 11, 31)), "2026-12-31");
});

// ---- the slider across midnight ----------------------------------------------

test("the slider alone can put the scene on yesterday, and that is a past day", () => {
  // Eight in the morning, dragged back ten hours, is ten the night before.
  const now = new Date(2026, 8, 12, 8, 0);
  assert.equal(c.sceneDay(-10, 0, now), -1);
  // Dragged back two hours it is still this morning.
  assert.equal(c.sceneDay(-2, 0, now), 0);
  assert.equal(c.sceneDay(0, 0, now), 0);
  assert.equal(c.sceneDay(0, -3, now), -3);
  // The two add up: three days back and then over midnight is four.
  assert.equal(c.sceneDay(-10, -3, now), -4);
});

test("a picked date is the date the scene lands on, wherever the slider is", () => {
  const now = new Date(2026, 8, 12, 8, 0);
  const lands = (picked, hourShift) => {
    const to = c.shiftsForDate(picked, hourShift, now);
    const scene = new Date(now.getTime() + (to.hourShift + to.dayShift * 24) * 3600000);
    return { date: c.asDateValue(scene), ...to };
  };
  // Slider at rest.
  assert.equal(lands(new Date(2026, 8, 5), 0).date, "2026-09-05");
  // Slider over midnight into last night. Counted from now this came out as the
  // 4th, and the box wrote the 4th back over the 5th that had just been chosen.
  const over = lands(new Date(2026, 8, 5), -10);
  assert.equal(over.date, "2026-09-05");
  assert.equal(over.hourShift, -10, "the hour the slider shows is kept");
  // Yesterday, from last night, is where the slider already is.
  assert.deepEqual(c.shiftsForDate(new Date(2026, 8, 11), -10, now), { hourShift: -10, dayShift: 0 });
  // Slider forward over midnight, at eight in the evening.
  const late = new Date(2026, 8, 12, 20, 0);
  const back = c.shiftsForDate(new Date(2026, 8, 12), 6, late);
  assert.equal(c.asDateValue(new Date(late.getTime() + (back.hourShift + back.dayShift * 24) * 3600000)),
    "2026-09-12");
});

test("today picked from last night lets go of the hours", () => {
  // The slider has the clock on yesterday evening. Today is ahead of that and
  // nothing goes forward, so the only way onto today is the real clock.
  const now = new Date(2026, 8, 12, 8, 0);
  assert.deepEqual(c.shiftsForDate(new Date(2026, 8, 12), -10, now), { hourShift: 0, dayShift: 0 });
  // With the slider still on today, picking today changes nothing.
  assert.deepEqual(c.shiftsForDate(new Date(2026, 8, 12), -2, now), { hourShift: -2, dayShift: 0 });
});

// ---- what the label says ----------------------------------------------------

test("standing on the real clock reads now", () => {
  assert.equal(c.clockLabel(new Date(2026, 8, 12, 14, 20), 0, 0), "now");
});

test("an hour dragged says how far it was dragged", () => {
  assert.equal(c.clockLabel(new Date(2026, 8, 12, 14, 20), -2.5, 0), "14:20 (-2h30)");
  assert.equal(c.clockLabel(new Date(2026, 8, 12, 6, 5), 3, 0), "06:05 (+3h00)");
});

test("a day chosen drops the hours, because -1823h tells nobody anything", () => {
  assert.equal(c.clockLabel(new Date(2026, 1, 12, 16, 12), 0, -212), "16:12");
  assert.equal(c.clockLabel(new Date(2026, 1, 12, 16, 12), -3, -212), "16:12");
});

// ---- what a link asks for ---------------------------------------------------

test("hour= is an offset from now, to the minute", () => {
  const now = new Date(2026, 8, 12, 12, 0);
  assert.equal(c.hourFromHash("#hour=14", now), 2);
  assert.equal(c.hourFromHash("#eye=1,2,3&hour=6", now), -6);
  // and not rounded to the slider's step
  assert.equal(c.hourFromHash("#hour=14.25", now), 2.25);
});

test("an hour that is not an hour is refused rather than guessed at", () => {
  const now = new Date(2026, 8, 12, 12, 0);
  assert.equal(c.hourFromHash("#hour=24", now), null);
  assert.equal(c.hourFromHash("#hour=-1", now), null);
  assert.equal(c.hourFromHash("#hour=lunchtime", now), null);
  assert.equal(c.hourFromHash("#eye=1,2,3", now), null);
  assert.equal(c.hourFromHash("", now), null);
  assert.equal(c.hourFromHash(null, now), null);
});

test("midnight is an hour like any other", () => {
  // #hour=0 has to mean midnight rather than nothing asked for.
  const now = new Date(2026, 8, 12, 12, 0);
  assert.equal(c.hourFromHash("#hour=0", now), -12);
});

test("day= is whole days back from today", () => {
  const now = new Date(2026, 8, 12, 8, 0);
  assert.equal(c.dayFromHash("#day=2026-09-12", now), 0);
  assert.equal(c.dayFromHash("#day=2026-09-11", now), -1);
  assert.equal(c.dayFromHash("#eye=1,2,3&hour=22&day=2026-09-05&map=1", now), -7);
  // Across a month end.
  assert.equal(c.dayFromHash("#day=2026-08-31", now), -12);
});

test("a day and an hour in a link land on that day at that hour", () => {
  // The link was taken on the 5th at ten at night and is opened on the 12th at
  // eight in the morning. The hour alone would have opened on the 12th.
  const now = new Date(2026, 8, 12, 8, 0);
  const hash = "#eye=1,2,3&hour=22&day=2026-09-05";
  const shift = c.hourFromHash(hash, now) + c.dayFromHash(hash, now) * 24;
  const scene = new Date(now.getTime() + shift * 3600000);
  assert.equal(c.asDateValue(scene), "2026-09-05");
  assert.equal(scene.getHours(), 22);
  assert.equal(c.sceneDay(c.hourFromHash(hash, now), c.dayFromHash(hash, now), now), -7);
});

test("a day that is not a past or present date is refused", () => {
  const now = new Date(2026, 8, 12, 8, 0);
  assert.equal(c.dayFromHash("#day=2026-09-13", now), null, "tomorrow");
  assert.equal(c.dayFromHash("#day=2026-02-31", now), null, "the 31st of February");
  assert.equal(c.dayFromHash("#day=2026-13-01", now), null, "a thirteenth month");
  assert.equal(c.dayFromHash("#day=yesterday", now), null);
  assert.equal(c.dayFromHash("#day=2026-9-5", now), null);
  assert.equal(c.dayFromHash("#day=2026-09-051", now), null);
  assert.equal(c.dayFromHash("#hour=14", now), null);
  assert.equal(c.dayFromHash("", now), null);
  assert.equal(c.dayFromHash(null, now), null);
});

// ---- what a past day costs --------------------------------------------------

test("the page says what it is not showing", () => {
  for (const word of ["ships", "aircraft", "golf"]) {
    assert.ok(c.GONE_ON_A_PAST_DAY.includes(word),
      `the note does not mention ${word}`);
  }
});

test("an hour no ship was written for is said, with or without a past day", () => {
  assert.equal(c.noteFor(false, false), "");
  assert.equal(c.noteFor(true, false), c.GONE_ON_A_PAST_DAY);
  // An hour back today is not a past day and the record can still have a hole.
  assert.equal(c.noteFor(false, true), c.NOT_RECORDED);
  assert.equal(c.noteFor(true, true), `${c.GONE_ON_A_PAST_DAY} ${c.NOT_RECORDED}`);
});

if (!process.exitCode) console.log("\nPASS: days, labels and hour= all hold.");
