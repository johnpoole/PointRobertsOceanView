import { numberAt, bearingAt } from "../clock.js";

// A shifted clock must have wind for that time, never a fallback to live wind.
export function kiteWind(feed, now, shifted) {
  const weather = feed.weather?.data;
  if (!weather) return {};
  if (shifted) {
    const s = weather.series;
    return {
      windSpeedMps: numberAt(s, s?.wind_speed_mps, now),
      windDirectionDegrees: bearingAt(s, s?.wind_direction_degrees, now),
    };
  }
  if (!feed.connected || feed.providerHealth?.weather !== 'live' || feed.weather.quality?.stale) return {};
  return { windSpeedMps: weather.wind_speed_mps, windDirectionDegrees: weather.wind_direction_degrees };
}
