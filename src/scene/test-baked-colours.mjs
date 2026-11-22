// Run: node src/scene/test-baked-colours.mjs
import assert from "node:assert/strict";
import { bakedColours } from "./baked-colours.js";

const near = (got, want) => assert.ok(
  got.length === want.length && want.every((v, i) => Math.abs(got[i] - v) < 1e-6),
  `${Array.from(got)} is not ${want}`);

// A part with one colour in its material is that colour all over.
near(bakedColours(2, null, { r: 0.2, g: 0.4, b: 0.6 }), [0.2, 0.4, 0.6, 0.2, 0.4, 0.6]);

// A bicycle: a black tyre and a red frame in one mesh under a white material.
// It used to come out white at both.
const colours = [[0.05, 0.05, 0.05], [0.8, 0.1, 0.1]];
const own = { getX: i => colours[i][0], getY: i => colours[i][1], getZ: i => colours[i][2] };
near(bakedColours(2, own, { r: 1, g: 1, b: 1 }), [0.05, 0.05, 0.05, 0.8, 0.1, 0.1]);

// A tinted material over painted vertices multiplies, as it does when drawn.
near(bakedColours(1, own, { r: 0.5, g: 1, b: 0 }), [0.025, 0.05, 0]);

console.log("PASS: a part keeps its own colours when its material is baked in.");
