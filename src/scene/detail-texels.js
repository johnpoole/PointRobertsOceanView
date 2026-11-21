// The grain laid over the ground and the buildings, as numbers. One square of
// it, made here and never drawn by hand, that repeats without a seam: weathered
// stone, with broad lumps, ridges and a net of fine cracks. The shader lays it
// on at several sizes at once, which is what stops any one of them reading as a
// repeat.
//
// The recipe is the rock detail texture out of Abyssal Garden, by Maksymilian
// Dendura (github.com/Noniv/abyssal-garden, MIT), carried over from its shader
// to plain arithmetic and without the pits.
//
// Four numbers a texel, each a byte:
//   0, 1  which way the surface leans there, east and north, 128 being level
//   2     how high it stands, 128 being the mean
//   3     a slow mottle, for patches a little lighter or darker than the rest
//
// The mean height is exactly the middle. The shader multiplies colour by height
// about that middle, so ground a long way off, where the grain has blurred to
// its mean, is the colour it was before there was any grain.
//
// Imports nothing, so node can check it.

export const DETAIL_SIZE = 256;

// How far from the middle the usual height and the usual lean sit, as a share
// of the whole range. Wide enough to use the byte, narrow enough that almost
// nothing is clipped at either end.
export const HEIGHT_RMS = 0.17;
export const LEAN_RMS = 0.3;

function hash(x, y, period, seed) {
  // Wrapped first, which is what makes the far edge meet the near one.
  const wx = ((x % period) + period) % period;
  const wy = ((y % period) + period) % period;
  let h = Math.imul(wx, 73856093) ^ Math.imul(wy, 19349663) ^ Math.imul(period + seed, 83492791);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Smooth noise that repeats every `period` cells.
function noise(x, y, period, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, period, seed), b = hash(ix + 1, iy, period, seed);
  const c = hash(ix, iy + 1, period, seed), d = hash(ix + 1, iy + 1, period, seed);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

// Octaves of it, each twice as fine and half as strong. u and v run 0 to 1
// across the square.
function layered(u, v, period, octaves, seed) {
  let sum = 0, weight = 0.5, total = 0, p = period;
  for (let o = 0; o < octaves; o++) {
    sum += weight * noise(u * p + o * 7.3, v * p + o * 7.3, p, seed + o);
    total += weight;
    weight *= 0.5;
    p *= 2;
  }
  return sum / total;
}

function heightAt(u, v) {
  // Pushed about a little first, so the cracks wander instead of running in
  // the straight lines the lattice would give them.
  const wu = u + 0.11 * (layered(u, v, 3, 4, 11) - 0.5);
  const wv = v + 0.11 * (layered(u + 0.5, v + 0.5, 3, 4, 23) - 0.5);
  const lumps = layered(wu, wv, 3, 6, 31);
  const ridge = 1 - Math.abs(layered(wu + 0.7, wv + 0.7, 5, 5, 47) * 2 - 1);
  const crackA = Math.min(Math.abs(layered(wu + 0.1, wv + 0.1, 4, 5, 59) * 2 - 1) * 7, 1);
  const crackB = Math.min(Math.abs(layered(wv + 0.3, wu + 0.3, 9, 4, 71) * 2 - 1) * 9, 1);
  return lumps * 0.5 + ridge * ridge * 0.24 + crackA * crackB * 0.26;
}

// The square, as size * size * 4 bytes, north row first.
export function detailTexels(size = DETAIL_SIZE) {
  const heights = new Float64Array(size * size);
  let mean = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const h = heightAt((x + 0.5) / size, (y + 0.5) / size);
      heights[y * size + x] = h;
      mean += h;
    }
  }
  mean /= size * size;
  let spread = 0;
  for (let n = 0; n < heights.length; n++) spread += (heights[n] - mean) ** 2;
  spread = Math.sqrt(spread / heights.length);
  if (!(spread > 0)) {
    throw new Error(
      `detailTexels: the ${size} x ${size} grain came out flat, with every ` +
      `height at ${mean}. The noise in detail-texels.js is broken.`);
  }

  // Lean, from the heights either side, wrapping at the edge like everything
  // else here. Scaled so the usual lean sits well inside a byte.
  const lean = new Float64Array(size * size * 2);
  let leanSq = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const e = heights[y * size + ((x + 1) % size)];
      const w = heights[y * size + ((x + size - 1) % size)];
      const s = heights[((y + 1) % size) * size + x];
      const n = heights[((y + size - 1) % size) * size + x];
      const n2 = (y * size + x) * 2;
      lean[n2] = e - w;
      lean[n2 + 1] = s - n;
      leanSq += lean[n2] ** 2 + lean[n2 + 1] ** 2;
    }
  }
  const leanScale = LEAN_RMS / Math.sqrt(leanSq / (size * size * 2));

  const out = new Uint8Array(size * size * 4);
  const byte = (v) => Math.min(255, Math.max(0, Math.round(v * 255)));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = y * size + x;
      out[n * 4] = byte(0.5 + 0.5 * lean[n * 2] * leanScale);
      out[n * 4 + 1] = byte(0.5 + 0.5 * lean[n * 2 + 1] * leanScale);
      out[n * 4 + 2] = byte(0.5 + (heights[n] - mean) * (HEIGHT_RMS / spread));
      out[n * 4 + 3] = byte(layered((x + 0.5) / size + 0.7, (y + 0.5) / size + 0.7, 3, 5, 97));
    }
  }
  return out;
}
