// The block terraces along the seaward edge of the lot: a poured concrete
// seawall standing out of the shingle, and segmented block laid in courses on
// top of it, each course stepped back from the one below.
//
// assets/site/389-terraces.json holds 34 stations over 16 m of frontage. The
// line they stand on and the height they hold are the lidar's — the flat above
// the wall and the flat below it are both in the point cloud, and where the
// ground turns up between them is where the wall is. The wall face itself is
// not and never will be: a flight looks down and a riser is vertical.
//
// The block is 200 mm on the course and 400 on the face, counted off the
// photographs against a loose one lying on the concrete. The courses come out
// of the bake, from what the ground climbs.
//
// It is drawn unbroken along the frontage. The photographs show it broken
// through in places and a stair cut down through it, and neither is here.

import * as THREE from "three";
import { toWorld } from "../geo.js";
import { pick, seeded } from "./parts.js";

// Concrete that has stood in salt water since somebody poured it.
const CONCRETE = [0x9a978d, 0x918e84, 0xa39f95, 0x8b8880];
// The block is a grey aggregate, and the courses do not all weather alike.
const BLOCK = [0x8d9088, 0x969890, 0x848780, 0x9ba096, 0x8a8d86];
// The joint between one block and the next, and between one course and the
// next. Drawn as a gap rather than a line, so the coursing reads at a distance.
const JOINT_M = 0.012;

export function buildTerraces(scene, terraces) {
  if (!terraces || !Array.isArray(terraces.stations)) {
    throw new Error(
      "buildTerraces: the terrace asset has no stations array, so there is no " +
      "line to stand a wall on. It is written by site/bake-oceanview-lidar.py " +
      "in PointRobertsEngineering, to assets/site/389-terraces.json.");
  }
  const block = terraces.block;
  if (!block || !(block.height_m > 0) || !(block.face_m > 0)) {
    throw new Error(
      "buildTerraces: the terrace asset carries no block size, so a course has " +
      `no height. Got ${JSON.stringify(block)} in assets/site/389-terraces.json.`);
  }

  const rand = seeded(20260824);
  const pos = [], col = [];
  const push = (x, y, z, c) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); };
  // A box, given its two opposite corners in world.
  const boxAt = (x0, y0, z0, x1, y1, z1, color) => {
    const c = new THREE.Color(color);
    const p = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
               [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    // Only the faces that can be seen: the west face, the top, and the two ends.
    // The east face is buried in the bank and the bottom is in the ground.
    const faces = [[0, 3, 2, 1], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
    for (const [a, b2, d, e] of faces) {
      push(...p[a], c); push(...p[b2], c); push(...p[d], c);
      push(...p[a], c); push(...p[d], c); push(...p[e], c);
    }
  };

  const st = terraces.stations;
  for (const s of st) {
    if (!(s.foot_m > 0) || !(s.concrete_m >= 0) || !(s.courses >= 0)) {
      throw new Error(
        `buildTerraces: a station at ${s.lat}, ${s.lon} has no wall on it — ` +
        `foot ${s.foot_m}, concrete ${s.concrete_m}, courses ${s.courses}. ` +
        `Every station in assets/site/389-terraces.json carries all three.`);
    }
  }

  // The stations as one run, with the distance along it to each. The courses are
  // laid along the whole run and not station by station: a station is half a
  // metre and a block is four hundred, so laying them inside a station leaves
  // every second course with nowhere to go and the bond never breaks joint.
  const line = st.map((s) => {
    const w = toWorld(s.lat, s.lon);
    return { x: w.x, z: w.z, s };
  });
  const arc = [0];
  for (let i = 1; i < line.length; i++) {
    arc.push(arc[i - 1] + Math.hypot(line[i].x - line[i - 1].x,
                                     line[i].z - line[i - 1].z));
  }
  const total = arc[arc.length - 1];

  // Where the run has got to at distance t, and which way inland is there.
  // Inland is east, which is the way the bake walked to find the foot.
  const at = (t) => {
    let i = 1;
    while (i < arc.length - 1 && arc[i] < t) i++;
    const a = line[i - 1], b = line[i];
    const span = arc[i] - arc[i - 1] || 1;
    const f = Math.min(1, Math.max(0, (t - arc[i - 1]) / span));
    let dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    let nx = -dz, nz = dx;
    if (nx < 0) { nx = -nx; nz = -nz; }
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f,
             nx, nz, s: f < 0.5 ? a.s : b.s };
  };

  // The concrete, sunk half a metre so the shingle closes over its footing. Cut
  // into short lengths along the run and swept the same way the block is: an
  // axis-aligned box between two stations whose x differs by a couple of metres
  // is a couple of metres of concrete, which is a bunker and not a seawall.
  const CONC_M = 0.9;
  const CONC_T = 0.35;
  for (let t = 0; t + CONC_M <= total; t += CONC_M) {
    const p = at(t + CONC_M / 2);
    if (p.s.concrete_m <= 0) continue;
    const a = at(t), b = at(t + CONC_M);
    const ax = a.x, az = a.z;
    const bx = b.x + p.nx * CONC_T, bz = b.z + p.nz * CONC_T;
    boxAt(Math.min(ax, bx), p.s.foot_m - 0.5, Math.min(az, bz),
          Math.max(ax, bx), p.s.foot_m + p.s.concrete_m, Math.max(az, bz),
          pick(CONCRETE, rand));
  }

  // The block, course by course, each stepped back off the one under it and
  // every other course started half a block along so the joints break.
  let laid = 0;
  const most = Math.max(0, ...st.map((s) => s.courses));
  for (let k = 0; k < most; k++) {
    for (let t = (k % 2) * block.face_m * 0.5;
         t + block.face_m <= total; t += block.face_m) {
      const p = at(t + block.face_m / 2);
      if (p.s.courses <= k) continue;
      const back = k * block.setback_m + 0.05;
      const y = p.s.foot_m + p.s.concrete_m + k * block.height_m;
      const a = at(t), b = at(t + block.face_m - JOINT_M);
      const ax = a.x + p.nx * back, az = a.z + p.nz * back;
      const bx = b.x + p.nx * (back + 0.30), bz = b.z + p.nz * (back + 0.30);
      boxAt(Math.min(ax, bx), y, Math.min(az, bz),
            Math.max(ax, bx), y + block.height_m - JOINT_M, Math.max(az, bz),
            pick(BLOCK, rand));
      laid++;
    }
  }
  const courses = laid;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 3));
  geom.computeVertexNormals();
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide })));
  scene.add(group);
  return { group, stations: st.length, blocks: courses };
}
