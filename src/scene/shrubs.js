// The shrubs and hedges the lidar found standing round the lot, as against the
// forest trees.js scatters by land cover and the crowns it measured.
//
// assets/site/389-shrubs.json holds 59 of them. Fifty seven are out in the 35 m
// buffer round the parcel — the neighbours' hedges and the roadside — and two
// are on the lot. The lot itself is under closed canopy and an aircraft sees the
// top of that and little under it, so the garden at 389 is not in this data and
// is not drawn here.
//
// Each mass carries where it is, the ground under it, how tall it is, and the
// long and short of its own footprint with the bearing its long side runs on. A
// clipped hedge came out 14.7 by 4.5 m on 174 degrees, and drawn as a circle of
// the same area it would run through the fence on one side and leave a gap on
// the other. So each is an oriented mound and not a ball.
//
// Fifty nine of them is nothing, so they are one merged mesh and one draw call,
// always on. No near ring and no far ring.
//
// What the lidar did not measure is species and colour. The greens here are a
// range and none of them is a claim about what is planted.

import * as THREE from "three";
import { fromWorld, toWorld } from "../geo.js";
import { pick, seeded } from "./parts.js";

// Round the mound and up it. Enough that a nine metre shrub does not read as a
// tent, and no more, because there are fifty nine of them.
const SEG = 14;
const RINGS = 5;

// The rim starts under the ground so the ground closes over the bottom wherever
// the mound sits, the way the hedge round the Breakers lot does.
const SINK_FRAC = 0.14;

// A shrub is not an ellipsoid. How far each vertex is pulled in off the smooth
// shape, as a fraction of its own reach.
//
// In and never out. The length, the width and the height are the three things
// the lidar measured, and a lump that pushed a vertex past any of them would be
// drawing a shrub bigger than the one that was found. So the smooth shape is the
// measurement and every lump takes something off it.
const LUMP = 0.17;

// Greens. Not measured — the lidar gives the height and the plan and nothing
// about the leaf. The range is what mixed scrub on this coast looks like from
// far enough off to see a whole shrub at once.
const COLORS = [0x2f4a2b, 0x3a5931, 0x27412a, 0x44623a, 0x2b4d33, 0x40593a];
// The underside of a shrub is in its own shadow. The rim is drawn this much of
// the way to black, which is what stops a green mound reading as a balloon.
const BASE_SHADE = 0.45;

// One mound. Its top is at the height the lidar measured, its rim follows
// whatever the ground is doing under it, and the ground is asked at every
// vertex rather than once at the middle, because the longest of these is nearly
// fifteen metres and the ground here falls sixteen metres in thirty five.
function mound(s, sample, rand, pos, col) {
  const at = toWorld(s.lat, s.lon);
  const b = (s.bearing_deg * Math.PI) / 180;
  // A compass bearing into the world: north is -Z, east is +X.
  const ax = Math.sin(b), az = -Math.cos(b);      // along the long side
  const px = Math.cos(b), pz = Math.sin(b);       // across it
  const half = s.length_m / 2, wide = s.width_m / 2;

  // One lump per vertex of the grid, drawn once so that neighbours share it and
  // the surface stays closed. The last column is the first, so the seam does
  // not show.
  //
  // The top ring is one point and is not lumped. Every vertex in it stands at
  // the same place, so a lump there would only move it up and down and leave a
  // pencil of coincident points at different heights instead of a peak. And the
  // height is the one thing here that was measured, so it is drawn as measured.
  const lump = [new Array(SEG + 1).fill(1)];
  for (let i = 1; i <= RINGS; i++) {
    const row = [];
    for (let j = 0; j < SEG; j++) row.push(1 - rand() * LUMP);
    row.push(row[0]);
    lump.push(row);
  }

  const base = new THREE.Color(pick(COLORS, rand));
  const grid = [];
  for (let i = 0; i <= RINGS; i++) {
    // Down the mound: the top ring is a point, the bottom one is the rim, and
    // the rim is below the ground by SINK_FRAC of the height.
    const t = i / RINGS;
    const a = (t * Math.PI) / 2;
    const reach = Math.sin(a);
    const rise = Math.cos(a) * (1 + SINK_FRAC) - SINK_FRAC;
    const shade = base.clone().multiplyScalar(1 - BASE_SHADE * t * t);
    const row = [];
    for (let j = 0; j <= SEG; j++) {
      const phi = (j / SEG) * Math.PI * 2;
      const k = lump[i][j];
      const u = half * reach * Math.cos(phi) * k;
      const v = wide * reach * Math.sin(phi) * k;
      const x = at.x + ax * u + px * v;
      const z = at.z + az * u + pz * v;
      const { lat, lon } = fromWorld(x, z);
      row.push({ x, y: sample(lat, lon) + rise * s.height_m * k, z, c: shade });
    }
    grid.push(row);
  }

  const push = (p) => {
    pos.push(p.x, p.y, p.z);
    col.push(p.c.r, p.c.g, p.c.b);
  };
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = grid[i][j], b2 = grid[i][j + 1];
      const c = grid[i + 1][j + 1], d = grid[i + 1][j];
      // Wound so the face looks out of the mound. Backwards, the material culls
      // the near side and what is left is the far inside wall, which is a torn
      // green scrap on the ground and looks nothing like a mistake.
      push(a); push(c); push(d);
      // The top ring is one point, so a and b are the same vertex there and the
      // second triangle of the quad has no area.
      if (i > 0) { push(a); push(b2); push(c); }
    }
  }
}

export function buildShrubs(scene, sample, shrubs) {
  if (!shrubs || !Array.isArray(shrubs.shrubs)) {
    throw new Error(
      "buildShrubs: the shrub asset has no shrubs array, so there is nothing to " +
      "stand on the ground. It is written by site/bake-oceanview-lidar.py in " +
      "PointRobertsEngineering, to assets/site/389-shrubs.json.");
  }
  const rand = seeded(20260823);
  const pos = [], col = [];
  for (const s of shrubs.shrubs) {
    if (!(s.length_m > 0) || !(s.width_m > 0) || !(s.height_m > 0)) {
      throw new Error(
        `buildShrubs: a mass at ${s.lat}, ${s.lon} has no size on it — ` +
        `length ${s.length_m}, width ${s.width_m}, height ${s.height_m}. ` +
        `Every mass in assets/site/389-shrubs.json carries all three.`);
    }
    mound(s, sample, rand, pos, col);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 3));
  geom.computeVertexNormals();
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 0 })));
  scene.add(group);
  return { group, shrubs: shrubs.shrubs.length };
}
