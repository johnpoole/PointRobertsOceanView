// The view in the address bar, and what survives being copied out of it.
//
// Run:
//     node src/test-share.mjs
//
// The hash is written every time the camera moves and read once on load. What
// matters is that the two agree: everything written comes back, and nothing a
// reader would accept can be silently dropped on the way out. Midnight was —
// hour=0 is a real hour and it was being dropped along with the switches that
// were off.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUB = pathToFileURL(path.join(HERE, "scene", "test-three-stub.mjs")).href;

// config.js reads the page it was served from. Nothing under test uses it.
globalThis.location = { protocol: "http:", host: "localhost" };

// share.js and what it imports, with three swapped for the stub.
const built = new Map();
function asDataUrl(file) {
  const abs = path.resolve(file);
  if (built.has(abs)) return built.get(abs);
  const src = fs.readFileSync(abs, "utf8").replace(
    /from\s+"([^"]+)"/g, (whole, spec) => {
      if (spec === "three" || spec.startsWith("three/")) return `from "${STUB}"`;
      if (spec.startsWith(".")) {
        const next = path.resolve(path.dirname(abs), spec);
        return `from "${asDataUrl(next)}"`;
      }
      throw new Error(`test-share cannot resolve the import ${spec}`);
    });
  const url = "data:text/javascript;base64,"
    + Buffer.from(src, "utf8").toString("base64");
  built.set(abs, url);
  return url;
}

const share = await import(asDataUrl(path.join(HERE, "share.js")));
const { ORIGIN } = await import(asDataUrl(path.join(HERE, "config.js")));
const { toWorld } = await import(asDataUrl(path.join(HERE, "geo.js")));

function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { console.log(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

// The least of a camera that viewHash touches: where it is, where it looks and
// what lens it has.
function camera(lat, lon, y, look = { x: 0, y: 0, z: -1 }, fov = 25) {
  const at = toWorld(lat, lon, y);
  return {
    fov,
    position: { x: at.x, y: at.y, z: at.z },
    getWorldDirection(v) { return v.set(look.x, look.y, look.z); },
  };
}

const keys = (hash) => Object.fromEntries(
  hash.replace(/^#/, "").split("&").map(p => {
    const eq = p.indexOf("=");
    return [p.slice(0, eq), p.slice(eq + 1)];
  }));

// ---- what goes out and what comes back --------------------------------------

test("the eye and the aim survive the round trip", () => {
  const cam = camera(48.989009, -123.085318, 20);
  const back = share.readViewHash(share.viewHash(cam));
  assert.ok(back, "a hash this wrote could not be read");
  assert.ok(Math.abs(back.eye.x - cam.position.x) < 0.2, "the eye moved");
  assert.ok(Math.abs(back.eye.y - cam.position.y) < 0.2, "the height moved");
  // The aim is three hundred metres down the line of sight, which here is north.
  const away = Math.hypot(back.aim.x - back.eye.x, back.aim.z - back.eye.z);
  assert.ok(Math.abs(away - 300) < 1, `the aim is ${away.toFixed(1)} m out`);
});

test("the lens travels with the view", () => {
  assert.equal(share.readViewHash(share.viewHash(camera(48.99, -123.08, 20, undefined, 40))).fov, 40);
});

test("a lens nobody has is ignored rather than applied", () => {
  const hash = share.viewHash(camera(48.99, -123.08, 20)).replace(/fov=[\d.]+/, "fov=900");
  assert.equal(share.readViewHash(hash).fov, null);
});

test("half a link is no link", () => {
  // Half a viewpoint is worse than none, so a malformed one opens on the default.
  assert.equal(share.readViewHash("#eye=48.99,-123.08,20"), null);
  assert.equal(share.readViewHash("#fov=25"), null);
  assert.equal(share.readViewHash(""), null);
  assert.equal(share.readViewHash(null), null);
});

// ---- the switches -----------------------------------------------------------

test("a switch that is on carries and one that is off does not", () => {
  const on = keys(share.viewHash(camera(48.99, -123.08, 20),
    { golf: true, novel: false, map: true }));
  assert.equal(on.golf, "1");
  assert.equal(on.map, "1");
  assert.ok(!("novel" in on), "a switch that was off was written down");
});

test("a switch that is on comes back on", () => {
  const back = share.readViewHash(share.viewHash(
    camera(48.99, -123.08, 20), { golf: true, cast: true }));
  assert.equal(back.golf, true);
  assert.equal(back.cast, true);
  assert.equal(back.novel, false);
});

// ---- the clock --------------------------------------------------------------

test("an hour carries as itself, not as an on", () => {
  const out = keys(share.viewHash(camera(48.99, -123.08, 20), { hour: 14.25 }));
  assert.equal(out.hour, "14.25");
});

test("midnight is an hour and is written down", () => {
  // This is the bug. Zero was dropped along with the switches that were off, so
  // a view standing within seven minutes of midnight could be opened on a link
  // and never sent as one.
  const out = keys(share.viewHash(camera(48.99, -123.08, 20), { hour: 0 }));
  assert.equal(out.hour, "0", "midnight was dropped out of the link");
});

test("no hour at all is left off", () => {
  for (const absent of [null, undefined]) {
    const out = keys(share.viewHash(camera(48.99, -123.08, 20), { hour: absent }));
    assert.ok(!("hour" in out), `hour=${absent} was written into the link`);
  }
});

test("the link a shared midnight makes is one the reader accepts", () => {
  // viewHash writes it and main.js's hourFromHash reads it. Both have to agree
  // that zero is an hour, and they used to disagree.
  const hash = share.viewHash(camera(48.99, -123.08, 20), { hour: 0 });
  const m = /(?:^#|&)hour=(-?\d+(?:\.\d+)?)/.exec(hash);
  assert.ok(m, "the reader's own pattern does not find the hour");
  assert.equal(Number(m[1]), 0);
});

if (!process.exitCode) {
  console.log("\nPASS: the view survives the round trip and midnight survives "
    + "with it.");
}
