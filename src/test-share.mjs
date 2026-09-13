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

// ---- the named places ------------------------------------------------------

const places = JSON.parse(
  fs.readFileSync(path.join(HERE, "..", "assets", "places.json"), "utf8")).places;

test("every named place has a hash this page will open", () => {
  // assets/places.json exists so a name can be turned into a view. A hash in it
  // the reader refuses is a place nobody can be sent to, and the file is built
  // by a script that does not import this reader.
  assert.ok(places.length > 10, `only ${places.length} places in the file`);
  for (const p of places) {
    const got = share.readViewHash(p.hash);
    assert.ok(got, `${p.id}: the page refuses its own hash, ${p.hash}`);
    assert.equal(got.fov, p.view.fov, `${p.id}: the lens did not survive`);
  }
});

test("every place is looked at from outside itself", () => {
  for (const p of places) {
    const eye = toWorld(p.view.eye.lat, p.view.eye.lon, p.view.eye.y);
    const aim = toWorld(p.view.aim.lat, p.view.aim.lon, p.view.aim.y);
    const back = Math.hypot(eye.x - aim.x, eye.z - aim.z);
    assert.ok(back > 25, `${p.id}: the camera stands ${back.toFixed(0)} m off it`);
    // A framed place is looked down on. Where the page opens is not framed: it
    // is a driver's eye on Tyee looking slightly up at the booths, which is the
    // whole point of it, so it is left alone.
    if (!p.starting_position) {
      assert.ok(eye.y > aim.y, `${p.id}: the camera is below what it looks at`);
    }
  }
});

test("no place is framed from orbit", () => {
  // Past a few hundred metres up it stops being a view of a place and becomes a
  // map, and the page already has a map on the O key.
  for (const p of places) {
    assert.ok(p.view.eye.y < 400,
      `${p.id}: the camera is ${p.view.eye.y} m up, which is a map`);
  }
});

test("every place has an id a URL can carry and words a reader can use", () => {
  for (const p of places) {
    assert.match(p.id, /^[a-z0-9][a-z0-9-]*$/, `${p.id} is not a usable id`);
    assert.ok(p.name && p.note, `${p.id} has no name or no note`);
  }
});

if (!process.exitCode) {
  console.log(`\nPASS: the view survives the round trip, midnight survives with `
    + `it, and all ${places.length} named places open.`);
}
