// The mounds, measured back off the vertices.
//
// Run:
//     node src/scene/test-shrubs.mjs
//
// Plain asserts and a non-zero exit, the same as test-trees.mjs beside it,
// because the project has no test runner and this does not need one.
//
// What can go wrong here is silent. A mound drawn round when the lidar measured
// a hedge, a bearing turned the wrong way, a mound floating over a slope or
// buried in it — every one of those is a green lump on a screen and looks like a
// shrub. So the geometry is read back and measured: how long it is along the
// bearing it was given, how wide across it, how tall over the ground it was put
// on, and whether its rim follows ground that falls.
//
// shrubs.js imports three, which is not installed — the browser gets it from a
// CDN. Each module is read, its three rewritten to the stub beside this file,
// and handed to node as a data URL.

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Scene } from "./test-three-stub.mjs";

// config.js reads the page it was served from. Nothing under test uses it.
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
        `test-shrubs: ${path.basename(abs)} imports "${spec}", which is neither ` +
        `three nor a file beside it, so the test has no way to resolve it.`);
    });
  const url = "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64");
  rewritten.set(abs, url);
  return url;
}

const { buildShrubs } = await import(asDataUrl(path.join(HERE, "shrubs.js")));

// LUMP, SINK_FRAC, SEG and RINGS in shrubs.js. Not exported, and written out
// here on purpose: if the mound changes shape this test should say so rather
// than follow it.
// The lump only ever pulls a vertex in, never out, so the measured length,
// width and height are the mound's bounds and not its middle.
const LUMP = 0.17;
const SINK_FRAC = 0.14;
const SEG = 14;
const RINGS = 5;
// Two triangles to a quad, except round the top ring where the quad is a
// triangle because its upper edge is the one apex vertex.
const VERTS_PER_MOUND = (RINGS * SEG * 2 - SEG) * 3;
// The rim is sampled at SEG angles and none of them lands on the short axis, so
// the widest sample falls a little inside the true width.
const OFF_AXIS = 1 - Math.cos(Math.PI / SEG);
// The position buffer is Float32, so a metre carries about a ten-thousandth of
// a millimetre of slop. Anything tighter than this is testing the float and not
// the mound.
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

function build(masses, sample) {
  const scene = new Scene();
  const out = buildShrubs(scene, sample, { shrubs: masses });
  assert.equal(scene.children.length, 1, "one group goes into the scene");
  const geom = scene.children[0].children[0].geometry;
  const pos = geom.attributes.position.array;
  assert.equal(geom.attributes.color.array.length, pos.length,
    "one colour per vertex");
  const v = [];
  for (let i = 0; i < pos.length; i += 3) v.push({ x: pos[i], y: pos[i + 1], z: pos[i + 2] });
  return { out, v };
}

const flat = (h) => () => h;

// One mound, on flat ground, measured back.
{
  const GROUND = 12.5;
  for (const [bearing, label] of [[0, "north"], [90, "east"], [174, "the hedge's"],
                                  [45, "north east"]]) {
    const m = {
      lat: ORIGIN.lat, lon: ORIGIN.lon, ground_m: GROUND,
      height_m: 1.86, top_m: 2.49, area_m2: 28.4, radius_m: 3.0,
      length_m: 14.7, width_m: 4.5, bearing_deg: bearing,
    };
    const { out, v } = build([m], flat(GROUND));
    assert.equal(out.shrubs, 1);
    assert.equal(v.length, VERTS_PER_MOUND,
      `${VERTS_PER_MOUND} vertices to a mound`);

    const at = world(m.lat, m.lon);
    const b = (bearing * Math.PI) / 180;
    const ax = Math.sin(b), az = -Math.cos(b);
    const px = Math.cos(b), pz = Math.sin(b);
    let alo = Infinity, ahi = -Infinity, clo = Infinity, chi = -Infinity;
    let ylo = Infinity, yhi = -Infinity;
    for (const p of v) {
      const dx = p.x - at.x, dz = p.z - at.z;
      const a = dx * ax + dz * az, c = dx * px + dz * pz;
      alo = Math.min(alo, a); ahi = Math.max(ahi, a);
      clo = Math.min(clo, c); chi = Math.max(chi, c);
      ylo = Math.min(ylo, p.y); yhi = Math.max(yhi, p.y);
    }

    // Along the bearing it is as long as it was measured, across it as wide,
    // and the lump is the only thing between the two numbers.
    const long = ahi - alo, wide = chi - clo;
    assert.ok(long > m.length_m * (1 - LUMP) && long < m.length_m + SLOP,
      `${label}: ran ${long.toFixed(2)} m along the bearing, measured ${m.length_m}`);
    assert.ok(wide > m.width_m * (1 - LUMP - OFF_AXIS) && wide < m.width_m + SLOP,
      `${label}: ran ${wide.toFixed(2)} m across it, measured ${m.width_m}`);
    // And the long way really is the bearing, not the other axis.
    assert.ok(long > wide * 2,
      `${label}: a 14.7 by 4.5 m hedge came out ${long.toFixed(1)} by ${wide.toFixed(1)}`);

    // The top stands at the measured height over the ground, and the rim is
    // under it, so the ground closes over the bottom.
    assert.ok(Math.abs(yhi - (GROUND + m.height_m)) < SLOP,
      `${label}: top at ${yhi.toFixed(4)}, and the lidar measured ` +
      `${m.height_m} m over ground ${GROUND}`);
    assert.ok(ylo < GROUND,
      `${label}: rim at ${ylo.toFixed(2)} is not under ground ${GROUND}`);
    assert.ok(ylo > GROUND - m.height_m * SINK_FRAC - SLOP,
      `${label}: rim at ${ylo.toFixed(2)} is buried, not sunk`);
  }
}

// Every face looks out of the mound. Wound the other way the material culls the
// near side and leaves the far inside wall showing, which draws as a torn green
// scrap lying on the ground — a thing that looks like scrub from a distance and
// is not a mound at all.
{
  const GROUND = 10;
  const m = {
    lat: ORIGIN.lat, lon: ORIGIN.lon, ground_m: GROUND, height_m: 2.0,
    top_m: 2.0, area_m2: 20, radius_m: 2.5,
    length_m: 8, width_m: 4, bearing_deg: 0,
  };
  const { v } = build([m], flat(GROUND));
  const at = world(m.lat, m.lon);
  let out = 0, inward = 0;
  for (let i = 0; i < v.length; i += 3) {
    const a = v[i], b = v[i + 1], c = v[i + 2];
    const u = [b.x - a.x, b.y - a.y, b.z - a.z];
    const w = [c.x - a.x, c.y - a.y, c.z - a.z];
    const n = [u[1] * w[2] - u[2] * w[1],
               u[2] * w[0] - u[0] * w[2],
               u[0] * w[1] - u[1] * w[0]];
    // From the middle of the mound out to the middle of the face.
    const d = [(a.x + b.x + c.x) / 3 - at.x,
               (a.y + b.y + c.y) / 3 - GROUND,
               (a.z + b.z + c.z) / 3 - at.z];
    if (n[0] * d[0] + n[1] * d[1] + n[2] * d[2] > 0) out++; else inward++;
  }
  assert.equal(inward, 0,
    `${inward} of ${out + inward} faces point into the mound instead of out`);
}

// A round one stays round. The hedge above would pass a test that only ever
// looked at the long axis.
{
  const GROUND = 8;
  const m = {
    lat: ORIGIN.lat, lon: ORIGIN.lon, ground_m: GROUND, height_m: 1.31,
    top_m: 2.13, area_m2: 13.8, radius_m: 2.1,
    length_m: 5.4, width_m: 4.6, bearing_deg: 2,
  };
  const { v } = build([m], flat(GROUND));
  const at = world(m.lat, m.lon);
  let rlo = Infinity, rhi = -Infinity;
  for (const p of v) {
    const r = Math.hypot(p.x - at.x, p.z - at.z);
    rlo = Math.min(rlo, r); rhi = Math.max(rhi, r);
  }
  assert.ok(rhi < m.length_m / 2 + SLOP,
    `a 5.4 by 4.6 m mass reached ${rhi.toFixed(2)} m from its middle`);
  assert.ok(rhi > (m.width_m / 2) * (1 - LUMP),
    "and it is not a spike");
}

// Ground that falls. The mound is a blanket over it, not a lid on a post: the
// rim at the low end sits lower than the rim at the high end by what the ground
// itself dropped. The bank here falls 16 m in 35.
{
  const SLOPE = 16 / 35;
  const BASE = 10;
  // Falling to the west, which is -x.
  const sample = (lat, lon) => BASE + world(lat, lon).x * SLOPE;
  const m = {
    lat: ORIGIN.lat, lon: ORIGIN.lon, ground_m: BASE, height_m: 1.5,
    top_m: 2.0, area_m2: 20, radius_m: 2.5,
    length_m: 12, width_m: 4, bearing_deg: 90,     // running east and west
  };
  const { v } = build([m], sample);
  // The two ends of the long axis, and the ground under each.
  let west = null, east = null;
  for (const p of v) {
    if (!west || p.x < west.x) west = p;
    if (!east || p.x > east.x) east = p;
  }
  const fall = (east.x - west.x) * SLOPE;
  assert.ok(fall > 4, `the test slope should fall several metres, fell ${fall.toFixed(2)}`);
  const drawn = east.y - west.y;
  assert.ok(Math.abs(drawn - fall) < m.height_m * (SINK_FRAC + LUMP) + 0.2,
    `the ground fell ${fall.toFixed(2)} m across the mound and the rim moved ` +
    `${drawn.toFixed(2)}. A mound on a post would move 0.`);
  // And every vertex is within a shrub's height of the ground under it.
  for (const p of v) {
    const g = BASE + p.x * SLOPE;
    assert.ok(p.y > g - m.height_m && p.y < g + m.height_m + SLOP,
      `a vertex at ${p.y.toFixed(2)} over ground ${g.toFixed(2)} is off the mound`);
  }
}

// Every mass in the asset gets drawn, and nothing else does.
{
  const file = path.join(HERE, "..", "..", "assets", "site", "389-shrubs.json");
  const asset = JSON.parse(fs.readFileSync(file, "utf8"));
  const { out, v } = build(asset.shrubs, flat(6));
  assert.equal(out.shrubs, asset.shrubs.length);
  assert.equal(v.length, asset.shrubs.length * VERTS_PER_MOUND,
    "one mound per mass in the asset and no more");
  console.log(`  the asset: ${asset.shrubs.length} masses, ${v.length} vertices`);
}

// A missing or malformed asset says so rather than drawing nothing.
{
  assert.throws(() => buildShrubs(new Scene(), flat(6), null), /no shrubs array/);
  assert.throws(() => buildShrubs(new Scene(), flat(6), {}), /no shrubs array/);
  assert.throws(
    () => buildShrubs(new Scene(), flat(6),
      { shrubs: [{ lat: 48.99, lon: -123.08, height_m: 1, width_m: 2 }] }),
    /no size on it/);
}

console.log("shrubs: ok");
