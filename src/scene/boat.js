// A 12 ft aluminium boat, seen from its own stern. Open-topped on purpose: the
// helm sits at the transom and the bow has to be able to take a bite out of the
// view forward, which a closed solid could not do from inside.
//
// A jon boat is close to a prism — flat bottom, near-vertical sides — so the
// hull is the plan outline laid flat for the bottom and the same outline swept
// upward for the sides. Forward is -Z, matching the geo transform.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const LENGTH_M = 3.66;   // 12 ft
const BEAM_M = 1.40;
const DEPTH_M = 0.45;    // gunwale above the bottom, amidships
const DRAFT_M = 0.13;    // bottom below the waterline, light
// The sheer lifts toward the bow and the bottom rocks up under it, so the
// forefoot clears the water at rest instead of knifing into it.
const SHEER_M = 0.22;    // extra gunwale height at the stem
const ROCKER_M = 0.17;   // how far the bottom rises at the stem
// Where the forefoot sits relative to the waterline. Positive is clear of it.
const BOW_KEEL_Y = ROCKER_M - DRAFT_M;

// 0 at the transom, 1 at the stem, for shaping sheer and rocker along her.
function fwdFraction(z) {
  return Math.min(1, Math.max(0, (LENGTH_M / 2 - z) / LENGTH_M));
}

// Plan outline, bow first, down the starboard side and back up the port side.
const HALF = BEAM_M / 2;
const FWD = LENGTH_M / 2;
const OUTLINE = [
  [0.00, -FWD],
  [0.32, -FWD + 0.62],
  [0.48, -FWD + 1.50],
  [0.50, -FWD + 2.85],
  [0.43, FWD],
  [-0.43, FWD],
  [-0.50, -FWD + 2.85],
  [-0.48, -FWD + 1.50],
  [-0.32, -FWD + 0.62],
].map(([x, z]) => [x * (HALF / 0.50), z]);

function hullGeometry() {
  const bottom = [];
  const sides = [];
  const n = OUTLINE.length;
  const keel = (z) => ROCKER_M * fwdFraction(z) ** 2;          // bottom rises forward
  const sheer = (z) => DEPTH_M + SHEER_M * fwdFraction(z) ** 2; // gunwale rises with it

  // Bottom: a fan from the middle of the transom out to each edge pair.
  const cx = 0, cz = FWD * 0.35;
  for (let i = 0; i < n; i++) {
    const a = OUTLINE[i], b = OUTLINE[(i + 1) % n];
    bottom.push(cx, keel(cz), cz, a[0], keel(a[1]), a[1], b[0], keel(b[1]), b[1]);
  }

  // Sides: the outline swept up to the gunwale.
  for (let i = 0; i < n; i++) {
    const a = OUTLINE[i], b = OUTLINE[(i + 1) % n];
    // Flare the gunwale out a little, the way a hull opens toward the sheer.
    const fa = 1.08;
    const ay = keel(a[1]), by = keel(b[1]);
    const ah = sheer(a[1]), bh = sheer(b[1]);
    sides.push(
      a[0], ay, a[1], b[0], by, b[1], b[0] * fa, bh, b[1],
      a[0], ay, a[1], b[0] * fa, bh, b[1], a[0] * fa, ah, a[1],
    );
  }

  const mk = (arr) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(arr), 3));
    g.computeVertexNormals();
    return g;
  };
  return mergeGeometries([mk(bottom), mk(sides)], false);
}

// A thwart across the boat, and the outboard's block over the transom.
function fittingsGeometry() {
  const geoms = [];
  const seat = new THREE.BoxGeometry(BEAM_M * 0.86, 0.05, 0.24);
  seat.translate(0, DEPTH_M * 0.72, -0.30);
  geoms.push(seat);
  const bowSeat = new THREE.BoxGeometry(BEAM_M * 0.52, 0.05, 0.22);
  bowSeat.translate(0, DEPTH_M * 0.72, -FWD + 0.85);
  geoms.push(bowSeat);
  const motor = new THREE.BoxGeometry(0.26, 0.42, 0.30);
  motor.translate(0, DEPTH_M * 0.9, FWD + 0.12);
  geoms.push(motor);
  const shaft = new THREE.CylinderGeometry(0.05, 0.05, 0.55, 6);
  shaft.translate(0, DEPTH_M * 0.35, FWD + 0.12);
  geoms.push(shaft);
  return mergeGeometries(geoms, false);
}

// Returns a group whose origin sits on the waterline, forward is -Z.
export function buildBoat() {
  const group = new THREE.Group();

  const hull = new THREE.Mesh(hullGeometry(), new THREE.MeshStandardMaterial({
    color: 0x9aa3a8, roughness: 0.45, metalness: 0.55, side: THREE.DoubleSide,
  }));
  hull.position.y = -DRAFT_M;
  group.add(hull);

  const fittings = new THREE.Mesh(fittingsGeometry(), new THREE.MeshStandardMaterial({
    color: 0x6b6f72, roughness: 0.7, metalness: 0.2,
  }));
  fittings.position.y = -DRAFT_M;
  group.add(fittings);

  group.visible = false;
  return group;
}

export const BOAT = { LENGTH_M, BEAM_M, DEPTH_M, DRAFT_M, BOW_KEEL_Y };
