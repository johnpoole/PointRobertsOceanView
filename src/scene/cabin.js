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
//   an upper deck on posts with a dark wire-mesh rail in a timber frame
//   a lower deck under it with horizontal timber rails, and lattice below that
//   a timber stair down the north side to the beach
//
// What the ground settles, and it is the whole reason the packet exists: the
// footprint runs from 5.74 m at its west corner to 10.79 m at its east. Five
// metres of fall under a seven metre building. The east side is dug into the
// bank and the west stands on posts.
//
// The footprint in the bake is an irregular seven-node trace of 55 m². The
// building here is the rectangle that fits it — 7.4 by 6.0, turned 18° east of
// north — because that is what the photographs show and the notch is not
// something a photograph can place.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { fromWorld } from "../geo.js";
import { box, gableRoof, tint } from "./parts.js";

// World metres. The centre of the fitted rectangle, and how far it is turned.
const AT = { x: -34.8, z: -6.95 };
const YAW = 0.318;           // 18.2°, off the long edge of the traced footprint
const W = 6.0;               // across, roughly east to west
const L = 7.4;               // along, roughly north to south

// Levels, off the ground under the uphill side.
const LOWER_FLOOR = 8.55;
const STOREY = 2.65;
const UPPER_FLOOR = LOWER_FLOOR + STOREY;
const EAVE = UPPER_FLOOR + STOREY;
const RISE = 1.15;           // a shallow pitch, about 3 in 12
const OVERHANG = 0.85;       // deep, and unmistakable in every photograph

const DECK_OUT = 3.9;        // the upper deck, projecting west over the bank
const LOWER_DECK_OUT = 3.2;
const RAIL_H = 1.05;
const POST = 0.16;
const GROUND_UNDER_DECK = 5.6;

const SEAM_SPACING = 0.55;   // standing seam, near enough off the roof photograph
const CHIMNEY_W = 0.85;
const CHIMNEY_TOP = 17.4;

const SIDING = 0.16;         // board exposure, wide, as in the north-face photo
const WIN_H = 1.35;
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
const RAIL_MESH = 0x3d4348;
const POST_COLOR = 0x2f4a44;  // the green-teal posts under the deck
const LATTICE = 0x353c41;   // dark, but off black: it is a screen, not a hole

// Turn a part from the cabin's own frame into the world.
function place(parts, geom) {
  geom.rotateY(YAW);
  geom.translate(AT.x, 0, AT.z);
  parts.push(geom);
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
  for (const [floor, height] of [[LOWER_FLOOR, STOREY], [UPPER_FLOOR, STOREY]]) {
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

  // Windows. A long band facing the water on both floors, smaller ones on the
  // north and south. Frames stand proud of the wall so they catch a shadow.
  const bandW = (floor, x, faceX) => {
    const along = faceX ? L - 1.6 : W - 1.6;
    const frame = faceX
      ? box(0.12, along, WIN_H + 0.18, x, floor + WIN_SILL - 0.09, 0, TRIM)
      : box(along, 0.12, WIN_H + 0.18, 0, floor + WIN_SILL - 0.09, x, TRIM);
    place(parts, frame);
    const pane = faceX
      ? box(0.14, along - 0.22, WIN_H, x, floor + WIN_SILL, 0, GLASS)
      : box(along - 0.22, 0.14, WIN_H, 0, floor + WIN_SILL, x, GLASS);
    place(parts, pane);
  };
  bandW(LOWER_FLOOR, -hw, true);
  bandW(UPPER_FLOOR, -hw, true);
  // One small window each on the north and south gable ends.
  for (const s of [-1, 1]) {
    place(parts, box(1.0, 0.12, 1.0, 1.2, UPPER_FLOOR + WIN_SILL, s * hl, TRIM));
    place(parts, box(0.8, 0.14, 0.8, 1.2, UPPER_FLOOR + WIN_SILL + 0.1, s * hl, GLASS));
  }

  // The roof, and the seams standing up off it.
  const roof = gableRoof(hw, hl, EAVE, RISE, OVERHANG, ROOF);
  place(parts, roof);
  const slope = RISE / hw;
  for (let x = -hw - OVERHANG + SEAM_SPACING; x < hw + OVERHANG; x += SEAM_SPACING) {
    const y = EAVE + RISE - slope * Math.abs(x) + 0.03;
    place(parts, box(0.05, L + OVERHANG * 2, 0.05, x, y, 0, SEAM));
  }
  // Fascia round the eave, dark, which is what makes the overhang read.
  for (const s of [-1, 1]) {
    place(parts, box(0.1, L + OVERHANG * 2, 0.22,
                     s * (hw + OVERHANG), EAVE - slope * OVERHANG - 0.22, 0, FASCIA));
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
  const railRun = (x, z, w, d) => {
    place(parts, box(w, d, 0.09, x, UPPER_FLOOR + RAIL_H, z, DECK_TIMBER));
    place(parts, box(w * 0.98, d * 0.98, RAIL_H - 0.18, x,
                     UPPER_FLOOR + 0.09, z, RAIL_MESH));
  };
  railRun(-hw - DECK_OUT, 0, 0.1, L);
  railRun(dx, -hl, DECK_OUT, 0.1);
  railRun(dx, hl, DECK_OUT, 0.1);

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
