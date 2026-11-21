// Run: node src/scene/test-openness.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openness, REACH_M } from './openness.js';

// Level ground sees the whole sky.
{
  const flat = new Float32Array(40 * 40).fill(7);
  const open = openness(flat, 40, 40, 1, 1);
  assert(open.every(v => v === 255), 'level ground is fully open');
}

// A slope that climbs one way and falls the other. Uphill the ground stands at
// the slope's own angle, downhill it hides nothing, and the two directions
// square across see level ground. So the eight come to a closed form.
{
  const n = 81, rise = 0.5;
  const ramp = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) ramp[i * n + j] = j * rise;
  const open = openness(ramp, n, n, 1, 1);
  const cos2 = (t) => 1 / (1 + t * t);
  const s = Math.SQRT1_2;
  // East, the two diagonals with an eastward half, and five that see nothing.
  // A diagonal runs root two along the ground for each cell east.
  const want = (cos2(rise) + 2 * cos2(rise * s) + 5) / 8;
  const got = open[40 * n + 40] / 255;
  assert(Math.abs(got - want) < 0.01, `mid-slope openness ${got}, expected ${want}`);
}

// The floor of a trench is darker than its rim, and darker the deeper it is.
{
  const n = 81;
  const trench = (depth) => {
    const z = new Float32Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      z[i * n + j] = Math.abs(j - 40) <= 2 ? 0 : depth;
    }
    return openness(z, n, n, 1, 1);
  };
  const shallow = trench(1), deep = trench(6);
  assert(shallow[40 * n + 40] < shallow[40 * n + 60], 'the floor sees less sky than the rim');
  assert(deep[40 * n + 40] < shallow[40 * n + 40], 'a deeper trench is darker');
  assert.equal(deep[40 * n + 60], 255, 'the top of the wall looks down, and is open');
}

// A cell with no ground in it neither hides anything nor is shaded.
{
  const n = 41;
  const z = new Float32Array(n * n);
  const hole = 20 * n + 22;
  z[hole] = -3000;                       // what nodata looks like in a heightmap
  const wall = 20 * n + 18;
  z[wall] = 50;
  const open = openness(z, n, n, 1, 1, (m) => m === hole || m === wall);
  assert.equal(open[20 * n + 20], 255, 'skipped neighbours cast nothing');
  assert.equal(open[hole], 255, 'a skipped cell is left open');
}

assert.throws(() => openness(new Float32Array(10), 4, 4, 1, 1), /16/,
  'a grid of the wrong size says what size it wanted');

// The ground the page draws. The beach is open, the foot of the bluff is not,
// and it has to be quick: this runs on load, on three and a half million cells.
{
  const meta = JSON.parse(readFileSync(new URL('../../assets/terrain/meta.json', import.meta.url)));
  const raw = readFileSync(new URL('../../assets/terrain/heightmap.bin', import.meta.url));
  const { nrows, ncols, cellsize_deg, north_lat, scale_m } = meta.grid;
  const counts = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  assert.equal(counts.length, nrows * ncols);
  const z = new Float32Array(counts.length);
  for (let n = 0; n < z.length; n++) z[n] = counts[n] * scale_m;
  const cellNorthM = cellsize_deg * 111320;
  const cellEastM = cellNorthM * Math.cos(north_lat * Math.PI / 180);
  const began = performance.now();
  const open = openness(z, nrows, ncols, cellNorthM, cellEastM);
  const took = performance.now() - began;
  let sum = 0, least = 255, under = 0;
  for (let n = 0; n < open.length; n++) {
    sum += open[n];
    if (open[n] < least) least = open[n];
    if (open[n] < 230) under++;
  }
  const mean = sum / open.length / 255;
  console.log(`near tile: ${nrows} x ${ncols} in ${took.toFixed(0)} ms, mean ${mean.toFixed(3)}, ` +
    `least ${(least / 255).toFixed(2)}, ${(100 * under / open.length).toFixed(1)}% under 0.90, ` +
    `reach ${REACH_M.join(', ')} m`);
  assert(mean > 0.95, 'most of the peninsula is open ground');
  assert(least < 0.75 * 255, 'somewhere on it there is a hollow');
  assert(took < 5000, `openness took ${took.toFixed(0)} ms on the near tile`);
}
console.log('PASS: level ground, a slope against its closed form, a trench, holes, and the baked near tile');
