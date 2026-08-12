// What is lying on the beach. Rounded stone and driftwood, scattered over the
// foreshore below the vegetation line.
//
// The terrain grid is 3 m cells, so the beach comes out of it as a smooth ramp
// and reads as sand. It is not sand. It is shingle with cobbles standing proud
// of it and logs thrown up the slope, and none of that is in a heightmap at
// this resolution. So it is put on top.
//
// Where things sit is not random. Stone gathers where the ground tilts: the
// steep toe under the bluff, the lip where the berm drops to the tide flat. The
// flats stay sand and stay bare, so slope is the whole of what decides it.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toWorld } from "../geo.js";

// The band worth dressing, metres above MLLW. Below the bottom of it the ocean
// plane covers everything at any tide we see; above the top the grass starts.
const BEACH_LOW_M = -0.8;
const BEACH_HIGH_M = 5.0;

// How much tilt counts as a slope. Rise over run, so 0.06 is about three and a
// half degrees, which is the beach itself, and the toe of the bluff is far
// steeper than that.
const SLOPE_FLAT = 0.05;
const SLOPE_STEEP = 0.30;

// Where to look. The beach in front of the bluff and a good way either side of
// it, which is all of it that is ever in view.
// Seven hundred metres either side of the house, which is the beach that is
// ever in the frame. Spread over the whole tile the same stones would be too
// thin to notice anywhere.
const REACH_M = 700;
const ATTEMPTS = 260000;
const MAX_STONES = 4200;
const MAX_LOGS = 190;

// Cobbles run from gravel you would not notice to boulders at the bluff toe.
const STONE_MIN_M = 0.18;
const STONE_MAX_M = 0.85;
// Boulders only where it is steep, because that is where they come from.
const BOULDER_SLOPE = 0.22;

const LOG_MIN_M = 2.0;
const LOG_MAX_M = 7.5;
const LOG_RADIUS_M = 0.18;

const STONE_COLORS = [0x6e6a63, 0x837c70, 0x585951, 0x948c7e, 0x4f4e49, 0xa39a89];
const WOOD_COLORS = [0x8a7a63, 0x9c8b72, 0x6f6250, 0xb0a084];

// One repeatable stream, so the beach is the same beach on every reload rather
// than a fresh scatter each time the page opens.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Rise over run, from the heights either side. The sampler works in degrees, so
// the step is converted at this latitude.
function slopeAt(sample, lat, lon, stepM) {
  const dLat = stepM / 111320;
  const dLon = stepM / (111320 * Math.cos((lat * Math.PI) / 180));
  const north = sample(lat + dLat, lon);
  const south = sample(lat - dLat, lon);
  const east = sample(lat, lon + dLon);
  const west = sample(lat, lon - dLon);
  return Math.hypot((north - south) / (2 * stepM), (east - west) / (2 * stepM));
}

function stoneGeometry(radius, rand) {
  // An icosahedron squashed flat is a cobble. A sphere is a marble.
  const g = new THREE.IcosahedronGeometry(radius, 0);
  g.scale(1 + rand() * 0.5, 0.55 + rand() * 0.3, 1 + rand() * 0.5);
  g.rotateY(rand() * Math.PI * 2);
  g.rotateX((rand() - 0.5) * 0.5);
  return g;
}

function logGeometry(length, rand) {
  const r = LOG_RADIUS_M * (0.6 + rand() * 0.9);
  const g = new THREE.CylinderGeometry(r * 0.75, r, length, 7);
  g.rotateZ(Math.PI / 2);              // lying down, along X
  g.rotateY(rand() * Math.PI * 2);     // then thrown at whatever angle
  g.rotateX((rand() - 0.5) * 0.25);
  return g;
}

// The rocks the lidar found on the foreshore west of 389, as against the shingle
// scattered by rule. Position, plan size and how far each stands over the ground
// around it are all measured; the shape is the same cobble the rest of the beach
// uses, scaled up. Bedded so the measured height is what shows.
//
// They are not tide-aware. The flight was at about a 1.8 m tide and these are
// what stood out of the water that day, so at a lower tide there will be rock on
// this beach that is not drawn. See assets/site/389-boulders.json.
function measuredBoulders(boulders, rand, push) {
  if (!boulders) return 0;
  if (!Array.isArray(boulders.boulders)) {
    throw new Error(
      "buildBeach: the boulder asset has no boulders array. It is written by " +
      "site/bake-oceanview-lidar.py in PointRobertsEngineering.");
  }
  let n = 0;
  for (const b of boulders.boulders) {
    const w = toWorld(b.lat, b.lon, b.base_m);
    const g = new THREE.IcosahedronGeometry(1, 0);
    g.scale(b.radius_m * (0.85 + rand() * 0.3), b.stands_m,
            b.radius_m * (0.85 + rand() * 0.3));
    g.rotateY(rand() * Math.PI * 2);
    g.rotateX((rand() - 0.5) * 0.3);
    // Centre on the ground, so half is buried and it stands its measured height.
    g.translate(w.x, w.y, w.z);
    push(STONE_COLORS, n % STONE_COLORS.length, g);
    n++;
  }
  return n;
}

// sample(lat, lon) -> metres above MLLW, the near tile's own sampler.
export function buildBeach(scene, sample, origin, boulders) {
  const rand = seeded(20260806);
  const dLatMax = REACH_M / 111320;
  const dLonMax = REACH_M / (111320 * Math.cos((origin.lat * Math.PI) / 180));

  const byColor = new Map();          // colour -> geometry list
  const push = (palette, index, geom) => {
    const key = palette[index];
    if (!byColor.has(key)) byColor.set(key, []);
    byColor.get(key).push(geom);
  };

  let stones = 0;
  let logs = 0;
  for (let n = 0; n < ATTEMPTS && (stones < MAX_STONES || logs < MAX_LOGS); n++) {
    const lat = origin.lat + (rand() * 2 - 1) * dLatMax;
    const lon = origin.lon + (rand() * 2 - 1) * dLonMax;
    const elev = sample(lat, lon);
    if (elev < BEACH_LOW_M || elev > BEACH_HIGH_M) continue;

    const slope = slopeAt(sample, lat, lon, 4);
    if (slope <= SLOPE_FLAT) continue;   // the flats are sand and stay bare
    const tilt = Math.min((slope - SLOPE_FLAT) / (SLOPE_STEEP - SLOPE_FLAT), 1);
    if (rand() > tilt) continue;

    const w = toWorld(lat, lon, elev);
    if (rand() < 0.965) {
      if (stones >= MAX_STONES) continue;
      // Big ones only on the steep, where they have fallen from.
      const big = slope > BOULDER_SLOPE ? rand() : rand() * rand();
      const radius = STONE_MIN_M + (STONE_MAX_M - STONE_MIN_M) * big;
      const g = stoneGeometry(radius, rand);
      // Bedded in rather than balanced on top.
      g.translate(w.x, w.y + radius * 0.22, w.z);
      push(STONE_COLORS, (n + stones) % STONE_COLORS.length, g);
      stones++;
    } else {
      if (logs >= MAX_LOGS) continue;
      const length = LOG_MIN_M + (LOG_MAX_M - LOG_MIN_M) * rand() * rand();
      const g = logGeometry(length, rand);
      g.translate(w.x, w.y + LOG_RADIUS_M * 0.7, w.z);
      push(WOOD_COLORS, logs % WOOD_COLORS.length, g);
      logs++;
    }
  }

  const rocks = measuredBoulders(boulders, rand, push);

  // One mesh per colour: a handful of draw calls for a few thousand stones.
  for (const [color, geoms] of byColor) {
    if (!geoms.length) continue;
    const mesh = new THREE.Mesh(
      mergeGeometries(geoms, false),
      new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0 }));
    mesh.castShadow = false;
    scene.add(mesh);
  }
  return { stones, logs, boulders: rocks };
}
