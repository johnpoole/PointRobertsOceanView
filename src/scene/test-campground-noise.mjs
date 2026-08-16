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
// is checked against the closed forms it is supposed to obey — 6 dB per doubling
// while the ray is still climbing, 3 dB per doubling once the inversion has
// turned it, n identical sources at one range 10 log10(n) over one — and then
// the whole field is checked against the two distances the staff report gives
// for this site.

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

const {
  ALPHA_DB_PER_KM, BANDS, DUCT_M, SITE_DB,
  bandOf, levelAt, noiseField, reachM, spreadingLoss,
} = await import(asDataUrl(path.join(HERE, "campground-noise.js")));
const { FT, planCampground } =
  await import(asDataUrl(path.join(HERE, "campground-plan.js")));

let failures = 0;
function ok(cond, what) {
  if (cond) return;
  failures++;
  console.error("FAIL " + what);
}
function near(got, want, tol, what) {
  ok(Math.abs(got - want) <= tol, `${what}: ${got.toFixed(3)} is not within ${tol} of ${want}`);
}

// A site is a rectangle, and the model takes its middle.
const at = (x, z) => ({ pad: { x0: x, x1: x, z0: z, z1: z } });
// The loss with the ground and the air taken back out, which is the part the
// inversion changes.
const geo = (d) => spreadingLoss(d) - (ALPHA_DB_PER_KM * d) / 1000;

// ---- the inversion ---------------------------------------------------------
// Inside the duct the ray is still climbing and the spreading is spherical: 6 dB
// every doubling.
near(geo(1), 0, 1e-9, "the geometric loss at one metre");
for (const d of [2, 10, 100]) {
  near(geo(d), 20 * Math.log10(d), 1e-9, `the geometric loss at ${d} m`);
}
near(geo(100) - geo(50), 6.02, 0.01, "the drop over a doubling inside the duct");

// Past it the inversion has turned the ray back down, the wave spreads over a
// cylinder instead of a sphere, and the doubling costs half as much.
for (const d of [DUCT_M, 400, 1000]) {
  near(geo(2 * d) - geo(d), 3.01, 0.01, `the drop over a doubling from ${d} m`);
}
// And the two halves meet, rather than the level jumping at the seam.
near(geo(DUCT_M + 1e-6), geo(DUCT_M), 1e-4, "the loss across the duct's edge");

// What the inversion is worth: how much louder a kilometre out than it would be
// on an afternoon with no duct at all.
const gain = 20 * Math.log10(1000) - geo(1000);
near(gain, 6.99, 0.01, "what the inversion is worth at a kilometre");
ok(gain > 0, "the inversion made the camp quieter, which is the wrong way round");

// The ground and the air take their cut over the whole path, which is the only
// reason the duct ever falls silent.
near(spreadingLoss(1000) - geo(1000), ALPHA_DB_PER_KM, 1e-9,
     "what the ground and the air take out over a kilometre");

// ---- one source ------------------------------------------------------------
for (const d of [1, 2, 50, 200, 1000, 3000]) {
  near(levelAt([at(0, 0)], d, 0), SITE_DB - spreadingLoss(d), 1e-9,
       `one site at ${d} m`);
}

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
near(levelAt([at(0, 0)], 0, 0), SITE_DB - spreadingLoss(1), 1e-9, "standing on a site");

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
// The distance the field is drawn out to is where every site together falls to
// the quietest band, so at that range the level is that band's edge exactly.
const n = 166;
const ring = [];
for (let i = 0; i < n; i++) ring.push(at(0, 0));
near(levelAt(ring, reachM(n), 0), BANDS[BANDS.length - 1].min, 0.01,
     "the level at the reach");

// ---- the campground itself -------------------------------------------------
const plan = planCampground(JSON.parse(fs.readFileSync(ASSET, "utf8")));
const field = noiseField(plan.sites, 60);
ok(field, "no field came back for the campground");
ok(field.span > 2 * field.reach, "the field does not cover the camp and its reach");

// The two distances the staff report gives, read as levels on the worst night.
// The houses over the eastern boundary are inside the 45 dBA that WAC 173-60
// allows after ten at night and outside the 55 it allows by day. The houses to
// the west are outside both and still audible.
const mid = (plan.block.z0 + plan.block.z1) / 2;
const west = levelAt(plan.sites, plan.block.x0 - 800 * FT, mid);
const east = levelAt(plan.sites, plan.block.x1 + 40 * FT, mid);
ok(east > 45 && east < 55,
   `at the 40 ft east the camp reads ${east.toFixed(1)} dB, and on the worst ` +
   `night it should be over the 45 dBA night limit and under the 55 dBA day one`);
ok(west > 35 && west < 45,
   `at the 800 ft west the camp reads ${west.toFixed(1)} dB, and it should stand ` +
   `out of a quiet rural night and stay under the 45 dBA night limit`);
ok(east > west, "the camp is louder 800 ft west than 40 ft east");

// How far the night limit reaches, which is the number the neighbours care
// about. Walked east off the block until the level drops through 45.
let nightM = 0;
while (levelAt(plan.sites, plan.block.x1 + nightM, mid) > 45 && nightM < 5000) nightM += 5;

const drawn = [...field.bands].filter((b) => b >= 0);
ok(drawn.length, "the field came out empty");
console.log(
  `${SITE_DB} dB a site, ${plan.sites.length} sites, duct from ${DUCT_M} m, ` +
  `${ALPHA_DB_PER_KM} dB a km out of it`);
console.log(
  `${east.toFixed(1)} dB at the 40 ft east, ${west.toFixed(1)} dB at the 800 ft ` +
  `west, quiet by ${field.reach.toFixed(0)} m`);
console.log(
  `the 45 dBA night limit reaches ${nightM} m off the east edge of the camp; ` +
  `bands drawn run ${BANDS[Math.min(...drawn)].label} to ${BANDS[Math.max(...drawn)].label} dB`);

if (failures) {
  console.error(`${failures} failed`);
  process.exit(1);
}
console.log("ok");
