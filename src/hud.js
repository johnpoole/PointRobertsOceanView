// DOM HUD. Reads feed state and writes the panels: connection, provider health,
// weather, wind vane, tide, vessel count, and the fixed notice. Shows nothing it
// was not given: null fields read as "—", and a dropped feed raises the banner.

import { NOTICE } from "./config.js";

const el = (id) => document.getElementById(id);

const CARDINALS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                   "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

function cardinal(deg) {
  if (deg == null) return "";
  return CARDINALS[Math.round(deg / 22.5) % 16];
}

function num(value, digits, suffix = "") {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits) + suffix;
}

export class Hud {
  constructor() {
    el("notice").textContent = NOTICE;
  }

  setConnection(connected, detail) {
    const conn = el("conn");
    conn.textContent = connected ? "online" : (detail || "offline");
    conn.classList.toggle("live", connected);
    conn.classList.toggle("offline", !connected);

    const banner = el("offline");
    banner.classList.toggle("hidden", connected);
    if (!connected) el("offline-sub").textContent = detail || "connecting…";
  }

  _health(id, status) {
    const node = el(id);
    node.textContent = status || "offline";
    node.classList.remove("live", "offline", "mock", "fallback");
    node.classList.add(status || "offline");
  }

  update(feed) {
    this._health("ph-weather", feed.providerHealth.weather);
    this._health("ph-tide", feed.providerHealth.tide);
    this._health("ph-vessels", feed.providerHealth.vessels);

    // Weather
    const wx = feed.weather && feed.weather.data;
    el("wx-station").textContent = wx && wx.station_id ? wx.station_id : "";
    el("wx-desc").textContent = wx && wx.description ? wx.description : "—";
    el("wx-temp").textContent = wx ? num(wx.temperature_c, 1, " °C") : "—";
    el("wx-cloud").textContent = wx ? num(wx.cloud_cover_percent, 0, " %") : "—";
    el("wx-vis").textContent = wx && wx.visibility_m != null
      ? (wx.visibility_m / 1000).toFixed(1) + " km" : "—";
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
    const tide = feed.tide && feed.tide.data;
    el("tide-station").textContent = tide && tide.station_id ? tide.station_id : "";
    el("tide-level").textContent = tide
      ? `${num(tide.water_level_m, 2, " m")} ${tide.datum || ""}`.trim() : "—";
    el("tide-trend").textContent = tide && tide.trend ? tide.trend : "—";

    el("vessel-count").textContent = String(feed.vessels.size);
  }
}
