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
//   a lower deck under it with horizontal timber rails, and lattice below that
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
// The footprint in the bake is an irregular seven-node trace of 55 m². The
// building here is the rectangle that fits it, turned 18° east of north, because
// that is what the photographs show and the notch is not something a photograph
// can place.
//
// What the 2023 lidar settles, and it is only the roof. 466 returns over the
// footprint and its overhang, 17 a square metre. The roof stands in a band 2.5 m
// thick with nothing between it and the canopy at 20 m, so it is unmistakable.
//
// It is a gable, but not a symmetric one. Fitted as one surface with two pitches
// meeting at a ridge, 463 of the 466 returns land inside 4 cm of it:
//
//   ridge   13.39 m MLLW, 0.90 m west of centre, level along its length
//   east    2.11 in 12, falling 4.13 m to an eave of 12.66 at the wall
//   west    3.15 in 12, falling 2.34 m to an eave of 12.77 at the wall
//   plan    8.49 m along the ridge by 8.17 across, over the eaves
//   centre  x -34.17, z -7.03
//
// The three left out are the chimney, which stands through this band.
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
import { fromWorld } from "../geo.js";
import { box, gableRoof, tint } from "./parts.js";

// World metres. The centre of the roof the lidar measured, and how far the
// building is turned, which the lidar could not measure and the footprint did.
const AT = { x: -34.17, z: -7.03 };
const YAW = 0.318;           // 18.2°, off the long edge of the traced footprint
const OVERHANG = 0.85;       // deep, and unmistakable in every photograph
// The walls, from the measured roof less the overhang on each side.
const W = 6.47;              // across the ridge, roughly east to west
const L = 6.79;              // along it, roughly north to south

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

// The way up from the beach, in three pieces: a concrete flight west to east
// along the south edge, a concrete landing at the level of the lower deck, and
// timber stairs off it running south to north against the east wall to the top
// deck. The concrete flight is pitched at the pitch of the ground it runs on,
// 5.58 m at the foot and 8.47 m at the head off the terrain bake. Anything
// steeper leaves the head of it standing in the air.
const STAIR_V = 8.15;        // clear of the deck's back corner, which reaches 7.36
const STAIR_W = 1.15;
const RISER = 0.16;
const GOING = 0.30;
const STEPS = 18;
const STAIR_BASE = 5.58;
const STAIR_U0 = -3.0;

const LANDING_Y = LOWER_FLOOR - 0.14;
const LANDING = { u0: 2.0, u1: 4.1, v0: 7.3, v1: 9.0 };

const WOOD_U = 3.5;          // the timber flight, hard against the east wall
const WOOD_W = 1.1;
const WOOD_RISER = 0.204;
const WOOD_GOING = 0.3325;
// It climbs from the landing to the upper floor, so it has as many risers as
// that takes and not a fixed count. The floor came down 0.75 m and the flight
// would otherwise have run three steps through it.
const WOOD_STEPS = Math.round((UPPER_FLOOR - LANDING_Y) / WOOD_RISER);
const WOOD_V0 = 8.6;         // its foot, on the landing, and it climbs north

const SEAM_SPACING = 0.55;   // standing seam, near enough off the roof photograph
const CHIMNEY_W = 0.85;
// The photographs settle how far it stands over the ridge, not how high it is,
// so it comes down with the roof.
const CHIMNEY_ABOVE_RIDGE = 2.4;
const CHIMNEY_TOP = RIDGE_Y + CHIMNEY_ABOVE_RIDGE;

const SIDING = 0.16;         // board exposure, wide, as in the north-face photo
// The north gable's small window. The west face and the south gable carry their
// own numbers, off the photographs of each.
const WIN_SILL = 1.0;

const CLAD = 0x2b3238;       // near-black, with the blue in it the photos show
const CLAD_SHADOW = 0x232a2f; // every other board, so the lap reads
const TRIM = 0xe8e6df;       // white window frames
const GLASS = 0x59707e;      // pale: these windows reflect sky, not a dark room
const ROOF = 0x6a7076;
const SEAM = 0x7d848a;
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
const LATTICE = 0x353c41;   // dark, but off black: it is a screen, not a hole
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

export function buildCabin(scene, sample) {
  const groundAt = (x, z) => {
    const { lat, lon } = fromWorld(x, z);
    return sample(lat, lon);
  };
  const parts = [];
  const hw = W / 2, hl = L / 2;

  // Both storeys, and the lap siding drawn as alternating bands so the wall is
  // boards rather than a painted slab.
  for (const [floor, height] of [[LOWER_FLOOR, LOWER_STOREY], [UPPER_FLOOR, UPPER_STOREY]]) {
    place(parts, box(W, L, height, 0, floor, 0, CLAD));
    for (let y = floor + SIDING; y < floor + height - 0.05; y += SIDING * 2) {
      place(parts, box(W + 0.03, L + 0.03, SIDING, 0, y, 0, CLAD_SHADOW));
    }
  }

  // The posts the west side stands on, down to the bank.
  for (const s of [-1, 1]) {
    for (const t of [-0.62, 0.0, 0.62]) {
      place(parts, box(POST, POST, LOWER_FLOOR - GROUND_UNDER_DECK + 0.4,
                       s > 0 ? hw - 0.3 : -hw - DECK_OUT + 0.4, GROUND_UNDER_DECK - 0.4,
                       t * L, POST_COLOR));
    }
  }

  // The west face, off John's photograph from the beach, 2026-08-14. Both floors
  // face the water and both are mostly glass, but they are not the same thing.
  //
  // Upstairs is sliding doors: the glass starts just off the deck boards and
  // runs up under the eave, near enough the whole height of the storey. It was
  // drawn as a 1.06 m band on a 1.0 m sill, which is a window, and it left a
  // metre of blank siding under it that is not there.
  //
  // Downstairs is windows: shorter, on a real sill, with siding under them down
  // to the lattice.
  //
  // Scaled against the storey, which is measured: 2.26 m from the upper floor to
  // the eave and 1.90 m from the lower floor to the upper.
  const WEST_UPPER = { sill: 0.10, h: 1.90, bays: 5 };
  const WEST_LOWER = { sill: 0.55, h: 1.15, bays: 3 };

  // Frames stand proud of the wall so they catch a shadow. The bays are the
  // uprights between the doors: five metres of unbroken glass reads as a
  // shopfront, and it is the frames between that make it a wall of doors.
  const bandW = (floor, x, faceX, spec) => {
    const along = faceX ? L - 1.6 : W - 1.6;
    const frame = faceX
      ? box(0.12, along, spec.h + 0.18, x, floor + spec.sill - 0.09, 0, TRIM)
      : box(along, 0.12, spec.h + 0.18, 0, floor + spec.sill - 0.09, x, TRIM);
    place(parts, frame);
    const pane = faceX
      ? box(0.14, along - 0.22, spec.h, x, floor + spec.sill, 0, GLASS)
      : box(along - 0.22, 0.14, spec.h, 0, floor + spec.sill, x, GLASS);
    place(parts, pane);
    for (let i = 1; i < spec.bays; i++) {
      const t = -along / 2 + (along * i) / spec.bays;
      place(parts, faceX
        ? box(0.15, 0.09, spec.h, x, floor + spec.sill, t, TRIM)
        : box(0.09, 0.15, spec.h, t, floor + spec.sill, x, TRIM));
    }
  };
  bandW(LOWER_FLOOR, -hw, true, WEST_LOWER);
  bandW(UPPER_FLOOR, -hw, true, WEST_UPPER);
  // The north gable end: one small window, still unphotographed.
  place(parts, box(1.0, 0.12, 1.0, 1.2, UPPER_FLOOR + WIN_SILL, -hl, TRIM));
  place(parts, box(0.8, 0.14, 0.8, 1.2, UPPER_FLOOR + WIN_SILL + 0.1, -hl, GLASS));

  // The south gable end, off John's photograph of it, 2026-08-14. Not the small
  // square that was here: one wide picture window, set well west of centre and
  // carried up close under the eave, with plain siding the whole way east of it.
  //
  // Scaled against the two things in the frame that are measured — the wall is
  // 6.47 m across and the storey 2.26 m from floor to eave — so the numbers are
  // read off the picture and not guessed. Sized to about a fifth of a metre.
  const SOUTH_WIN_W = 2.10;
  const SOUTH_WIN_H = 1.05;
  const SOUTH_WIN_X = -1.70;   // west of centre, and 0.5 m clear of the corner
  const SOUTH_WIN_SILL = 0.90; // above the upper floor, head 0.31 under the eave
  place(parts, box(SOUTH_WIN_W, 0.12, SOUTH_WIN_H,
                   SOUTH_WIN_X, UPPER_FLOOR + SOUTH_WIN_SILL, hl, TRIM));
  place(parts, box(SOUTH_WIN_W - 0.2, 0.14, SOUTH_WIN_H - 0.2,
                   SOUTH_WIN_X, UPPER_FLOOR + SOUTH_WIN_SILL + 0.1, hl, GLASS));

  // The roof, and the seams standing up off it.
  const roof = gableRoof(hw, hl, EAVE, 0, OVERHANG, ROOF, RIDGE);
  place(parts, roof);
  // The surface, so the seams and the fascia sit on the roof rather than beside it.
  const roofY = (x) => RIDGE_Y - (x > RIDGE_X ? SLOPE_E : SLOPE_W) * Math.abs(x - RIDGE_X);
  for (let x = -hw - OVERHANG + SEAM_SPACING; x < hw + OVERHANG; x += SEAM_SPACING) {
    place(parts, box(0.05, L + OVERHANG * 2, 0.05, x, roofY(x) + 0.03, 0, SEAM));
  }
  // Fascia round the eave, dark, which is what makes the overhang read.
  for (const s of [-1, 1]) {
    place(parts, box(0.1, L + OVERHANG * 2, 0.22,
                     s * (hw + OVERHANG), roofY(s * (hw + OVERHANG)) - 0.22, 0, FASCIA));
    place(parts, box((hw + OVERHANG) * 2, 0.1, 0.2,
                     0, EAVE - 0.2, s * (hl + OVERHANG), FASCIA));
  }

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
  railRun(hw, hl + UPPER_SOUTH_OUT / 2, 0.1, UPPER_SOUTH_OUT);

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
  // The screen is dark but it is not a hole. Framed in timber and lifted off
  // black, or it reads as a missing wall rather than lattice in shadow.
  const skirtH = LOWER_FLOOR - 0.14 - GROUND_UNDER_DECK;
  place(parts, box(0.1, L, skirtH, -hw - LOWER_DECK_OUT, GROUND_UNDER_DECK, 0, LATTICE));
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
  // Under it the same lattice screen, in panels that shorten as the ground
  // climbs. Each panel starts a little under grade, because a panel that stops
  // short of the ground is a hole and a panel buried in it is nothing at all.
  const grade = (f) => GROUND_AT_SOUTH_WEST - 0.3 +
                       f * (GROUND_AT_SOUTH_END - GROUND_AT_SOUTH_WEST);
  const PANELS = 6;
  for (let k = 0; k < PANELS; k++) {
    const f = (k + 0.5) / PANELS, gm = grade(f);
    onEdge(edge / PANELS, LOWER_FLOOR - 0.14 - gm, 0.1, f, gm, LATTICE);
    const fp = k / PANELS, gp = grade(fp);
    place(parts, box(0.16, 0.16, LOWER_FLOOR - 0.14 - gp,
                     sx0 + fp * du, gp, sv0 + fp * dv, DECK_TIMBER));
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
  // Handrail both sides. The bar is laid flat and raked to the pitch before
  // place() turns it into the world with everything else.
  const rake = Math.atan2(RISER, GOING);
  const raked = (v, y0, dy) => {
    const g = new THREE.BoxGeometry(Math.hypot(STEPS * GOING, STEPS * RISER),
                                    0.09, 0.09);
    g.rotateZ(rake);
    g.translate(STAIR_U0 + (STEPS * GOING) / 2,
                y0 + dy + (STEPS * RISER) / 2, v);
    place(parts, tint(g, DECK_TIMBER));
  };
  for (const s of [-1, 1]) {
    const v = stv + s * (STAIR_W / 2);
    const y0 = STAIR_BASE + RISER + RAIL_H;
    raked(v, y0, 0);
    raked(v, y0, -RAIL_H * 0.45);
    for (let k = 1; k < STEPS; k += 5) {
      place(parts, box(0.1, 0.1, RAIL_H, STAIR_U0 + k * GOING,
                       STAIR_BASE + (k + 1) * RISER, v, DECK_TIMBER));
    }
  }

  // The landing it arrives on, cut into the bank at the level of the lower
  // deck boards, and the timber flight off it climbing north to the top deck.
  place(parts, box(LANDING.u1 - LANDING.u0, LANDING.v1 - LANDING.v0, 0.2,
                   (LANDING.u0 + LANDING.u1) / 2, LANDING_Y - 0.2,
                   (LANDING.v0 + LANDING.v1) / 2, CONCRETE));
  for (let k = 0; k < WOOD_STEPS; k++) {
    const v = WOOD_V0 - k * WOOD_GOING;
    const y = LANDING_Y + (k + 1) * WOOD_RISER;
    place(parts, box(WOOD_W, WOOD_GOING, 0.1, WOOD_U, y - 0.1, v, DECK_TIMBER));
    place(parts, box(WOOD_W, 0.08, WOOD_RISER, WOOD_U, y - WOOD_RISER,
                     v + WOOD_GOING / 2, DECK_TIMBER));
  }
  // Its rail runs the other way, so the bar is laid along z and raked about x.
  const wRun = (WOOD_STEPS - 1) * WOOD_GOING;
  const wRise = (WOOD_STEPS - 1) * WOOD_RISER;
  const wRake = Math.atan2(WOOD_RISER, WOOD_GOING);
  for (const s of [-1, 1]) {
    const u = WOOD_U + s * (WOOD_W / 2);
    const yFoot = LANDING_Y + WOOD_RISER + RAIL_H;
    for (const drop of [0, -RAIL_H * 0.45]) {
      const g = new THREE.BoxGeometry(0.09, 0.09, Math.hypot(wRun, wRise));
      g.rotateX(wRake);
      g.translate(u, yFoot + drop + wRise / 2, WOOD_V0 - wRun / 2);
      place(parts, tint(g, DECK_TIMBER));
    }
    for (let k = 0; k < WOOD_STEPS; k += 4) {
      place(parts, box(0.1, 0.1, RAIL_H, u,
                       LANDING_Y + (k + 1) * WOOD_RISER,
                       WOOD_V0 - k * WOOD_GOING, DECK_TIMBER));
    }
  }

  // The stair down the north side.
  for (let k = 0; k < 9; k++) {
    const y = LOWER_FLOOR - 0.3 - k * 0.3;
    place(parts, box(1.1, 0.32, 0.1, -hw - 1.2 - k * 0.16, y, -hl - 0.9, DECK_TIMBER));
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
