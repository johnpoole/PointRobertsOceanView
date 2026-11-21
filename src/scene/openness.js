// How much of the sky a point on the ground can see, worked out from the
// heightmap it is drawn from. The foot of a bank has the bank standing over one
// side of it and a gully has a wall on both, so less of the sky's light reaches
// them than reaches open ground. That is the whole of it: this dims the light
// that comes from the sky and leaves the sun alone. The sun has its own shadows.
//
// For each point the ground is walked outward in eight directions, and the
// steepest angle anything stands up at is kept for each. A sky of even
// brightness lights a level surface in proportion to the square of the cosine
// of that angle, so the eight are averaged that way.
//
// Only the ground is in it. The lidar is bare earth, so a house or a fir stands
// over nothing here.
//
// Imports nothing, so node can run it against the baked heightmap.

// How far out the ground is looked at, in metres. The nearest catches a deck
// cut and a stair, the furthest a bluff.
export const REACH_M = [1.5, 4, 10, 25];

const DIRECTIONS = 8;

// heights: metres, row-major, north row first. cellNorthM and cellEastM are the
// size of one cell on the ground. skip(n) is true for a cell with no ground in
// it, and is left out where every cell has. Returns a byte per cell: 255 sees
// the whole sky.
export function openness(heights, nrows, ncols, cellNorthM, cellEastM, skip = null) {
  if (heights.length !== nrows * ncols) {
    throw new Error(
      `openness: ${heights.length} heights for a ${nrows} x ${ncols} grid, ` +
      `which wants ${nrows * ncols}.`);
  }
  // Each direction as the grid steps it takes and how far apart those are on
  // the ground. A reach shorter than a cell lands on the point itself and is
  // dropped; one that lands where a shorter reach already did is dropped too.
  const steps = [];
  for (let k = 0; k < DIRECTIONS; k++) {
    const a = (k / DIRECTIONS) * 2 * Math.PI;
    const east = Math.sin(a), north = Math.cos(a);
    const seen = new Set();
    const ring = [];
    for (const reach of REACH_M) {
      const di = -Math.round((reach * north) / cellNorthM);   // rows run south
      const dj = Math.round((reach * east) / cellEastM);
      const key = `${di},${dj}`;
      if ((di === 0 && dj === 0) || seen.has(key)) continue;
      seen.add(key);
      ring.push({ di, dj, perM: 1 / Math.hypot(di * cellNorthM, dj * cellEastM) });
    }
    steps.push(ring);
  }

  const out = new Uint8Array(nrows * ncols);
  for (let i = 0; i < nrows; i++) {
    for (let j = 0; j < ncols; j++) {
      const n = i * ncols + j;
      if (skip && skip(n)) { out[n] = 255; continue; }
      const here = heights[n];
      let sum = 0;
      for (let k = 0; k < DIRECTIONS; k++) {
        const ring = steps[k];
        let steepest = 0;   // rise over run. Ground that falls away hides nothing.
        for (let s = 0; s < ring.length; s++) {
          const ii = i + ring[s].di, jj = j + ring[s].dj;
          // Off the tile there is no ground to stand in the way.
          if (ii < 0 || ii >= nrows || jj < 0 || jj >= ncols) continue;
          const m = ii * ncols + jj;
          if (skip && skip(m)) continue;
          const rise = (heights[m] - here) * ring[s].perM;
          if (rise > steepest) steepest = rise;
        }
        // cos^2 of the angle whose tangent is the rise.
        sum += 1 / (1 + steepest * steepest);
      }
      out[n] = Math.round((sum / DIRECTIONS) * 255);
    }
  }
  return out;
}
