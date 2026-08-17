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
  AIR_DB_PER_KM, BANDS, GROUND_PATH_H_M, SITE_DB,
  bandOf, groundLoss, levelAt, noiseField, reachM, spreadingLoss,
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
// The spreading on its own, with the air and the ground taken back out.
const geo = (d) => spreadingLoss(d) - (AIR_DB_PER_KM * d) / 1000 - groundLoss(d);

// ---- the terms, each against the standard ----------------------------------
// Geometrical divergence, ISO 9613-2 equation (7): spherical, at every distance.
// Six decibels a doubling and no duct — a night inversion does not change this,
// because the standard's whole method is already the inversion case.
near(geo(1), 0, 1e-9, "the spreading at one metre");
for (const d of [2, 10, 100, 200, 1000, 3000]) {
  near(geo(d), 20 * Math.log10(d), 1e-9, `the spreading at ${d} m`);
}
for (const d of [50, 200, 1000]) {
  near(geo(2 * d) - geo(d), 6.02, 0.01, `the drop over a doubling from ${d} m`);
}

// Atmospheric absorption, ISO 9613-2 equation (8): a d / 1000, and nothing else.
near(spreadingLoss(1000) - spreadingLoss(1000 - 1e-9)
     - (groundLoss(1000) - groundLoss(1000 - 1e-9)), 0, 1e-6, "a continuous loss");
for (const d of [500, 1000, 2000]) {
  near(spreadingLoss(d) - geo(d) - groundLoss(d), (AIR_DB_PER_KM * d) / 1000, 1e-9,
       `what the air takes out over ${d} m`);
}

// Ground effect, ISO 9613-2 equation (10). It climbs fast and then sits just
// under 4,8 dB for ever. It is not a loss per kilometre, and the whole reason
// this test exists is that an earlier version of the model made it one.
ok(groundLoss(5) === 0, "the ground is already taking something out at five metres");
for (const d of [400, 1000, 4000]) {
  near(groundLoss(d), 4.8 - ((2 * GROUND_PATH_H_M) / d) * (17 + 300 / d), 1e-12,
       `the ground effect at ${d} m`);
}
// Ten times the distance may not buy more than a fraction of a decibel. A loss
// of 3 dB a kilometre, which is what this used to be, would buy 3,6.
ok(groundLoss(4000) - groundLoss(400) < 0.2,
   `the ground took ${(groundLoss(4000) - groundLoss(400)).toFixed(2)} dB more ` +
   `over ten times the distance, so it is behaving like a per-kilometre loss`);
ok(groundLoss(1e6) < 4.8, "the ground effect went over its own ceiling");

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
// A quiet rural night is 25 to 35 dB on its own. Nothing under that may be
// drawn: the camp cannot be picked out of the background there, and a region
// where it is inaudible is not an impact and must not be coloured like one.
ok(BANDS[BANDS.length - 1].min >= 35,
   `the quietest band starts at ${BANDS[BANDS.length - 1].min} dB, which is ` +
   `inside what a quiet rural night already sounds like`);

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
// The source level is the one term with no measured campground behind it. What
// can be asserted is that it is the vocal effort claimed and not another one.
// ANSI S3.5-1997 gives, a metre in front of a talker: normal 62,35 · raised
// 68,34 · loud 74,85 · shout 82,30 dB. This model says raised, so it must sit
// between raised and loud, nearer raised.
ok(SITE_DB >= 68.34 && SITE_DB < 74.85,
   `the source is ${SITE_DB} dB at a metre. ANSI S3.5-1997 puts a raised voice ` +
   `at 68,34 and a loud one at 74,85, and this file claims a raised voice`);

console.log(
  `${SITE_DB} dB a site, ${plan.sites.length} sites, spherical throughout, ` +
  `${AIR_DB_PER_KM} dB a km of air, ${groundLoss(1000).toFixed(1)} dB of ground`);
console.log(
  `${east.toFixed(1)} dB at the 40 ft east, ${west.toFixed(1)} dB at the 800 ft ` +
  `west, quiet by ${field.reach.toFixed(0)} m`);
console.log(
  `the 45 dBA night limit reaches ${nightM} m off the east edge of the camp; ` +
  `bands drawn run ${BANDS[Math.min(...drawn)].label} to ${BANDS[Math.max(...drawn)].label} dB`);

// What the unmeasured number costs. Printed every run, because a reader who sees
// only the line above will take 60 m for a finding, and it is an assumption
// wearing a finding's clothes.
const reach45 = (S) => {
  let m = 0;
  while (10 * Math.log10(plan.sites.reduce((e, s) => {
    const sx = (s.pad.x0 + s.pad.x1) / 2, sz = (s.pad.z0 + s.pad.z1) / 2;
    return e + Math.pow(10, (S - spreadingLoss(Math.hypot(plan.block.x1 + m - sx, mid - sz))) / 10);
  }, 0)) > 45 && m < 9000) m += 5;
  return m;
};
console.log(
  `move the source and it moves: ${[64, 70, 76, 82]
    .map((S) => `${S} dB -> ${reach45(S)} m`).join(", ")}`);

if (failures) {
  console.error(`${failures} failed`);
  process.exit(1);
}
console.log("ok");
