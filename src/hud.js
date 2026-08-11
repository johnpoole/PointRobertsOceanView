// DOM HUD. Reads feed state and writes the panels: connection, provider health,
// weather, wind vane, tide, vessel count, and the fixed notice. Shows nothing it
// was not given: null fields read as "—", and a dropped feed raises the banner.

const el = (id) => document.getElementById(id);

const CARDINALS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                   "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

const KNOT = 0.514444;   // m/s, for the helm readout

function cardinal(deg) {
  if (deg == null) return "";
  return CARDINALS[Math.round(deg / 22.5) % 16];
}

function num(value, digits, suffix = "") {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits) + suffix;
}

export class Hud {
  // The row in the corner. Says what it is doing from the first frame, because a
  // one-line reading is not in anybody's way.
  setConnection(connected, detail) {
    const conn = el("conn");
    conn.textContent = connected ? "online" : (detail || "offline");
    conn.classList.toggle("live", connected);
    conn.classList.toggle("offline", !connected);
  }

  // The banner across the middle of the view. Separate from the row above, and
  // the caller decides when: it used to go up the instant the page loaded and
  // came down when the socket opened, so every single load began with a red box
  // over the water saying the feed was offline when nothing was wrong.
  banner(show, detail) {
    el("offline").classList.toggle("hidden", !show);
    if (show) el("offline-sub").textContent = detail || "reconnecting…";
  }

  _health(id, status) {
    const node = el(id);
    node.textContent = status || "offline";
    node.classList.remove("live", "offline", "mock", "fallback", "scraped");
    node.classList.add(status || "offline");
  }

  // `at` is what the feeds say at the hour the page is standing at. On the
  // present hour it is the feed itself. Moved off it, these are forecasts, and
  // the panels say so rather than showing a forecast where a gauge reading was.
  update(feed, at = {}) {
    this._health("ph-weather", feed.providerHealth.weather);
    this._health("ph-tide", feed.providerHealth.tide);
    this._health("ph-currents", feed.providerHealth.currents);
    this._health("ph-vessels", feed.providerHealth.vessels);
    this._health("ph-aircraft", feed.providerHealth.aircraft);
    el("ais-why").textContent = feed.vesselsNote || "";

    // Weather
    const wx = at.weather || (feed.weather && feed.weather.data);
    el("wx-station").textContent = wx && wx.station_id ? wx.station_id : "";
    el("wx-desc").textContent = wx && wx.description ? wx.description : "—";
    el("wx-temp").textContent = wx ? num(wx.temperature_c, 1, " °C") : "—";
    el("wx-cloud").textContent = wx ? num(wx.cloud_cover_percent, 0, " %") : "—";
    el("wx-vis").textContent = wx && wx.visibility_m != null
      ? (wx.visibility_m / 1000).toFixed(1) + " km" : "—";
    el("wx-sea").textContent = wx && wx.wave_height_m != null
      ? `${wx.wave_height_m.toFixed(1)} m${wx.wave_direction_degrees != null ? " " + cardinal(wx.wave_direction_degrees) : ""}`
      : "—";
    el("wx-rh").textContent = wx ? num(wx.relative_humidity_percent, 0, " %") : "—";
    el("wx-precip").textContent = wx ? num(wx.precipitation_probability_percent, 0, " %") : "—";

    const dir = wx ? wx.wind_direction_degrees : null;
    const spd = wx ? wx.wind_speed_mps : null;
    el("wx-wind").textContent = spd == null
      ? "—"
      : `${spd.toFixed(1)} m/s${dir != null ? " from " + Math.round(dir) + "° " + cardinal(dir) : ""}`;
    // Vane points into the wind (toward the FROM direction). Arrow rests pointing
    // north; rotate clockwise by the from-bearing.
    const arrow = el("vane-arrow");
    if (dir != null) arrow.style.transform = `rotate(${dir}deg)`;

    // Tide
    const tide = at.tide || (feed.tide && feed.tide.data);
    el("tide-station").textContent = tide && tide.station_id ? tide.station_id : "";
    el("tide-level").textContent = tide
      ? `${num(tide.water_level_m, 2, " m")} ${tide.datum || ""}`.trim() : "—";
    el("tide-trend").textContent = tide && tide.predicted
      ? "predicted" : (tide && tide.trend ? tide.trend : "—");
    // A forecast is not a reading and the panel titles say which is on screen.
    el("wx-station").textContent = wx && wx.predicted
      ? "forecast" : (wx && wx.station_id ? wx.station_id : "");

    el("vessel-count").textContent = String(feed.vessels.size);
    el("aircraft-count").textContent = String(feed.aircraft.size);
  }

  // The helm, in boat mode only. boat is Nav's own state: heading and course are
  // radians about +Y, speed and madeGood are metres a second. A null course
  // means it is not going anywhere worth naming a bearing for.
  helm(show, boat, current) {
    el("helm").classList.toggle("hidden", !show);
    if (!show) return;
    const c = current && current.data;
    el("helm-current").textContent = !c ? "—"
      : c.state === "slack" ? "slack"
      : `${num(c.drift_kn, 1, " kn")} ${Math.round(c.set_degrees)}° ${cardinal(c.set_degrees)}`;
    // Nav's yaw grows counter-clockwise from north; a compass bearing does not.
    const bearing = (rad) => (((-rad * 180) / Math.PI) % 360 + 360) % 360;
    el("helm-heading").textContent =
      `${Math.round(bearing(boat.yaw))}° at ${(boat.speed / KNOT).toFixed(1)} kn`;
    el("helm-course").textContent = boat.course == null ? "—"
      : `${Math.round(bearing(boat.course))}° at ${(boat.madeGood / KNOT).toFixed(1)} kn`;
    el("helm-note").textContent = !c ? "no current reading"
      : `predicted, ${c.station_id} ${c.station_distance_km} km offshore`;
  }
}
