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

// ---- what a past day costs --------------------------------------------------

test("the page says what it is not showing", () => {
  for (const word of ["ships", "aircraft", "golf"]) {
    assert.ok(c.GONE_ON_A_PAST_DAY.includes(word),
      `the note does not mention ${word}`);
  }
});

if (!process.exitCode) console.log("\nPASS: days, labels and hour= all hold.");
