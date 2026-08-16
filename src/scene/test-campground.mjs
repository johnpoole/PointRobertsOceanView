// The campground, laid out.
//
// Run:
//     node src/scene/test-campground.mjs
//
// Plain asserts and a non-zero exit, the same as the python tests in server/,
// because the project has no test runner and this does not need one.
//
// The layout is a rule applied to a surveyed lot, so what can go wrong is
// arithmetic: a site standing outside the buffer the code was supposed to keep,
// two sites on the same ground, a building over the height the permit caps, a
// count that does not add up to what was approved. All of that is invisible on
// screen at any range this is ever seen from.
//
// The project has no package.json, so node reads a .js file as CommonJS and an
// import statement inside one is a syntax error. Each module is read, its own
// relative imports rewritten to data URLs, and handed to node that way, which is
// the same trick test-trees.mjs uses.
//
// campground-plan.js imports geo.js, which imports config.js, which reads the
// page it was served from. Nothing under test uses it.

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
        `test-campground: ${path.basename(abs)} imports "${spec}", which is not a ` +
        `file beside it, so the test has no way to resolve it. The plan is meant ` +
        `to stand clear of three — if it now imports it, the split has been lost.`);
    });
  const url = "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64");
  rewritten.set(abs, url);
  return url;
}

const {
  BUFFER_M, BUILDINGS, CLUSTER_STALLS, DEVELOPED_ACRES, FT,
  HEIGHT_CAP_M, HYDRANTS, PLINTH_M, RV_FROM_EAST_M, SITES,
  SITE_SETBACK_M, STORE_SETBACK_M,
  distToRing, inRing, planCampground, reachToEdge,
} = await import(asDataUrl(path.join(HERE, "campground-plan.js")));

let failures = 0;
function ok(cond, what) {
  if (cond) return;
  failures++;
  console.error("FAIL " + what);
}
function near(got, want, tol, what) {
  ok(Math.abs(got - want) <= tol, `${what}: ${got} is not within ${tol} of ${want}`);
}

const parcel = JSON.parse(fs.readFileSync(ASSET, "utf8"));
const plan = planCampground(parcel);

// ---- the lot ---------------------------------------------------------------
// The county's geometry against the acreage the decision states. More than an
// acre apart and this is not the lot the permit is about.
near(parcel.rings[0].acres, parcel.legal_acres, 1.0, "the lot's acreage");
ok(parcel.rings.length === 3, `the parcel has ${parcel.rings.length} rings, not 3`);

// ---- the developed area ----------------------------------------------------
near(plan.developedAcres, DEVELOPED_ACRES, 0.05, "the developed area");
ok(plan.block.x1 > plan.block.x0 && plan.block.z1 > plan.block.z0,
   "the block came out inside out");
// Every corner of the block stands inside the lot and clear of its boundary by
// the setback. This is the whole point of easternRect.
for (const x of [plan.block.x0, plan.block.x1]) {
  for (const z of [plan.block.z0, plan.block.z1]) {
    ok(inRing(plan.ring, x, z), `block corner ${x.toFixed(0)},${z.toFixed(0)} is off the lot`);
    ok(distToRing(plan.ring, x, z) >= SITE_SETBACK_M - 1e-6,
       `block corner ${x.toFixed(0)},${z.toFixed(0)} is ` +
       `${distToRing(plan.ring, x, z).toFixed(2)} m from the boundary, inside the ` +
       `${SITE_SETBACK_M.toFixed(2)} m setback`);
  }
}
ok(SITE_SETBACK_M >= BUFFER_M,
   `the site setback ${SITE_SETBACK_M.toFixed(2)} m is inside the code buffer ` +
   `${BUFFER_M.toFixed(2)} m`);

// ---- the staff report's own distances --------------------------------------
// The three the report states, read back off the layout rather than fed into it.
// The 800 ft west is the check on the whole eastern-third reading: nothing tunes
// it, so if it drifts a long way the reading is wrong.
const westFt = plan.westToNeighbour / FT;
ok(westFt > 600 && westFt < 1000,
   `the block's west edge came out ${westFt.toFixed(0)} ft from the neighbouring ` +
   `lots and the staff report says about 800`);
ok(plan.rvFromEast >= RV_FROM_EAST_M,
   `the RV sites are ${(plan.rvFromEast / FT).toFixed(0)} ft off the eastern ` +
   `boundary and the staff report has them over ${(RV_FROM_EAST_M / FT).toFixed(0)}`);
// The eastmost thing on the site is a tent rank. The report puts the tent sites
// about 40 ft off the eastern boundary, and nothing here may be closer than
// that. It comes out further, because the lot's east boundary steps nine metres
// west partway up and a straight row has to stand off the tighter half.
const eastmost = plan.sites.reduce((a, b) => (b.pad.x1 > a.pad.x1 ? b : a));
ok(eastmost.kind === "tent",
   `the eastmost site is a ${eastmost.kind} and the staff report has tent sites ` +
   `nearest the eastern boundary`);
const eastFt = plan.siteFromEast / FT;
ok(eastFt >= 40, `a site stands ${eastFt.toFixed(0)} ft off the eastern boundary ` +
   `and the staff report's nearest is 40`);
ok(eastFt < 70, `the nearest site is ${eastFt.toFixed(0)} ft off the eastern ` +
   `boundary and the staff report says about 40, which this is no longer near`);
// And the park models are the westmost thing on it.
const westmost = plan.sites.reduce((a, b) => (b.pad.x0 < a.pad.x0 ? b : a));
ok(westmost.kind === "cabin",
   `the westmost site is a ${westmost.kind} and the staff report has the park ` +
   `models on the western side`);

// ---- the sites -------------------------------------------------------------
const wanted = SITES.reduce((n, s) => n + s.count, 0);
ok(plan.sites.length === wanted,
   `${plan.sites.length} sites placed, ${wanted} approved`);
for (const s of SITES) {
  const got = plan.sites.filter((p) => p.kind === s.kind).length;
  ok(got === s.count, `${got} ${s.kind} sites, ${s.count} approved`);
}
// Park models west, RVs central, tents through the remainder: a rank carries one
// kind and no other, the westmost is the park models, and the RV rank is not an
// outer one.
for (let r = 0; r < plan.ranks.length; r++) {
  const kinds = new Set(plan.sites.filter((s) => s.rank === r).map((s) => s.kind));
  ok(kinds.size <= 1,
     `rank ${r} carries ${[...kinds].join(" and ")}, and a rank carries one kind`);
}
ok(plan.kindOf[0] === "cabin",
   `the westmost rank carries ${plan.kindOf[0]} sites, not the park models`);
ok(plan.rvRank > 0 && plan.rvRank < plan.ranks.length - 1,
   `the RVs are on rank ${plan.rvRank} of ${plan.ranks.length}, which is an ` +
   `outer one, and the staff report has them central`);
ok(plan.kindOf[plan.ranks.length - 1] === "tent",
   `the eastmost rank carries ${plan.kindOf[plan.ranks.length - 1]} sites, not tents`);

// Every made surface — pad, stall, road, clearing — lies on the block and clear
// of the lot boundary.
const rects = [
  ...plan.sites.map((s) => s.pad),
  ...plan.stalls,
  ...plan.rec,
  ...plan.buildings.map((b) => ({
    x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2 })),
];
for (const r of rects) {
  for (const [x, z] of [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]]) {
    ok(x >= plan.block.x0 - 1e-6 && x <= plan.block.x1 + 1e-6
       && z >= plan.block.z0 - 1e-6 && z <= plan.block.z1 + 1e-6,
       `a made surface reaches ${x.toFixed(1)},${z.toFixed(1)}, off the block ` +
       `${plan.block.x0.toFixed(1)}..${plan.block.x1.toFixed(1)} by ` +
       `${plan.block.z0.toFixed(1)}..${plan.block.z1.toFixed(1)}`);
    ok(distToRing(plan.ring, x, z) >= BUFFER_M - 1e-6,
       `a made surface reaches ${x.toFixed(1)},${z.toFixed(1)}, which is ` +
       `${distToRing(plan.ring, x, z).toFixed(2)} m from the lot boundary`);
  }
}

// No two of them stand on the same ground. n squared over 596 rectangles is
// nothing, and a sweep would only hide the arithmetic being tested.
const overlaps = [];
for (let i = 0; i < rects.length; i++) {
  for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    if (a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6
        && a.z0 < b.z1 - 1e-6 && b.z0 < a.z1 - 1e-6) {
      overlaps.push(`${a.x0.toFixed(1)},${a.z0.toFixed(1)} and ` +
                    `${b.x0.toFixed(1)},${b.z0.toFixed(1)}`);
    }
  }
}
ok(overlaps.length === 0,
   `${overlaps.length} made surfaces overlap, first at ${overlaps[0]}`);

// ---- the stalls ------------------------------------------------------------
// 184 at nine by eighteen feet, condition 48(i): one per campsite, except an RV
// parks on its own pad, plus eighteen at the store.
const onSite = SITES.filter((s) => s.stall).reduce((n, s) => n + s.count, 0);
ok(plan.stalls.length === onSite + CLUSTER_STALLS,
   `${plan.stalls.length} stalls, expected ${onSite + CLUSTER_STALLS}`);
const rvs = SITES.find((s) => s.kind === "rv").count;
ok(plan.stalls.length + rvs === 184,
   `${plan.stalls.length} stalls and ${rvs} RV pads is ` +
   `${plan.stalls.length + rvs}, and the decision counts 184`);
// A stall on a site lies across its rank and one at the store lies along the
// band, so nine by eighteen is checked either way round.
for (const s of plan.stalls) {
  const a = s.x1 - s.x0, b = s.z1 - s.z0;
  ok(Math.abs(Math.min(a, b) - 9 * FT) < 1e-6 && Math.abs(Math.max(a, b) - 18 * FT) < 1e-6,
     `a stall is ${a.toFixed(2)} by ${b.toFixed(2)} m, not nine by eighteen feet`);
}

// ---- the buildings ---------------------------------------------------------
// Every building the decision lists is here, the restroom twice, and none of
// them is over the twenty-five feet the Special District allows.
const byName = {};
for (const b of plan.buildings) byName[b.name] = (byName[b.name] || 0) + 1;
ok(byName.restroom === 2, `${byName.restroom} restroom blocks, the decision has 2`);
for (const name of ["store", "clubhouse", "manager", "shed"]) {
  ok(byName[name] === 1, `${byName[name] || 0} of the ${name}, expected 1`);
}
for (const b of plan.buildings) {
  near(b.w * b.d, BUILDINGS[b.name].sqft * FT * FT, 0.01,
       `the ${b.name}'s footprint`);
  const h = PLINTH_M + b.spec.wall + b.spec.rise;
  ok(h <= HEIGHT_CAP_M,
     `the ${b.name} stands ${h.toFixed(2)} m over the ${HEIGHT_CAP_M.toFixed(2)} m cap`);
}
// The store, the manager's residence and the community building are on the south
// side by the entrance, and the store's own setback off the southern boundary is
// stated rather than chosen.
const store = plan.buildings.find((b) => b.name === "store");
near(reachToEdge(plan.ring, store.x, store.z + store.d / 2, 0, 1) / FT, 57, 0.5,
     "the store's setback off the southern boundary, in feet");
for (const name of ["store", "manager", "clubhouse"]) {
  const b = plan.buildings.find((x) => x.name === name);
  ok(b.z > plan.spineZ,
     `the ${name} stands at z ${b.z.toFixed(1)}, north of the spine at ` +
     `${plan.spineZ.toFixed(1)}, and the staff report has it on the south side ` +
     `by the entrance`);
}

// The cabins are the twelve park models, twelve feet wide, and they are sites
// rather than buildings, so they are counted off the site list.
const cabins = plan.sites.filter((s) => s.kind === "cabin");
ok(cabins.length === 12, `${cabins.length} park models, the decision has 12`);
for (const c of cabins) {
  // Its width lies across the rank, which now runs north and south, so twelve
  // feet is the z span and the length is the x one.
  near(c.pad.z1 - c.pad.z0, 12 * FT, 1e-3, "a park model's width");
  near((c.pad.x1 - c.pad.x0) * (c.pad.z1 - c.pad.z0), 200 * FT * FT, 0.01,
       "a park model's floor area");
}

// ---- the roads -------------------------------------------------------------
ok(plan.hydrants.length === HYDRANTS,
   `${plan.hydrants.length} hydrants, the decision has ${HYDRANTS}`);
for (const h of plan.hydrants) {
  ok(inRing(plan.ring, h.x, h.z), "a hydrant stands off the lot");
}
// The entrance drive leaves the block southward and reaches the lot boundary.
// Its far end is the Johnson Road frontage, so it must be outside the block.
const drive = plan.roads[0];
ok(drive.az > plan.block.z1,
   `the entrance drive ends at z ${drive.az.toFixed(1)}, which is not south of ` +
   `the block's south edge at ${plan.block.z1.toFixed(1)}`);
ok(distToRing(plan.ring, drive.ax, drive.az) < 1e-3,
   "the entrance drive stops short of the lot boundary");

// What the layout came out at, including the one number the rule cannot honour.
console.log(
  `lot ${plan.lotAcres} acres, developed ${plan.developedAcres.toFixed(2)}, ` +
  `${plan.sites.length} sites over ${plan.ranks.length} ranks on ${plan.rungs} ` +
  `rows, ${plan.stalls.length} stalls, ${plan.buildings.length} buildings`);
console.log(
  `west edge ${(plan.westToNeighbour / FT).toFixed(0)} ft off the neighbours ` +
  `(report says about 800), RVs ${(plan.rvFromEast / FT).toFixed(0)} ft off the ` +
  `eastern boundary (report says over 200)`);
console.log(
  `road run ${plan.runLen.toFixed(0)} m, ${HYDRANTS} hydrants at ` +
  `${plan.hydrantSpacing.toFixed(0)} m apart, and the decision asks for no more ` +
  `than ${plan.hydrantSpacingWanted.toFixed(0)} m`);

if (failures) {
  console.error(`${failures} failed`);
  process.exit(1);
}
console.log("ok");
