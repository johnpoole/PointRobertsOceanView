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

const CONCRETE = 0xa8a49b;
// Weathered, and the treads are paler than the risers because rain washes them.
const RISER_SHADE = 0.88;
// Each step is a slab: the tread you walk on and the face under its nose.
const TREAD_THICK_M = 0.12;
// How much wider than the flight the ground is cut, so no bank pokes through a
// tread at the edge.
const CHEEK_M = 0.15;
// How far past each end the cut runs, so the bottom step is not stood in a wall.
const ENDS_M = 0.3;

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
export function stairCarve(spec) {
  const foot = toWorld(spec.bottom.lat, spec.bottom.lon, spec.bottom.ground_m);
  const b = (spec.bearing_deg * Math.PI) / 180;
  const fx = Math.sin(b), fz = -Math.cos(b);
  const rx = Math.cos(b), rz = Math.sin(b);
  const run = spec.going_m * (spec.steps - 1);
  const halfW = spec.width_m / 2 + CHEEK_M;
  const pitch = spec.rise_m / spec.going_m;
  return (lat, lon, y) => {
    const p = toWorld(lat, lon, 0);
    const dx = p.x - foot.x, dz = p.z - foot.z;
    const across = dx * rx + dz * rz;
    if (Math.abs(across) > halfW) return y;
    const along = dx * fx + dz * fz;
    if (along < -ENDS_M || along > run + ENDS_M) return y;
    // The flight's own line, held level past each end so the cut does not run
    // away up the bank or down it.
    const t = Math.min(Math.max(along, 0), run);
    return Math.min(y, foot.y + pitch * t - TREAD_THICK_M);
  };
}

function slab(w, h, d, x, y, z, yaw) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateY(yaw);
  g.translate(x, y, z);
  return g;
}

// spec is assets/site/389-stair.json.
export function buildStair(scene, spec, projector) {
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
  for (const m of parts) {
    m.castShadow = false;
    scene.add(m);
  }
  const top = foot.y + spec.rise_m * (spec.steps - 1);
  return { meshes: parts, bottom: foot.y, top, run: spec.going_m * spec.steps };
}
