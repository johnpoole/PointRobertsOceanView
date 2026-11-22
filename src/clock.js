// The clock the scene stands at. Zero is the real one and the slider moves it.
//
// Only what has a forecast behind it reads this: the sun, the tide, the tidal
// stream and the weather. Vessels and aircraft are live positions and there is
// nothing to run them forward to, so they stay where they are and the page says
// the rest is a prediction.

let offsetMs = 0;

export function setOffsetHours(hours) {
  offsetMs = hours * 3600000;
}

export function offsetHours() {
  return offsetMs / 3600000;
}

export function sceneNow() {
  return new Date(Date.now() + offsetMs);
}

// True when the page is standing somewhere other than the present hour, which is
// when a reading stops being a measurement and becomes a forecast.
export function shifted() {
  return offsetMs !== 0;
}

// A run baked by the proxy: { start: "YYYY-MM-DD HH:MMZ", step_s, ... }. Returns
// the fractional index of `when` in it, or null if it falls outside — a run that
// does not reach is not extrapolated, it is refused.
function indexIn(series, when) {
  if (!series || !series.start || !series.step_s) return null;
  const start = Date.parse(series.start.replace(" ", "T"));
  if (!Number.isFinite(start)) return null;
  const i = (when.getTime() - start) / (series.step_s * 1000);
  return i >= 0 ? i : null;
}

// One number out of a run, straight-line between the two slots either side.
export function numberAt(series, run, when) {
  const i = indexIn(series, when);
  if (i == null || !Array.isArray(run) || i > run.length - 1) return null;
  const a = Math.floor(i);
  const b = Math.min(a + 1, run.length - 1);
  const lo = run[a];
  const hi = run[b];
  if (lo == null || hi == null) return lo == null ? hi : lo;
  return lo + (hi - lo) * (i - a);
}

// One bearing out of a run. A compass bearing wraps and a straight line between
// two of them does not: 350 to 10 is twenty degrees round the short way, and
// blended as numbers it reads 180, which points due south when the wind is very
// nearly due north. The vane, the cloud drift and the swell all take this.
//
// So the two are blended as points on the circle and the angle taken back off.
export function bearingAt(series, run, when) {
  const i = indexIn(series, when);
  if (i == null || !Array.isArray(run) || i > run.length - 1) return null;
  const a = Math.floor(i);
  const b = Math.min(a + 1, run.length - 1);
  const lo = run[a];
  const hi = run[b];
  if (lo == null || hi == null) return lo == null ? hi : lo;
  // The signed difference the short way round, which is -180 to +180. Walking
  // that fraction of it from the first bearing crosses north without noticing.
  // Two bearings dead opposite are half a circle apart either way and this turns
  // one of them, always the same one.
  const round = ((hi - lo + 540) % 360) - 180;
  return (lo + round * (i - a) + 360) % 360;
}

// One slot out of a run, not interpolated. For anything that is a word rather
// than a number — a sky description, whether the stream is flooding or slack.
export function slotAt(series, run, when) {
  const i = indexIn(series, when);
  if (i == null || !Array.isArray(run) || i > run.length - 1) return null;
  return run[Math.round(i)];
}

// A total for the hour ending at each slot, which is how rainfall is counted.
// The hour the scene stands in ends at the next slot up, and a total is not
// blended: half way between a dry hour and a wet one it is one or the other.
export function hourEndingAt(series, run, when) {
  const i = indexIn(series, when);
  if (i == null || !Array.isArray(run) || i > run.length - 1) return null;
  return run[Math.ceil(i)];
}

const WEATHER_NUMBERS = ["cloud_cover_percent", "cloud_cover_low_percent",
                         "cloud_cover_mid_percent", "cloud_cover_high_percent",
                         "wind_speed_mps",
                         "temperature_c", "relative_humidity_percent", "visibility_m",
                         "precipitation_probability_percent"];

// The weather at an hour the page has been moved to: the present reading with
// whatever the run holds for that hour laid over it, marked as a forecast.
//
// The run is a few days long and the date box reaches months back. An hour the
// run has nothing at all for comes back with no reading in it and says so. It
// used to come back as the present reading whole, with forecast written on it.
export function weatherAtHour(w, when) {
  const s = w.series;
  if (!s) return w;
  const out = { ...w, predicted: true };
  let found = 0;
  for (const k of WEATHER_NUMBERS) {
    const v = numberAt(s, s[k], when);
    if (v != null) { out[k] = v; found++; }
  }
  // Not with the numbers above it. A bearing wraps and blending it as a number
  // reads 180 halfway between 350 and 10.
  const bearing = bearingAt(s, s.wind_direction_degrees, when);
  if (bearing != null) { out.wind_direction_degrees = bearing; found++; }
  const d = slotAt(s, s.description, when);
  if (d) { out.description = d; found++; }
  // Set whether or not the run has it. What is falling now is not what was
  // falling then, and a run with no figure for the hour leaves it unknown.
  out.precipitation_mm = hourEndingAt(s, s.precipitation_mm, when);
  if (out.precipitation_mm != null) found++;
  if (!found) return { predicted: true, beyond: true };
  return out;
}
