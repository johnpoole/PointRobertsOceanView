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

// One slot out of a run, not interpolated. For anything that is a word rather
// than a number — a sky description, whether the stream is flooding or slack.
export function slotAt(series, run, when) {
  const i = indexIn(series, when);
  if (i == null || !Array.isArray(run) || i > run.length - 1) return null;
  return run[Math.round(i)];
}
