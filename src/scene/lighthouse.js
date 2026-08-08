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

// 48°58′17″N 123°04′58″W.
const AT = { lat: 48.971389, lon: -123.082778 };

const TOWER_M = 7.62;      // 25 ft
const LEG_SPREAD_M = 2.4;  // footprint at the ground
const LEG_M = 0.16;
const PLATFORM_M = 0.12;
const LANTERN_M = 0.9;

// The light is put where the lantern is, on top of the tower, on ground this
// page already knows the height of. It is not set from the published focal
// height of 9 m, because that is measured above mean high water and everything
// here is metres above MLLW. Standing it on the tower puts it at about 10.6 m
// on our datum, and the two agree to inside the tide range. Driving it from the
// 9 m instead buried the lamp two metres down inside the steelwork.

// Two flashes, this far apart, and then the whole thing again this often.
const PERIOD_S = 5.0;
const GAP_S = 0.5;
const ON_S = 0.25;

const STEEL = 0x8d9299;

function towerGeometry(groundY) {
  const parts = [];
  const half = LEG_SPREAD_M / 2;
  const top = groundY + TOWER_M;
  // Four legs, raked in from the ground to a small platform.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x0 = sx * half, z0 = sz * half;
      const x1 = sx * half * 0.28, z1 = sz * half * 0.28;
      const pos = [];
      const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      // A raked leg as a thin four-sided column.
      for (const [ox, oz] of [[LEG_M, 0], [0, LEG_M], [-LEG_M, 0], [0, -LEG_M]]) {
        const [nx, nz] = [oz, -ox];
        quad([x0 + ox, groundY, z0 + oz], [x1 + ox, top, z1 + oz],
             [x1 + nx, top, z1 + nz], [x0 + nx, groundY, z0 + nz]);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
      g.computeVertexNormals();
      parts.push(tint(g, STEEL));
    }
  }
  // Two rings of bracing, and the platform the lantern stands on.
  for (const f of [0.34, 0.67]) {
    const y = groundY + TOWER_M * f;
    const s = half * (1 - 0.72 * f) * 2;
    parts.push(box(s, LEG_M * 0.7, LEG_M * 0.7, 0, y, s / 2, STEEL));
    parts.push(box(s, LEG_M * 0.7, LEG_M * 0.7, 0, y, -s / 2, STEEL));
    parts.push(box(LEG_M * 0.7, LEG_M * 0.7, s, s / 2, y, 0, STEEL));
    parts.push(box(LEG_M * 0.7, LEG_M * 0.7, s, -s / 2, y, 0, STEEL));
  }
  parts.push(box(1.5, 1.5, PLATFORM_M, 0, top, 0, STEEL));
  // The lantern itself, dark until it fires.
  parts.push(box(0.7, 0.7, LANTERN_M, 0, top + PLATFORM_M, 0, 0x2a2f34));
  return mergeGeometries(parts, false);
}

// Where the lamp sits: the middle of the lantern on top of the tower.
function lampHeight(groundY) {
  return groundY + TOWER_M + PLATFORM_M + LANTERN_M / 2;
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
    { x: 0, y: lampHeight(groundY), z: 0, color: 0xffffff, size: 14 },
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
