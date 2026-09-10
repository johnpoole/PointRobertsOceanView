// The marina car park, and the rule that nothing stands in it unless the camera
// is being read.
//
// Run:
//     node src/scene/test-marina-lot.mjs
//
// The counts come off a camera nobody has calibrated, so the one thing this
// guards above all is that a count of zero, a camera that failed, and a server
// that is not looking all draw the same thing: an empty car park.

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

globalThis.location = { protocol: "http:", host: "localhost" };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUB = pathToFileURL(path.join(HERE, "test-three-stub.mjs")).href;

const rewritten = new Map();
function asDataUrl(file) {
  const abs = path.resolve(file);
  if (rewritten.has(abs)) return rewritten.get(abs);
  const src = fs.readFileSync(abs, "utf8").replace(/from\s+"([^"]+)"/g, (whole, spec) => {
    if (spec === "three" || spec.startsWith("three/")) return `from "${STUB}"`;
    if (spec.startsWith(".")) return `from "${asDataUrl(path.resolve(path.dirname(abs), spec))}"`;
    throw new Error(`test-marina-lot: ${path.basename(abs)} imports "${spec}"`);
  });
  const url = "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64");
  rewritten.set(abs, url);
  return url;
}

const { buildMarinaLot, LOT } = await import(asDataUrl(path.join(HERE, "marina-lot.js")));
const { toWorld } = await import(asDataUrl(path.join(HERE, "../geo.js")));

// Flat ground, so what is being checked is the placing and not the terrain.
const scene = { children: [], add(o) { this.children.push(o); } };
const lot = buildMarinaLot(scene, () => 3.2);

// The lot as traced: a long two-row car park, not a square and not a street.
const a = toWorld(...LOT.southWest), b = toWorld(...LOT.northEast);
const run = Math.hypot(b.x - a.x, b.z - a.z);
assert.ok(run > 50 && run < 65, `lot is ${run.toFixed(1)} m long`);
assert.ok(LOT.width > 15 && LOT.width < 22, `lot is ${LOT.width} m across`);
assert.ok(LOT.depth * 2 < LOT.width, "two rows of stalls fit across it with an aisle left over");
assert.ok(lot.stalls >= 8, `${lot.stalls} stalls drawn`);

const cars = lot.group.children.filter(o => o.name.startsWith("marina-car-"));
const people = lot.group.children.filter(o => o.name.startsWith("marina-person-"));
assert.equal(cars.length, lot.stalls);
assert.ok(people.length > 0, "somewhere for the people to stand");
assert.ok(lot.group.children.some(o => o.name === "marina-lot-paving"), "the paving is drawn");

// Every car stands inside the lot it belongs to.
const along = { x: (b.x - a.x) / run, z: (b.z - a.z) / run };
const across = { x: -along.z, z: along.x };
for (const car of cars) {
  const dx = car.position.x - a.x, dz = car.position.z - a.z;
  const down = dx * along.x + dz * along.z, over = dx * across.x + dz * across.z;
  assert.ok(down > 0 && down < run, `a car ${down.toFixed(1)} m down a ${run.toFixed(1)} m lot`);
  assert.ok(over > 0 && over < LOT.width, `a car ${over.toFixed(1)} m across a ${LOT.width} m lot`);
}

const showing = () => cars.filter(c => c.visible).length + people.filter(p => p.visible).length;

// Nothing is drawn until the camera is actually being read.
lot.update(null);
assert.equal(showing(), 0, "a car park with no feed is empty");
lot.update({ data: { watching: false } });
assert.equal(showing(), 0, "nobody looking, nothing drawn");
lot.update({ data: { watching: true, error: "snapshot 502" } });
assert.equal(showing(), 0, "a camera that failed draws nothing, and the readout says why");
lot.update({ data: { watching: true, vehicles: 0, people: 0 } });
assert.equal(showing(), 0, "an empty lot is an empty lot");

lot.update({ data: { watching: true, vehicles: 3, people: 2 } });
assert.equal(cars.filter(c => c.visible).length, 3, "three found, three drawn");
assert.equal(people.filter(p => p.visible).length, 2, "two found, two drawn");
// And it comes back down again rather than leaving cars standing.
lot.update({ data: { watching: true, vehicles: 1, people: 0 } });
assert.equal(showing(), 1, "the count fell and so did the picture");

// More than the lot holds is capped by the lot, not by pretending.
lot.update({ data: { watching: true, vehicles: 500, people: 500 } });
assert.equal(cars.filter(c => c.visible).length, cars.length, "the lot fills and stops");

console.log(`PASS: ${run.toFixed(1)} x ${LOT.width} m car park, ${lot.stalls} stalls, ` +
  `drawn only while the camera is being read.`);
