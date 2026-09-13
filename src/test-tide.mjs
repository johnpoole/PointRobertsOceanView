// The tide worked out here, against the tide NOAA publish.
//
// Run:
//     node src/test-tide.mjs
//
// The scene stands the sea at whatever this returns, and the shoreline, the
// flats, the boats and half the novel's staging all move with it. So the test
// is not that the arithmetic runs. It is that the number is NOAA's number.
//
// Their predictions for station 9449639 are fetched and compared minute for
// minute, over days years apart, because the nodal corrections drift on an
// eighteen year cycle and a run that agrees this week can be out in 2030.
//
// This one talks to the network. It is checking against an authority and there
// is no way to do that from a file.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

// The version the page pins, so the two cannot drift apart.
const INDEX = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const PINNED = /"tide-predictor":\s*"([^"]+)"/.exec(INDEX);
assert.ok(PINNED, "index.html has no tide-predictor entry in its importmap");

const VENDOR = path.join(ROOT, "assets", "vendor", "tide-predictor.mjs");
if (!fs.existsSync(VENDOR)) {
  fs.mkdirSync(path.dirname(VENDOR), { recursive: true });
  const res = await fetch(PINNED[1]);
  if (!res.ok) throw new Error(`${PINNED[1]} answered ${res.status}`);
  fs.writeFileSync(VENDOR, await res.text());
}

// tide.js imports by the bare name the importmap resolves, so the module is
// read and that one import pointed at the file fetched above.
const src = fs.readFileSync(path.join(HERE, "tide.js"), "utf8").replace(
  /from "tide-predictor"/,
  `from "${new URL(`file://${VENDOR.replace(/\\/g, "/")}`).href}"`);
const tide = await import(
  "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"));

const baked = JSON.parse(fs.readFileSync(
  path.join(ROOT, "assets", "tide", "harmonics.json"), "utf8"));

function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { console.log(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

// ---- what was baked ---------------------------------------------------------

test("the harmonics are a full analysis, in metres, on the chart datum", () => {
  assert.ok(baked.constituents.length >= 30,
    `${baked.constituents.length} constituents is a partial analysis`);
  assert.equal(baked.units, "metres");
  assert.equal(baked.datum, "MLLW");
  assert.equal(baked.station_id, "9449639");
  // The Strait of Georgia runs a mixed tide with the diurnal pull on top, so
  // K1 is bigger than M2 here. If that ever inverts, the wrong station was
  // baked.
  const by = Object.fromEntries(baked.constituents.map(c => [c.name, c.amplitude]));
  assert.ok(by.K1 > by.M2,
    `K1 ${by.K1} is not above M2 ${by.M2}, which is not this station`);
  assert.ok(baked.datum_offset_m > 1 && baked.datum_offset_m < 3,
    `MSL is ${baked.datum_offset_m} m above MLLW, which is not Point Roberts`);
});

test("the harmonics load", () => {
  assert.equal(tide.loadHarmonics(baked), true);
  assert.equal(tide.ready(), true);
});

test("nothing baked is refused rather than guessed at", () => {
  // A fresh module, because loadHarmonics is not undone by a bad call.
  assert.equal(tide.loadHarmonics(null), false);
  assert.equal(tide.loadHarmonics({ constituents: [] }), false);
  tide.loadHarmonics(baked);
});

// ---- against NOAA -----------------------------------------------------------

const COOPS = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

async function noaaDay(yyyymmdd) {
  const url = `${COOPS}?application=PointRobertsOceanView&station=9449639`
    + `&product=predictions&datum=MLLW&units=metric&time_zone=gmt&format=json`
    + `&begin_date=${yyyymmdd}&range=48&interval=h`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NOAA answered ${res.status} for ${yyyymmdd}`);
  const body = await res.json();
  if (body.error) throw new Error(`NOAA: ${body.error.message}`);
  return body.predictions.map(p => ({
    when: new Date(p.t.replace(" ", "T") + "Z"),
    level: Number(p.v),
  }));
}

// Days years apart, so the nodal corrections are exercised rather than one
// week's worth of them.
const DAYS = ["20260101", "20260913", "20270214", "20300621"];
const RESULTS = [];
for (const day of DAYS) {
  let rows;
  try {
    rows = await noaaDay(day);
  } catch (e) {
    console.log(`SKIP ${day}: ${e.message}`);
    continue;
  }
  let worst = 0, sum = 0;
  for (const r of rows) {
    const mine = tide.levelAt(r.when);
    assert.ok(mine != null, `no level at ${r.when.toISOString()}`);
    const off = Math.abs(mine - r.level);
    worst = Math.max(worst, off);
    sum += off * off;
  }
  RESULTS.push({ day, n: rows.length, worst, rms: Math.sqrt(sum / rows.length) });
}

test("NOAA answered for at least one of the days asked for", () => {
  assert.ok(RESULTS.length, "every NOAA call failed; nothing was checked");
});

test("the water is within ten centimetres of NOAA's own, years out", () => {
  // Their published run, hour by hour, over 48 hours of each day. Ten
  // centimetres is the threshold because the shoreline moves metres for every
  // centimetre of tide on the flat below the bluff, and a decimetre is already
  // visible there.
  for (const r of RESULTS) {
    assert.ok(r.worst < 0.10,
      `${r.day}: worst ${r.worst.toFixed(3)} m over ${r.n} readings`);
  }
});

test("it does not merely agree on average", () => {
  // A run that is half a metre high and half a metre low averages to nothing.
  for (const r of RESULTS) {
    assert.ok(r.rms < 0.07, `${r.day}: rms ${r.rms.toFixed(3)} m`);
  }
});

// ---- the shape the page reads -----------------------------------------------

test("the highs and lows come in order and alternate", () => {
  const when = new Date(Date.UTC(2026, 8, 13, 12));
  const ex = tide.extremesAround(when, 48);
  assert.ok(ex.length >= 4, `only ${ex.length} extremes in two days`);
  for (let i = 1; i < ex.length; i++) {
    assert.ok(ex[i].time > ex[i - 1].time, "the extremes are not in order");
    assert.notEqual(ex[i].high, ex[i - 1].high,
      "two highs in a row, with no low between them");
  }
});

test("a high is above a low, and both are on the chart datum", () => {
  const ex = tide.extremesAround(new Date(Date.UTC(2026, 8, 13, 12)), 48);
  const highs = ex.filter(e => e.high).map(e => e.level);
  const lows = ex.filter(e => !e.high).map(e => e.level);
  assert.ok(Math.min(...highs) > Math.max(...lows),
    "a high came out below a low");
  // MLLW is the chart datum, so a low is near zero and never far below it, and
  // the range here is about five metres.
  assert.ok(Math.min(...lows) > -1.0, `a low of ${Math.min(...lows)} m MLLW`);
  assert.ok(Math.max(...highs) < 5.5, `a high of ${Math.max(...highs)} m MLLW`);
});

test("the trend follows the next extreme", () => {
  const when = new Date(Date.UTC(2026, 8, 13, 12));
  const next = tide.extremesAround(when).find(e => e.time > when);
  assert.equal(tide.trendAt(when), next.high ? "rising" : "falling");
});

test("what the panel reads says it is a prediction and carries no surge", () => {
  const s = tide.stateAt(new Date(Date.UTC(2026, 1, 14, 3)));
  assert.equal(s.datum, "MLLW");
  assert.equal(s.predicted, true);
  assert.equal(s.surge_m, null, "a computed day claimed a measured surge");
  assert.equal(s.station_id, "9449639");
  assert.ok(Number.isFinite(s.water_level_m));
});

test("a day years back has water, which is the whole point", () => {
  for (const iso of ["2019-07-04T20:00:00Z", "2024-02-29T12:00:00Z",
                     "2031-11-11T06:00:00Z"]) {
    const m = tide.levelAt(new Date(iso));
    assert.ok(m != null && m > -1.5 && m < 6, `${iso} gave ${m} m`);
  }
});

if (!process.exitCode) {
  console.log();
  for (const r of RESULTS) {
    console.log(`  ${r.day}  ${String(r.n).padStart(3)} readings  `
      + `worst ${r.worst.toFixed(3)} m  rms ${r.rms.toFixed(3)} m`);
  }
  console.log("\nPASS: the tide here is NOAA's tide, on days years apart.");
}
