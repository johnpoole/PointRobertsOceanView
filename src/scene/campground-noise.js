// How far the campground carries, by distance alone.
//
// Every camp site is a point source of SITE_DB at one metre, they all sound at
// once, and their energies add. The level at a point is
//
//     10 log10 ( sum over sites of 10^(SITE_DB/10) / r^2 )
//
// which falls 6 dB per doubling of distance from any one site, and nearer 3 dB
// per doubling close in, where the camp is wider than it is far away. That is
// the whole model. It is geometric spreading and nothing else.
//
// WHAT IS NOT IN IT, all of which moves the answer more than distance does:
//
//   The night inversion. Warm air over cool bends sound back down instead of
//   letting it climb away, and over a flat plateau after dark that is worth 5 to
//   10 dB at a few hundred metres. It is the largest term there is and it is not
//   here.
//
//   Wind. Downwind adds and upwind takes away by about as much.
//
//   Ground effect over soft ground, which takes several dB back out at mid
//   frequencies across a few hundred metres.
//
//   The trees, worth 1 to 3 dB per 10 m of belt and no more. A screen you cannot
//   see through is not a screen you cannot hear through.
//
//   The terrain, which on this plateau shields nothing from anything anyway.
//
// So this is the shape of the falloff and not a prediction of a level. A real
// assessment measures the background at the houses over several nights and
// models it under ISO 9613-2. Nothing read off this belongs in a comment to the
// county.

// One occupied site with people talking, at a metre. Ordinary conversation.
// Every site is given this and every site sounds at once, which is a full camp
// on a summer evening and not an average night.
export const SITE_DB = 60;

// Where the bands are cut. The first two are the law — WAC 173-60 allows 55 dBA
// at a residence and 45 dBA between ten at night and seven in the morning, which
// is condition 49. The other two are what a quiet rural night sounds like: it
// sits at 25 to 35 dB, so 35 is where the camp starts to stand out of it and 25
// is where the camp joins it.
export const BANDS = [
  { min: 55, label: "55+", color: "#f09ec0" },
  { min: 45, label: "45", color: "#d55181" },
  { min: 35, label: "35", color: "#b2496f" },
  { min: 25, label: "25", color: "#8f3a5c" },
];

// The level at a point, in decibels, from sites given as { pad } rectangles.
export function levelAt(sites, x, z) {
  const ref = Math.pow(10, SITE_DB / 10);
  let energy = 0;
  for (const s of sites) {
    const sx = (s.pad.x0 + s.pad.x1) / 2, sz = (s.pad.z0 + s.pad.z1) / 2;
    // Held at a metre. Inside that the point-source model is meaningless and
    // would run away to infinity.
    const r2 = Math.max((x - sx) ** 2 + (z - sz) ** 2, 1);
    energy += ref / r2;
  }
  return 10 * Math.log10(energy);
}

// Which band a level falls in, or -1 for below the quietest.
export function bandOf(db) {
  for (let i = 0; i < BANDS.length; i++) if (db >= BANDS[i].min) return i;
  return -1;
}

// How far out there is anything to draw. Worked from the model rather than
// written down: n sites all at distance d together make
// SITE_DB + 10 log10(n) - 20 log10(d), so the distance at which that reaches the
// quietest band is the edge of the field.
export function reachM(count) {
  const floor = BANDS[BANDS.length - 1].min;
  return Math.pow(10, (SITE_DB + 10 * Math.log10(count) - floor) / 20);
}

// The whole field as a band index per cell, over a square-ish grid covering the
// sites and their reach. Returned in world metres so a caller can place it.
export function noiseField(sites, cells = 220) {
  if (!sites.length) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const s of sites) {
    x0 = Math.min(x0, s.pad.x0); x1 = Math.max(x1, s.pad.x1);
    z0 = Math.min(z0, s.pad.z0); z1 = Math.max(z1, s.pad.z1);
  }
  const reach = reachM(sites.length);
  x0 -= reach; x1 += reach; z0 -= reach; z1 += reach;
  const span = Math.max(x1 - x0, z1 - z0);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  x0 = cx - span / 2; z0 = cz - span / 2;

  const bands = new Int8Array(cells * cells);
  for (let i = 0; i < cells; i++) {
    const z = z0 + (span * (i + 0.5)) / cells;
    for (let j = 0; j < cells; j++) {
      const x = x0 + (span * (j + 0.5)) / cells;
      bands[i * cells + j] = bandOf(levelAt(sites, x, z));
    }
  }
  return { bands, cells, x0, z0, span, reach };
}
