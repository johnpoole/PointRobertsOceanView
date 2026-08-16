// Where the Nielson Campground goes, worked out in metres. No three, no meshes:
// this file is the rule and campground.js is the drawing of it.
//
// Whatcom County Hearing Examiner decision CUP2024-00005, 7 July 2026, granting
// a 166-site public campground on 16.5 acres of a 46.31-acre wooded lot off
// Dogwood Way. The decision, the site plan set and every other exhibit are on
// the county's project page, whatcomcounty.us/4437/Nielson-Campground-Project.
//
// TWO KINDS OF NUMBER LIVE HERE AND THEY MUST NOT BE CONFUSED.
//
// The lot is surveyed. It comes out of Whatcom County's own parcel layer, baked
// by scripts/build_parcel.py, and the largest of its three rings measures 46.53
// acres against the 46.31 the decision states.
//
// The layout is not. The site plan set is Exhibit 22 of the decision and Exhibit
// 22 is not in the decision, so nobody here knows where the applicant's roads run
// or where any one site sits. What this file lays out is worked from the counts
// and the areas the decision does give, and every rule is written beside the
// constant it uses. It is a campground of the size and shape that was approved,
// standing on the lot that was approved. It is not the applicant's drawing.
//
// The one thing the rule cannot honour is the hydrant spacing. The decision has
// five hydrants at no more than 600 ft apart along their loop. The loop this rule
// lays out is longer than theirs, so five at 600 ft would stop short of the north
// end. Five is the decision's number and it is kept, spread along the run, and
// the spacing that comes out is handed back rather than quietly fixed.

import { toWorld } from "../geo.js";

export const FT = 0.3048;
export const ACRE_M2 = 4046.8564224;

// ---- what the decision says ------------------------------------------------
// Page numbers are the Hearing Examiner decision unless marked SR (staff report).

export const BUFFER_M = 30 * FT;          // 30-foot landscaped perimeter buffer, WCC 20.37
export const DEVELOPED_ACRES = 16.5;      // the developed area within the larger lot, p.1
export const HEIGHT_CAP_M = 25 * FT;      // Point Roberts Special District, condition 46
export const ROAD_ONE_WAY_M = 20 * FT;    // fire access, SR p.30
export const ROAD_TWO_WAY_M = 26 * FT;    // and the width at each hydrant
export const HYDRANTS = 5;                // p.7
export const HYDRANT_SPACING_M = 600 * FT; // what the decision asks for, SR p.27

// 136 tent, 18 RV, 12 park model cabins. p.7. Placed in this order, from the
// entrance inward: the RVs first because the entrance and the dump station are
// what they come for, then the cabins, then the tents.
export const SITES = [
  { kind: "rv", count: 18, pitch: 15.0, pad: [5.0, 12.0], stall: false },
  { kind: "cabin", count: 12, pitch: 10.0, pad: [3.658, 5.080], stall: true },
  { kind: "tent", count: 136, pitch: 12.0, pad: [4.0, 5.0], stall: true },
];

// Every building the decision lists, in square feet, with the wall height and
// roof rise this file gives it. The cap is checked below rather than trusted.
export const BUILDINGS = {
  store:     { sqft: 2000, wall: 3.6, rise: 1.8 },   // office and camp store
  clubhouse: { sqft: 1200, wall: 3.8, rise: 2.0 },   // community building
  restroom:  { sqft: 960, wall: 2.9, rise: 1.2 },    // two of them
  manager:   { sqft: 720, wall: 3.0, rise: 2.0 },    // manager's residence
  shed:      { sqft: 864, wall: 3.4, rise: 1.1 },    // maintenance
  cabin:     { sqft: 200, wall: 2.5, rise: 0.9 },    // park model, twelve of them
};
export const PLINTH_M = 0.25;
// A building's footprint is its area at the proportion of a real one that size.
// The cabins are the exception: a park model is twelve feet wide and its length
// falls out of the area.
const BUILDING_RATIO = 1.55;
export const CABIN_WIDTH_M = 12 * FT;

// 184 stalls at 9 by 18 feet, condition 48(i). 166 of them are one per campsite
// and stand on the site; an RV site parks on its own pad and takes no separate
// stall. The other 18 cluster at the store.
export const STALL = [9 * FT, 18 * FT];
export const CLUSTER_STALLS = 18;

// ---- what this file decides, and calls decided ------------------------------

const CELL_M = 4.0;           // how finely the lot is gridded to find the buildable part
// The band at the entrance that holds the buildings. Deep enough for the store
// with two rows of stalls behind it: at 34 m the back row crossed into the first
// rank of campsites.
const SERVICE_BAND_M = 42.0;
const SITE_GAP_M = 1.0;       // road edge to the first thing standing on the site
const STALL_GAP_M = 2.5;      // the car to what it came to stand beside
const REAR_MARGIN_M = 1.5;    // the back of a site to the back of the one behind it
const REC_DEPTH_M = 30.0;     // the two outdoor activity areas, p.7
const HYDRANT_WIDE_M = 16.0;  // how much road is widened to 26 ft at a hydrant

// ---- the lot ---------------------------------------------------------------

export function worldRing(coords) {
  return coords.map(([lat, lon]) => {
    const w = toWorld(lat, lon, 0);
    return { x: w.x, z: w.z };
  });
}

export function inRing(ring, x, z) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) {
      hit = !hit;
    }
  }
  return hit;
}

export function distToRing(ring, x, z) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = dx * dx + dz * dz;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len));
    best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return best;
}

// How far you can go from (x, z) along (dx, dz) before leaving the ring. This is
// how the entrance drive reaches the public road without anybody writing down
// where the public road is.
export function reachToEdge(ring, x, z, dx, dz) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const ex = b.x - a.x, ez = b.z - a.z;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - x) * ez - (a.z - z) * ex) / den;
    const u = ((a.x - x) * dz - (a.z - z) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  return best;
}

// The largest axis-aligned rectangle standing clear of the lot boundary by the
// perimeter buffer. The lot is a ragged fifty-one sided thing with its west side
// bitten out by the houses on Park Drive, so the buildable part is found rather
// than assumed: grid the lot, mark every cell inside and far enough in, then take
// the largest all-marked rectangle.
export function buildableRect(ring, buffer) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of ring) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
  }
  const ncols = Math.floor((x1 - x0) / CELL_M);
  const nrows = Math.floor((z1 - z0) / CELL_M);
  const free = new Uint8Array(nrows * ncols);
  for (let i = 0; i < nrows; i++) {
    const z = z0 + (i + 0.5) * CELL_M;
    for (let j = 0; j < ncols; j++) {
      const x = x0 + (j + 0.5) * CELL_M;
      free[i * ncols + j] = inRing(ring, x, z) && distToRing(ring, x, z) >= buffer ? 1 : 0;
    }
  }

  // Largest rectangle in a binary grid, row by row, by the usual stack of
  // histogram bars.
  const h = new Int32Array(ncols);
  let best = { area: 0 };
  const stack = [];
  for (let i = 0; i < nrows; i++) {
    for (let j = 0; j < ncols; j++) h[j] = free[i * ncols + j] ? h[j] + 1 : 0;
    stack.length = 0;
    for (let j = 0; j <= ncols; j++) {
      const cur = j < ncols ? h[j] : 0;
      let start = j;
      while (stack.length && stack[stack.length - 1].h > cur) {
        const top = stack.pop();
        const area = top.h * (j - top.j);
        if (area > best.area) {
          best = { area, j0: top.j, j1: j, i0: i - top.h + 1, i1: i };
        }
        start = top.j;
      }
      stack.push({ j: start, h: cur });
    }
  }
  if (!best.area) {
    throw new Error(
      `campground-plan: no cell of the lot stands ${buffer.toFixed(2)} m clear of ` +
      `its own boundary, so there is nowhere to put anything. Check ` +
      `assets/site/nielson-campground.json — the ring is probably not the lot.`);
  }
  return {
    x0: x0 + best.j0 * CELL_M, x1: x0 + best.j1 * CELL_M,
    z0: z0 + best.i0 * CELL_M, z1: z0 + (best.i1 + 1) * CELL_M,
    area: best.area * CELL_M * CELL_M,
  };
}

export function footprint(sqft) {
  const m2 = sqft * FT * FT;
  const d = Math.sqrt(m2 / BUILDING_RATIO);
  return { w: d * BUILDING_RATIO, d };
}

// ---- the plan --------------------------------------------------------------

// parcel is the baked asset. Everything below is world metres: +x east, +z south.
export function planCampground(parcel) {
  if (!parcel || !parcel.rings || !parcel.rings.length) {
    throw new Error(
      "planCampground: no parcel. assets/site/nielson-campground.json is the lot " +
      "this stands on and there is nothing to lay out without it. Re-bake it " +
      "with scripts/build_parcel.py.");
  }

  for (const [name, spec] of Object.entries(BUILDINGS)) {
    const h = PLINTH_M + spec.wall + spec.rise;
    if (h > HEIGHT_CAP_M) {
      throw new Error(
        `planCampground: the ${name} stands ${h.toFixed(2)} m and the Point ` +
        `Roberts Special District caps it at ${HEIGHT_CAP_M.toFixed(2)} m ` +
        `(25 ft), condition 46. Cut its wall or its rise in BUILDINGS.`);
    }
  }

  const ring = worldRing(parcel.rings[0].coords);

  // The developed area: the buildable rectangle shrunk about its own south edge,
  // keeping its proportion, until it is the 16.5 acres approved. South, because
  // the entrance comes off Johnson Road at the south.
  const rect = buildableRect(ring, BUFFER_M);
  const want = DEVELOPED_ACRES * ACRE_M2;
  if (rect.area < want) {
    throw new Error(
      `planCampground: the buildable part of the lot is ` +
      `${(rect.area / ACRE_M2).toFixed(2)} acres and the decision approves ` +
      `${DEVELOPED_ACRES} acres of development. The lot in ` +
      `assets/site/nielson-campground.json is too small for the permit it carries.`);
  }
  const k = Math.sqrt(want / rect.area);
  const W = (rect.x1 - rect.x0) * k;
  const D = (rect.z1 - rect.z0) * k;
  const mid = (rect.x0 + rect.x1) / 2;
  const block = { x0: mid - W / 2, x1: mid + W / 2, z0: rect.z1 - D, z1: rect.z1, w: W, d: D };

  // The spine runs down the east side, because the Johnson Road frontage and Mill
  // Road are both on that side. The rungs run west off it and the sites rank
  // along both sides of each rung.
  const spineX = block.x1 - ROAD_TWO_WAY_M / 2;
  const rungX1 = spineX - ROAD_TWO_WAY_M / 2;
  const rungX0 = block.x0 + 2.0;
  const rankLen = rungX1 - rungX0;
  // How deep a rank is, off the road edge: whatever the deepest kind of site
  // needs, and a margin behind it. Written down rather than chosen, because a
  // rank one decimetre shallower than the site standing in it puts the back of
  // every cabin through the back of the tent site behind it, and nothing on the
  // screen ever shows that.
  const siteDepth = (s) =>
    SITE_GAP_M + (s.stall ? STALL[1] + STALL_GAP_M : 0) + s.pad[1];
  const SITE_DEPTH_M = Math.max(...SITES.map(siteDepth)) + REAR_MARGIN_M;
  const bandD = SITE_DEPTH_M * 2 + ROAD_ONE_WAY_M;
  const maxRungs = Math.floor((D - SERVICE_BAND_M) / bandD);
  if (maxRungs < 1) {
    throw new Error(
      `planCampground: ${DEVELOPED_ACRES} acres came out ${W.toFixed(0)} by ` +
      `${D.toFixed(0)} m, and after the ${SERVICE_BAND_M} m service band there ` +
      `is no room for even one ${bandD.toFixed(1)} m rung. Cut SERVICE_BAND_M, or ` +
      `the pad depths in SITES, which are what set a rung's ${SITE_DEPTH_M.toFixed(1)} m ranks.`);
  }

  // Fill the ranks. A rank is one side of one rung, taken from the entrance
  // inward, and each site takes its own pitch along it. A site that will not fit
  // in what is left of a rank starts the next one.
  const queue = [];
  for (const s of SITES) for (let i = 0; i < s.count; i++) queue.push(s);
  const rungZ = [];
  for (let r = 0; r < maxRungs; r++) {
    rungZ.push(block.z1 - SERVICE_BAND_M - r * bandD - SITE_DEPTH_M - ROAD_ONE_WAY_M / 2);
  }

  const sites = [];
  let rank = 0, along = 0;
  for (const s of queue) {
    while (along + s.pitch > rankLen) { rank++; along = 0; }
    if ((rank >> 1) >= maxRungs) {
      throw new Error(
        `planCampground: ran out of block after ${sites.length} of ` +
        `${queue.length} sites. ${DEVELOPED_ACRES} acres at ${W.toFixed(0)} by ` +
        `${D.toFixed(0)} m holds ${maxRungs} rungs of ${rankLen.toFixed(0)} m and ` +
        `that is not enough. Cut the pitches or the pad depths in SITES.`);
    }
    const rung = rank >> 1;
    const south = (rank & 1) === 0;          // the rank nearer the entrance first
    const out = south ? 1 : -1;              // away from the road
    const edge = rungZ[rung] + out * ROAD_ONE_WAY_M / 2;
    const cx = rungX0 + along + s.pitch / 2;
    let stall = null;
    if (s.stall) {
      const a = edge + out * SITE_GAP_M, b = a + out * STALL[1];
      stall = { x0: cx - STALL[0] / 2, x1: cx + STALL[0] / 2,
                z0: Math.min(a, b), z1: Math.max(a, b) };
    }
    const from = SITE_GAP_M + (s.stall ? STALL[1] + STALL_GAP_M : 0);
    const a = edge + out * from, b = a + out * s.pad[1];
    sites.push({
      kind: s.kind, rank, rung, south, x: cx,
      pad: { x0: cx - s.pad[0] / 2, x1: cx + s.pad[0] / 2,
             z0: Math.min(a, b), z1: Math.max(a, b) },
      stall,
    });
    along += s.pitch;
  }
  const rungs = sites[sites.length - 1].rung + 1;
  rungZ.length = rungs;

  // The entrance drive runs south off the block to the lot boundary, which at
  // that bearing is the Johnson Road frontage. The gated access to Mill Road,
  // condition 10, runs east off the middle of the spine to the east boundary.
  const driveRun = reachToEdge(ring, spineX, block.z1, 0, 1);
  if (!Number.isFinite(driveRun)) {
    throw new Error(
      "planCampground: the drive runs south off the block and never leaves the " +
      "lot, which means the block is not inside the ring. Check buildableRect.");
  }
  const spineZ0 = rungZ[rungs - 1] - ROAD_ONE_WAY_M / 2;
  const gateZ = (block.z0 + block.z1) / 2;
  const gateRun = reachToEdge(ring, spineX, gateZ, 1, 0);

  const roads = [
    { ax: spineX, az: block.z1 + driveRun, bx: spineX, bz: spineZ0, w: ROAD_TWO_WAY_M },
  ];
  if (Number.isFinite(gateRun)) {
    roads.push({ ax: spineX, az: gateZ, bx: spineX + gateRun, bz: gateZ, w: ROAD_ONE_WAY_M });
  }
  for (const z of rungZ) {
    roads.push({ ax: rungX0, az: z, bx: rungX1, bz: z, w: ROAD_ONE_WAY_M });
  }

  // Five hydrants, spread along the whole run, and the road widened to 26 ft at
  // each. What the spacing actually comes out at is handed back.
  const runLen = driveRun + (block.z1 - spineZ0) + rungs * rankLen;
  const hydrants = [];
  for (let i = 0; i < HYDRANTS; i++) {
    const t = ((i + 0.5) / HYDRANTS) * rungs;
    const r = Math.min(rungs - 1, Math.floor(t));
    const x = rungX0 + rankLen * (t - r);
    hydrants.push({ x, z: rungZ[r], wide: HYDRANT_WIDE_M });
    roads.push({ ax: x - HYDRANT_WIDE_M / 2, az: rungZ[r],
                 bx: x + HYDRANT_WIDE_M / 2, bz: rungZ[r], w: ROAD_TWO_WAY_M });
  }

  // The buildings, west to east across the service band: the maintenance shed at
  // the far end from the way in, the clubhouse, the first activity area, the
  // first restroom, then the store and the manager's house at the entrance.
  const bandZ = block.z1 - SERVICE_BAND_M / 2;
  const buildings = [];
  const put = (name, frac, z = bandZ) => {
    const f = footprint(BUILDINGS[name].sqft);
    const b = { name, spec: BUILDINGS[name], x: rungX0 + rankLen * frac, z, ...f };
    buildings.push(b);
    return b;
  };
  put("shed", 0.06);
  put("clubhouse", 0.20);
  put("restroom", 0.66);
  const store = put("store", 0.83);
  put("manager", 0.95);

  const rec = [
    { x0: rungX0 + rankLen * 0.30, x1: rungX0 + rankLen * 0.58,
      z0: block.z1 - SERVICE_BAND_M + 2, z1: block.z1 - 2 },
  ];
  // The second activity area at the north end, where the ranks ran out, with the
  // second restroom on it. Only if the ranks did run out — a block filled to its
  // north edge has nowhere to put it.
  const northZ1 = rungZ[rungs - 1] - ROAD_ONE_WAY_M / 2 - SITE_DEPTH_M;
  if (northZ1 - REC_DEPTH_M > block.z0) {
    rec.push({ x0: rungX0 + rankLen * 0.25, x1: rungX0 + rankLen * 0.75,
               z0: northZ1 - REC_DEPTH_M, z1: northZ1 });
    put("restroom", 0.86, northZ1 - REC_DEPTH_M / 2);
  }

  // The eighteen stalls that are not on a campsite. Two rows of nine behind the
  // store, on the camp side of it, so a car parks off the entrance drive rather
  // than on it.
  const stalls = sites.filter((s) => s.stall).map((s) => s.stall);
  for (let i = 0; i < CLUSTER_STALLS; i++) {
    const x = store.x - store.w / 2 + (i % 9) * (STALL[0] + 0.3);
    const z1 = bandZ - store.d / 2 - 2.0 - (i < 9 ? 0 : 1) * (STALL[1] + 1.0);
    stalls.push({ x0: x, x1: x + STALL[0], z0: z1 - STALL[1], z1 });
  }

  return {
    ring, block, rect, spineX, rungX0, rungX1, rankLen, rungZ, rungs,
    sites, stalls, roads, hydrants, buildings, rec,
    developedAcres: (W * D) / ACRE_M2,
    lotAcres: parcel.rings[0].acres,
    runLen,
    hydrantSpacing: runLen / HYDRANTS,
    hydrantSpacingWanted: HYDRANT_SPACING_M,
    centre: { x: (block.x0 + block.x1) / 2, z: (block.z0 + block.z1) / 2 },
    span: Math.max(W, D),
  };
}
