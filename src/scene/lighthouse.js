// Point Roberts Light, on the point at Lighthouse Marine Park.
//
// Not a lighthouse. The government bought the land for a light station in 1908
// and never built the tower, so what stands there is a skeleton tower about
// 25 ft high with the light 9 m above the water. That is what is drawn.
//
// It shows two white flashes and then waits. The period is John's, timed from
// the point while looking at it. The published light list says fifteen seconds
// and it is left recorded here that they disagree, because a number somebody
// read off the water beats a number somebody copied out of a table.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { toWorld } from "../geo.js";
import { box, tint } from "./parts.js";
import { buildLamps, setLampLevel } from "./lights.js";

// Position supplied by John on 2026-09-06; terrain and lamp share this anchor.
const AT = { lat: 48.97163890548649, lon: -123.08368536530644 };

const TOWER_M = 7.62;      // 25 ft
const LEG_SPREAD_M = 2.4;  // footprint at the ground
const LEG_M = 0.10;
const BEACON_STEM_M = 0.22;
const LANTERN_M = 0.50;
const BEACON_X = LEG_SPREAD_M / 2;
const BEACON_Z = -LEG_SPREAD_M / 2;
const MARKER_DIAGONAL_M = 3.0;

// The light is put where the lantern is, on top of the tower, on ground this
// page already knows the height of. It is not set from the published focal
// height of 9 m, because that is measured above mean high water and everything
// here is metres above MLLW. Its elevation follows the sampled ground plus the
// frame, mounting stem and half the beacon height. Driving it from the 9 m
// instead buried the lamp inside the steelwork.

// Two flashes, this far apart, and then the whole thing again this often.
const PERIOD_S = 5.0;
const GAP_S = 0.5;
const ON_S = 0.25;

const STEEL = 0x8d9299;

// Structure reference supplied by John, photographed May 2018:
// https://nealslighthouses.blogspot.com/2018/06/lighthouse-point-point-roberts.html
// The 25 ft height is stated there. Widths, member sizes, marker placement and
// compass orientation are visual approximations, not surveyed measurements.
function towerGeometry(groundY) {
  const parts = [];
  const half = LEG_SPREAD_M / 2;
  const top = groundY + TOWER_M;
  const beam = (a, b, width = LEG_M) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const delta = end.clone().sub(start);
    const g = new THREE.BoxGeometry(width, delta.length(), width);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), delta.normalize()));
    g.translate(...start.add(end).multiplyScalar(0.5).toArray());
    parts.push(tint(g, STEEL));
  };
  // Straight uprights, with four open bays instead of tapering legs.
  for (const x of [-half, half]) for (const z of [-half, half]) {
    beam([x, groundY, z], [x, top, z]);
  }
  const levels = [0.25, 2.10, 3.95, 5.80, TOWER_M];
  for (const y of levels) for (const sign of [-1, 1]) {
    beam([-half, groundY + y, sign * half], [half, groundY + y, sign * half]);
    beam([sign * half, groundY + y, -half], [sign * half, groundY + y, half]);
  }
  for (let i = 0; i < levels.length - 1; i++) {
    const y0 = groundY + levels[i], y1 = groundY + levels[i + 1];
    for (const sign of [-1, 1]) {
      beam([-half, y0, sign * half], [half, y1, sign * half], 0.065);
      beam([half, y0, sign * half], [-half, y1, sign * half], 0.065);
      beam([sign * half, y0, -half], [sign * half, y1, half], 0.065);
      beam([sign * half, y0, half], [sign * half, y1, -half], 0.065);
    }
  }
  // Narrow ladder inside the frame, visible through the open lower bays.
  for (const x of [-0.23, 0.23]) {
    beam([x, groundY + 0.15, half - 0.2], [x, top, half - 0.2], 0.045);
  }
  for (let y = 0.3; y < TOWER_M; y += 0.30) {
    beam([-0.23, groundY + y, half - 0.2], [0.23, groundY + y, half - 0.2], 0.035);
  }
  // Quartered diamonds: red above/below the centre, white on either side.
  // The photos show markers on multiple faces. Four cardinal faces are an
  // approximate layout; their precise compass bearings are not established.
  const side = MARKER_DIAGONAL_M / Math.SQRT2;
  for (let face = 0; face < 4; face++) {
    const markerPart = (g) => {
      g.rotateZ(Math.PI / 4);
      g.translate(0, groundY + 6.30, half + 0.10);
      g.rotateY(face * Math.PI / 2);
      parts.push(g);
    };
    markerPart(box(side, 0.07, side, 0, -side / 2, 0, STEEL));
    // Weathered board backs, kept separate from the painted outer face.
    markerPart(box(side - 0.10, 0.02, side - 0.10,
                   0, -(side - 0.10) / 2, -0.05, 0x9b8967));
    const tile = (side - 0.12) / 2;
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      markerPart(box(tile, 0.025, tile, x * tile / 2,
                       y * tile / 2 - tile / 2, 0.05,
                       x === y ? 0xf13a30 : 0xf0f0e7));
    }
  }
  // Small cylindrical beacon on a corner post, not a room-like box at centre.
  const cylinder = (radius, height, bottom, color) => {
    const g = new THREE.CylinderGeometry(radius, radius, height, 12);
    g.translate(BEACON_X, bottom + height / 2, BEACON_Z);
    parts.push(tint(g, color));
  };
  cylinder(0.12, BEACON_STEM_M, top, STEEL);
  cylinder(0.28, LANTERN_M, top + BEACON_STEM_M, 0x9bb3bd);
  cylinder(0.31, 0.055, top + BEACON_STEM_M, STEEL);
  cylinder(0.31, 0.055, top + BEACON_STEM_M + LANTERN_M - 0.055, STEEL);
  return mergeGeometries(parts, false);
}

// The flash and the visible beacon share the same position.
function lampHeight(groundY) {
  return groundY + TOWER_M + BEACON_STEM_M + LANTERN_M / 2;
}

// sample(lat, lon) -> terrain height, the same one the cabin stands on.
export function buildLighthouse(scene, sample) {
  if (!sample) {
    throw new Error(
      "buildLighthouse: no terrain sampler, so there is no ground to stand the " +
      "tower on. Build it inside the near-terrain promise in main.js, the way " +
      "buildCabin is.");
  }
  const w = toWorld(AT.lat, AT.lon);
  const groundY = sample(AT.lat, AT.lon);

  const group = new THREE.Group();
  group.position.set(w.x, 0, w.z);
  const mesh = new THREE.Mesh(
    towerGeometry(groundY),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4,
                                     side: THREE.DoubleSide }));
  group.add(mesh);

  const lamp = buildLamps([
    { x: BEACON_X, y: lampHeight(groundY), z: BEACON_Z, color: 0xffffff, size: 14 },
  ]);
  group.add(lamp);
  scene.add(group);

  return {
    group,
    // t is the running clock in seconds; night is 0 in full day, 1 after sunset.
    update(t, night) {
      const phase = t % PERIOD_S;
      const lit = phase < ON_S || (phase >= GAP_S && phase < GAP_S + ON_S);
      setLampLevel(lamp, lit ? night : 0);
    },
  };
}
