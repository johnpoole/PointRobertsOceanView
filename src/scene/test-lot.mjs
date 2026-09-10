// The old Breakers lot as it stands now: where the hedge is, and the six
// parking aisles left on it.
//
// Run:
//     node src/scene/test-lot.mjs
//
// Both were read off the county 2022 aerial rather than guessed, and the thing
// worth guarding is that they stay read: no hedge on the west side, where the
// image shows none, and every aisle inside the lot it belongs to.

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// brademy-lot.js holds nothing but the numbers and imports nothing, so it is
// read and evaluated on its own. Node treats a bare .js here as CommonJS, which
// is why it goes in as a data url rather than by path.
const source = fs.readFileSync(path.join(here, "brademy-lot.js"), "utf8");
const { LOT, HEDGE_RUNS: sides, AISLES } = await import(
  "data:text/javascript;base64," + Buffer.from(source, "utf8").toString("base64"));

assert.equal(LOT.length, 4, "the lot has four corners");
assert.ok(sides.length >= 2, `${sides.length} hedge runs`);

// Side 2 is SW to NW, the west boundary. The aerial reads 3% vegetated there —
// the lot runs straight out onto the yard next door — so nothing is drawn on it.
assert.ok(!sides.some(r => r.side === 2), "no hedge on the west side");
// East and south are hedged end to end.
for (const side of [0, 1]) {
  const run = sides.find(r => r.side === side);
  assert.ok(run, `a run on side ${side}`);
  assert.equal(run.from, 0, `side ${side} starts at its first corner`);
  assert.equal(run.to, 1, `side ${side} runs to its second`);
}
// The north carries scrub over its eastern part only, not the whole side.
const north = sides.find(r => r.side === 3);
if (north) {
  assert.ok(north.from > 0.2, `the north run starts at ${north.from}, not at the corner`);
  assert.equal(north.to, 1, "and runs to the northeast corner");
}

// Every aisle lies inside the lot, runs north to south, and is a car's width or
// more. The aerial put them between 3.9 and 5.8 m.
const metres = (a, b) => Math.hypot((b[1] - a[1]) * 111320 * Math.cos(a[0] * Math.PI / 180),
                                    (b[0] - a[0]) * 111320);
function inside([lat, lon]) {
  let hit = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const a = LOT[i], b = LOT[j];
    if ((a[0] > lat) !== (b[0] > lat) &&
        lon < (b[1] - a[1]) * (lat - a[0]) / (b[0] - a[0]) + a[1]) hit = !hit;
  }
  return hit;
}
assert.equal(AISLES.length, 6, "six aisles");
for (const [nw, se] of AISLES) {
  assert.ok(inside(nw) && inside(se), `an aisle corner outside the lot: ${nw}`);
  const wide = metres([nw[0], nw[1]], [nw[0], se[1]]);
  const long = metres([nw[0], nw[1]], [se[0], nw[1]]);
  assert.ok(wide > 3 && wide < 8, `an aisle ${wide.toFixed(1)} m wide`);
  assert.ok(long > 60 && long < 100, `an aisle ${long.toFixed(1)} m long`);
  assert.ok(long > wide * 6, "an aisle is long and thin, running north and south");
}
// And they do not lie on top of one another.
const spans = AISLES.map(([nw, se]) => [Math.min(nw[1], se[1]), Math.max(nw[1], se[1])])
  .sort((a, b) => a[0] - b[0]);
for (let i = 1; i < spans.length; i++) {
  assert.ok(spans[i][0] > spans[i - 1][1], "two aisles overlap");
}

console.log(`PASS: hedge on ${sides.length} sides and none on the west, ` +
  `${AISLES.length} aisles inside the lot, none overlapping.`);
