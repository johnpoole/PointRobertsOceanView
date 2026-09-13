// The people: the model they are made of, and how each one is dressed.
//
// Run:
//     node src/scene/test-figures.mjs
//
// The model is fetched from the URL figures.js loads it from and read as glTF,
// to check it is still what the code expects: a walk that runs on the spot, a
// person's height, and a body whose every vertex belongs to some part of a
// person. Then the dressing is checked, and the module is run against the stub.
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
const figures = await import("data:text/javascript;base64," + Buffer.from(
  src.replace(/from "(three|three\/[^"]*)"/g, `from "${STUB}"`), "utf8")
  .toString("base64"));

// ---- the model --------------------------------------------------------------

const res = await fetch(URL_);
await test("the model is there, and a browser on another origin may load it", () => {
  assert.equal(res.status, 200, `${URL_} answered ${res.status}`);
  assert.equal(res.headers.get("access-control-allow-origin"), "*",
    "the CDN no longer allows the page to fetch it from another origin");
});
const raw = Buffer.from(await res.arrayBuffer());
const jsonLength = raw.readUInt32LE(12);
const g = JSON.parse(raw.toString("utf8", 20, 20 + jsonLength));
const binAt = 20 + jsonLength + 8;

// Every item of an accessor, as arrays of numbers.
function values(accessor) {
  const a = g.accessors[accessor];
  const view = g.bufferViews[a.bufferView];
  const width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
  const [read, size] = {
    5126: ["readFloatLE", 4], 5123: ["readUInt16LE", 2], 5121: ["readUInt8", 1],
  }[a.componentType];
  const stride = view.byteStride || width * size;
  const at = binAt + (view.byteOffset || 0) + (a.byteOffset || 0);
  const out = [];
  for (let i = 0; i < a.count; i++) {
    const item = [];
    for (let k = 0; k < width; k++) item.push(raw[read](at + i * stride + k * size));
    out.push(item);
  }
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
  const span = (k) => Math.max(...v.map(p => p[k])) - Math.min(...v.map(p => p[k]));
  assert.ok(span(0) < 10 && span(2) < 10,
    `the hips travel ${span(0).toFixed(1)} across and ${span(2).toFixed(1)} forward`);
});

await test("the figure is the height of a person without scaling", () => {
  const high = Math.max(...g.meshes.flatMap(m => m.primitives)
    .map(p => g.accessors[p.attributes.POSITION].max[1]));
  assert.ok(high > 1.6 && high < 1.95, `the model stands ${high.toFixed(3)} m`);
});

// ---- dressing it ------------------------------------------------------------

await test("every vertex of the body is some part of a person", () => {
  // regionOf throws on a bone it does not recognise, so a rig with another
  // skeleton fails here rather than drawing a figure with holes in its clothes.
  const bones = g.skins[0].joints.map(j => g.nodes[j].name);
  const tally = new Array(figures.REGIONS.length).fill(0);
  for (const node of g.nodes.filter(n => "mesh" in n)) {
    const prim = g.meshes[node.mesh].primitives[0];
    const joints = values(prim.attributes.JOINTS_0);
    const weights = values(prim.attributes.WEIGHTS_0);
    const positions = values(prim.attributes.POSITION);
    for (let v = 0; v < positions.length; v++) {
      let best = 0;
      for (let k = 1; k < 4; k++) if (weights[v][k] > weights[v][best]) best = k;
      tally[figures.regionOf(bones[joints[v][best]], positions[v][1])]++;
    }
  }
  const named = Object.fromEntries(figures.REGIONS.map((r, i) => [r, tally[i]]));
  for (const part of ["skin", "shirt", "trousers", "shoes"]) {
    assert.ok(named[part] > 1000, `only ${named[part]} vertices of ${part}: ${JSON.stringify(named)}`);
  }
  assert.ok(named.hair > 100, `only ${named.hair} vertices of hair`);
});

await test("a bone nobody has written down is an error, not a guess", () => {
  assert.throws(() => figures.regionOf("mixamorig:Tail", 1.0), /Tail/);
});

await test("the head is skin and its crown is hair", () => {
  assert.equal(figures.REGIONS[figures.regionOf("mixamorigHead", 1.60)], "skin");
  assert.equal(figures.REGIONS[figures.regionOf("mixamorigHead", 1.78)], "hair");
  assert.equal(figures.REGIONS[figures.regionOf("mixamorig:LeftHandIndex2", 1.0)], "skin");
  assert.equal(figures.REGIONS[figures.regionOf("mixamorigLeftForeArm", 1.2)], "shirt");
  assert.equal(figures.REGIONS[figures.regionOf("mixamorigRightUpLeg", 0.8)], "trousers");
  assert.equal(figures.REGIONS[figures.regionOf("mixamorigLeftToeBase", 0.05)], "shoes");
});

await test("the shirt is the colour the caller asked for", () => {
  for (const coat of [0x3f5468, 0x8c5a3c, 0x2b3a52]) {
    assert.equal(figures.paletteFor(coat)[figures.REGIONS.indexOf("shirt")], coat);
  }
});

await test("the same caller gets the same person every time", () => {
  assert.deepEqual(figures.paletteFor(0x4f7a55), figures.paletteFor(0x4f7a55));
});

await test("different callers get different people", () => {
  const coats = Array.from({ length: 24 }, (_, i) => 0x203040 + i * 0x0a1b2c);
  const faces = new Set(coats.map(c => figures.paletteFor(c).join(",")));
  assert.ok(faces.size >= 20, `24 coats made only ${faces.size} different people`);
  const skins = new Set(coats.map(c => figures.paletteFor(c)[0]));
  assert.ok(skins.size >= 3, `24 people have only ${skins.size} skin tones`);
});

// ---- the module -------------------------------------------------------------

await figures.preload();
const settle = () => new Promise(r => setTimeout(r, 0));

await test("a walker is handed back at once, and walks before the model lands", () => {
  const who = figures.buildWalker(0x3f5468);
  assert.equal(typeof who.stride, "function");
  who.stride(12.5);
  assert.equal(who.walked, 12.5);
});

await test("the model is dropped in, turned to face the way the scene faces", async () => {
  const who = figures.buildWalker(0x3f5468);
  await figures.preload();
  await settle();
  assert.ok(who.children[0], "no body was added");
  assert.ok(Math.abs(who.children[0].rotation.y - Math.PI) < 1e-9);
});

if (!process.exitCode) {
  console.log("\nPASS: Xbot is at its URL, walks on the spot, and every part of it "
    + "is dressed.");
}
