// The near ring, walked.
//
// Run:
//     node src/scene/test-trees.mjs
//
// Plain asserts and a non-zero exit, the same as the python tests in server/,
// because the project has no test runner and this does not need one.
//
// A tree keeps its slot in the near ring until it leaves the ring, and only the
// trees crossing the edge are written. That is bookkeeping over two arrays and
// it is invisible when it goes wrong: a tree stands in a slot that is no longer
// drawn, or a slot is written and never uploaded, and what you see is a gap in
// the forest that closes again when you walk on.
//
// So the ring is walked to a position a step at a time and compared against one
// built fresh at that same position, which from empty is nothing but adds. Both
// are then checked against the trees themselves, and against a shadow of what
// the GPU has actually been told.
//
// trees.js imports three, which is not installed — the browser gets it from a
// CDN. Each module is read, its three rewritten to the stub beside this file,
// and handed to node as a data URL.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Scene, Vector3 } from "./test-three-stub.mjs";

// config.js reads the page it was served from. Nothing under test uses it.
globalThis.location = { protocol: "http:", host: "localhost" };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUB = pathToFileURL(path.join(HERE, "test-three-stub.mjs")).href;

const rewritten = new Map();
const rewriting = new Set();

function asDataUrl(file) {
  const abs = path.resolve(file);
  if (rewritten.has(abs)) return rewritten.get(abs);
  if (rewriting.has(abs)) {
    throw new Error(
      `test-trees: ${path.basename(abs)} is part of an import cycle, which the ` +
      `rewrite here cannot express. Break the cycle or load it another way.`);
  }
  rewriting.add(abs);
  const src = fs.readFileSync(abs, "utf8").replace(
    /from\s+"([^"]+)"/g,
    (whole, spec) => {
      if (spec === "three" || spec.startsWith("three/")) return `from "${STUB}"`;
      if (spec.startsWith(".")) {
        return `from "${asDataUrl(path.resolve(path.dirname(abs), spec))}"`;
      }
      throw new Error(
        `test-trees: ${path.basename(abs)} imports "${spec}", which is neither ` +
        `three nor a file beside it, so the test has no way to resolve it.`);
    });
  rewriting.delete(abs);
  const url = "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64");
  rewritten.set(abs, url);
  return url;
}

const { buildTrees } = await import(asDataUrl(path.join(HERE, "trees.js")));

// NEAR_M in trees.js. Not exported, and written out here on purpose: if the
// ring changes size this test should say so rather than follow it.
const NEAR_M = 300;

// A square of forest, alternating deciduous and evergreen so both crown shapes
// are exercised, flat and well above the beach so nothing is turned away.
const CELL_M = 30;
const CELLS = 20;
const ORIGIN = { lat: 48.989009, lon: -123.085318 };
const M_PER_DEG_LAT = 111320;
const COS_LAT = Math.cos(ORIGIN.lat * Math.PI / 180);
const HALF = (CELLS * CELL_M) / 2;
const GROUND_M = 50;

const cover = {
  meta: {
    grid: { nrows: CELLS, ncols: CELLS },
    cell_m: CELL_M,
    box: {
      min_lat: ORIGIN.lat - HALF / M_PER_DEG_LAT,
      max_lat: ORIGIN.lat + HALF / M_PER_DEG_LAT,
      min_lon: ORIGIN.lon - HALF / (M_PER_DEG_LAT * COS_LAT),
      max_lon: ORIGIN.lon + HALF / (M_PER_DEG_LAT * COS_LAT),
    },
  },
  codes: Uint8Array.from({ length: CELLS * CELLS }, (_, i) => (i % 3 ? 42 : 41)),
};

// Crowns first, then trunks: the order Ring adds them, near ring before far.
const CONIFER = 0, BROADLEAF = 1, TRUNKS = 2;

function build() {
  const scene = new Scene();
  const trees = buildTrees(scene, () => GROUND_M, cover, [], null);
  return { trees, near: scene.children.slice(0, 3), far: scene.children.slice(3, 5) };
}

// Where a mesh has put each instance it is drawing.
function placed(mesh) {
  const out = [];
  const a = mesh.instanceMatrix.array;
  for (let s = 0; s < mesh.count; s++) {
    out.push([a[s * 16 + 12], a[s * 16 + 13], a[s * 16 + 14]]);
  }
  return out;
}

// Every slot in use, matrix and colour together, so a crown wearing another
// tree's colour is a difference and not a pair of matching multisets.
function slots(mesh) {
  const out = [];
  for (let s = 0; s < mesh.count; s++) {
    const m = Array.from(mesh.instanceMatrix.array.subarray(s * 16, s * 16 + 16));
    const row = m.map((v) => v.toFixed(3)).join(",");
    const c = mesh.instanceColor
      ? Array.from(mesh.instanceColor.array.subarray(s * 3, s * 3 + 3))
      : [];
    out.push(row + "|" + c.map((v) => v.toFixed(3)).join(","));
  }
  out.sort();
  return out;
}

function render(meshes) { for (const m of meshes) m.render(); }

const NAME = ["conifer crowns", "broadleaf crowns", "trunks"];

function sameRing(walked, fresh, where) {
  for (let i = 0; i < walked.length; i++) {
    const a = slots(walked[i]), b = slots(fresh[i]);
    if (a.length !== b.length) {
      throw new Error(
        `${where}: the ring walked here holds ${a.length} ${NAME[i]} and one ` +
        `built here holds ${b.length}. A tree was dropped or kept when it ` +
        `crossed the edge of the ring.`);
    }
    for (let n = 0; n < a.length; n++) {
      if (a[n] === b[n]) continue;
      throw new Error(
        `${where}: ${NAME[i]} differ from a ring built here, at row ${n} of ` +
        `${a.length}.\n  walked: ${a[n]}\n  fresh:  ${b[n]}`);
    }
  }
}

// Nothing may be drawn out of a slot the GPU was never given.
function allUploaded(meshes, where) {
  for (let i = 0; i < meshes.length; i++) {
    for (const attr of meshes[i].attributes()) {
      const stride = attr.itemSize;
      for (let s = 0; s < meshes[i].count * stride; s++) {
        if (attr.array[s] === attr.shadow[s]) continue;
        throw new Error(
          `${where}: ${NAME[i]} slot ${Math.floor(s / stride)} was written and ` +
          `left out of every update range, so the GPU still holds ` +
          `${attr.shadow[s]} where the ring says ${attr.array[s]}.`);
      }
    }
  }
}

// The trees themselves, out of the far ring, which holds every one of them and
// is written once. A scattered tree's crown sits at its own foot, so the far
// matrix carries the position the near ring should be cutting on.
function everyTree(far) {
  return far.flatMap(placed);
}

function ringShouldHold(all, at) {
  return all.filter(([x, y, z]) => {
    const dx = x - at.x, dy = y - at.y, dz = z - at.z;
    return dx * dx + dy * dy + dz * dz < NEAR_M * NEAR_M;
  }).length;
}

function holdsTheRightTrees(near, all, at, where) {
  const want = ringShouldHold(all, at);
  const held = near[TRUNKS].count;
  if (held !== want) {
    throw new Error(
      `${where}: the ring holds ${held} trees and ${want} stand within ` +
      `${NEAR_M} m of it.`);
  }
  const crowns = near[CONIFER].count + near[BROADLEAF].count;
  if (crowns !== held) {
    throw new Error(`${where}: ${crowns} crowns standing over ${held} trunks.`);
  }
  for (const [x, y, z] of placed(near[TRUNKS])) {
    const dx = x - at.x, dy = y - at.y, dz = z - at.z;
    const d = Math.hypot(dx, dy, dz);
    if (d >= NEAR_M) {
      throw new Error(
        `${where}: a trunk is being drawn at (${x.toFixed(0)}, ${z.toFixed(0)}), ` +
        `${d.toFixed(0)} m out, past the ${NEAR_M} m the near ring reaches.`);
    }
  }
}

// Twenty one metres a step, over the twenty that triggers a rebuild, so every
// step rewrites. Then a jump clear across the tile, a return to ground it has
// already covered, and a step that does not move at all.
function walk() {
  const path = [];
  for (let i = 0; i < 20; i++) path.push([-250 + i * 21, -250 + i * 13]);
  path.push([250, -250]);
  path.push([-250, -250]);
  path.push([-250, -250]);
  for (let i = 0; i < 8; i++) path.push([-250 + i * 45, 100]);
  return path;
}

// CLEAR_OF_CAMERA_M in trees.js. The measured trees inside it stand in the
// opening view and are held out of the near ring until something asks for them.
const CLEAR_OF_CAMERA_M = 25;

const asLat = (m) => m / M_PER_DEG_LAT;
const asLon = (m) => m / (M_PER_DEG_LAT * COS_LAT);

// A handful of lidar trees, some of them standing in the view and some not.
function measuredTrees() {
  const out = [];
  for (const north of [8, 14, 21, 60, 90]) {
    out.push({
      lat: ORIGIN.lat + asLat(north), lon: ORIGIN.lon,
      ground_m: GROUND_M, height_m: 28, radius_m: 3.5, crown_base_frac: 0.5,
    });
  }
  return {
    trees: out,
    outline: [
      [ORIGIN.lat - asLat(120), ORIGIN.lon - asLon(120)],
      [ORIGIN.lat - asLat(120), ORIGIN.lon + asLon(120)],
      [ORIGIN.lat + asLat(120), ORIGIN.lon + asLon(120)],
      [ORIGIN.lat + asLat(120), ORIGIN.lon - asLon(120)],
    ],
  };
}

// The trees standing in the opening view: out by default, in when asked for,
// and out again after.
function testHomeTrees() {
  const scene = new Scene();
  const t = buildTrees(scene, () => GROUND_M, cover, [], measuredTrees());
  const near = scene.children.slice(0, 3);
  const at = new Vector3(0, GROUND_M + 1.6, 0);

  // A measured tree is 28 m tall with a 3.5 m crown; nothing scattered here is.
  const lidar = (mesh) => placed(mesh).filter(([x, y, z]) =>
    Math.hypot(x, z) < CLEAR_OF_CAMERA_M && Math.abs(y - GROUND_M) < 0.01).length;

  const look = (show, want, where) => {
    t.homeTrees(show);
    t.update({ position: at });
    render(near);
    const held = lidar(near[TRUNKS]);
    if (held !== want) {
      throw new Error(
        `${where}: ${held} measured trees inside ${CLEAR_OF_CAMERA_M} m are being ` +
        `drawn, and ${want} should be.`);
    }
  };

  look(false, 0, "with the opening view clear");
  look(true, 3, "with the trees asked for");
  look(false, 0, "with them put away again");
  console.log("ok   the trees in the opening view come and go on asking");
}

function main() {
  testHomeTrees();
  const walked = build();
  const all = everyTree(walked.far);
  if (all.length !== walked.trees.trees) {
    throw new Error(
      `test-trees: the far ring holds ${all.length} trees and buildTrees ` +
      `reports ${walked.trees.trees}. The test is reading the wrong meshes.`);
  }

  let held = 0;
  const path = walk();
  for (let step = 0; step < path.length; step++) {
    const [x, z] = path[step];
    const at = new Vector3(x, GROUND_M + 10, z);
    const where = `step ${step + 1} at (${x}, ${z})`;

    walked.trees.update({ position: at });
    render(walked.near);

    const fresh = build();
    fresh.trees.update({ position: at });
    render(fresh.near);

    allUploaded(walked.near, where);
    sameRing(walked.near, fresh.near, where);
    holdsTheRightTrees(walked.near, all, at, where);
    held = Math.max(held, walked.near[TRUNKS].count);
  }

  console.log(`ok   ${all.length} trees on the tile, ${path.length} camera ` +
              `positions, up to ${held} of them in the near ring`);
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(`FAIL ${err.message}`);
  process.exit(1);
}
