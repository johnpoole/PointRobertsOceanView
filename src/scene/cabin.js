// 389 W Bluff Rd, the cabin this whole page looks out from.
//
// Modelled off the photographs in the stabilisation packet — the west elevation
// from the beach, the roof from the uphill side, and the north face — rather than
// from the extruded box the OSM footprint gives every other building.
//
// What the photographs settle:
//
//   near-black horizontal lap siding, wide boards, on both levels
//   a low-pitched gable, new standing-seam metal, grey, with very deep eaves
//   a brick chimney through the middle, standing well above the ridge
//   white window frames, a long band of them facing the water on both floors
//   one wide picture window on the upper south gable, west of centre and up
//     under the eave, with plain siding east of it
//   an upper deck on posts with a dark wire-mesh rail in a timber frame
//   a lower deck under it with horizontal timber rails, open square lattice on
//     the west, and a recessed diagonal screen behind the open south return
//   both decks turning the south-west corner and running back along the south
//     face, the top one 3 ft out and the lower one 12 ft at the sea end and
//     closing to 3 ft where the bank comes up level with it
//   a concrete stair up the bank south of that deck, timber handrail both sides
//   a timber stair down the north side to the beach
//
// What the ground settles, and it is the whole reason the packet exists: the
// footprint runs from 5.74 m at its west corner to 10.79 m at its east. Five
// metres of fall under a seven metre building. The east side is dug into the
// bank and the west stands on posts.
//
// The OSM footprint has six corners plus its closing node, covering 55 m².
// John confirmed on 2026-09-06 that the southeast notch cuts through the roof
// and entire upper level. Its inner corner comes from that trace; the main
// ridge and slopes remain the lidar's. Issue #43.
//
// What the 2023 lidar settles, and it is only the roof. 466 returns over the
// footprint and its overhang, 17 a square metre. The roof stands in a band 2.5 m
// thick with nothing between it and the canopy at 20 m, so it is unmistakable.
//
// The main roof is an asymmetric gable. The 2026-09-06 comparison found 419 of
// 466 selected returns within 10 cm of this surface, with median absolute
// vertical error 3.9 cm. The former claim of 463 within 4 cm did not reproduce.
// These are the parameters of the main surface, not proof of every roof edge:
//
//   ridge   13.39 m MLLW, 0.90 m west of centre, level along its length
//   east    2.11 in 12, falling 4.13 m to an eave of 12.66 at the wall
//   west    3.15 in 12, falling 2.34 m to an eave of 12.77 at the wall
//   plan    8.49 m along the ridge by 8.17 across, over the eaves
//   centre  x -34.17, z -7.03
//
// Returns in the confirmed notch do not override the current site observation.
//
// Two things fall out of that and neither was put in by hand. Take the overhang
// off and the walls are 6.79 by 6.47, which is 473 sq ft, and the assessor
// carries 496. And the eave sits 4.18 m over the lower floor, not the 5.30 drawn
// — which puts the upper floor at 10.45, and 10.45 is exactly where the lidar
// finds the ground on the uphill side. You walk in at grade from the road. That
// is what dug into the bank means, and it was not modelled that way before.
//
// The way the ridge is turned does come out of the lidar, once the two pitches
// are fitted separately. One gable at one pitch is insensitive to rotation when
// the roof is this flat — five millimetres of residual across twelve degrees.
// Two planes and the line between them are not: that line lands 17° east of
// north, against the 18° the footprint gives, so the two agree and the turn
// stays where it was. Everything under the eaves stays with the photographs,
// because an aircraft sees a roof and the ground beside it and nothing else.
//
// Heights are MLLW throughout. The lidar is NAVD88 in US survey feet on Geoid18,
// converted at 0.3048006096 m and lifted 0.411 m, which is where NAVD88 zero
// sits above MLLW here.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { fromWorld, toWorld } from "../geo.js";
import { box, gableRoof, tint } from "./parts.js";
import { cutRoofNotch, notchedStorey } from "./roof-notch.js";
import { groundClearance } from "./ground-clearance.js";
import { southStairPlan } from "./cabin-stairs-plan.js";

// World metres. The centre of the roof the lidar measured, and how far the
// building is turned, which the lidar could not measure and the footprint did.
const AT = { x: -34.17, z: -7.03 };
const YAW = 0.318;           // 18.2°, off the long edge of the traced footprint
const OVERHANG = 0.85;       // deep, and unmistakable in every photograph
// The walls, from the measured roof less the overhang on each side.
const W = 6.47;              // across the ridge, roughly east to west
const L = 6.79;              // along it, roughly north to south

// Concave corner of assets/osm/features.json's home polygon, not a new estimate
// from a photograph. Preserve its mapped position when turning into cabin axes.
const NOTCH_WORLD = toWorld(48.9890627, -123.0857575);
const NOTCH_X = (NOTCH_WORLD.x - AT.x) * Math.cos(YAW)
              - (NOTCH_WORLD.z - AT.z) * Math.sin(YAW);
const NOTCH_Z = (NOTCH_WORLD.x - AT.x) * Math.sin(YAW)
              + (NOTCH_WORLD.z - AT.z) * Math.cos(YAW);

// Levels. The lower floor is where the deck and the ground under it put it. The
// upper floor is the uphill grade, which is where the lidar finds the ground you
// walk in from. The eave is measured, and the two storeys are what is left: a
// low half-buried level under a full one, which is also why the assessor counts
// 496 sq ft of living space in a 473 sq ft footprint.
const LOWER_FLOOR = 8.55;
const UPPER_FLOOR = 10.45;
const EAVE = 12.71;          // the wall top: the two measured eaves differ by 11 cm
const LOWER_STOREY = UPPER_FLOOR - LOWER_FLOOR;
const UPPER_STOREY = EAVE - UPPER_FLOOR;
// The ridge is off centre and the two sides do not share a pitch. Measured.
const RIDGE_X = -0.90;       // west of centre, which is the short steep side
const RIDGE_Y = 13.39;
const SLOPE_E = 2.11 / 12;
const SLOPE_W = 3.15 / 12;
const RIDGE = { x: RIDGE_X, y: RIDGE_Y, slopeE: SLOPE_E, slopeW: SLOPE_W };

const DECK_OUT = 3.9;        // the upper deck, projecting west over the bank
const LOWER_DECK_OUT = 3.2;
const RAIL_H = 1.05;
const POST = 0.16;
const GROUND_UNDER_DECK = 5.6;

// The south side. The top deck returns 3 ft. The one under it is not a
// rectangle: it is 3 ft out at the sea end and opens to 12 ft at the back,
// where the ground has climbed level with the boards.
const UPPER_SOUTH_OUT = 0.91;
const SOUTH_OUT_WEST = 0.91;
const SOUTH_OUT_EAST = 3.66;
const SOUTH_END = 2.1;              // where the ground reaches the deck top
const GROUND_AT_SOUTH_WEST = 4.62;  // the terrain under the two ends of that edge
const GROUND_AT_SOUTH_END = 8.41;

// PXL_20211108_175012789, paired by the owner with the 13 September saved
// entrance view: a boarded passage between the east wall and a block bank.
// Width and far termination are visual estimates, not calibrated dimensions.
const PASSAGE_INNER = W / 2 + 0.035;
const PASSAGE_OUTER = W / 2 + 1.20;
const PASSAGE_NORTH = -L / 2 + 0.4;

// Both south flights are concrete. The August 2026 photographs show a level
// lower-deck entrance beside the retaining wall and timber handrails above it.
const SOUTH_STAIR = southStairPlan({ halfW: W / 2, halfL: L / 2,
  lowerFloor: LOWER_FLOOR, upperFloor: UPPER_FLOOR, southEnd: SOUTH_END,
  southOutEast: SOUTH_OUT_EAST });
const { z: STAIR_V, width: STAIR_W, rise: RISER, going: GOING,
  steps: STEPS, bottom: STAIR_BASE, x: STAIR_U0 } = SOUTH_STAIR.lower;
const LANDING_Y = LOWER_FLOOR;
const { x: SOUTH_UPPER_U, width: SOUTH_UPPER_W, rise: SOUTH_UPPER_RISER,
  going: SOUTH_UPPER_GOING, steps: SOUTH_UPPER_STEPS, foot: SOUTH_UPPER_FOOT } = SOUTH_STAIR.upper;

// The stair down the north side runs between the two decks: off the top one and
// down to the lower one. It does not go on to the ground. Like the timber flight
// it has as many risers as the drop takes rather than a fixed count.
const NORTH_RISER = 0.21;
const NORTH_STEPS = Math.round((UPPER_FLOOR - LOWER_FLOOR) / NORTH_RISER);
const NORTH_W = 0.91;        // three feet
const NORTH_GOING = 0.28;
const NORTH_TREAD = 0.05;
// It descends west, away from the house, and its foot lands on the west edge of
// the lower deck. That fixes where the head is rather than leaving it to be
// picked: the run is the going times the risers, measured back from the edge.
const NORTH_FOOT_U = -(W / 2) - LOWER_DECK_OUT;
const NORTH_HEAD_U = NORTH_FOOT_U + (NORTH_STEPS - 1) * NORTH_GOING;
// Its middle, out from the north wall far enough to clear the eave.
const NORTH_V = -(L / 2) - 0.9;

const SEAM_SPACING = 0.55;   // standing seam, near enough off the roof photograph
const CHIMNEY_W = 0.85;
// The photographs settle how far it stands over the ridge, not how high it is,
// so it comes down with the roof.
const CHIMNEY_ABOVE_RIDGE = 2.4;
const CHIMNEY_TOP = RIDGE_Y + CHIMNEY_ABOVE_RIDGE;

const SIDING = 0.16;         // board exposure, wide, as in the north-face photo
// The north gable's small window. The May 2025 oblique view confirms an opening
// but does not settle its dimensions; retain the earlier size estimate.
const WIN_SILL = 1.0;
// The sill the upper south window stands on, above the upper floor. The window
// at the south end of the west wall stands on the same one — John, reading the
// two photographs against each other, 2026-08-14. It is a measurement and not a
// coincidence, so it is one number and both use it.
const SOUTH_WIN_SILL = 0.90;

const CLAD = 0x2b3238;       // near-black, with the blue in it the photos show
const CLAD_SHADOW = 0x232a2f; // every other board, so the lap reads
const TRIM = 0xe8e6df;       // white window frames
const GLASS = 0x59707e;      // pale: these windows reflect sky, not a dark room
const ROOF = 0x6a7076;
const SEAM = 0x555d65;
const FASCIA = 0x22282c;
const BRICK = 0x7d5544;
const DECK_TIMBER = 0x9c8a72;   // weathered cedar, greyed off
// The upper rail: galvanised wire in a metal frame, both pale. It was one dark
// colour on a solid panel, and the photographs from the beach show the house
// through it.
const RAIL_WIRE = 0xb7c0c4;
const RAIL_FRAME = 0xa8b1b5;
const MESH_M = 0.11;         // the grid, off the photographs
const WIRE_M = 0.012;
const POST_COLOR = 0x2f4a44;  // the green-teal posts under the deck
const LATTICE = 0x8a8780;   // weathered open timber grid, May 2025 beach photograph
const CONCRETE = 0x8d8b84;  // the stair treads and the wall they run against

// Turn a part from the cabin's own frame into the world.
function place(parts, geom) {
  geom.rotateY(YAW);
  geom.translate(AT.x, 0, AT.z);
  parts.push(geom);
}

// A flat slab of any plan shape, standing on y and thick by t. Corners are
// [x, z] in the cabin's frame, in order round the outline. Wanted because the
// lower south deck is a trapezoid and box() only makes rectangles.
function slab(corners, y, t, color) {
  const pos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  const top = corners.map(([x, z]) => [x, y + t, z]);
  const bot = corners.map(([x, z]) => [x, y, z]);
  for (let k = 1; k + 1 < corners.length; k++) {
    tri(top[0], top[k], top[k + 1]);
    tri(bot[0], bot[k + 1], bot[k]);
  }
  for (let k = 0; k < corners.length; k++) {
    const j = (k + 1) % corners.length;
    tri(bot[k], bot[j], top[j]);
    tri(bot[k], top[j], top[k]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return tint(g, color);
}

// The same footprints and tread levels used below, with clearance under their
// undersides. These are model constraints, not newly measured ground heights.
export function cabinGroundSurfaces() {
  const surfaces = [], hw = W / 2, hl = L / 2;
  const add = (polygon, underside) => surfaces.push({ polygon, ceiling: underside - 0.08 });
  const rectangle = (x0, x1, z0, z1, underside) =>
    add([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], underside);
  rectangle(-hw - DECK_OUT, -hw, -hl, hl, UPPER_FLOOR - 0.14);
  rectangle(-hw - DECK_OUT, hw, hl, hl + UPPER_SOUTH_OUT, UPPER_FLOOR - 0.14);
  rectangle(-hw - LOWER_DECK_OUT, -hw, -hl, hl, LOWER_FLOOR - 0.14);
  add([[-hw - LOWER_DECK_OUT, hl], [SOUTH_END, hl],
       [SOUTH_END, hl + SOUTH_OUT_EAST], [-hw - LOWER_DECK_OUT, hl + SOUTH_OUT_WEST]],
      LOWER_FLOOR - 0.14);
  add(SOUTH_STAIR.landing, LANDING_Y - 0.2);
  add(SOUTH_STAIR.topLanding, UPPER_FLOOR - 0.2);
  rectangle(PASSAGE_INNER, PASSAGE_OUTER, PASSAGE_NORTH, hl, UPPER_FLOOR - 0.07);
  // The confirmed entrance recess is at upper-floor grade, not an uncut bank.
  rectangle(NOTCH_X, hw, NOTCH_Z, hl, UPPER_FLOOR - 0.02);
  for (let k = 0; k < STEPS; k++) {
    const x = STAIR_U0 + k * GOING, top = STAIR_BASE + (k + 1) * RISER;
    rectangle(x - GOING / 2, x + GOING / 2, STAIR_V - STAIR_W / 2,
      STAIR_V + STAIR_W / 2, top - RISER - 0.35);
  }
  for (let k = 0; k < SOUTH_UPPER_STEPS; k++) {
    const z = SOUTH_UPPER_FOOT - (k + 0.5) * SOUTH_UPPER_GOING;
    const top = LANDING_Y + (k + 1) * SOUTH_UPPER_RISER;
    rectangle(SOUTH_UPPER_U - SOUTH_UPPER_W / 2, SOUTH_UPPER_U + SOUTH_UPPER_W / 2,
      z - SOUTH_UPPER_GOING / 2, z + SOUTH_UPPER_GOING / 2, top - SOUTH_UPPER_RISER - 0.20);
  }
  const northRise = (UPPER_FLOOR - LOWER_FLOOR) / NORTH_STEPS;
  for (let k = 0; k < NORTH_STEPS; k++) {
    const x = NORTH_HEAD_U - k * NORTH_GOING, top = UPPER_FLOOR - (k + 1) * northRise;
    rectangle(x - (NORTH_GOING + 0.03) / 2, x + (NORTH_GOING + 0.03) / 2,
      NORTH_V - NORTH_W / 2, NORTH_V + NORTH_W / 2, top - NORTH_TREAD);
  }
  return surfaces;
}

export function cabinCarve(gridDiagonal) {
  const carve = groundClearance(cabinGroundSurfaces(), gridDiagonal);
  const c = Math.cos(YAW), s = Math.sin(YAW);
  return (lat, lon, height) => {
    const p = toWorld(lat, lon), dx = p.x - AT.x, dz = p.z - AT.z;
    return carve(dx * c - dz * s, dx * s + dz * c, height);
  };
}

export function buildCabin(scene, sample, bankSample = sample) {
  const groundAt = (x, z, sampler = sample) => {
    const { lat, lon } = fromWorld(x, z);
    return sampler(lat, lon);
  };
  const parts = [];
  const hw = W / 2, hl = L / 2;

  // Both storeys, and the lap siding drawn as alternating bands so the wall is
  // boards rather than a painted slab. The upper storey has the roof's notch
  // all the way down to its floor, with closed, clad walls inside the recess.
  for (const [floor, height] of [[LOWER_FLOOR, LOWER_STOREY], [UPPER_FLOOR, UPPER_STOREY]]) {
    const wallPart = (w, l, h, y, color) => {
      if (floor !== UPPER_FLOOR) {
        place(parts, box(w, l, h, 0, y, 0, color));
        return;
      }
      // Recess the base wall 15 mm behind the siding at the inner edges too.
      // The proud bands then finish at the mapped cut instead of z-fighting
      // with the new walls or projecting across the roof opening.
      const inset = color === CLAD ? 0.015 : 0;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(notchedStorey(
        w / 2, l / 2, y, h, NOTCH_X - inset, NOTCH_Z - inset), 3));
      g.computeVertexNormals();
      place(parts, tint(g, color));
    };
    wallPart(W, L, height, floor, CLAD);
    for (let y = floor + SIDING; y < floor + height - 0.05; y += SIDING * 2) {
      wallPart(W + 0.03, L + 0.03, SIDING, y, CLAD_SHADOW);
    }
  }

  // May 2025 west elevation and June 2022 southwest view: tall posts carry
  // beams and knee braces under the upper deck, rather than ending at the
  // lower floor. Sizes/spacing are photo estimates; feet use the baked ground.
  const groundLocal = (x, z, sampler = sample) => groundAt(
    AT.x + x * Math.cos(YAW) + z * Math.sin(YAW),
    AT.z - x * Math.sin(YAW) + z * Math.cos(YAW), sampler);
  const member = (a, b, w, d, color) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    const g = new THREE.BoxGeometry(w, direction.length(), d);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), direction.normalize()));
    g.translate(...start.add(end).multiplyScalar(0.5).toArray());
    return tint(g, color);
  };

  // Boards span the narrow east passage. Small real joints keep it distinct
  // from the concrete stair landing without requiring a photographic texture.
  const boardCount = Math.ceil((hl - PASSAGE_NORTH) / 0.145);
  const boardPitch = (hl - PASSAGE_NORTH) / boardCount;
  for (let k = 0; k < boardCount; k++) {
    place(parts, box(PASSAGE_OUTER - PASSAGE_INNER, boardPitch - 0.004, 0.07,
      (PASSAGE_INNER + PASSAGE_OUTER) / 2, UPPER_FLOOR - 0.07,
      PASSAGE_NORTH + (k + 0.5) * boardPitch, DECK_TIMBER));
  }
  // Retaining blocks on the uphill edge. The original uncut survey supplies
  // an approximate bank top behind the wall; course sizes are photo
  // estimates. The original elevation asset is not changed to fit the photo.
  const wallBase = UPPER_FLOOR - 0.20;
  const wallRun = hl - PASSAGE_NORTH, blockLength = 0.40, course = 0.20;
  for (let row = 0; row < 20; row++) {
    for (let z0 = PASSAGE_NORTH - (row % 2) * blockLength / 2; z0 < hl; z0 += blockLength) {
      const a = Math.max(z0, PASSAGE_NORTH), b = Math.min(z0 + blockLength, hl);
      if (b - a < 0.025) continue;
      const z = (a + b) / 2;
      // The grid smooths the wall into a bank. Read the retained ground two
      // metres behind its foot, rather than treating the low interpolated
      // value beside the passage as the wall top. This offset is an estimate.
      const bank = groundLocal(PASSAGE_OUTER + 2.0, z, bankSample);
      const top = Math.max(UPPER_FLOOR + 1.4, Math.min(UPPER_FLOOR + 3.8, bank));
      if (wallBase + row * course >= top) continue;
      const colors = [0x85877e, 0x92938a, 0x7c8078];
      place(parts, box(0.38, b - a - 0.012, course - 0.012,
        PASSAGE_OUTER + 0.20 + row * 0.04, wallBase + row * course, z,
        colors[(row + Math.round((z - PASSAGE_NORTH) / blockLength)) % colors.length]));
    }
  }
  const beamTop = UPPER_FLOOR - 0.14, beamBottom = beamTop - 0.22;
  const postX = -hw - DECK_OUT + 0.4;
  place(parts, box(0.20, L, 0.22, postX, beamBottom, 0, DECK_TIMBER));
  for (const z of [-hl + 0.3, -L / 6, L / 6, hl - 0.3]) {
    const foot = groundLocal(postX, z) - 0.18;
    place(parts, box(POST, POST, beamBottom - foot, postX, foot, z, POST_COLOR));
    place(parts, box(DECK_OUT, 0.18, 0.22, -hw - DECK_OUT / 2,
                     beamBottom, z, DECK_TIMBER));
    place(parts, member([postX, beamBottom - 0.72, z],
      [postX + 0.72, beamBottom, z], 0.10, 0.13, DECK_TIMBER));
    for (const side of [-1, 1]) {
      if (Math.abs(z + side * 0.65) > hl) continue;
      place(parts, member([postX, beamBottom - 0.65, z],
        [postX, beamBottom, z + side * 0.65], 0.10, 0.13, DECK_TIMBER));
    }
  }

  // The west face. Off John's photograph from the beach and his correction of
  // what I made of it, 2026-08-14.
  //
  // It is not one band. The run shares a head under the eave and the sills do
  // not: four sliding doors with the glass down to the deck boards, and at the
  // south end a window standing on SOUTH_WIN_SILL, the same sill as the window
  // on the south wall. That last one is the whole of the correction — it was
  // drawn running to the floor with the doors, and it does not.
  //
  // Heights are above the floor of their own storey, and both storeys are
  // measured: 2.26 m up to the eave, 1.90 m up to the floor above.
  const WEST_HEAD = 1.90;                 // the head every bay shares
  const WEST_DOOR_SILL = 0.10;            // just off the deck boards
  const WEST_UPPER = [WEST_DOOR_SILL, WEST_DOOR_SILL, WEST_DOOR_SILL,
                      WEST_DOOR_SILL, SOUTH_WIN_SILL];

  // One frame per bay, because the sills differ and a single pane cannot hold
  // two of them. Frames stand proud of the wall so they catch a shadow, and the
  // pair of them between two bays is the upright that makes a run of glass read
  // as doors rather than as a shopfront.
  //
  // Bays run north to south, so the last one in the list is the south end.
  const westRun = (floor, head, sills) => {
    const along = L - 1.6;
    const w = along / sills.length;
    for (let i = 0; i < sills.length; i++) {
      const sill = sills[i];
      const h = head - sill;
      const t = -along / 2 + w * (i + 0.5);
      place(parts, box(0.12, w, h + 0.18, -hw, floor + sill - 0.09, t, TRIM));
      place(parts, box(0.14, w - 0.22, h, -hw, floor + sill, t, GLASS));
    }
  };
  // PXL_20250514_163557098: two separated white-framed pairs, with a low
  // horizontal division and glass near deck level. Not three equal windows.
  for (const z of [-1.7, 1.7]) {
    const w = 1.9, h = 1.64, sill = LOWER_FLOOR + 0.09;
    place(parts, box(0.12, w, h, -hw, sill, z, TRIM));
    for (const side of [-1, 1]) {
      const paneZ = z + side * (w - 0.12) / 4;
      place(parts, box(0.14, (w - 0.12) / 2 - 0.08, h - 0.16,
        -hw, sill + 0.08, paneZ, GLASS));
    }
    place(parts, box(0.16, w - 0.16, 0.045, -hw, sill + 0.48, z, TRIM));
  }
  westRun(UPPER_FLOOR, WEST_HEAD, WEST_UPPER);

  // The entrance is on the east-facing inset wall, facing into the notch.
  // John's PXL_20211108_175009151.jpg shows two tall glazed leaves in pale
  // frames. Their 1.35 m combined width and 2.10 m height are visual estimates,
  // centred within the mapped wall run; the old roof in that photo is not used.
  const ENTRY_W = 1.35, ENTRY_H = 2.10;
  const entryZ = (NOTCH_Z + hl) / 2;
  place(parts, box(0.10, ENTRY_W, ENTRY_H,
                   NOTCH_X + 0.025, UPPER_FLOOR, entryZ, TRIM));
  for (const side of [-1, 1]) {
    place(parts, box(0.025, ENTRY_W / 2 - 0.14, ENTRY_H - 0.26,
                     NOTCH_X + 0.0875, UPPER_FLOOR + 0.18,
                     entryZ + side * ENTRY_W / 4, GLASS));
  }
  // A small dark handle beside the meeting stile, as in the reference.
  place(parts, box(0.05, 0.04, 0.12, NOTCH_X + 0.12,
                   UPPER_FLOOR + 0.90, entryZ + 0.08, FASCIA));

  // The north gable end: one small window (size remains an estimate).
  place(parts, box(1.0, 0.12, 1.0, 1.2, UPPER_FLOOR + WIN_SILL, -hl, TRIM));
  place(parts, box(0.8, 0.14, 0.8, 1.2, UPPER_FLOOR + WIN_SILL + 0.1, -hl, GLASS));

  // The south gable end, off John's photograph of it, 2026-08-14. Not the small
  // square that was here: one wide picture window, set well west of centre and
  // carried up close under the eave, with plain siding the whole way east of it.
  //
  // Scaled against the two things in the frame that are measured — the wall is
  // 6.47 m across and the storey 2.26 m from floor to eave — so the numbers are
  // read off the picture and not guessed. Sized to about a fifth of a metre.
  // Its sill is SOUTH_WIN_SILL, up with the constants, because the window at the
  // south end of the west wall stands on the same one.
  const SOUTH_WIN_W = 2.10;
  const SOUTH_WIN_H = 1.05;
  const SOUTH_WIN_X = -1.70;   // west of centre, and 0.5 m clear of the corner
  place(parts, box(SOUTH_WIN_W, 0.12, SOUTH_WIN_H,
                   SOUTH_WIN_X, UPPER_FLOOR + SOUTH_WIN_SILL, hl, TRIM));
  place(parts, box(SOUTH_WIN_W - 0.2, 0.14, SOUTH_WIN_H - 0.2,
                   SOUTH_WIN_X, UPPER_FLOOR + SOUTH_WIN_SILL + 0.1, hl, GLASS));

  // The narrow lower south window in 20190731_103926, behind the return deck.
  place(parts, box(0.64, 0.12, 1.02, -0.45, LOWER_FLOOR + 0.55, hl, TRIM));
  place(parts, box(0.48, 0.14, 0.86, -0.45, LOWER_FLOOR + 0.63, hl, GLASS));
  place(parts, box(0.48, 0.16, 0.045, -0.45, LOWER_FLOOR + 1.0, hl, TRIM));

  // Cut every roof component, including the gable infill, so neither trim nor
  // standing seams bridge the confirmed notch above the recessed upper walls.
  const roofPart = (geometry, color) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(
      cutRoofNotch(geometry.attributes.position.array, NOTCH_X, NOTCH_Z), 3));
    g.computeVertexNormals();
    geometry.dispose();
    place(parts, tint(g, color));
  };
  roofPart(gableRoof(hw, hl, EAVE, 0, OVERHANG, ROOF, RIDGE), ROOF);
  // The surface, so the seams and the fascia sit on the roof rather than beside it.
  const roofY = (x) => RIDGE_Y - (x > RIDGE_X ? SLOPE_E : SLOPE_W) * Math.abs(x - RIDGE_X);
  // May 2025 roof close-ups: ribs follow the fall, perpendicular to the ridge.
  // A vertical-height profile keeps every rib base on its measured plane.
  const slopeBar = (x0, x1, z, width, height, offset, color) => {
    const g = box(x1 - x0, width, height, (x0 + x1) / 2, 0, z, color);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + roofY(p.getX(i)) + offset);
    g.computeVertexNormals();
    return g;
  };
  for (let z = -hl - OVERHANG + SEAM_SPACING / 2; z < hl + OVERHANG; z += SEAM_SPACING) {
    for (const [a, b] of [[-hw - OVERHANG, RIDGE_X], [RIDGE_X, hw + OVERHANG]]) {
      roofPart(slopeBar(a, b, z, 0.025, 0.04, 0.002, SEAM), SEAM);
    }
  }
  // Fascia round the eave, dark, which is what makes the overhang read.
  for (const s of [-1, 1]) {
    roofPart(box(0.1, L + OVERHANG * 2, 0.22,
                 s * (hw + OVERHANG), roofY(s * (hw + OVERHANG)) - 0.22, 0, FASCIA), FASCIA);
    for (const [a, b] of [[-hw - OVERHANG, RIDGE_X], [RIDGE_X, hw + OVERHANG]]) {
      roofPart(slopeBar(a, b, s * (hl + OVERHANG), 0.10, 0.20, -0.20, FASCIA), FASCIA);
      // Exposed timber under the north/south overhang, visible in May 2025.
      roofPart(slopeBar(a, b, s * (hl + OVERHANG / 2), OVERHANG,
        0.035, -0.045, DECK_TIMBER), DECK_TIMBER);
    }
  }
  // Fascia on the two new edges. Keep its thickness on the retained side.
  const notchRun = hl + OVERHANG - NOTCH_Z;
  roofPart(box(0.1, notchRun, 0.22, NOTCH_X - 0.05,
               roofY(NOTCH_X) - 0.22, NOTCH_Z + notchRun / 2, FASCIA), FASCIA);
  const edgeRun = hw + OVERHANG - NOTCH_X;
  const edgeDrop = roofY(hw + OVERHANG) - roofY(NOTCH_X);
  const notchEdge = new THREE.BoxGeometry(Math.hypot(edgeRun, edgeDrop), 0.22, 0.1);
  notchEdge.rotateZ(Math.atan2(edgeDrop, edgeRun));
  notchEdge.translate(NOTCH_X + edgeRun / 2,
                 roofY(NOTCH_X) + edgeDrop / 2 - 0.11, NOTCH_Z - 0.05);
  roofPart(notchEdge.toNonIndexed(), FASCIA);

  // The chimney, through the roof and well above the ridge.
  place(parts, box(CHIMNEY_W, CHIMNEY_W, CHIMNEY_TOP - UPPER_FLOOR,
                   0.6, UPPER_FLOOR, -0.4, BRICK));
  place(parts, box(CHIMNEY_W + 0.14, CHIMNEY_W + 0.14, 0.16, 0.6,
                   CHIMNEY_TOP - 0.16, -0.4, 0x6b483a));

  // The upper deck, out over the bank, with the wire-mesh rail.
  const dx = -hw - DECK_OUT / 2;
  place(parts, box(DECK_OUT, L, 0.14, dx, UPPER_FLOOR - 0.14, 0, DECK_TIMBER));
  // The rail is a square wire mesh in a metal frame, pale galvanised, and you
  // see the house through it. It was a solid dark panel, which read as a wall.
  // The grid is about 110 mm off the photographs from the beach.
  const railRun = (x, z, w, d) => {
    const alongX = w > d;
    const run = alongX ? w : d;
    place(parts, box(w, d, 0.06, x, UPPER_FLOOR + RAIL_H, z, RAIL_FRAME));
    const top = UPPER_FLOOR + RAIL_H;
    const bottom = UPPER_FLOOR + 0.09;
    for (let y = bottom; y <= top - 0.02; y += MESH_M) {
      place(parts, box(alongX ? run : WIRE_M, alongX ? WIRE_M : run, WIRE_M,
                       x, y, z, RAIL_WIRE));
    }
    const n = Math.max(1, Math.round(run / MESH_M));
    for (let k = 0; k <= n; k++) {
      const off = -run / 2 + (k * run) / n;
      place(parts, box(WIRE_M, WIRE_M, top - bottom,
                       x + (alongX ? off : 0), bottom, z + (alongX ? 0 : off),
                       RAIL_WIRE));
    }
    // A post at each end and every two metres between, which is what holds the
    // panels up and what you actually pick out at a distance.
    const posts = Math.max(1, Math.round(run / 2.0));
    for (let k = 0; k <= posts; k++) {
      const off = -run / 2 + (k * run) / posts;
      place(parts, box(0.07, 0.07, RAIL_H,
                       x + (alongX ? off : 0), UPPER_FLOOR, z + (alongX ? 0 : off),
                       RAIL_FRAME));
    }
  };
  railRun(-hw - DECK_OUT, 0, 0.1, L);
  railRun(dx, -hl, DECK_OUT, 0.1);

  // And it returns 3 ft along the south face, the whole width of the building.
  const usx0 = -hw - DECK_OUT, usw = hw - usx0, uscx = usx0 + usw / 2;
  const usv = hl + UPPER_SOUTH_OUT;
  place(parts, box(usw, UPPER_SOUTH_OUT, 0.14, uscx, UPPER_FLOOR - 0.14,
                   hl + UPPER_SOUTH_OUT / 2, DECK_TIMBER));
  railRun(uscx, usv, usw, 0.1);
  railRun(usx0, hl + UPPER_SOUTH_OUT / 2, 0.1, UPPER_SOUTH_OUT);
  // Open the east end into the concrete top landing; a mesh panel here used
  // to block the stair connection. Timber rails finish its outside edges below.

  // The lower deck, its horizontal timber rails on posts, and the lattice screen
  // closing the space under it.
  const lx = -hw - LOWER_DECK_OUT / 2;
  place(parts, box(LOWER_DECK_OUT, L, 0.14, lx, LOWER_FLOOR - 0.14, 0, DECK_TIMBER));
  for (let k = 0; k < 3; k++) {
    const y = LOWER_FLOOR + 0.32 + k * 0.34;
    place(parts, box(0.09, L, 0.09, -hw - LOWER_DECK_OUT, y, 0, DECK_TIMBER));
  }
  for (let k = 0; k < 5; k++) {
    const z = -hl + (k * L) / 4;
    place(parts, box(0.11, 0.11, RAIL_H,
                     -hw - LOWER_DECK_OUT, LOWER_FLOOR, z, DECK_TIMBER));
  }
  // Open square slats, not an opaque panel: PXL_20250514_163557098 and the
  // October 2022 close-up. Slat width and pitch are visual estimates. Geometry
  // leaves real holes and stays in the cabin's single merged draw call.
  const skirtH = LOWER_FLOOR - 0.14 - GROUND_UNDER_DECK;
  const latticeX = -hw - LOWER_DECK_OUT;
  const latticePitch = 0.13, latticeSlat = 0.026;
  for (let z = -hl + latticeSlat / 2; z <= hl - latticeSlat / 2; z += latticePitch) {
    place(parts, box(0.026, latticeSlat, skirtH, latticeX,
      GROUND_UNDER_DECK, z, LATTICE));
  }
  for (let y = GROUND_UNDER_DECK; y + latticeSlat <= LOWER_FLOOR - 0.14; y += latticePitch) {
    place(parts, box(0.026, L, latticeSlat, latticeX + 0.026, y, 0, LATTICE));
  }
  for (let k = 0; k < 5; k++) {
    const z = -hl + (k * L) / 4;
    place(parts, box(0.14, 0.14, skirtH,
                     -hw - LOWER_DECK_OUT, GROUND_UNDER_DECK, z, DECK_TIMBER));
  }
  place(parts, box(0.18, L, 0.12, -hw - LOWER_DECK_OUT,
                   GROUND_UNDER_DECK + skirtH - 0.12, 0, DECK_TIMBER));

  // The deck turns the south-west corner and runs back along the south face,
  // narrow at the sea end and opening out at the back. Same boards, same three
  // rails. No rail at the east end, because there you step off onto the ground.
  const sx0 = -hw - LOWER_DECK_OUT;
  const sv0 = hl + SOUTH_OUT_WEST, sv1 = hl + SOUTH_OUT_EAST;
  place(parts, slab([[sx0, hl], [SOUTH_END, hl], [SOUTH_END, sv1], [sx0, sv0]],
                    LOWER_FLOOR - 0.14, 0.14, DECK_TIMBER));

  // Everything on that outer edge is raked to it. A bar is laid along x and
  // turned in plan before place() turns the whole cabin into the world.
  const du = SOUTH_END - sx0, dv = sv1 - sv0;
  const edge = Math.hypot(du, dv);
  const turn = Math.atan2(-dv, du);
  const onEdge = (w, h, t, f, y, color) => {
    const g = new THREE.BoxGeometry(w, h, t);
    g.rotateY(turn);
    g.translate(sx0 + f * du, y + h / 2, sv0 + f * dv);
    place(parts, tint(g, color));
  };
  for (let k = 0; k < 3; k++) {
    const y = LOWER_FLOOR + 0.32 + k * 0.34;
    onEdge(edge, 0.09, 0.09, 0.5, y, DECK_TIMBER);
    place(parts, box(0.09, SOUTH_OUT_WEST, 0.09, sx0, y,
                     hl + SOUTH_OUT_WEST / 2, DECK_TIMBER));
  }
  for (let k = 0; k <= 6; k++) {
    const f = k / 6;
    place(parts, box(0.11, 0.11, RAIL_H, sx0 + f * du, LOWER_FLOOR,
                     sv0 + f * dv, DECK_TIMBER));
  }
  // The south return stands on open posts (June 2022 southwest photograph).
  // Its screen is recessed behind the deck, not across this entire outer edge.
  const grade = (f) => GROUND_AT_SOUTH_WEST - 0.3 +
                       f * (GROUND_AT_SOUTH_END - GROUND_AT_SOUTH_WEST);
  const PANELS = 6;
  for (let k = 0; k < PANELS; k++) {
    const fp = k / PANELS, gp = grade(fp);
    place(parts, box(0.16, 0.16, LOWER_FLOOR - 0.14 - gp,
                     sx0 + fp * du, gp, sv0 + fp * dv, DECK_TIMBER));
  }

  // Diagonal screen under the south side of the house, behind the open return
  // deck. The October 2022 close-up shows diamonds here and squares to the
  // west. Clip each slat against the sampled ground and lower deck underside.
  const screenZ = hl - 0.10, screenTop = LOWER_FLOOR - 0.14;
  const screenLeft = -hw, screenRight = SOUTH_END;
  const bottomLeft = groundLocal(screenLeft, screenZ) - 0.1;
  const bottomRight = groundLocal(screenRight, screenZ) - 0.1;
  const floorSlope = (bottomRight - bottomLeft) / (screenRight - screenLeft);
  const bottom = (x) => bottomLeft + (x - screenLeft) * floorSlope;
  for (const slope of [-1, 1]) {
    for (let intercept = Math.min(bottomLeft, bottomRight) - 6;
         intercept < screenTop + 6; intercept += 0.22) {
      // y = slope * (x - screenLeft) + intercept, clipped to the trapezoid.
      let lo = screenLeft, hi = screenRight;
      const clip = (a, b) => { // a*x+b >= 0
        if (Math.abs(a) < 1e-9) { if (b < 0) hi = lo - 1; }
        else if (a > 0) lo = Math.max(lo, -b / a);
        else hi = Math.min(hi, -b / a);
      };
      clip(-slope, screenTop + slope * screenLeft - intercept);
      clip(slope - floorSlope, intercept - slope * screenLeft - bottomLeft + floorSlope * screenLeft);
      if (hi - lo < 0.03) continue;
      const y = (x) => slope * (x - screenLeft) + intercept;
      place(parts, member([lo, Math.max(bottom(lo), y(lo)), screenZ],
        [hi, y(hi), screenZ], 0.03, 0.025, LATTICE));
    }
  }

  // The concrete flight, clear of the deck to the south, climbing west to east
  // up the bank. Drawn as a stepped solid rather than floating slabs, because
  // that is what concrete does.
  const stv = STAIR_V;
  for (let k = 0; k < STEPS; k++) {
    const y = STAIR_BASE + (k + 1) * RISER;
    place(parts, box(GOING, STAIR_W, RISER + 0.35, STAIR_U0 + k * GOING,
                     y - RISER - 0.35, stv, CONCRETE));
  }
  // Outer timber handrail; the photographed inner edge follows the retaining
  // wall. Its head meets the landing at the same level as the last tread.
  const southRailV = STAIR_V + STAIR_W / 2;
  for (const h of [RAIL_H, RAIL_H * 0.55]) {
    place(parts, member([STAIR_U0 - GOING / 2, STAIR_BASE + RISER + h, southRailV],
      [SOUTH_END, LOWER_FLOOR + h, southRailV], 0.09, 0.12, DECK_TIMBER));
  }
  for (const k of [0, 5, 10, 15, STEPS - 1]) {
    place(parts, box(0.1, 0.1, RAIL_H, STAIR_U0 + k * GOING,
      STAIR_BASE + (k + 1) * RISER, southRailV, DECK_TIMBER));
  }

  // Level concrete access into the lower deck, then concrete steps to the
  // upper landing. The landing is an L: the small north tongue reaches the
  // lower deck's open east end without putting a slab through the upper flight.
  const upper = SOUTH_STAIR.upper, left = upper.x - upper.width / 2;
  const right = upper.x + upper.width / 2;
  place(parts, box(right - SOUTH_END, 9 - upper.foot, 0.2,
    (SOUTH_END + right) / 2, LANDING_Y - 0.2, (9 + upper.foot) / 2, CONCRETE));
  place(parts, box(left - SOUTH_END, 1.1, 0.2,
    (SOUTH_END + left) / 2, LANDING_Y - 0.2, upper.foot - 0.55, CONCRETE));
  place(parts, slab(SOUTH_STAIR.topLanding, UPPER_FLOOR - 0.2, 0.2, CONCRETE));
  for (let k = 0; k < SOUTH_UPPER_STEPS; k++) {
    const v = SOUTH_UPPER_FOOT - (k + 0.5) * SOUTH_UPPER_GOING;
    const y = LANDING_Y + (k + 1) * SOUTH_UPPER_RISER;
    place(parts, box(SOUTH_UPPER_W, SOUTH_UPPER_GOING, SOUTH_UPPER_RISER + 0.20,
      SOUTH_UPPER_U, y - SOUTH_UPPER_RISER - 0.20, v, CONCRETE));
  }
  // Weathered timber rails follow the complete flight and meet the landing
  // rails. Their ends are computed from tread edges, not an unrelated run.
  for (const u of [left, right]) {
    for (const h of [RAIL_H, RAIL_H * 0.55]) {
      place(parts, member([u, LANDING_Y + h, upper.foot],
        [u, UPPER_FLOOR + h, upper.head], 0.09, 0.12, DECK_TIMBER));
    }
    for (const k of [0, 3, 6, SOUTH_UPPER_STEPS]) {
      const top = k === SOUTH_UPPER_STEPS ? UPPER_FLOOR : LANDING_Y + k * SOUTH_UPPER_RISER;
      const z = upper.foot - k * SOUTH_UPPER_GOING;
      place(parts, box(0.1, 0.1, RAIL_H, u, top, z, DECK_TIMBER));
    }
  }
  // The top landing joins the existing deck through its open east rail end.
  for (const h of [RAIL_H, RAIL_H * 0.55]) {
    place(parts, member([right, UPPER_FLOOR + h, upper.head],
      [right, UPPER_FLOOR + h, hl], 0.09, 0.12, DECK_TIMBER));
    // No cross-rail here: the landing continues into the photographed passage.
    place(parts, member([right, LOWER_FLOOR + h, upper.foot],
      [right, LOWER_FLOOR + h, 9], 0.09, 0.12, DECK_TIMBER));
    place(parts, member([right, LOWER_FLOOR + h, 9],
      [SOUTH_END, LOWER_FLOOR + h, 9], 0.09, 0.12, DECK_TIMBER));
    place(parts, member([SOUTH_END, LOWER_FLOOR + h, 9],
      [SOUTH_END, LOWER_FLOOR + h, southRailV], 0.09, 0.12, DECK_TIMBER));
  }
  for (const [x, z, floor] of [[right, hl, UPPER_FLOOR], [right, 9, LOWER_FLOOR], [SOUTH_END, 9, LOWER_FLOOR]]) {
    place(parts, box(0.1, 0.1, RAIL_H, x, floor, z, DECK_TIMBER));
  }

  // The stair down the north side, off the top deck to the lower one. Open
  // treads on stringers, three feet wide, running west out to the edge of the
  // lower deck, with a handrail on the outer side. The photographs show no rail
  // on the house side, and there is a wall there.
  const northRise = (UPPER_FLOOR - LOWER_FLOOR) / NORTH_STEPS;
  const northU = (k) => NORTH_HEAD_U - k * NORTH_GOING;
  for (let k = 0; k < NORTH_STEPS; k++) {
    const y = UPPER_FLOOR - (k + 1) * northRise;
    place(parts, box(NORTH_GOING + 0.03, NORTH_W, NORTH_TREAD,
                     northU(k), y - NORTH_TREAD, NORTH_V, DECK_TIMBER));
  }
  // The two stringers the treads sit on, raked to the pitch.
  const northRake = Math.atan2(northRise, NORTH_GOING);
  const northRun = (NORTH_STEPS - 1) * NORTH_GOING;
  const northDrop = (NORTH_STEPS - 1) * northRise;
  const northBar = (v, y0, thick) => {
    const g = new THREE.BoxGeometry(Math.hypot(northRun, northDrop), thick, thick);
    g.rotateZ(northRake);
    g.translate(NORTH_HEAD_U - northRun / 2, y0 - northDrop / 2, v);
    place(parts, tint(g, DECK_TIMBER));
  };
  for (const s of [-1, 1]) {
    northBar(NORTH_V + s * (NORTH_W / 2), UPPER_FLOOR - northRise - 0.14, 0.14);
  }
  // The handrail, on the outer side. North is -v, so that is the low side.
  const railV = NORTH_V - NORTH_W / 2;
  northBar(railV, UPPER_FLOOR - northRise + RAIL_H, 0.09);
  northBar(railV, UPPER_FLOOR - northRise + RAIL_H * 0.55, 0.09);
  for (let k = 0; k < NORTH_STEPS; k += 3) {
    place(parts, box(0.09, 0.09, RAIL_H, northU(k),
                     UPPER_FLOOR - (k + 1) * northRise, railV, DECK_TIMBER));
  }

  const mesh = new THREE.Mesh(
    mergeGeometries(parts, false),
    new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.85, metalness: 0.04,
      side: THREE.DoubleSide }));
  scene.add(mesh);
  return {
    mesh,
    centre: new THREE.Vector3(AT.x, LOWER_FLOOR, AT.z),
    groundWest: groundAt(AT.x - hw - DECK_OUT, AT.z),
    groundEast: groundAt(AT.x + hw, AT.z),
  };
}
