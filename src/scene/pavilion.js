// A shelter on the beach at the foot of the bank below 389.
//
// It is not built. Nothing on that beach looks like this and nothing here
// pretends otherwise: it is off until asked for, on the button or on H, the same
// as the courts on T and the campground on G.
//
// Where it stands is arithmetic rather than taste. The bank falls from 9.4 m
// under the cabin to 2.0 m out on the flat, and the lidar has the fall in three
// stages: steep for four metres, easing over the next six, and beach after that.
// The shelf at the bottom of the steep part is the only ground here that is both
// level and dry — the waterline stands 43 m off the camera at a 3.5 m tide,
// which is the seaward edge of this footprint. So it sits there, 8 m west of the
// cabin, on ground the near tile reads between 3.75 m and 4.9 m across the
// footprint.
//
// The deck is level and clears the highest of that ground by 0.3 m, which puts
// it better than a metre and a half over that 3.5 m tide. The posts are not one
// length: each is cut to the ground under its own foot, which is how the west
// side of the cabin is built and for the same reason.
//
// What it is made of is the west coast reading of the thing John showed me:
// cedar posts and beams, a slatted roof with a driftwood log laid along the
// seaward side, a low bed of driftwood logs, wool and canvas rather than
// macramé, hurricane lanterns and glass floats hung off the beam. The lanterns
// come up with the dark the way the ships' lights do.
//
// Every dimension here is chosen. None of it is measured off anything, because
// there is nothing there to measure.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { fromWorld, toWorld } from "../geo.js";
import { box, tint } from "./parts.js";
import { buildLamps, setLampLevel } from "./lights.js";

// The middle of the footprint: world (-42.5, -4.5), 8 m west of the cabin.
const AT = { lat: 48.9890494, lon: -123.0858998 };

const HALF_ALONG_M = 2.3;   // along the shore, north and south
const HALF_ACROSS_M = 1.8;  // toward the water and away from it
const DECK_CLEAR_M = 0.3;   // the deck over the highest ground under it
const DECK_THICK_M = 0.09;
const POST_R_M = 0.11;
const HEADROOM_M = 2.45;    // deck to the underside of the beam
const BEAM_M = 0.24;
const EAVE_M = 0.4;
const SLAT_M = 0.06;
const SLAT_GAP_M = 0.3;
const LOG_R_M = 0.19;       // the driftwood laid along the seaward side
// Where the lanterns hang along that beam.
const LANTERNS = [-1.5, 1.5];

const CEDAR = 0x9a8f7f;
const SLAT = 0xa2967f;
const DRIFTWOOD = 0xb8b2a4;
const DECKING = 0x8f8677;
const WOOL = 0xe6e0d2;
const BLANKET = 0x6f6d66;
const OLIVE = 0x8a8a6e;
const RUG = 0x9b6a5c;
const CANVAS = 0xd8cfba;
const IRON = 0x2a2f34;
const FLOAT_GLASS = [0x4f9c96, 0x6fa86a, 0x7fb6c4];

// Anything round: a post, a log, a rope, a glass float. y is its middle.
function log(radius, length, x, y, z, axis, color) {
  const g = new THREE.CylinderGeometry(radius, radius * 1.06, length, 8);
  if (axis === "x") g.rotateZ(Math.PI / 2);
  if (axis === "z") g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return tint(g, color);
}

// Where the deck sits and how long each post is, given the ground under the
// footprint. Plain arithmetic, so it can be checked without a browser:
// ground(x, z) is the terrain height at a point in the footprint's own frame,
// x toward the water at -x, z along the shore.
export function plan(ground) {
  const feet = [];
  for (const x of [-HALF_ACROSS_M, HALF_ACROSS_M]) {
    for (const z of [-HALF_ALONG_M + 0.2, 0, HALF_ALONG_M - 0.2]) {
      feet.push({ x, z, ground: ground(x, z) });
    }
  }
  const deckY = Math.max(...feet.map((f) => f.ground)) + DECK_CLEAR_M;
  const beamY = deckY + HEADROOM_M;
  return {
    deckY,
    beamY,
    roofY: beamY + BEAM_M,
    bedY: deckY + 0.47,
    posts: feet.map((f) => ({ ...f, top: beamY + BEAM_M })),
  };
}

function parts(shape) {
  const { deckY, beamY, roofY, bedY, posts } = shape;
  const out = [];

  // The posts, each cut to the ground under its own foot and buried a little,
  // so not one of them ends in the air.
  for (const p of posts) {
    const bottom = p.ground - 0.3;
    out.push(log(POST_R_M, p.top - bottom, p.x, (p.top + bottom) / 2, p.z, "y", CEDAR));
  }

  // The deck: two joists under it and planks across.
  for (const x of [-HALF_ACROSS_M + 0.3, HALF_ACROSS_M - 0.3]) {
    out.push(box(0.16, HALF_ALONG_M * 2, 0.2, x, deckY - DECK_THICK_M - 0.2, 0, CEDAR));
  }
  const plank = 0.18;
  const planks = Math.floor((HALF_ALONG_M * 2) / (plank + 0.02));
  for (let i = 0; i < planks; i++) {
    const z = -HALF_ALONG_M + plank / 2 + i * (plank + 0.02);
    out.push(box(HALF_ACROSS_M * 2, plank, DECK_THICK_M, 0, deckY - DECK_THICK_M, z, DECKING));
  }

  // A beam along each long side, the slats across them, and the driftwood log
  // laid over the seaward end of the slats.
  for (const x of [-HALF_ACROSS_M, HALF_ACROSS_M]) {
    out.push(box(BEAM_M * 0.7, HALF_ALONG_M * 2 + EAVE_M, BEAM_M, x, beamY, 0, CEDAR));
  }
  const slats = Math.round((HALF_ALONG_M * 2 + EAVE_M) / SLAT_GAP_M);
  for (let i = 0; i <= slats; i++) {
    const z = -HALF_ALONG_M - EAVE_M / 2 + i * SLAT_GAP_M;
    out.push(box(HALF_ACROSS_M * 2 + EAVE_M * 1.5, 0.1, SLAT_M, 0.05, roofY, z, SLAT));
  }
  out.push(log(LOG_R_M, HALF_ALONG_M * 2 + EAVE_M * 1.4, -HALF_ACROSS_M,
               roofY + SLAT_M + LOG_R_M, 0, "z", DRIFTWOOD));

  // The bed, landward, out of the weather: a frame of driftwood, a mattress, a
  // blanket thrown back, cushions at the head.
  const bx = 0.66;
  for (const z of [-1.05, 1.05]) {
    out.push(log(0.13, 1.5, bx, deckY + 0.13, z, "x", DRIFTWOOD));
  }
  for (const x of [bx - 0.72, bx + 0.72]) {
    out.push(log(0.12, 2.1, x, deckY + 0.3, 0, "z", DRIFTWOOD));
  }
  out.push(box(1.4, 2.1, 0.22, bx, bedY - 0.22, 0, WOOL));
  out.push(box(1.36, 1.0, 0.09, bx - 0.1, bedY, 0.5, BLANKET));
  out.push(box(1.3, 0.5, 0.18, bx, bedY, -0.75, CANVAS));
  for (const z of [-0.95, -0.48]) {
    out.push(box(0.48, 0.42, 0.2, bx + 0.44, bedY, z, OLIVE));
  }

  // A rug on the boards between the bed and the water.
  out.push(box(1.5, 2.0, 0.02, -0.85, deckY, 0, RUG));

  // The hammock chair, hung off the seaward beam.
  const seatY = deckY + 0.62;
  const hangX = -1.1;
  const spread = beamY - (seatY + 0.06);
  for (const z of [-0.34, 0.34]) {
    out.push(log(0.025, spread, hangX, seatY + 0.06 + spread / 2, z, "y", CANVAS));
  }
  out.push(log(0.035, 1.0, hangX, beamY - 0.02, 0, "z", DRIFTWOOD));
  out.push(box(0.7, 0.9, 0.06, hangX, seatY, 0, CANVAS));
  out.push(box(0.06, 0.9, 0.5, hangX + 0.32, seatY, 0, CANVAS));

  // Lanterns on that beam, and glass floats at the north end of it.
  const lanternX = -HALF_ACROSS_M + 0.06;
  for (const z of LANTERNS) {
    out.push(log(0.02, 0.3, lanternX, beamY - 0.15, z, "y", IRON));
    out.push(box(0.16, 0.16, 0.26, lanternX, beamY - 0.56, z, IRON));
  }
  FLOAT_GLASS.forEach((color, i) => {
    const z = -HALF_ALONG_M + 0.2;
    const drop = 0.5 + i * 0.22;
    const x = lanternX + 0.24 + i * 0.16;
    out.push(log(0.015, drop, x, beamY - drop / 2, z, "y", CANVAS));
    out.push(log(0.11, 0.2, x, beamY - drop, z, "y", color));
  });

  return out;
}

// sample(lat, lon) -> terrain height, the same one the cabin stands on.
export function buildPavilion(scene, sample) {
  if (!sample) {
    throw new Error(
      "buildPavilion: no terrain sampler, so there is no ground to stand it on " +
      "and no way to cut the posts to length. Build it inside the near-terrain " +
      "promise in main.js, the way buildCabin is.");
  }
  const w = toWorld(AT.lat, AT.lon);
  // The footprint keeps the world's own frame — +x east, +z south — so the open
  // side faces west, down the view.
  const shape = plan((x, z) => {
    const at = fromWorld(w.x + x, w.z + z);
    return sample(at.lat, at.lon);
  });

  const group = new THREE.Group();
  group.position.set(w.x, 0, w.z);
  group.visible = false;   // not built, so not standing there until asked for
  group.add(new THREE.Mesh(
    mergeGeometries(parts(shape), false),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85,
                                     metalness: 0, side: THREE.DoubleSide })));

  const lamps = buildLamps(LANTERNS.map((z) => ({
    x: -HALF_ACROSS_M + 0.06, y: shape.beamY - 0.43, z, color: 0xffdca8, size: 6,
  })));
  group.add(lamps);
  scene.add(group);

  return {
    group,
    centre: new THREE.Vector3(w.x, shape.deckY, w.z),
    span: HALF_ALONG_M * 2,
    get visible() { return group.visible; },
    setVisible(on) { group.visible = on; },
    // night is 0 in full daylight and 1 once the sun is well down, the same
    // figure the ships' lights ride on.
    update(night) {
      if (group.visible) setLampLevel(lamps, night);
    },
  };
}
