// How far the campground carries, on the worst night rather than an average one.
//
// Worst case is the case that matters. A campground is not a nuisance on the
// median evening, it is a nuisance on the still warm one when the place is full
// and everybody is up late.
//
// This follows ISO 9613-2:1996. That standard is not an afternoon model that has
// to have a night added to it — its own scope says it predicts levels "under
// meteorological conditions favourable to propagation", and names those
// conditions as downwind propagation or, equivalently, propagation under a
// well-developed moderate ground-based temperature inversion, such as commonly
// occurs on clear, calm nights. That is exactly the night in question, and it is
// what the standard is for.
//
//     L(d) = SITE_DB - 20 log10(d) - Aatm - Agr
//
// summed in energy over every site. Every term below is out of the standard and
// the clause it comes from is written beside it.
//
// AN EARLIER VERSION OF THIS FILE WAS WRONG AND THE WAY IT WAS WRONG IS WORTH
// KEEPING. It carried a home-made surface duct: spherical spreading to 200 m and
// then cylindrical, 6 dB per doubling of distance becoming 3, on the reasoning
// that a night inversion bends the sound back down. The reasoning is sound and
// the arithmetic was right and the conclusion was still wrong, because ISO 9613-2
// already is the inversion case and its geometrical divergence term is spherical
// at every distance. The duct was the inversion counted twice. It put the 35 dB
// contour at 1170 m where the standard puts it at 390.
//
// WHAT IS STILL NOT IN IT:
//
//   The trees. ISO 9613-2 table A.1 gives 1 dB for a path of 10 to 20 m through
//   dense foliage at speech frequencies, and 0,05 dB/m from 20 to 200 m, capped
//   at the 200 m value. The perimeter buffer the permit requires is 30 ft, which
//   is 9 m, shorter than the shortest path in the table. It is worth about a
//   decibel. A screen you cannot see through is not a screen you cannot hear
//   through, and leaving it out costs almost nothing.
//
//   Barriers and housing, which is the right way round for a worst case.
//
//   The terrain, which on this plateau shields nothing from anything anyway.
//
// So this is an upper bound: the level ISO calls one that is seldom exceeded. It
// is not a prediction of a typical night and it is not a measurement. A real
// assessment measures the background at the houses over several nights and runs
// the full octave-band method with the real source spectrum. Nothing read off
// this belongs in a comment to the county.

// One occupied site, at a metre. A raised voice, which is how people talk
// outdoors around a fire with others talking nearby.
//
// Checked two ways rather than taken off a speech table alone. Speech tables put
// ordinary conversation near 60 dB at a metre and a raised voice near 70. And
// the US Bureau of Reclamation's noise appendix for the Navajo Reservoir plan
// puts developed recreation areas — campgrounds and day-use areas — at an Ldn of
// 50 to 65 dBA, as a class. At 70 dB a site this model comes out at 56 dB
// standing in the middle of the camp, which sits mid-band of that range. At 60
// it comes out at 46, below it.
export const SITE_DB = 70;

// Atmospheric absorption, ISO 9613-2:1996 table 2: the coefficient at 500 Hz,
// 10 °C and 70% relative humidity, which is the band speech sits in and the
// coolest, dampest row the table carries. The whole row, for the record:
// 63 Hz 0,1 · 125 Hz 0,4 · 250 Hz 1,0 · 500 Hz 1,9 · 1 kHz 3,7 · 2 kHz 9,7 ·
// 4 kHz 32,8 · 8 kHz 117 dB/km.
export const AIR_DB_PER_KM = 1.9;

// Ground effect, ISO 9613-2:1996 equation (10) — the alternative method, which
// applies when only the A-weighted level is wanted, the ground is porous and the
// sound is not a tone. All three hold here: the lot is forest and pasture and
// the sound is people.
//
//     Agr = 4,8 - (2 hm / d) [17 + (300 / d)]  >= 0 dB
//
// hm is the mean height of the path above the ground. A person at a campsite and
// a person outside a house are both about this far up. Note what this term does:
// it climbs quickly and then sits just under 4,8 dB for ever. It is not a loss
// per kilometre, which is what an earlier version of this file made it.
export const GROUND_PATH_H_M = 1.5;

// Where the bands are cut. The first two are the law — WAC 173-60-040 sets 55
// dBA for a Class A source at a Class A receiving property, and reduces it by 10
// between ten at night and seven in the morning for Class A receiving property,
// which is what condition 49 of the permit invokes. Both figures read off the
// regulation. It also allows short exceedances above those: 5 dBA for 15 minutes
// in an hour, 10 dBA for 5 minutes, 15 dBA for 1,5 minutes. None of that is
// drawn — these bands are the steady limits.
//
// The last band is the night itself: a quiet rural night sits at 25 to 35 dB, so
// 35 is where the camp starts to stand out of it.
//
// Nothing is drawn below 35. There was a 25 dB band and it was wrong to paint: a
// region where the camp cannot be picked out of the background is not an impact
// and must not be coloured like one.
//
// One hue, stepped, quietest deepest. Run through the data-viz validator on both
// surfaces it is drawn on — the map panel's dark background and the ground — and
// it holds monotone lightness, visible gaps and one hue on all of them. The
// quietest step does not clear the 2:1 floor against mid ground, which is the
// documented behaviour of a sequential ramp rather than a miss: its low end is
// allowed to recede toward the surface.
export const BANDS = [
  { min: 55, label: "55+", color: "#e79ab6" },
  { min: 45, label: "45", color: "#cc4e7c" },
  { min: 35, label: "35", color: "#843150" },
];

// ISO 9613-2 equation (10). Floored at zero, as the standard says.
export function groundLoss(d) {
  return Math.max(0, 4.8 - ((2 * GROUND_PATH_H_M) / d) * (17 + 300 / d));
}

// How much is lost getting r metres from a source, in decibels: spherical
// spreading, the air, and the ground. The standard's own divergence term carries
// a further 11 dB because it starts from sound power; SITE_DB is already a
// pressure at a metre, so that conversion is done.
export function spreadingLoss(r) {
  const d = Math.max(r, 1);
  return 20 * Math.log10(d) + (AIR_DB_PER_KM * d) / 1000 + groundLoss(d);
}

// The level at a point, in decibels, from sites given as { pad } rectangles.
export function levelAt(sites, x, z) {
  let energy = 0;
  for (const s of sites) {
    const sx = (s.pad.x0 + s.pad.x1) / 2, sz = (s.pad.z0 + s.pad.z1) / 2;
    // Held at a metre. Inside that a point source is meaningless and the sum
    // would run away to infinity on top of the camp.
    const r = Math.max(Math.hypot(x - sx, z - sz), 1);
    energy += Math.pow(10, (SITE_DB - spreadingLoss(r)) / 10);
  }
  return 10 * Math.log10(energy);
}

// Which band a level falls in, or -1 for below the quietest.
export function bandOf(db) {
  for (let i = 0; i < BANDS.length; i++) if (db >= BANDS[i].min) return i;
  return -1;
}

// How far out there is anything to draw: the range at which every site together
// falls to the quietest band. Solved rather than written down, because the loss
// is no longer a logarithm that can be turned inside out. Bisection, because the
// loss climbs with distance and so the answer is bracketed from the start.
export function reachM(count) {
  const floor = BANDS[BANDS.length - 1].min;
  const together = SITE_DB + 10 * Math.log10(count);
  let lo = 1, hi = 1;
  while (together - spreadingLoss(hi) > floor && hi < 1e6) hi *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (together - spreadingLoss(mid) > floor) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// The whole field as a band index per cell, over a square grid covering the
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
