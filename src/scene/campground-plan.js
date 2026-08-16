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
// The drawing of the layout is not here. The site plan set is Exhibit 22 and
// Exhibit 22 is not in the decision, so nobody here has seen where the
// applicant's roads run or where any one site sits.
//
// But the staff report describes the layout in prose, and everything it says is
// obeyed rather than invented around. Five statements, all from pages 14 and 15
// of the staff report, and every one of them drives a constant below:
//
//   the campground is clustered in the eastern third of the lot
//   the store, the manager's residence and the community building are on the
//     south side of the development by the main entrance off Johnson Road
//   the park models are on the western side, the RVs central, and the tent
//     sites through the remainder
//   the nearest residence to the west is about 800 ft from the camp sites, the
//     RVs are more than 200 ft and the tent sites about 40 ft from the eastern
//     property boundary, and the store is 57 ft from the southern boundary
//   a secondary gated access runs off Mill Road
//
// The 800 ft is the check on the whole thing rather than an input. Take the
// eastern 16.5 acres of the lot and its west edge lands 827 ft from the houses
// on the far side of the western notch. Nothing was tuned to make that happen.
//
// The one thing the rule cannot honour is the hydrant spacing. The decision has
// five hydrants no more than 600 ft apart along their loop. The loop this rule
// lays out is longer than theirs, so five at 600 ft would stop short of the end.
// Five is the decision's number and it is kept, spread along the run, and the
// spacing that comes out is handed back rather than quietly fixed.

import { toWorld } from "../geo.js";

export const FT = 0.3048;
export const ACRE_M2 = 4046.8564224;

// ---- what the decision says ------------------------------------------------
// SR is the staff report, which is attached to the decision.

export const BUFFER_M = 30 * FT;           // landscaped perimeter buffer, WCC 20.37
export const DEVELOPED_ACRES = 16.5;       // the developed area within the lot, p.1
export const HEIGHT_CAP_M = 25 * FT;       // Point Roberts Special District, condition 46
export const ROAD_ONE_WAY_M = 20 * FT;     // fire access, SR p.30
export const ROAD_TWO_WAY_M = 26 * FT;     // and the width at each hydrant
export const HYDRANTS = 5;                 // p.7
export const HYDRANT_SPACING_M = 600 * FT; // what the decision asks for, SR p.27

// How far a camp site stands off the lot boundary. The code minimum is the 30 ft
// buffer, but the tightest distance the applicant states is 40 ft, tent sites to
// the eastern boundary, so 40 ft is what every site gets. Asserted against the
// code minimum below rather than assumed to clear it.
export const SITE_SETBACK_M = 40 * FT;     // SR p.15
// And the store's own, to the southern boundary along Johnson Road.
export const STORE_SETBACK_M = 57 * FT;    // SR p.15
// The RVs are kept this far off the eastern boundary, which is what puts them
// central. Checked rather than arranged for.
export const RV_FROM_EAST_M = 200 * FT;    // SR p.15

// 136 tent, 18 RV, 12 park model cabins. p.7.
export const SITES = [
  { kind: "cabin", count: 12, pitch: 10.0, pad: [3.658, 5.080], stall: true },
  { kind: "rv", count: 18, pitch: 15.0, pad: [5.0, 12.0], stall: false },
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
// The park models are the exception: one is twelve feet wide and its length
// falls out of the area.
const BUILDING_RATIO = 1.55;
export const CABIN_WIDTH_M = 12 * FT;

// 184 stalls at 9 by 18 feet, condition 48(i). 166 of them are one per campsite
// and stand on the site; an RV site parks on its own pad and takes no separate
// stall. The other 18 cluster behind the store.
export const STALL = [9 * FT, 18 * FT];
export const CLUSTER_STALLS = 18;

// ---- what this file decides, and calls decided ------------------------------

const CELL_M = 4.0;           // how finely the lot is gridded to find the buildable part
// The band along the south that holds the buildings. Deep enough for the store
// with two rows of stalls behind it.
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
// how the entrance drive reaches the public road, and how the store finds the
// southern boundary it is set back from, without anybody writing either down.
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

// Every cell of the lot that lies inside it and stands at least `setback` clear
// of its own boundary. The lot is a ragged fifty-one sided thing with its west
// side bitten out by the houses on Park Drive, so this is found rather than
// assumed.
function buildableMask(ring, setback) {
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
      free[i * ncols + j] = inRing(ring, x, z) && distToRing(ring, x, z) >= setback ? 1 : 0;
    }
  }
  return { free, ncols, nrows, x0, z0 };
}

// The largest all-free rectangle lying no further west than column j0, by the
// usual stack of histogram bars.
function largestRect(mask, j0) {
  const { free, ncols, nrows } = mask;
  const h = new Int32Array(ncols);
  let best = { area: 0 };
  const stack = [];
  for (let i = 0; i < nrows; i++) {
    for (let j = j0; j < ncols; j++) h[j] = free[i * ncols + j] ? h[j] + 1 : 0;
    stack.length = 0;
    for (let j = j0; j <= ncols; j++) {
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
  return best;
}

// The easternmost buildable rectangle holding the acreage asked for. The western
// limit is walked east to west and the first one that is big enough wins, which
// is what "clustered in the eastern third of the lot" means when it has to be a
// number. Its own west edge is then the 800 ft to the neighbours, unforced.
export function easternRect(ring, setback, wantM2) {
  const mask = buildableMask(ring, setback);
  // Half a cell in on every side. A cell is marked free by its centre, so the
  // rectangle's own edges run half a cell beyond the last centre that was tested
  // and would stand a quarter of a metre inside the setback. The acreage is
  // measured after that trim, not before, or the block comes up short.
  const h = CELL_M / 2;
  for (let j0 = mask.ncols - 1; j0 >= 0; j0--) {
    const r = largestRect(mask, j0);
    if (!r.area) continue;
    const x0 = mask.x0 + r.j0 * CELL_M + h, x1 = mask.x0 + r.j1 * CELL_M - h;
    const z0 = mask.z0 + r.i0 * CELL_M + h, z1 = mask.z0 + (r.i1 + 1) * CELL_M - h;
    const area = (x1 - x0) * (z1 - z0);
    if (area < wantM2) continue;
    return { x0, x1, z0, z1, area };
  }
  throw new Error(
    `easternRect: nowhere on the lot holds ${(wantM2 / ACRE_M2).toFixed(2)} acres ` +
    `standing ${setback.toFixed(2)} m clear of its own boundary. Check ` +
    `assets/site/nielson-campground.json — the ring is probably not the lot.`);
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
  if (SITE_SETBACK_M < BUFFER_M) {
    throw new Error(
      `planCampground: sites are set back ${SITE_SETBACK_M.toFixed(2)} m and the ` +
      `code buffer is ${BUFFER_M.toFixed(2)} m, so this layout would stand inside ` +
      `the buffer WCC 20.37 requires. Raise SITE_SETBACK_M.`);
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

  // The eastern 16.5 acres, then the north edge brought south until it is exactly
  // that. South, because the entrance and the buildings are on the Johnson Road
  // end and that end is held.
  const want = DEVELOPED_ACRES * ACRE_M2;
  const rect = easternRect(ring, SITE_SETBACK_M, want);
  const W = rect.x1 - rect.x0;
  const block = { x0: rect.x0, x1: rect.x1, z1: rect.z1, z0: rect.z1 - want / W, w: W };
  block.d = block.z1 - block.z0;

  // The rungs run north and south across the width, so a rank is a north-south
  // row of sites and the ranks read west to east. That is the only arrangement
  // in which "park models west, RVs central, tents through the remainder" is a
  // thing you can lay out rather than a thing you approximate.
  const siteDepth = (s) =>
    SITE_GAP_M + (s.stall ? STALL[1] + STALL_GAP_M : 0) + s.pad[1];
  // How deep a rank is, off the road edge: whatever the deepest kind of site
  // needs, and a margin behind it. Written down rather than chosen, because a
  // rank a decimetre shallower than the site standing in it puts the back of
  // every park model through the back of the tent behind it, and nothing on the
  // screen ever shows that.
  const rankDepth = Math.max(...SITES.map(siteDepth)) + REAR_MARGIN_M;
  const bandW = rankDepth * 2 + ROAD_ONE_WAY_M;
  const rungs = Math.floor(W / bandW);
  if (rungs < 2) {
    throw new Error(
      `planCampground: the eastern ${DEVELOPED_ACRES} acres came out ${W.toFixed(0)} m ` +
      `wide and one row of sites is ${bandW.toFixed(1)} m, so there is no room for ` +
      `the park models and the RVs to be in different rows. Cut the pad depths in SITES.`);
  }
  // What is left over is spread between the rows rather than pushed to one side,
  // so the westmost rank sits on the block's west edge and the eastmost on its
  // east edge and both stated distances hold at once. The gaps become the trees
  // left standing between the rows.
  const gap = rungs > 1 ? (W - rungs * bandW) / (rungs - 1) : 0;

  // The ranks, west to east. Rank 2r is the west side of rung r and 2r+1 the east.
  const ranks = [];
  for (let r = 0; r < rungs; r++) {
    const bx0 = block.x0 + r * (bandW + gap);
    const roadX = bx0 + rankDepth + ROAD_ONE_WAY_M / 2;
    ranks.push({ rung: r, roadX, out: -1, x0: bx0, x1: bx0 + rankDepth });
    ranks.push({ rung: r, roadX, out: 1,
                 x0: bx0 + rankDepth + ROAD_ONE_WAY_M,
                 x1: bx0 + bandW });
    ranks[ranks.length - 2].roadEdge = roadX - ROAD_ONE_WAY_M / 2;
    ranks[ranks.length - 1].roadEdge = roadX + ROAD_ONE_WAY_M / 2;
  }

  // The park models take the westmost rank and the RVs the rank whose middle
  // lies nearest the middle of the block, which is what "centrally located"
  // comes to when it has to pick one. The tents take everything else, divided as
  // evenly as they go, so the eastmost rank is tents and stands at its 40 ft.
  const midX = (block.x0 + block.x1) / 2;
  let rvRank = 1;
  for (let i = 1; i < ranks.length - 1; i++) {
    const c = (r) => Math.abs((ranks[r].x0 + ranks[r].x1) / 2 - midX);
    if (c(i) < c(rvRank)) rvRank = i;
  }
  const kindOf = new Array(ranks.length).fill("tent");
  kindOf[0] = "cabin";
  kindOf[rvRank] = "rv";

  const rankZ0 = block.z0 + REC_DEPTH_M;          // the north clearing
  const rankZ1 = block.z1 - SERVICE_BAND_M;       // the buildings at the south
  const rankLen = rankZ1 - rankZ0;
  if (rankLen <= 0) {
    throw new Error(
      `planCampground: the block is ${block.d.toFixed(0)} m deep and the service ` +
      `band and the north clearing want ${(SERVICE_BAND_M + REC_DEPTH_M).toFixed(0)} m ` +
      `of it, leaving nothing for sites. Cut SERVICE_BAND_M or REC_DEPTH_M.`);
  }

  // How many of each kind go on each rank carrying that kind. A kind on one rank
  // is all of it; a kind spread over several is divided as evenly as it goes.
  const sites = [];
  for (const spec of SITES) {
    const mine = [];
    for (let i = 0; i < ranks.length; i++) if (kindOf[i] === spec.kind) mine.push(i);
    if (!mine.length) {
      throw new Error(
        `planCampground: no rank was given to the ${spec.kind} sites, so ` +
        `${spec.count} of them have nowhere to stand. Check kindOf.`);
    }
    let left = spec.count;
    for (let k = 0; k < mine.length; k++) {
      const n = Math.ceil(left / (mine.length - k));
      left -= n;
      const run = n * spec.pitch;
      if (run > rankLen) {
        throw new Error(
          `planCampground: ${n} ${spec.kind} sites at ${spec.pitch} m need ` +
          `${run.toFixed(0)} m and a rank is ${rankLen.toFixed(0)} m. Give the ` +
          `${spec.kind} sites more ranks in kindOf, or cut their pitch in SITES.`);
      }
      // Ranked from the entrance end northward.
      const rank = ranks[mine[k]];
      for (let i = 0; i < n; i++) {
        const cz = rankZ1 - i * spec.pitch - spec.pitch / 2;
        let stall = null;
        if (spec.stall) {
          const a = rank.roadEdge + rank.out * SITE_GAP_M, b = a + rank.out * STALL[1];
          stall = { x0: Math.min(a, b), x1: Math.max(a, b),
                    z0: cz - STALL[0] / 2, z1: cz + STALL[0] / 2 };
        }
        const from = SITE_GAP_M + (spec.stall ? STALL[1] + STALL_GAP_M : 0);
        const a = rank.roadEdge + rank.out * from, b = a + rank.out * spec.pad[1];
        sites.push({
          kind: spec.kind, rank: mine[k], rung: rank.rung, z: cz,
          pad: { x0: Math.min(a, b), x1: Math.max(a, b),
                 z0: cz - spec.pad[0] / 2, z1: cz + spec.pad[0] / 2 },
          stall,
        });
      }
    }
  }

  // The RVs are meant to stand more than 200 ft off the eastern boundary. That
  // falls out of which rank is central rather than being arranged, so it is
  // checked here rather than assumed.
  const rvEast = Math.max(...sites.filter((s) => s.kind === "rv").map((s) => s.pad.x1));
  const rvClear = reachToEdge(ring, rvEast, (block.z0 + block.z1) / 2, 1, 0);
  if (rvClear < RV_FROM_EAST_M) {
    throw new Error(
      `planCampground: the RV sites came out ${(rvClear / FT).toFixed(0)} ft from ` +
      `the eastern boundary and the staff report has them more than ` +
      `${(RV_FROM_EAST_M / FT).toFixed(0)} ft. The central rank is not central ` +
      `enough — check the rung count.`);
  }

  // ---- the buildings, along the south by the entrance ----------------------
  const bandZ = block.z1 - SERVICE_BAND_M / 2;
  const buildings = [];
  const put = (name, frac, z = bandZ) => {
    const f = footprint(BUILDINGS[name].sqft);
    const b = { name, spec: BUILDINGS[name], x: block.x0 + W * frac, z, ...f };
    buildings.push(b);
    return b;
  };
  put("shed", 0.05);
  put("clubhouse", 0.19);
  put("restroom", 0.60);
  // The second restroom block stands at the far end of the camp, on the north
  // clearing, because a rank is 260 m long and one block by the entrance is a
  // long walk from the north end of it.
  put("restroom", 0.90, (block.z0 + rankZ0) / 2);
  // The store's own setback is stated, and it is measured off the southern
  // boundary rather than off the block, so the boundary is asked for.
  const storeF = footprint(BUILDINGS.store.sqft);
  const storeX = block.x0 + W * 0.76;
  const southAt = block.z1 + reachToEdge(ring, storeX, block.z1, 0, 1);
  const store = put("store", 0.76, southAt - STORE_SETBACK_M - storeF.d / 2);
  const manager = put("manager", 0.97);

  // The eighteen stalls that are not on a campsite. Two rows of nine behind the
  // store, on the camp side of it, so a car parks off the entrance drive.
  const stalls = sites.filter((s) => s.stall).map((s) => s.stall);
  let stallEast = -Infinity;
  for (let i = 0; i < CLUSTER_STALLS; i++) {
    const x = store.x - store.w / 2 + (i % 9) * (STALL[0] + 0.3);
    const z1 = store.z - store.d / 2 - 2.0 - (i < 9 ? 0 : 1) * (STALL[1] + 1.0);
    stalls.push({ x0: x, x1: x + STALL[0], z0: z1 - STALL[1], z1 });
    stallEast = Math.max(stallEast, x + STALL[0]);
  }

  // ---- the roads -----------------------------------------------------------
  // The spine runs east and west along the north edge of the service band and
  // every rung hangs north off it. The entrance drive comes up from Johnson Road
  // between the store's parking and the manager's house, which is the one gap
  // along that frontage wide enough for it.
  const spineZ = rankZ1 + ROAD_TWO_WAY_M / 2;
  const driveX = (stallEast + manager.x - manager.w / 2) / 2;
  const driveRun = reachToEdge(ring, driveX, block.z1, 0, 1);
  if (!Number.isFinite(driveRun)) {
    throw new Error(
      "planCampground: the entrance drive runs south off the block and never " +
      "leaves the lot, which means the block is not inside the ring. Check easternRect.");
  }
  const roads = [
    { ax: driveX, az: block.z1 + driveRun, bx: driveX, bz: spineZ, w: ROAD_TWO_WAY_M },
    { ax: block.x0, az: spineZ, bx: block.x1, bz: spineZ, w: ROAD_TWO_WAY_M },
  ];
  const rungX = [];
  for (let r = 0; r < rungs; r++) {
    const x = ranks[r * 2].roadX;
    rungX.push(x);
    roads.push({ ax: x, az: spineZ, bx: x, bz: rankZ0, w: ROAD_ONE_WAY_M });
  }
  // The gated access off Mill Road, condition 10, east off the last rung.
  const gateZ = (rankZ0 + rankZ1) / 2;
  const gateX = rungX[rungs - 1];
  const gateRun = reachToEdge(ring, gateX, gateZ, 1, 0);
  if (Number.isFinite(gateRun)) {
    roads.push({ ax: gateX, az: gateZ, bx: gateX + gateRun, bz: gateZ, w: ROAD_ONE_WAY_M });
  }

  // Five hydrants, spread along the whole run, and the road widened to 26 ft at
  // each. What the spacing actually comes out at is handed back.
  const runLen = driveRun + (block.z1 - spineZ) + W + rungs * (spineZ - rankZ0);
  const hydrants = [];
  for (let i = 0; i < HYDRANTS; i++) {
    const t = ((i + 0.5) / HYDRANTS) * rungs;
    const r = Math.min(rungs - 1, Math.floor(t));
    const z = spineZ - (spineZ - rankZ0) * (t - r);
    hydrants.push({ x: rungX[r], z, wide: HYDRANT_WIDE_M });
    roads.push({ ax: rungX[r], az: z - HYDRANT_WIDE_M / 2,
                 bx: rungX[r], bz: z + HYDRANT_WIDE_M / 2, w: ROAD_TWO_WAY_M });
  }

  // ---- the two outdoor activity areas --------------------------------------
  // One in the service band between the community building and the first
  // restroom, one across the north end where the ranks stop.
  const rec = [
    { x0: block.x0 + W * 0.27, x1: block.x0 + W * 0.52,
      z0: block.z1 - SERVICE_BAND_M + 2, z1: block.z1 - 2 },
    // Stopped short of the east end, which is where the second restroom stands.
    { x0: block.x0 + 2, x1: block.x0 + W * 0.82, z0: block.z0 + 2, z1: rankZ0 - 2 },
  ];

  return {
    ring, block, rect, ranks, rungX, rungs, rankZ0, rankZ1, rankLen, spineZ,
    sites, stalls, roads, hydrants, buildings, rec, kindOf, rvRank,
    developedAcres: (W * block.d) / ACRE_M2,
    lotAcres: parcel.rings[0].acres,
    // What the staff report's own distances come out at, so they can be read
    // back rather than believed.
    westToNeighbour: reachToEdge(ring, block.x0, (block.z0 + block.z1) / 2, -1, 0),
    rvFromEast: rvClear,
    // The nearest any site gets to the eastern boundary. The report says the
    // tent sites are about 40 ft off it, and the setback puts nothing closer
    // than that — but the lot's east boundary steps 9 m west partway up, and one
    // straight row cannot follow a step, so the row stands off the tighter half
    // and is further than 40 ft along the rest.
    siteFromEast: Math.min(...sites.map((s) => reachToEdge(ring, s.pad.x1, s.z, 1, 0))),
    runLen,
    hydrantSpacing: runLen / HYDRANTS,
    hydrantSpacingWanted: HYDRANT_SPACING_M,
    centre: { x: (block.x0 + block.x1) / 2, z: (block.z0 + block.z1) / 2 },
    span: Math.max(W, block.d),
  };
}
