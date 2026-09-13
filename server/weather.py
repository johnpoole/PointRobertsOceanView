"""Open-Meteo: the air, the sky and the sea state over the peninsula.

Three calls on three hosts. The forecast carries the wind, the cloud by layer
and the hourly run the page reads when its clock is off the present hour. The
air quality call carries the haze, which is the whole of what decides whether a
sunset is gold or red. The marine call carries the wave.

The last two are each wrapped on their own, so a failure costs the sky's
turbidity or the sea state and not the weather.
"""

from __future__ import annotations

import logging
from datetime import datetime

import httpx

from server.when import parse_time, utcnow

log = logging.getLogger("oceanview.weather")


FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"


# WMO weather-interpretation codes -> short text for the HUD.
WMO_CODES = {
    0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Rime fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Dense drizzle",
    56: "Freezing drizzle", 57: "Freezing drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain",
    66: "Freezing rain", 67: "Freezing rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
    80: "Rain showers", 81: "Rain showers", 82: "Violent rain showers",
    85: "Snow showers", 86: "Snow showers",
    95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with hail",
}


def hour_index(times: list[str], now: datetime) -> int | None:
    """Index of the hourly sample for the current hour (times are GMT, on the hour)."""
    stamp = now.strftime("%Y-%m-%dT%H")
    for i, t in enumerate(times):
        if t.startswith(stamp):
            return i
    return 0 if times else None


# What the hourly run carries through to the browser, under the names the state
# already uses, so the client reads one shape whichever hour it is standing at.
HOURLY_FIELDS = {
    "cloud_cover": "cloud_cover_percent",
    "cloud_cover_low": "cloud_cover_low_percent",
    "cloud_cover_mid": "cloud_cover_mid_percent",
    "cloud_cover_high": "cloud_cover_high_percent",
    "wind_speed_10m": "wind_speed_mps",
    "wind_direction_10m": "wind_direction_degrees",
    "temperature_2m": "temperature_c",
    "relative_humidity_2m": "relative_humidity_percent",
    "visibility": "visibility_m",
    "precipitation_probability": "precipitation_probability_percent",
}


def hourly_block(hourly: dict) -> dict:
    """Open-Meteo's hourly run, as an evenly stepped hour the browser can index."""
    times = hourly.get("time") or []
    if len(times) < 2:
        raise RuntimeError(
            f"Open-Meteo returned {len(times)} hourly samples and a run needs at "
            f"least two. Check the hourly= parameter on the forecast call.")
    block = {"start": times[0] + "Z", "step_s": 3600}
    for src, name in HOURLY_FIELDS.items():
        run = hourly.get(src)
        if run is None:
            raise RuntimeError(
                f"Open-Meteo hourly has no {src}, which the forecast call asked "
                f"for. Its parameter list has changed.")
        if len(run) != len(times):
            raise RuntimeError(
                f"Open-Meteo hourly {src} has {len(run)} samples against "
                f"{len(times)} timestamps.")
        block[name] = run
    block["description"] = [WMO_CODES.get(c) for c in hourly.get("weather_code", [])]
    return block


async def fetch_weather(client: httpx.AsyncClient, point: tuple) -> dict:
    """point is (lat, lon). It is the caller's, because the sky over a place is
    the only thing here that knows which place."""
    forecast = await client.get(FORECAST_URL, params={
        "latitude": point[0], "longitude": point[1],
        # The cloud is asked for by layer as well as in total. The total cannot
        # tell a lid from a ceiling of cirrus, and those are the difference
        # between a grey evening and a lit one.
        "current": "temperature_2m,relative_humidity_2m,cloud_cover,cloud_cover_low,"
                   "cloud_cover_mid,cloud_cover_high,wind_speed_10m,"
                   "wind_direction_10m,precipitation,weather_code",
        # The hourly run as well as the reading for now, so a page standing at
        # another hour can shade the sky and set the vane for that hour. Two days
        # covers the twelve hours the clock moves either way.
        "hourly": "visibility,precipitation_probability,cloud_cover,cloud_cover_low,"
                  "cloud_cover_mid,cloud_cover_high,wind_speed_10m,"
                  "wind_direction_10m,temperature_2m,relative_humidity_2m,weather_code",
        "wind_speed_unit": "ms", "timezone": "GMT", "forecast_days": 2,
        "past_days": 1,
    })
    forecast.raise_for_status()
    data = forecast.json()
    cur = data["current"]
    hourly = data.get("hourly", {})
    now = utcnow()
    idx = hour_index(hourly.get("time", []), now)
    vis = hourly.get("visibility", [None])[idx] if idx is not None else None
    pprob = hourly.get("precipitation_probability", [None])[idx] if idx is not None else None

    # How much haze is in the air, which is the whole of what decides whether a
    # sunset is gold or red or nothing at all. Open-Meteo reports it at 550 nm,
    # the same wavelength the browser divides it by.
    #
    # Its own call, on its own host, so a failure here costs the sky's turbidity
    # and nothing else. Null goes through as null and the browser holds the last
    # air it was given rather than inventing clean.
    aod = None
    try:
        air = await client.get(AIR_URL, params={
            "latitude": point[0], "longitude": point[1],
            "current": "aerosol_optical_depth",
        })
        air.raise_for_status()
        aod = air.json().get("current", {}).get("aerosol_optical_depth")
    except Exception as exc:
        log.warning("Aerosol optical depth unavailable, sky turbidity held: %s", exc)

    wave_h = wave_dir = wave_period = swell_period = None
    try:
        marine = await client.get(MARINE_URL, params={
            "latitude": point[0], "longitude": point[1],
            # The combined period is the whole sea surface. The swell period is
            # the long part of it underneath the chop, and on the days there is
            # any it is the part that breaks on the beach.
            "current": "wave_height,wave_direction,wave_period,swell_wave_period",
        })
        marine.raise_for_status()
        m = marine.json().get("current", {})
        wave_h, wave_dir, wave_period = m.get("wave_height"), m.get("wave_direction"), m.get("wave_period")
        swell_period = m.get("swell_wave_period")
    except Exception as exc:
        log.warning("Marine waves unavailable: %s", exc)

    return {
        "state": {
            "station_id": "open-meteo",
            "temperature_c": cur.get("temperature_2m"),
            "wind_speed_mps": cur.get("wind_speed_10m"),
            "wind_direction_degrees": cur.get("wind_direction_10m"),
            "relative_humidity_percent": cur.get("relative_humidity_2m"),
            "visibility_m": vis,
            "cloud_cover_percent": cur.get("cloud_cover"),
            "cloud_cover_low_percent": cur.get("cloud_cover_low"),
            "cloud_cover_mid_percent": cur.get("cloud_cover_mid"),
            "cloud_cover_high_percent": cur.get("cloud_cover_high"),
            "aerosol_optical_depth": aod,
            "precipitation_probability_percent": pprob,
            # What is falling now, in millimetres for the last hour. The
            # probability says it might; this says it is. Already asked for in
            # the current block and thrown away until the sound wanted it.
            "precipitation_mm": cur.get("precipitation"),
            "description": WMO_CODES.get(cur.get("weather_code")),
            "wave_height_m": wave_h,
            "wave_direction_degrees": wave_dir,
            "wave_period_s": wave_period,
            "swell_period_s": swell_period,
            # The hourly run, for a page standing at another hour. The sea state
            # is not in it: Open-Meteo's marine call gives the wave now and no
            # forecast, so a page off the present hour keeps the present sea and
            # nothing pretends otherwise.
            "series": hourly_block(hourly),
        },
        "time": parse_time(cur.get("time")) or now,
    }
