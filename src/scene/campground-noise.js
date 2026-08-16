// How far the campground carries, on the worst night rather than an average one.
//
// Worst case is the case that matters. A campground is not a nuisance on the
// median evening, it is a nuisance on the still warm one when the place is full
// and everybody is up late, and that is the night this models. Three choices
// make it the worst case and each is written down below: every site occupied and
// sounding at once, people talking at a raised voice rather than a quiet one,
// and a nocturnal inversion holding the sound down on the ground.
//
// The level at a point is the energy sum over every site,
//
//     10 log10 ( sum over sites of 10^((SITE_DB - loss(r)) / 10) )
//
// and loss(r) is where the inversion lives.
//
// THE INVERSION. After sunset the ground cools faster than the air over it, so
// the air a hundred metres up is warmer than the air at head height. Sound
// travels faster in warm air, so a ray climbing out of the camp is bent back
// down. Past the range where the bending returns it to the ground, the sound
// stops spreading over a sphere and starts spreading over a cylinder, and the
// falloff goes from 6 dB per doubling of distance to 3. That is a surface duct
// and it is why you can hear a road at night that you cannot hear at noon.
//
// The duct does not run for ever. Every bounce off soft ground takes something
// out and the air itself absorbs the high end, so a term proportional to
// distance is carried alongside. Without it the model would never fall silent.
//
// WHAT IS STILL NOT IN IT:
//
//   Wind, which adds about as much again downwind and takes it away upwind. On
//   the worst night the wind is calm, which is the condition the duct wants, so
//   leaving it out is the right way round for a worst case.
//
//   The trees, worth 1 to 3 dB per 10 m of belt and no more. A screen you cannot
//   see through is not a screen you cannot hear through, and leaving it out
//   costs a couple of decibels.
//
//   The terrain, which on this plateau shields nothing from anything anyway.
//
// So this is an upper bound on the shape of the falloff, not a prediction of a
// level. A real assessment measures the background at the houses over several
// nights and models it under ISO 9613-2, which is itself a downwind model for
// much the same reason this one is a night model. Nothing read off this belongs
// in a comment to the county.

// One occupied site, at a metre. A raised voice, which is how people talk
// outdoors around a fire with others talking near them — not a shout, and not
// the 60 dB of ordinary indoor conversation.
export const SITE_DB = 70;

// Where the duct closes: how far a ray climbing out of the camp travels before
// the inversion has bent it back to the ground. A few hundred metres under a
// clear-sky nocturnal inversion. Inside it the sound has not yet been turned
// and the spreading is ordinary.
export const DUCT_M = 200;

// What the duct still loses per kilometre, from the air absorbing the high end
// and from each bounce off soft ground. Without this the cylinder never dies and
// the camp is audible in Vancouver.
export const ALPHA_DB_PER_KM = 3;

// Where the bands are cut. The first two are the law — WAC 173-60 allows 55 dBA
// at a residence and 45 dBA between ten at night and seven in the morning, which
// is condition 49. The other two are what a quiet rural night sounds like: it
// sits at 25 to 35 dB, so 35 is where the camp stands out of it and 25 is where
// it joins it.
//
// One hue, stepped, quietest deepest. Run through the data-viz validator on both
// surfaces it is drawn on — this panel's dark background and the terrain — and
// it holds monotone lightness, visible gaps and one hue on all of them. The
// quietest step does not clear the 2:1 floor against mid terrain, and that is
// the intended behaviour rather than a miss: this is a sequential field and its
// low end means "barely anything", which is allowed to recede toward the ground.
export const BANDS = [
  { min: 55, label: "55+", color: "#e79ab6" },
  { min: 45, label: "45", color: "#da6690" },
  { min: 35, label: "35", color: "#b4446d" },
  { min: 25, label: "25", color: "#843150" },
];

// How much is lost getting r metres from a source, in decibels. Spherical while
// the ray is still climbing, cylindrical once the inversion has turned it, and
// the ground and the air taking their cut the whole way.
export function spreadingLoss(r) {
  const d = Math.max(r, 1);
  const geometric = d <= DUCT_M
    ? 20 * Math.log10(d)
    : 20 * Math.log10(DUCT_M) + 10 * Math.log10(d / DUCT_M);
  return geometric + (ALPHA_DB_PER_KM * d) / 1000;
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
