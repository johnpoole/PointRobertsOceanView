// The rectangle a building footprint is stood in.
//
// Run:
//     node src/scene/test-land.mjs
//
// Plain asserts and a non-zero exit, the same as the rest of the tests here.
//
// A house drawn at the wrong angle is not obviously wrong on screen. From the
// bluff a roof twenty degrees out still reads as a roof, and the block under it
// still reads as a house, and nothing about the picture says the walls are
// facing somewhere the walls do not face. So it is checked here instead: a
// footprint of a known size, turned through a known angle, has to come back the
// size it is and the angle it was turned through.
//
// The project has no package.json, so node reads a .js file as CommonJS and an
// import statement inside one is a syntax error. land.js is read, its three
// rewritten to the stub beside this file and its own relative imports rewritten
// to data URLs, and handed to node that way. The same trick test-trees.mjs uses.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
        `test-land: ${path.basename(abs)} imports "${spec}", which is neither ` +
        `three nor a file beside it, so the test has no way to resolve it.`);
    });
  const url = "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64");
  rewritten.set(abs, url);
  return url;
}

const { fitRectangle } = await import(asDataUrl(path.join(HERE, "land.js")));

let failures = 0;
function ok(cond, what) {
  if (cond) return;
  failures++;
  console.error("FAIL " + what);
}
function near(got, want, tol, what) {
  ok(Math.abs(got - want) <= tol, `${what}: ${got} is not within ${tol} of ${want}`);
}

// A rectangle w by d, centred on cx,cz, turned through deg.
function turned(w, d, deg, cx = 0, cz = 0) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]
    .map(([x, z]) => [cx + x * c - z * s, cz + x * s + z * c]);
}

// A box turned through the angle that comes back has to land on the footprint,
// which is the only thing any of this is for. rotateY sends local x,z to
// world x*cos+z*sin, -x*sin+z*cos.
function corners(rect) {
  const c = Math.cos(rect.angle), s = Math.sin(rect.angle);
  const hw = rect.width / 2, hd = rect.depth / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]
    .map(([x, z]) => [rect.cx + x * c + z * s, rect.cz - x * s + z * c]);
}

// The furthest any corner of one set sits from the nearest corner of the other.
function apart(a, b) {
  let worst = 0;
  for (const p of a) {
    let best = Infinity;
    for (const q of b) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
    worst = Math.max(worst, best);
  }
  return worst;
}

// ---- a rectangle comes back as itself, at whatever angle it stands ----------

for (const deg of [0, 12, 40, 45, 73, 90, 137, -25]) {
  const w = 14.5, d = 6.2;
  const r = fitRectangle(turned(w, d, deg, 120, -80));
  const sides = [r.width, r.depth].sort((a, b) => b - a);
  near(sides[0], w, 1e-6, `turned ${deg} deg: the long side`);
  near(sides[1], d, 1e-6, `turned ${deg} deg: the short side`);
  near(r.cx, 120, 1e-6, `turned ${deg} deg: the centre east`);
  near(r.cz, -80, 1e-6, `turned ${deg} deg: the centre north`);
  near(apart(corners(r), turned(w, d, deg, 120, -80)), 0, 1e-6,
       `turned ${deg} deg: the box lands on the footprint`);
}

// ---- and it is smaller than the one squared to north and east --------------
//
// This is the whole of what was wrong. A house at forty degrees to the grid was
// drawn in the box that holds it, which is half again as wide and three times
// as deep as the house is.

{
  const w = 14.5, d = 6.2, deg = 40;
  const pts = turned(w, d, deg);
  const bx = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
  const bz = Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]));
  const r = fitRectangle(pts);
  ok(r.width * r.depth < bx * bz * 0.8,
     `the fitted rectangle is ${(r.width * r.depth).toFixed(1)} m2 against ` +
     `${(bx * bz).toFixed(1)} for the one squared to the grid`);
  console.log(`ok   a house 14.5 by 6.2 at 40 deg: fitted ${r.width.toFixed(1)} by ` +
              `${r.depth.toFixed(1)}, squared to the grid ${bx.toFixed(1)} by ${bz.toFixed(1)}`);
}

// ---- the shapes OSM actually hands over ------------------------------------

{
  // A closed way repeats its first node as its last. It must not count twice.
  const pts = turned(10, 4, 30);
  const closed = pts.concat([pts[0]]);
  const a = fitRectangle(pts), b = fitRectangle(closed);
  near(b.width, a.width, 1e-9, "a closed way fits the same rectangle as an open one");
  near(b.depth, a.depth, 1e-9, "a closed way fits the same depth");
}

{
  // An L. The smallest rectangle holds the whole of it and stands on the arms.
  const L = [[0, 0], [12, 0], [12, 4], [4, 4], [4, 10], [0, 10]];
  const r = fitRectangle(L);
  const sides = [r.width, r.depth].sort((a, b) => b - a);
  near(sides[0], 12, 1e-6, "an L: the long side is the long arm");
  near(sides[1], 10, 1e-6, "an L: the short side is the other arm");
}

{
  // A way with nothing to stand a rectangle in gets none, and the caller drops
  // it rather than drawing a house of no width.
  ok(fitRectangle([[0, 0], [5, 5]]) === null, "two corners fit no rectangle");
  ok(fitRectangle([[3, 3], [3, 3], [3, 3]]) === null, "one corner three times fits none");
  ok(fitRectangle([[0, 0], [1, 1], [2, 2], [3, 3]]) === null,
     "four corners on one line fit none");
}

console.log(failures ? `\n${failures} failed` : "\nland ok");
process.exit(failures ? 1 : 0);
