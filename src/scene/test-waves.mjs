// Run: node src/scene/test-waves.mjs
import assert from 'node:assert/strict';
import { PARTS, ampFor, carried, lengthFor } from './waves.js';

// The reading in the issue: 0.54 m at 2.95 s.
// Sample the three sines over a long run and measure what they stand at.
function measuredHeight(amp0, len0) {
  let sum = 0, sumSq = 0, n = 0;
  for (let x = 0; x < 20000; x += 0.25) {
    let h = 0;
    PARTS.forEach((p, i) => {
      // Each part runs at its own length and angle, so they do not stay in step.
      h += amp0 * p.amp * Math.sin((2 * Math.PI * x) / (len0 * p.len) + i * 1.7);
    });
    sum += h; sumSq += h * h; n++;
  }
  const mean = sum / n;
  return 4 * Math.sqrt(sumSq / n - mean * mean);
}

const amp = ampFor(0.54);
const drawn = measuredHeight(amp, lengthFor(2.95));
assert.ok(Math.abs(drawn - 0.54) < 0.01,
  `a 0.54 m sea was drawn ${drawn.toFixed(3)} m high`);

// Half the height, which is what it was, stands 1.82 times too high.
assert.ok(Math.abs(measuredHeight(0.54 / 2, 13.6) / 0.54 - 1.82) < 0.02);

// 2.95 s is a 13.6 m wave. It used to be held at 70.
assert.ok(Math.abs(lengthFor(2.95) - 13.6) < 0.05, String(lengthFor(2.95)));
assert.ok(Math.abs(lengthFor(8) - 99.9) < 0.1, String(lengthFor(8)));

// A mesh with points 47 m apart carries none of a 14 m wave and all of a 300 m one.
assert.equal(carried(13.6, 46.875), 0);
assert.equal(carried(100, 46.875), 0);
assert.equal(carried(300, 46.875), 1);
const part = carried(210, 46.875);
assert.ok(part > 0 && part < 1, String(part));

console.log('PASS: the sea stands at the height reported and runs at the length its period gives.');
