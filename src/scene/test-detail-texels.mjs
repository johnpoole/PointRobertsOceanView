// Run: node src/scene/test-detail-texels.mjs
import assert from 'node:assert/strict';
import { detailTexels, DETAIL_SIZE, HEIGHT_RMS } from './detail-texels.js';

const size = DETAIL_SIZE;
const t = detailTexels();
assert.equal(t.length, size * size * 4);

const channel = (c) => Array.from({ length: size * size }, (_, n) => t[n * 4 + c]);
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const rms = (a, m) => Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);

// The shader multiplies colour by height about the middle. Off the middle, and
// every surface the grain is on gets lighter or darker for it.
const height = channel(2);
assert(Math.abs(mean(height) - 127.5) < 0.75, `height mean is ${mean(height)}, wanted 127.5`);
assert(Math.abs(rms(height, mean(height)) / 255 - HEIGHT_RMS) < 0.01,
  `height spread is ${rms(height, mean(height)) / 255}`);
const clipped = height.filter(v => v === 0 || v === 255).length / height.length;
assert(clipped < 0.005, `${(clipped * 100).toFixed(2)}% of heights are clipped`);

// Level on the whole: a lean that does not average out tilts every surface.
for (const c of [0, 1]) {
  assert(Math.abs(mean(channel(c)) - 127.5) < 1.5, `lean ${c} averages ${mean(channel(c))}`);
}

// No seam. The step across the edge of the square is the same size as the step
// between any two neighbours inside it.
const step = (x0, y0, x1, y1) => Math.abs(t[(y0 * size + x0) * 4 + 2] - t[(y1 * size + x1) * 4 + 2]);
let inside = 0, acrossX = 0, acrossY = 0;
for (let k = 0; k < size; k++) {
  inside += step(size / 2, k, size / 2 + 1, k);
  acrossX += step(size - 1, k, 0, k);
  acrossY += step(k, size - 1, k, 0);
}
assert(acrossX < inside * 1.6 && acrossY < inside * 1.6,
  `seam: ${acrossX} and ${acrossY} across the edge against ${inside} inside`);

// The same square every time, or the ground would change on a reload.
assert.deepEqual(detailTexels(), t);

console.log(`PASS: ${size} x ${size}, height mean ${mean(height).toFixed(2)}, ` +
  `seam ${acrossX}/${acrossY} against ${inside}, ${(clipped * 100).toFixed(2)}% clipped`);
