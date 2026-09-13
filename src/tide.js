// The tide at Point Roberts, worked out here.
//
// The proxy sends a two-day run of NOAA's own predictions beside the live
// reading, and that is the better answer wherever it reaches: it is the same
// office that published the harmonics, run through their own software. But the
// date box reaches back months and the run does not, and past the end of it the
// sea had nothing to stand on.
//
// So this is the fallback, and it is the same arithmetic NOAA do. The tide is a
// sum of thirty-seven cosines, each with its own size, speed and head start, and
// those are baked into assets/tide/harmonics.json off NOAA's own publication of
// them. Checked against their published predictions it lands within seven
// centimetres four years out.
//
// What this cannot do is the surge. That is the weather pushing water about, it
// is measured and not computed, and it only exists for now. A day worked out
// here is the astronomical tide and nothing else, and anything showing it says
// predicted.

import { createTidePredictor } from "tide-predictor";

// The nodal corrections. The moon's orbit wobbles on an eighteen year cycle and
// the constituents have to be nudged for where it is in that cycle. Checked
// both ways against NOAA: iho came out at 0.062 m and schureman at 0.067 m, so
// iho it is.
const CORRECTIONS = "iho";

let predictor = null;
let offsetM = 0;
let station = null;

// Hand it the baked file. Returns false if it cannot be used, rather than
// throwing into a render loop — the page still has NOAA's own run for today and
// works without this.
export function loadHarmonics(baked) {
  if (!baked || !Array.isArray(baked.constituents) || !baked.constituents.length) {
    return false;
  }
  predictor = createTidePredictor(baked.constituents, {
    nodeCorrections: CORRECTIONS,
    // The sum is about mean sea level. Everything in this model is metres above
    // MLLW, which is the datum the shoreline is cut at.
    offset: baked.datum_offset_m,
  });
  offsetM = baked.datum_offset_m;
  station = baked.station_id;
  return true;
}

export function ready() {
  return predictor !== null;
}

// Metres above MLLW at an instant, or null if the harmonics never loaded.
export function levelAt(when) {
  if (!predictor) return null;
  const got = predictor.getWaterLevelAtTime({ time: when });
  return got && Number.isFinite(got.level) ? got.level : null;
}

// The highs and lows either side of an instant, newest last. Used for the trend
// and the number the panel shows as the next one coming.
export function extremesAround(when, hours = 24) {
  if (!predictor) return [];
  const half = (hours / 2) * 3600000;
  return predictor.getExtremesPrediction({
    start: new Date(when.getTime() - half),
    end: new Date(when.getTime() + half),
  });
}

// Rising or falling at an instant, off the next extreme that has not happened
// yet. Null when nothing is known.
export function trendAt(when) {
  const next = extremesAround(when).find(e => e.time > when);
  if (!next) return null;
  return next.high ? "rising" : "falling";
}

// What the panel needs, in the shape the live reading already comes in, so the
// HUD does not have to know which of the two it is looking at.
export function stateAt(when) {
  const level = levelAt(when);
  if (level == null) return null;
  const next = extremesAround(when).find(e => e.time > when);
  return {
    station_id: station,
    water_level_m: level,
    prediction_m: next ? next.level : null,
    datum: "MLLW",
    trend: next ? (next.high ? "rising" : "falling") : null,
    // No surge. It is a measurement of the weather on top of the tide and there
    // is none for a day that has gone.
    surge_m: null,
    predicted: true,
    // Worked out here rather than handed over by NOAA, which is worth saying
    // because it is astronomical only.
    computed: true,
  };
}

export function datumOffsetM() {
  return offsetM;
}
