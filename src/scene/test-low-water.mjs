// The novel's staging, checked against the ground it is staged on.
//
// Run:
//     node src/scene/test-low-water.mjs
//
// Nothing here draws anything. What it asks is whether each scene can work:
// whether the people are standing on something, whether the boats are floating,
// whether the flats the story turns on are actually dry at the tide the chapter
// names, and above all whether the camera is pointed at any of it. A scene
// staged behind the camera is a scene nobody sees, and that has happened here
// before.

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

// The page's modules are plain .js, which node reads as CommonJS. Rewriting
// each relative import into a data URL is what lets one be imported here.
const seen = new Map();
function asModule(rel, from) {
  const url = new URL(rel, from);
  if (seen.has(url.href)) return seen.get(url.href);
  let src = fs.readFileSync(url, "utf8");
  for (const spec of new Set([...src.matchAll(/from\s+"(\.[^"]+)"/g)].map(m => m[1]))) {
    src = src.split(`from "${spec}"`).join(`from "${asModule(spec, url)}"`);
  }
  const data = "data:text/javascript;base64," + Buffer.from(src).toString("base64");
  seen.set(url.href, data);
  return data;
}

// config.js builds the websocket URL off the page it is served from, and there
// is no page here.
globalThis.location = { protocol: "https:", host: "ptrob.pgyard.ca" };

const { CHAPTERS, TRAVEL_S } = await import(
  asModule("./low-water.js", new URL(import.meta.url)));

// ---- the ground they stand on ----------------------------------------------
// The same baked heightmap the page samples, read straight off disk.
const meta = JSON.parse(fs.readFileSync(path.join(root, "assets/terrain/meta.json")));
const grid = meta.grid;
const raw = fs.readFileSync(path.join(root, "assets/terrain/heightmap.bin"));
const heights = new Int16Array(raw.buffer, raw.byteOffset,
  grid.nrows * grid.ncols);

function ground(lat, lon) {
  const r = Math.min(Math.max((grid.north_lat - lat) / grid.cellsize_deg, 0), grid.nrows - 1.001);
  const c = Math.min(Math.max((lon - grid.west_lon) / grid.cellsize_deg, 0), grid.ncols - 1.001);
  const r0 = Math.floor(r), c0 = Math.floor(c), fr = r - r0, fc = c - c0;
  const v = (rr, cc) => heights[rr * grid.ncols + cc] * grid.scale_m;
  const a = v(r0, c0) * (1 - fc) + v(r0, c0 + 1) * fc;
  const b = v(r0 + 1, c0) * (1 - fc) + v(r0 + 1, c0 + 1) * fc;
  return a * (1 - fr) + b * fr;
}

const M_PER_DEG = 111320;
const COS = Math.cos(48.989009 * Math.PI / 180);
function enu(lat, lon, y) {
  return { x: (lon + 123.085318) * M_PER_DEG * COS, y, z: -(lat - 48.989009) * M_PER_DEG };
}

assert.equal(CHAPTERS.length, 7, "seven chapters");
assert.deepEqual(CHAPTERS.map(c => c.n), [1, 2, 3, 4, 5, 6, 7], "numbered in order");
// The route opens and closes at the border, which is the book's shape.
assert.ok(CHAPTERS[0].title.includes("border"), "it opens at the line");
assert.ok(CHAPTERS[6].title.includes("border"), "and closes there");
// And chapter six is the night one, which is the whole mechanism of the book.
assert.ok(CHAPTERS[5].hour < 5,
  `chapter six is at ${CHAPTERS[5].hour}, which is not the small hours`);

let actors = 0, walked = 0;
for (const ch of CHAPTERS) {
  const where = `chapter ${ch.n} (${ch.title})`;
  assert.ok(ch.dwell >= 14, `${where}: ${ch.dwell}s is not long enough to act anything out`);
  assert.ok(ch.actors.length > 0, `${where}: nothing happens in it`);
  // A held tide has to be a tide this coast reaches.
  if (ch.tide !== null) {
    assert.ok(ch.tide > -1.0 && ch.tide < 4.5,
      `${where}: ${ch.tide} m is not a tide Point Roberts reaches`);
  }
  const water = ch.tide === null ? 1.5 : ch.tide;   // a middling sea when it is live

  const eye = enu(ch.eye[0], ch.eye[1], ch.eye[2]);
  const aim = enu(ch.aim[0], ch.aim[1], ch.aim[2]);
  // The camera has to be out of the ground, or the whole scene is the inside
  // of a hill.
  assert.ok(ch.eye[2] > ground(ch.eye[0], ch.eye[1]) + 1.0,
    `${where}: the camera at ${ch.eye[2]} m is inside ground at `
    + `${ground(ch.eye[0], ch.eye[1]).toFixed(1)} m`);

  // You have to be somewhere else from what you are looking at, and near enough
  // to see it.
  const gap = Math.hypot(aim.x - eye.x, aim.z - eye.z);
  assert.ok(gap > 25 && gap < 600, `${where} looks ${gap.toFixed(0)} m`);

  const look = { x: aim.x - eye.x, y: aim.y - eye.y, z: aim.z - eye.z };
  const lookLen = Math.hypot(look.x, look.y, look.z);

  for (const actor of ch.actors) {
    actors++;
    assert.ok(actor.keys.length >= 2, `${where}: an actor with one key does nothing`);
    let last = -1, moved = 0;
    for (const [t, lat, lon] of actor.keys) {
      assert.ok(t > last, `${where}: keys run backwards at ${t}s`);
      last = t;
      // The tile stops at the 49th parallel and the border station stands just
      // north of it, so a sample there is the clamp at the tile edge — which is
      // what the page does too. What is checked is that the point is on the
      // peninsula at all.
      assert.ok(lat > 48.96 && lat < 49.006 && lon > -123.14 && lon < -123.01,
        `${where}: ${lat},${lon} is not on the peninsula`);
      const bed = ground(lat, lon);
      if (actor.on === "ground") {
        // Standing on the bottom means the bottom is out of the water.
        assert.ok(bed > water,
          `${where}: someone stands at ${bed.toFixed(2)} m with the sea at ${water} m`);
      } else {
        // Floating means there is water under them.
        assert.ok(bed < water - 0.3,
          `${where}: a hull sits over ${bed.toFixed(2)} m of bottom with the `
          + `sea at ${water} m`);
      }
      // And the camera has to be looking at them.
      const p = enu(lat, lon, bed);
      const to = { x: p.x - eye.x, y: p.y - eye.y, z: p.z - eye.z };
      const range = Math.hypot(to.x, to.y, to.z);
      assert.ok(range < 900,
        `${where}: an actor is ${range.toFixed(0)} m from the camera`);
      const dot = (to.x * look.x + to.y * look.y + to.z * look.z) / (range * lookLen);
      const off = Math.acos(Math.min(Math.max(dot, -1), 1)) * 180 / Math.PI;
      assert.ok(off < 30,
        `${where}: an actor is ${off.toFixed(0)}° off the middle of the frame`);
    }
    assert.ok(actor.keys[actor.keys.length - 1][0] <= ch.dwell,
      `${where}: an actor is still going ${
        actor.keys[actor.keys.length - 1][0] - ch.dwell}s after the scene ends`);
    for (let i = 1; i < actor.keys.length; i++) {
      const a = enu(actor.keys[i - 1][1], actor.keys[i - 1][2], 0);
      const b = enu(actor.keys[i][1], actor.keys[i][2], 0);
      const step = Math.hypot(b.x - a.x, b.z - a.z);
      const secs = actor.keys[i][0] - actor.keys[i - 1][0];
      moved += step;
      // Nobody teleports. A walker at 2 m/s, a car at 25.
      const cap = actor.mode === "car" ? 25 : actor.mode === "walk" ? 2.2 : 6;
      assert.ok(step / secs <= cap + 1e-6,
        `${where}: a ${actor.mode} covers ${(step / secs).toFixed(1)} m/s`);
    }
    if (moved > 1) walked++;
  }
  // Something has to move, or the chapter is a photograph.
  assert.ok(ch.actors.some(a => {
    const f = a.keys[0], l = a.keys[a.keys.length - 1];
    return Math.hypot(...[1, 2].map(i => l[i] - f[i])) > 1e-5;
  }), `${where}: nothing in it moves`);
}

// Every chapter names the light it was written under, and the two that were
// written under no light at all carry a torch. A scene that needs a torch has
// to be dark whenever anybody looks at it, which is why the sun and not the
// hour is what the page winds to.
for (const ch of CHAPTERS) {
  assert.equal(typeof ch.sun, "number", `chapter ${ch.n} names no sun`);
  assert.ok(ch.sun > -55 && ch.sun < 65, `chapter ${ch.n} sun at ${ch.sun}`);
  assert.equal(typeof ch.west, "boolean", `chapter ${ch.n} names no side of noon`);
  if (ch.sun > 0) continue;
  assert.ok(ch.actors.some(a => a.lamp),
    `chapter ${ch.n} is under a sun at ${ch.sun}° and nobody has a light`);
}

// An actor whose last key lands on the dwell is still standing there when the
// chapter ends. One that stops earlier has gone inside, and that only reads as
// a door if there is a door to have gone through.
for (const ch of CHAPTERS) {
  for (const a of ch.actors) {
    const ends = a.keys[a.keys.length - 1][0];
    assert.ok(ends === ch.dwell || ends <= ch.dwell - 2,
      `chapter ${ch.n}: an actor stops at ${ends}s of ${ch.dwell}, which is `
      + `neither standing there nor gone`);
  }
}

// The flats the story turns on have to dry at the tide the chapter names.
const flat = CHAPTERS.find(c => c.n === 6);
assert.ok(flat.tide < 0, "the crossing is not staged at a low water");
// The one that covers ground, not just the one carrying a light: the pair
// waiting for it have a torch too.
const crosser = flat.actors.find(a =>
  Math.abs(a.keys[a.keys.length - 1][2] - a.keys[0][2]) > 1e-5);
for (const [, lat, lon] of crosser.keys) {
  assert.ok(ground(lat, lon) > flat.tide,
    `the crossing runs through ${ground(lat, lon).toFixed(2)} m of bottom, `
    + `which is under a ${flat.tide} m tide`);
}
// And it has to actually cross the line, or it is a walk on a beach.
const lats = crosser.keys.map(k => k[1]);
assert.ok(Math.max(...lats) > 49.0 && Math.min(...lats) < 49.0,
  "the crossing never crosses the 49th parallel");

const runtime = CHAPTERS.reduce((s, c) => s + c.dwell + TRAVEL_S, 0);
console.log(`PASS: ${CHAPTERS.length} chapters, ${actors} actors, ${walked} of them `
  + `moving, all of them dry or afloat and inside 30° of the frame, the crossing `
  + `dry from ${Math.max(...lats).toFixed(5)} to ${Math.min(...lats).toFixed(5)} `
  + `at ${flat.tide} m. ${Math.round(runtime)}s end to end.`);
