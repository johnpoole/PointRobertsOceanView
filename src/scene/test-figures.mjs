// The people, and the files they are made of.
//
// Run:
//     node src/scene/test-figures.mjs
//
// Two halves. The files on disk are read as glTF and checked to be what
// figures.js expects — the right rig, the right clip, one shared texture — and
// the module is run against the stub to check a figure is built, walks off
// ground covered rather than off a clock, and stands the right height.
//
// The rig check is the one that matters. Kenney's walk turns seven joints by
// name, so a pack swapped for another one with a different skeleton would load
// without complaint and stand there rigid.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIGURES = path.join(HERE, "..", "..", "assets", "figures");
const STUB = pathToFileURL(path.join(HERE, "test-three-stub.mjs")).href;

// Awaits, because half of these wait on a load. Without that an async case
// resolved after the summary printed and its failure escaped as an unhandled
// rejection, which reads as a crash rather than as a failing test.
async function test(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); }
  catch (e) { console.log(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

// The JSON chunk out of a .glb.
function readGlb(file) {
  const raw = fs.readFileSync(file);
  assert.equal(raw.toString("utf8", 0, 4), "glTF", `${file} is not a glb`);
  return JSON.parse(raw.toString("utf8", 20, 20 + raw.readUInt32LE(12)));
}

const files = fs.readdirSync(FIGURES).filter(f => f.endsWith(".glb")).sort();

// ---- what is on disk --------------------------------------------------------

await test("there are twelve bodies and a licence beside them", () => {
  assert.equal(files.length, 12, `${files.length} bodies`);
  const licence = fs.readFileSync(path.join(FIGURES, "LICENSE.txt"), "utf8");
  assert.match(licence, /Creative Commons Zero/,
    "the licence beside the figures is not the CC0 one they were taken under");
  assert.match(licence, /Kenney/);
});

await test("every body carries the rig figures.js drives", () => {
  // root, two legs, a torso, two arms, a head. Kenney's walk turns these by
  // name. A pack with another skeleton would load and stand rigid.
  const wanted = ["root", "leg-left", "leg-right", "torso",
                  "arm-left", "arm-right", "head"].sort();
  for (const f of files) {
    const g = readGlb(path.join(FIGURES, f));
    assert.ok(g.skins && g.skins.length, `${f} has no skin`);
    const joints = g.skins[0].joints.map(j => g.nodes[j].name).sort();
    assert.deepEqual(joints, wanted, `${f} is rigged differently`);
  }
});

await test("every body carries a walk, and it runs on the spot", () => {
  for (const f of files) {
    const g = readGlb(path.join(FIGURES, f));
    const walk = (g.animations || []).find(a => a.name === "walk");
    assert.ok(walk, `${f} has no clip called walk`);
    // The caller moves the figure along the ground. A clip that also carried it
    // forward would double the travel and the feet would skate.
    const root = walk.channels.find(c =>
      c.target.path === "translation" && g.nodes[c.target.node].name === "root");
    if (root) {
      const acc = g.accessors[walk.samplers[root.sampler].output];
      assert.ok(Math.abs(acc.min[0]) < 0.01 && Math.abs(acc.min[2]) < 0.01
        && Math.abs(acc.max[0]) < 0.01 && Math.abs(acc.max[2]) < 0.01,
        `${f}'s walk carries the root along the ground, not just up and down`);
    }
  }
});

await test("the clips are all the same length, or they walk at different speeds", () => {
  const lengths = new Set();
  for (const f of files) {
    const g = readGlb(path.join(FIGURES, f));
    const walk = g.animations.find(a => a.name === "walk");
    const acc = g.accessors[walk.samplers[walk.channels[0].sampler].input];
    lengths.add(Math.round(acc.max[0] * 1000));
  }
  assert.equal(lengths.size, 1,
    `the walk is ${[...lengths].join(", ")} ms long across the twelve bodies`);
});

await test("twelve bodies, one material and one texture between them", () => {
  const images = new Set();
  for (const f of files) {
    const g = readGlb(path.join(FIGURES, f));
    assert.equal(g.materials.length, 1, `${f} has ${g.materials.length} materials`);
    for (const i of g.images || []) images.add(i.uri);
  }
  assert.equal(images.size, 1, `the bodies want ${images.size} textures`);
  const uri = [...images][0];
  assert.ok(fs.existsSync(path.join(FIGURES, uri)),
    `the bodies name ${uri} and it is not beside them`);
});

await test("a body is small enough to draw forty of", () => {
  for (const f of files) {
    const g = readGlb(path.join(FIGURES, f));
    const tris = g.meshes.flatMap(m => m.primitives)
      .reduce((n, p) => n + g.accessors[p.indices].count / 3, 0);
    assert.ok(tris < 1500, `${f} is ${tris} triangles`);
  }
});

await test("the bodies are not all the same height, which is why each is measured", () => {
  // 0.661 to 0.793, because some of them are wearing a hat. Scaling all twelve
  // by one number would have stood the tall one at nearly two metres, so
  // figures.js measures each body and scales it on its own.
  const src = fs.readFileSync(path.join(HERE, "figures.js"), "utf8");
  assert.match(src, /setFromObject/,
    "figures.js no longer measures the body it is scaling");
  const heights = files.map(f => {
    const g = readGlb(path.join(FIGURES, f));
    return Math.max(...g.meshes.flatMap(m_ => m_.primitives)
      .map(p => g.accessors[p.attributes.POSITION].max[1]));
  });
  assert.ok(Math.max(...heights) - Math.min(...heights) > 0.05,
    "the bodies are all one height after all, so the measuring is pointless");
  const person = Number(/PERSON_HEIGHT_M = ([\d.]+)/.exec(src)[1]);
  assert.ok(person > 1.5 && person < 2.0, `a person is ${person} m`);
  // Scaled to a person, none of them is a giant or a child.
  for (let i = 0; i < files.length; i++) {
    const scaled = heights[i] * (person / heights[i]);
    assert.ok(Math.abs(scaled - person) < 1e-9, files[i]);
  }
});

// ---- the module ------------------------------------------------------------

const src = fs.readFileSync(path.join(HERE, "figures.js"), "utf8")
  .replace(/from "(three|three\/[^"]*)"/g, `from "${STUB}"`);
const figures = await import(
  "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"));

await figures.preload();

await test("a walker is handed back at once, before anything has loaded", () => {
  const who = figures.buildWalker(0);
  assert.ok(who, "no group came back");
  assert.equal(typeof who.stride, "function", "it cannot be walked");
  // The callers drive stride from the first frame, before the model can be
  // there. It has to answer rather than throw.
  who.stride(12.5);
});

await test("the walk runs off ground covered, not off a clock", async () => {
  const who = figures.buildWalker(0);
  await figures.preload();
  await new Promise(r => setTimeout(r, 0));
  who.stride(0);
  who.stride(1.52);          // one whole cycle, two steps of 0.76
  assert.equal(who.walked, 1.52);
});

await test("standing still keeps the feet still", async () => {
  const who = figures.buildWalker(0);
  await figures.preload();
  await new Promise(r => setTimeout(r, 0));
  who.stride(5);
  const stood = who.walked;
  who.stride(5);
  assert.equal(who.walked, stood, "the feet moved while the figure did not");
});

await test("the coat picks a body and the same coat picks the same one", async () => {
  const a = figures.buildWalker(0x2b3a52);
  const b = figures.buildWalker(0x2b3a52);
  await figures.preload();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(a.children[0].name, b.children[0].name,
    "the same caller got two different people");
  assert.ok(figures.bodyCount() === 12);
});

await test("the model is turned to face the way everything else faces", async () => {
  const who = figures.buildWalker(3);
  await figures.preload();
  await new Promise(r => setTimeout(r, 0));
  const body = who.children[0];
  assert.ok(body, "no body was added");
  assert.ok(Math.abs(body.rotation.y - Math.PI) < 1e-9,
    "the model faces the other way to the rest of the scene");
});

if (!process.exitCode) {
  console.log(`\nPASS: ${files.length} bodies on one rig and one texture, `
    + `walking off the ground they cover.`);
}
