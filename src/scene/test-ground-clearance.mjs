import assert from "node:assert/strict";
import { groundClearance } from "./ground-clearance.js";

const surfaces = [
  { polygon: [[-2, -1], [2, -1], [2, 1], [-2, 1]], ceiling: 4 },
  { polygon: [[0, 0], [3, 0], [3, 2], [0, 1]], ceiling: 3 },
];
const diagonal = Math.hypot(0.188, 0.286), cut = groundClearance(surfaces, diagonal);
assert.equal(cut(1, 0.5, 9), 3, "overlapping regions take the lower ceiling");
assert.equal(cut(0, 0, 2), 2, "existing low ground is never filled");
assert.equal(cut(4, 4, 9), 9, "outside the finite correction remains unchanged");
assert.equal(cut(-2 - diagonal, 0, 9), 4, "full-depth clearance includes a grid diagonal");
const fading = cut(-2 - diagonal - 0.3, 0, 9);
assert.ok(Math.abs(fading - 6.5) < 1e-10, "bounded transition back to original ground");
assert.equal(cut(-2 - diagonal - 0.601, 0, 9), 9);

// A skinny diagonal flight crossing a grid is the failure case: clipping only
// vertices inside its polygon misses most treads. Check interpolation across
// every intersecting cell, for multiple rotations relative to the terrain.
let samples = 0;
for (const yaw of [0, 0.318, 0.83, 1.5]) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const local = (x, z) => [x * c - z * s, x * s + z * c];
  const ceiling = groundClearance([{ polygon: [[0, 0], [2, 0], [2, 0.25], [0, 0.25]], ceiling: 3 }], diagonal);
  const at = (x, z) => ceiling(...local(x, z), 7 + 0.4 * x + 0.3 * z);
  for (let x = -2.2; x < 2.2; x += 0.188) for (let z = -2.2; z < 2.2; z += 0.286) {
    const a = at(x, z), b = at(x + 0.188, z), d = at(x + 0.188, z + 0.286), e = at(x, z + 0.286);
    for (const u of [0, 0.17, 0.51, 0.89, 1]) for (const v of [0, 0.23, 0.57, 0.93, 1]) {
      const [lx, lz] = local(x + u * 0.188, z + v * 0.286);
      if (lx < 0 || lx > 2 || lz < 0 || lz > 0.25) continue;
      const triangle = u + v <= 1 ? a * (1 - u - v) + b * u + e * v
        : b * (1 - v) + e * (1 - u) + d * (u + v - 1);
      const bilinear = a * (1 - u) * (1 - v) + b * u * (1 - v) + e * (1 - u) * v + d * u * v;
      assert.ok(triangle <= 3 + 1e-10, "rendered triangle cannot poke through a narrow surface");
      assert.ok(bilinear <= 3 + 1e-10, "sampler cannot poke through a narrow surface");
      samples++;
    }
  }
}
assert.ok(samples > 500);
console.log(`Ground clearance passed: ${samples} rotated-flight samples, local cut-only bounds and interpolation.`);
