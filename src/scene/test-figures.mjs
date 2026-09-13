// The people, and the model they are made of.
//
// Run:
//     node src/scene/test-figures.mjs
//
// Two halves. The model is fetched from the URL figures.js loads it from and read
// as glTF, to check it is still what the code expects: a walk clip that runs on
// the spot, and a figure the height of a person. Then the module is run against
// the stub to check a figure is built and walks off ground covered.
//
// This one talks to the network, because the model is not allowed in the
// repository. It loads off jsDelivr at runtime and that is what is checked.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUB = pathToFileURL(path.join(HERE, "test-three-stub.mjs")).href;

async function test(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); }
  catch (e) { console.log(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

const src = fs.readFileSync(path.join(HERE, "figures.js"), "utf8");
const URL_ = /XBOT_URL =\s*"([^"]+)"/.exec(src)[1];

// ---- the model --------------------------------------------------------------

const res = await fetch(URL_);
await test("the model is there, and a browser on another origin may load it", () => {
  assert.equal(res.status, 200, `${URL_} answered ${res.status}`);
  assert.equal(res.headers.get("access-control-allow-origin"), "*",
    "the CDN no longer allows the page to fetch it from another origin");
});
const raw = Buffer.from(await res.arrayBuffer());
const g = JSON.parse(raw.toString("utf8", 20, 20 + raw.readUInt32LE(12)));
const binAt = 20 + raw.readUInt32LE(12) + 8;

function values(accessor) {
  const a = g.accessors[accessor];
  const view = g.bufferViews[a.bufferView];
  const width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
  const at = binAt + (view.byteOffset || 0) + (a.byteOffset || 0);
  const flat = new Float32Array(raw.buffer.slice(raw.byteOffset + at,
    raw.byteOffset + at + a.count * width * 4));
  const out = [];
  for (let i = 0; i < flat.length; i += width) out.push(flat.slice(i, i + width));
  return out;
}

await test("the model carries a walk", () => {
  assert.ok(g.animations.some(a => a.name === "walk"),
    `the clips are ${g.animations.map(a => a.name).join(", ")}`);
});

await test("the walk runs on the spot, so the callers do the moving", () => {
  // A walk that also carried the hips forward would double the travel and the
  // feet would skate. Mixamo's centimetres: the hips may sway, not advance.
  const walk = g.animations.find(a => a.name === "walk");
  const hips = walk.channels.find(c => c.target.path === "translation"
    && /Hips$/.test(g.nodes[c.target.node].name));
  assert.ok(hips, "the walk has no hips translation to check");
  const v = values(walk.samplers[hips.sampler].output);
  const spanZ = Math.max(...v.map(p => p[2])) - Math.min(...v.map(p => p[2]));
  const spanX = Math.max(...v.map(p => p[0])) - Math.min(...v.map(p => p[0]));
  assert.ok(spanZ < 10 && spanX < 10,
    `the hips travel ${spanX.toFixed(1)} across and ${spanZ.toFixed(1)} forward`);
});

await test("the figure is the height of a person without scaling", () => {
  const high = Math.max(...g.meshes.flatMap(m => m.primitives)
    .map(p => g.accessors[p.attributes.POSITION].max[1]));
  assert.ok(high > 1.6 && high < 1.95, `the model stands ${high.toFixed(3)} m`);
});

// ---- the module -------------------------------------------------------------

const figures = await import("data:text/javascript;base64," + Buffer.from(
  src.replace(/from "(three|three\/[^"]*)"/g, `from "${STUB}"`), "utf8")
  .toString("base64"));

await figures.preload();
const settle = () => new Promise(r => setTimeout(r, 0));

await test("a walker is handed back at once, and walks before the model lands", () => {
  const who = figures.buildWalker(0);
  assert.equal(typeof who.stride, "function");
  who.stride(12.5);
  assert.equal(who.walked, 12.5);
});

await test("the model is dropped in, turned to face the way the scene faces", async () => {
  const who = figures.buildWalker(0);
  await figures.preload();
  await settle();
  assert.ok(who.children[0], "no body was added");
  assert.ok(Math.abs(who.children[0].rotation.y - Math.PI) < 1e-9);
});

await test("standing still keeps the feet still", async () => {
  const who = figures.buildWalker(0);
  await settle();
  who.stride(5);
  who.stride(5);
  assert.equal(who.walked, 5);
});

if (!process.exitCode) {
  console.log("\nPASS: Xbot is at its URL, walks on the spot, and stands a person high.");
}
