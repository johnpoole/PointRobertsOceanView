// The terrace wall, measured back off the vertices.
//
// Run:
//     node src/scene/test-terraces.mjs
//
// Plain asserts and a non-zero exit, the same as test-shrubs.mjs beside it,
// because the project has no test runner and this does not need one.
//
// A wall is easy to draw wrong in ways that still look like a wall. Courses that
// are not 200 mm. A stack that leans out over the beach instead of back into the
// bank. A wall that floats over the foot the lidar found, or is buried under it.
// A course count that does not match what the bake counted. Each of those is a
// grey band on a screen and none of them announces itself.

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Scene } from "./test-three-stub.mjs";

globalThis.location = { protocol: "http:", host: "localhost" };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUB = pathToFileURL(path.join(HERE, "test-three-stub.mjs")).href;
const rewritten = new Map();

function asDataUrl(file) {
  const abs = path.resolve(file);
  if (rewritten.has(abs)) return rewritten.get(abs);
  const src = fs.readFileSync(abs, "utf8").replace(
    /from\s+"([^"]+)"/g,
    (whole, spec) => {
      if (spec === "three" || spec.startsWith("three/")) return `from "${STUB}"`;
      if (spec.startsWith(".")) {
        return `from "${asDataUrl(path.resolve(path.dirname(abs), spec))}"`;
      }
      throw new Error(
        `test-terraces: ${path.basename(abs)} imports "${spec}", which is ` +
        `neither three nor a file beside it.`);
    });
  const url = "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64");
  rewritten.set(abs, url);
  return url;
}

const { buildTerraces } = await import(asDataUrl(path.join(HERE, "terraces.js")));

// The position buffer is Float32, so a metre carries about a ten-thousandth of
// a millimetre of slop.
const SLOP = 1e-4;
const ORIGIN = { lat: 48.989009, lon: -123.085318 };
const M_PER_DEG_LAT = 111320;
const COS_LAT = Math.cos((ORIGIN.lat * Math.PI) / 180);

function world(lat, lon) {
  return {
    x: (lon - ORIGIN.lon) * M_PER_DEG_LAT * COS_LAT,
    z: -(lat - ORIGIN.lat) * M_PER_DEG_LAT,
  };
}

function build(asset) {
  const scene = new Scene();
  const out = buildTerraces(scene, asset);
  assert.equal(scene.children.length, 1, "one group goes into the scene");
  const geom = scene.children[0].children[0].geometry;
  const pos = geom.attributes.position.array;
  assert.equal(geom.attributes.color.array.length, pos.length, "a colour per vertex");
  const v = [];
  for (let i = 0; i < pos.length; i += 3) {
    v.push({ x: pos[i], y: pos[i + 1], z: pos[i + 2] });
  }
  return { out, v };
}

const BLOCK = { height_m: 0.2, face_m: 0.4, setback_m: 0.06 };

// Two stations a metre apart, six courses over a metre of concrete, on flat
// ground. Everything about the wall read back off the triangles.
{
  const foot = 4.2, conc = 1.0, courses = 6;
  const a = { lat: ORIGIN.lat, lon: ORIGIN.lon, foot_m: foot, top_m: foot + 2.2,
              concrete_m: conc, courses, bank_above_m: 0 };
  const b = { ...a, lat: ORIGIN.lat - 1 / M_PER_DEG_LAT };
  const { out, v } = build({ block: BLOCK, stations: [a, b] });
  assert.equal(out.stations, 2);
  assert.ok(out.blocks > 0, "some block got laid");

  const ys = v.map((p) => p.y);
  const top = Math.max(...ys), bot = Math.min(...ys);
  // The top of the wall is the concrete plus the courses, and nothing stands
  // over it. Six courses of 200 mm on a metre of concrete over a 4.2 m foot.
  const want = foot + conc + courses * BLOCK.height_m;
  assert.ok(Math.abs(top - want) < BLOCK.height_m,
    `the wall tops out at ${top.toFixed(3)}, and ${courses} courses of ` +
    `${BLOCK.height_m} m over ${conc} m of concrete on a ${foot} m foot is ${want}`);
  // And it is sunk, so the shingle closes over the footing.
  assert.ok(bot < foot - 0.4 + SLOP && bot > foot - 0.6,
    `the footing is at ${bot.toFixed(2)} and the foot of the wall is ${foot}`);

  // It leans back into the bank as it climbs, never out over the beach. Inland
  // is east, which is +x.
  const lo = v.filter((p) => p.y < foot + conc + 0.3);
  const hi = v.filter((p) => p.y > foot + conc + (courses - 1) * BLOCK.height_m);
  const loW = Math.min(...lo.map((p) => p.x));
  const hiW = Math.min(...hi.map((p) => p.x));
  assert.ok(hiW > loW,
    `the top course starts at x ${hiW.toFixed(2)} and the bottom at ` +
    `${loW.toFixed(2)}: the stack leans out over the beach, not into the bank`);
  const lean = hiW - loW;
  assert.ok(Math.abs(lean - (courses - 1) * BLOCK.setback_m) < 0.12,
    `it leaned back ${lean.toFixed(3)} m over ${courses} courses, and ` +
    `${BLOCK.setback_m} m a course is ${((courses - 1) * BLOCK.setback_m).toFixed(3)}`);

  // The courses are courses. Every vertex sits on a course boundary or the top
  // of one, so the distinct heights above the concrete are multiples of 200 mm.
  const base = foot + conc;
  const above = [...new Set(ys.filter((y) => y > base + SLOP)
    .map((y) => Math.round(((y - base) / BLOCK.height_m) * 100) / 100))];
  for (const k of above) {
    const off = Math.abs(k - Math.round(k));
    assert.ok(off < 0.1,
      `a course edge sits ${k.toFixed(3)} courses up, which is not a course`);
  }
}

// The wall stands on the line the lidar found, not beside it.
{
  const a = { lat: ORIGIN.lat, lon: ORIGIN.lon, foot_m: 4.2, top_m: 6.4,
              concrete_m: 1.0, courses: 6, bank_above_m: 0 };
  const b = { ...a, lat: ORIGIN.lat - 1 / M_PER_DEG_LAT };
  const { v } = build({ block: BLOCK, stations: [a, b] });
  const at = world(a.lat, a.lon);
  const west = Math.min(...v.map((p) => p.x));
  assert.ok(Math.abs(west - at.x) < 0.1,
    `the wall's face is at x ${west.toFixed(2)} and the station the lidar ` +
    `found is at ${at.x.toFixed(2)}`);
  const zs = v.map((p) => p.z);
  assert.ok(Math.min(...zs) > world(a.lat, a.lon).z - 0.1
            && Math.max(...zs) < world(b.lat, b.lon).z + 0.1,
    "the wall runs between its two stations and no further");
}

// A station with no courses is concrete and nothing else. The north end of this
// frontage runs down to a 21 cm lip.
{
  const a = { lat: ORIGIN.lat, lon: ORIGIN.lon, foot_m: 4.0, top_m: 4.21,
              concrete_m: 0.21, courses: 0, bank_above_m: 0 };
  const b = { ...a, lat: ORIGIN.lat - 1 / M_PER_DEG_LAT };
  const { out, v } = build({ block: BLOCK, stations: [a, b] });
  assert.equal(out.blocks, 0, "no courses asked for, so no block laid");
  assert.ok(Math.max(...v.map((p) => p.y)) < 4.0 + 0.21 + SLOP,
    "and nothing stands over the concrete");
}

// The real asset: every station drawn, and the wall where the lidar put it.
{
  const file = path.join(HERE, "..", "..", "assets", "site", "389-terraces.json");
  const asset = JSON.parse(fs.readFileSync(file, "utf8"));
  const { out, v } = build(asset);
  assert.equal(out.stations, asset.stations.length);
  const foots = asset.stations.map((s) => s.foot_m);
  const ys = v.map((p) => p.y);
  assert.ok(Math.min(...ys) > Math.min(...foots) - 0.7,
    "nothing is buried far under the foot the lidar found");
  const tops = asset.stations.map(
    (s) => s.foot_m + s.concrete_m + s.courses * asset.block.height_m);
  assert.ok(Math.max(...ys) < Math.max(...tops) + SLOP,
    `the wall reaches ${Math.max(...ys).toFixed(2)} m and the tallest station ` +
    `is ${Math.max(...tops).toFixed(2)}`);
  console.log(`  the asset: ${asset.stations.length} stations, ${out.blocks} blocks, ` +
    `foot ${Math.min(...foots).toFixed(2)}..${Math.max(...foots).toFixed(2)} m, ` +
    `top ${Math.max(...tops).toFixed(2)} m MLLW`);
}

// A missing or malformed asset says so rather than drawing nothing.
{
  assert.throws(() => buildTerraces(new Scene(), null), /no stations array/);
  assert.throws(() => buildTerraces(new Scene(), {}), /no stations array/);
  assert.throws(() => buildTerraces(new Scene(), { stations: [] }), /no block size/);
  assert.throws(
    () => buildTerraces(new Scene(), {
      block: BLOCK,
      stations: [{ lat: 48.99, lon: -123.08, concrete_m: 1, courses: 2 },
                 { lat: 48.99, lon: -123.08, concrete_m: 1, courses: 2 }],
    }),
    /no wall on it/);
}

console.log("terraces: ok");
