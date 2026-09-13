// The concrete stair east of the house.
//
// The terrain here is lidar at 1.15 m cells and a tread is a quarter of that,
// so what the heightmap holds through this ground is a smooth ramp with no steps
// in it at all. That is not a rounding error when a camera frame is thrown at
// it: the rays run at eleven to seventeen degrees against a bank nearly as
// steep, and a foot of height error slides where they land four to six metres
// along the ground. The picture of the stair went one way and the stair went
// another.
//
// So the stair is drawn as the thing it is. It is not in the lidar and it is not
// in OSM; it was measured out of the photograph the roof camera takes — twelve
// tread edges as twelve directions, scaled by John's count of nineteen steps and
// his tread of about ten inches. See assets/site/389-stair.json, which carries
// what was measured and what was not.
//
// One average step. The real ones differ and nothing here knows how.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toWorld } from "../geo.js";
import { groundClearance } from "./ground-clearance.js";
import { stairAccessPlan } from "./stair-access-plan.js";

export function stairAccess(spec, entryEdge) {
  const foot = toWorld(spec.bottom.lat, spec.bottom.lon, spec.bottom.ground_m);
  return stairAccessPlan({ foot: [foot.x, foot.y, foot.z], bearing: spec.bearing_deg,
    steps: spec.steps, going: spec.going_m, rise: spec.rise_m, width: spec.width_m }, entryEdge);
}

const CONCRETE = 0xa8a49b;
// Weathered, and the treads are paler than the risers because rain washes them.
const RISER_SHADE = 0.88;
// Each step is a slab: the tread you walk on and the face under its nose.
const TREAD_THICK_M = 0.12;
// How far under the treads the ground sits. Cutting to the underside of a tread
// leaves the ground flush with the bottom of every step and the flight standing
// in nothing. In the frame the risers show and there is shadow under the noses,
// so the ground is below them. John, 2026-08-14: the stairs are above the
// ground. Read off the photograph by eye, not fitted.
const GROUND_DROP_M = 0.15;
// How far out from the edge of the flight the ground is taken down at full
// depth, and over what further distance it climbs back to the bake. At 0.15 m —
// the flight and no more — what is drawn is a slot, and from the front door
// camera you look into its near wall instead of at the steps. Both eyeballed off
// the same photograph, which cannot do better: the camera stands at the foot and
// looks along the flight, so a ray beside it grazes the ground and half a metre
// of assumed offset moves the answer by a metre.
const CUT_M = 1.2;
const FADE_M = 2.5;
// How far past the head the cut runs, so the top step is not stood in a wall.
const ENDS_M = 0.3;
// And how far past the foot. Not the same number. The bottom step is level with
// the floor of the upper storey, so the ground you cross from the house to reach
// it is level with it too, and the bake does not know that — it runs the bank
// straight through. 3.6 m is where the bake falls back to the foot's own height,
// which is where the flight stood before John moved it three widths east.
// Without this the ridge between the camera and the bottom step hides the flight.
const FOOT_M = 3.6;

// Where the stair stands, the stair is the ground.
//
// The bank is convex here — steep for the first four metres and flat after —
// so it bulges above the straight line of a flight and buries its middle. That
// is not the stair being in the wrong place. It is the lidar at 1.15 m cells
// running a smooth ramp through treads a quarter of that, which is the same
// reason the stair has to be drawn at all.
//
// So the ground is cut down to the underside of the treads along the flight and
// left alone everywhere else. It only ever cuts, never fills: ground already
// below the flight is what the bottom step sits on.
//
// Handed to buildTerrain, which applies it above both the mesh and sample(), so
// the drawn ground, the floor the camera is held over, the trees, the beach and
// the camera projector all see the same cut. Cutting the mesh alone would leave
// the sampler answering with a bank that is no longer there.
export function stairCarve(spec, gridDiagonal = 0, entryEdge) {
  const foot = toWorld(spec.bottom.lat, spec.bottom.lon, spec.bottom.ground_m);
  const b = (spec.bearing_deg * Math.PI) / 180;
  const fx = Math.sin(b), fz = -Math.cos(b);
  const rx = Math.cos(b), rz = Math.sin(b);
  const run = spec.going_m * (spec.steps - 1);
  const halfW = spec.width_m / 2 + CUT_M + gridDiagonal;
  const pitch = spec.rise_m / spec.going_m;
  const access = entryEdge ? stairAccess(spec, entryEdge) : null;
  const landingCut = groundClearance(access ? [access.bottom, access.head].map(polygon => ({
    polygon: polygon.map(p => [p[0], p[2]]), ceiling: polygon[0][1] - 0.28,
  })) : [], gridDiagonal);
  return (lat, lon, y) => {
    const p = toWorld(lat, lon, 0);
    y = landingCut(p.x, p.z, y);
    const dx = p.x - foot.x, dz = p.z - foot.z;
    const across = Math.abs(dx * rx + dz * rz);
    if (across > halfW + FADE_M) return y;
    const along = dx * fx + dz * fz;
    // The mesh interpolates neighbouring vertices. Carry the same cut one
    // triangle further so the bank beyond a landing cannot bleed into it.
    if (along < -FOOT_M - gridDiagonal || along > run + ENDS_M + gridDiagonal) return y;
    // The flight's own line, held level past each end so the cut does not run
    // away up the bank or down it.
    const t = Math.min(Math.max(along, 0), run);
    const floor = foot.y + pitch * t - TREAD_THICK_M - GROUND_DROP_M;
    // Full depth beside the flight, then back to the bake across the fade, so
    // the cut has a bank at its edge rather than a wall.
    const k = across <= halfW ? 0 : (across - halfW) / FADE_M;
    return Math.min(y, floor + (y - floor) * k);
  };
}

function slab(w, h, d, x, y, z, yaw) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateY(yaw);
  g.translate(x, y, z);
  return g;
}

// spec is assets/site/389-stair.json.
export function buildStair(scene, spec, projector, entryEdge) {
  if (!spec || !spec.bottom || !spec.steps) {
    throw new Error(
      "buildStair: the stair asset has no bottom or no step count. It is " +
      "written by the fit in the scratchpad off the front door camera frame; " +
      "see assets/site/389-stair.json.");
  }
  const foot = toWorld(spec.bottom.lat, spec.bottom.lon, spec.bottom.ground_m);
  // Bearing is compass: 0 north, 90 east. World +x is east and +z is south, so
  // a step forward is (sin, -cos) and the slabs turn by the same angle.
  const b = (spec.bearing_deg * Math.PI) / 180;
  const fx = Math.sin(b), fz = -Math.cos(b);

  const treads = [];
  const risers = [];
  for (let k = 0; k < spec.steps; k++) {
    const out = spec.going_m * k;
    const up = spec.rise_m * k;
    const x = foot.x + fx * out;
    const z = foot.z + fz * out;
    // The tread, laid flat, its nose at the step's own point.
    treads.push(slab(spec.width_m, TREAD_THICK_M, spec.going_m,
                     x + fx * spec.going_m / 2, foot.y + up - TREAD_THICK_M / 2,
                     z + fz * spec.going_m / 2, -b));
    // The riser under the nose, down to the step below.
    risers.push(slab(spec.width_m, spec.rise_m, 0.06, x, foot.y + up - spec.rise_m / 2,
                     z, -b));
  }

  const wood = [];
  if (entryEdge) {
    const access = stairAccess(spec, entryEdge);
    // Convex landing plates share their exact boundaries with the terrain cut.
    const plate = (corners) => {
      const vertices = [], tri = (a, b, c) => vertices.push(...a, ...b, ...c);
      const lower = corners.map(([x, y, z]) => [x, y - 0.20, z]);
      for (let k = 1; k < corners.length - 1; k++) {
        tri(corners[0], corners[k + 1], corners[k]);
        tri(lower[0], lower[k], lower[k + 1]);
      }
      for (let k = 0; k < corners.length; k++) {
        const j = (k + 1) % corners.length;
        tri(corners[k], lower[k], lower[j]); tri(corners[k], lower[j], corners[j]);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(vertices.length / 3 * 2), 2));
      g.setIndex(Array.from({ length: vertices.length / 3 }, (_, i) => i));
      g.computeVertexNormals(); return g;
    };
    treads.push(plate(access.bottom), plate(access.head));
    const member = (a, b, w, d) => {
      const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
      const delta = end.clone().sub(start);
      const g = new THREE.BoxGeometry(w, delta.length(), d);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
      g.translate(...start.add(end).multiplyScalar(0.5).toArray()); return g;
    };
    // Left when descending: the photographed south/outer timber handrail.
    const outer = spec.width_m / 2, lift = (p, h) => [p[0], p[1] + h, p[2]];
    for (const h of [0.58, 1.05]) {
      wood.push(member(lift(access.bottom[3], h), lift(access.bottom[2], h), 0.09, 0.14));
      wood.push(member(access.point(0, outer, foot.y + h),
        access.point(access.run, outer, access.top + h), 0.09, 0.14));
      wood.push(member(access.point(access.run, outer, access.top + h),
        access.point(access.run + access.headDepth, outer, access.top + h), 0.09, 0.14));
    }
    for (const k of [0, 5, 10, 15, spec.steps - 1]) {
      const at = access.point(k * spec.going_m, outer, foot.y + k * spec.rise_m);
      wood.push(member(lift(at, -0.12), lift(at, 1.10), 0.11, 0.11));
    }
    for (const along of [access.run, access.run + access.headDepth]) {
      const at = access.point(along, outer, access.top);
      wood.push(member(lift(at, -0.20), lift(at, 1.10), 0.11, 0.11));
    }
    // Shallow dark joints make the upper plate read as the photographed paving.
    for (let along = access.run + 0.43; along < access.run + access.headDepth; along += 0.43) {
      risers.push(member(access.point(along, -outer, access.top + 0.001),
        access.point(along, outer, access.top + 0.001), 0.008, 0.002));
    }
    for (let across = -outer + 0.40; across < outer; across += 0.40) {
      risers.push(member(access.point(access.run, across, access.top + 0.001),
        access.point(access.run + access.headDepth, across, access.top + 0.001), 0.008, 0.002));
    }
  }

  const mat = new THREE.MeshStandardMaterial({
    color: CONCRETE, roughness: 1, metalness: 0 });
  const riserMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(CONCRETE).multiplyScalar(RISER_SHADE),
    roughness: 1, metalness: 0 });
  if (projector) {
    projector.dress(mat);
    projector.dress(riserMat);
  }

  const parts = [
    new THREE.Mesh(mergeGeometries(treads, false), mat),
    new THREE.Mesh(mergeGeometries(risers, false), riserMat),
  ];
  if (wood.length) parts.push(new THREE.Mesh(mergeGeometries(wood, false),
    new THREE.MeshStandardMaterial({ color: 0x8e816d, roughness: 1, metalness: 0 })));
  for (const m of parts) {
    m.castShadow = false;
    scene.add(m);
  }
  const top = foot.y + spec.rise_m * (spec.steps - 1);
  return { meshes: parts, bottom: foot.y, top, run: spec.going_m * spec.steps };
}
