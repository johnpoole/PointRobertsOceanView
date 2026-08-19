// Where the shelter on the beach stands, checked against the ground it stands
// on rather than against a picture of it.
//
// Run:
//     node src/scene/test-pavilion.mjs
//
// The browser here rasterises this scene at about three seconds a frame, so a
// look at it costs minutes. Every question about where a thing sits is
// arithmetic and is answered in a second, which is what this does.
//
// pavilion.js imports three for the geometry, so the module is read and its
// three rewritten to the stub beside this file. Only plan() is called, and
// plan() is arithmetic.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
        `test-pavilion: ${path.basename(abs)} imports "${spec}", which is ` +
        `neither three nor a file beside it, so the test cannot resolve it.`);
    });
  const url = "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64");
  rewritten.set(abs, url);
  return url;
}

const { plan } = await import(asDataUrl(path.join(HERE, "pavilion.js")));

let failures = 0;
function ok(cond, what) {
  if (cond) return;
  failures++;
  console.error("FAIL " + what);
}

// The ground the near tile reads across this footprint: it falls to the west
// and to the north, 4.9 m at the landward corners and 3.75 m at the seaward.
const GROUND = (x, z) => 4.9 - 0.32 * (1.8 - x) - 0.1 * (2.3 - z) / 2;

const shape = plan(GROUND);

// The deck is level and stands clear of the highest ground under it.
const highest = Math.max(...shape.posts.map((p) => p.ground));
ok(Math.abs(shape.deckY - (highest + 0.3)) < 1e-9,
   `the deck is not 0.3 m over the highest ground: ${shape.deckY} against ${highest}`);

// And clear of the tide. The waterline stands 43 m off the camera at a 3.5 m
// tide and this footprint's seaward edge is at 44 m, so a deck that does not
// clear 3.5 m is a deck with the sea running over it.
ok(shape.deckY > 3.5 + 1.0,
   `the deck is only ${shape.deckY.toFixed(2)} m, which is not clear of a 3.5 m tide`);

// Every post reaches the ground under its own foot and goes into it. One length
// for all six would leave the seaward pair standing in the air.
for (const p of shape.posts) {
  ok(p.top > p.ground + 2.5, `a post at ${p.x},${p.z} is too short to carry the beam`);
}
const lengths = shape.posts.map((p) => p.top - (p.ground - 0.3));
ok(Math.max(...lengths) - Math.min(...lengths) > 0.5,
   "every post came out the same length, so they are not cut to the ground");

// You can stand up in it.
ok(shape.beamY - shape.deckY >= 2.4,
   `only ${(shape.beamY - shape.deckY).toFixed(2)} m of headroom`);

// The bed is on the deck and not through it or floating over it.
ok(shape.bedY > shape.deckY && shape.bedY < shape.deckY + 0.6,
   `the bed sits at ${(shape.bedY - shape.deckY).toFixed(2)} m over the boards`);

// The roof is above the beam it is carried on.
ok(shape.roofY > shape.beamY, "the roof is not above the beam");

// Down on the flat the tide is what governs, not the ground. Ground at 2.5 m
// would put a deck 0.3 m over it under water twice a day.
const low = plan(() => 2.5);
ok(low.deckY === 4.2, `on low ground the deck came out at ${low.deckY}, not 4.2`);
ok(low.posts.every((p) => p.top - p.ground > 4.3),
   "the posts did not grow to carry a deck lifted by the tide");

// Flat ground gives flat posts, which is the one case that would hide a sign
// error in the cut.
const flat = plan(() => 4.5);
ok(flat.deckY === 4.8, `on flat ground the deck came out at ${flat.deckY}`);
ok(flat.posts.every((p) => p.ground === 4.5), "flat ground did not give flat feet");

if (failures) {
  console.error(`${failures} failed`);
  process.exit(1);
}
console.log(
  `pavilion: deck ${shape.deckY.toFixed(2)} m, beam ${shape.beamY.toFixed(2)} m, ` +
  `posts ${Math.min(...lengths).toFixed(2)}–${Math.max(...lengths).toFixed(2)} m`);
