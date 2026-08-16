// How far the campground carries, checked against arithmetic that can be done
// on paper.
//
// Run:
//     node src/scene/test-campground-noise.mjs
//
// Plain asserts and a non-zero exit, the same as the rest of the tests here.
//
// A propagation model is the easiest kind of code to get wrong and never find
// out about, because whatever it draws looks like a plausible blob. So the model
// is checked against the closed form it is supposed to obey — one source falls
// 6 dB per doubling, n identical sources at the same range are 10 log10(n) over
// one — and the whole field is checked against the two distances the staff
// report gives for this site.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

globalThis.location = { protocol: "http:", host: "localhost" };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSET = path.join(HERE, "..", "..", "assets", "site", "nielson-campground.json");

const rewritten = new Map();
function asDataUrl(file) {
  const abs = path.resolve(file);
  if (rewritten.has(abs)) return rewritten.get(abs);
  const src = fs.readFileSync(abs, "utf8").replace(
    /from\s+"([^"]+)"/g,
    (whole, spec) => {
      if (spec.startsWith(".")) {
        return `from "${asDataUrl(path.resolve(path.dirname(abs), spec))}"`;
      }
      throw new Error(
        `test-campground-noise: ${path.basename(abs)} imports "${spec}", which is ` +
        `not a file beside it, so the test has no way to resolve it.`);
    });
  const url = "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64");
  rewritten.set(abs, url);
  return url;
}

const { BANDS, SITE_DB, bandOf, levelAt, noiseField, reachM } =
  await import(asDataUrl(path.join(HERE, "campground-noise.js")));
const { FT, planCampground } =
  await import(asDataUrl(path.join(HERE, "campground-plan.js")));

let failures = 0;
function ok(cond, what) {
  if (cond) return;
  failures++;
  console.error("FAIL " + what);
}
function near(got, want, tol, what) {
  ok(Math.abs(got - want) <= tol, `${what}: ${got.toFixed(2)} is not within ${tol} of ${want}`);
}

// A site is a rectangle, and the model takes its middle.
const at = (x, z) => ({ pad: { x0: x, x1: x, z0: z, z1: z } });

// ---- one source ------------------------------------------------------------
// At a metre it is the source level, and it loses 6 dB every doubling after.
near(levelAt([at(0, 0)], 1, 0), SITE_DB, 1e-9, "one site at one metre");
for (const d of [2, 4, 8, 16, 100, 1000]) {
  near(levelAt([at(0, 0)], d, 0), SITE_DB - 20 * Math.log10(d), 1e-9,
       `one site at ${d} m`);
}
near(levelAt([at(0, 0)], 100, 0) - levelAt([at(0, 0)], 200, 0), 6.02, 0.01,
     "the drop over one doubling");

// ---- many sources ----------------------------------------------------------
// n of them the same distance off are 10 log10(n) louder than one.
for (const n of [2, 10, 166]) {
  const ring = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    ring.push(at(500 * Math.cos(a), 500 * Math.sin(a)));
  }
  near(levelAt(ring, 0, 0), levelAt([at(500, 0)], 0, 0) + 10 * Math.log10(n), 1e-9,
       `${n} sites at 500 m`);
}

// Held at a metre inside the site, or the model runs away to infinity and paints
// the camp itself an infinite decibel.
ok(Number.isFinite(levelAt([at(0, 0)], 0, 0)), "a site's own square is not finite");
near(levelAt([at(0, 0)], 0, 0), SITE_DB, 1e-9, "standing on a site");

// ---- the bands -------------------------------------------------------------
// Cut high to low, so bandOf takes the first that fits and never skips one.
for (let i = 1; i < BANDS.length; i++) {
  ok(BANDS[i].min < BANDS[i - 1].min,
     `the bands are not in falling order at ${BANDS[i].label}`);
}
ok(bandOf(BANDS[0].min) === 0, "the loudest band does not claim its own edge");
ok(bandOf(BANDS[BANDS.length - 1].min - 0.001) === -1,
   "something below the quietest band was still given a colour");

// ---- the reach -------------------------------------------------------------
// The distance the field is computed out to is the distance at which every site
// together falls to the quietest band, so at that range the level is that band's
// edge and no further out is worth drawing.
const n = 166;
const r = reachM(n);
const ring = [];
for (let i = 0; i < n; i++) ring.push(at(0, 0));
near(levelAt(ring, r, 0), BANDS[BANDS.length - 1].min, 0.01,
     "the level at the reach");

// ---- the campground itself -------------------------------------------------
const plan = planCampground(JSON.parse(fs.readFileSync(ASSET, "utf8")));
const field = noiseField(plan.sites, 60);
ok(field, "no field came back for the campground");
ok(field.span > 2 * field.reach, "the field does not cover the camp and its reach");

// The two distances the staff report gives, read as levels. These are what the
// prose said and the model has to agree with it: the houses to the west are far
// enough that the camp is under a quiet rural night, and the houses over the
// eastern boundary are not.
const mid = (plan.block.z0 + plan.block.z1) / 2;
const west = levelAt(plan.sites, plan.block.x0 - 800 * FT, mid);
const east = levelAt(plan.sites, plan.block.x1 + 40 * FT, mid);
ok(west < 35, `at the 800 ft west the camp reads ${west.toFixed(1)} dB, which is ` +
   `not under the 35 dB a quiet rural night covers`);
ok(east > 35 && east < 55,
   `at the 40 ft east the camp reads ${east.toFixed(1)} dB, and it should be ` +
   `audible over a quiet night and under the 55 dB WAC 173-60 allows by day`);
ok(east > west, "the camp is louder 800 ft west than 40 ft east");

// Band 0 is the loudest, so the loudest one on the map is the smallest index
// that got drawn at all.
const drawn = [...field.bands].filter((b) => b >= 0);
ok(drawn.length, "the field came out empty");
console.log(
  `${SITE_DB} dB a site, ${plan.sites.length} sites: ` +
  `${west.toFixed(1)} dB at the 800 ft west, ${east.toFixed(1)} dB at the 40 ft ` +
  `east, drawn out to ${field.reach.toFixed(0)} m`);
console.log(
  `loudest band the map reaches is ${BANDS[Math.min(...drawn)].label} dB, ` +
  `quietest ${BANDS[Math.max(...drawn)].label} dB`);

if (failures) {
  console.error(`${failures} failed`);
  process.exit(1);
}
console.log("ok");
