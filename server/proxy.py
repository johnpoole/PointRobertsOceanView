"""Local proxy for the Point Roberts ocean view.

Serves the static site and bridges three upstream feeds into one browser
WebSocket at /ws/live:

  - vessels : AISStream.io  (needs AISSTREAM_API_KEY in .env)
  - tide    : NOAA CO-OPS station 9449424 (Cherry Point), MLLW, metres
  - weather : NWS api.weather.gov, station KORS + gridpoint sky/precip

The browser talks only to this process, so there is no CORS and the AISStream
key never leaves the server. Nothing is invented: each feed carries a health
status of live / offline, and a feed that fails is reported, not faked.

Run:
    python -m uvicorn server.proxy:app --port 8080
or:
    python server/proxy.py
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

import httpx
import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import Response
from fastapi.staticfiles import StaticFiles

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("proxy")

SCHEMA_VERSION = "1.0"
REPO_ROOT = Path(__file__).resolve().parents[1]

# ---- fixed constants (documented, not fetched) -----------------------------

# Wide enough to cover the traffic visible from the bluff: the Strait of Georgia
# shipping lane to the west and the Tsawwassen ferry lanes to the north and south.
BBOX = {"min_lat": 48.80, "min_lon": -123.50, "max_lat": 49.18, "max_lon": -122.95}
STALE_SECONDS = {"vessels": 300, "aircraft": 120}
HEARTBEAT_SECONDS = 10.0

AIS_URL = "wss://stream.aisstream.io/v0/stream"
# An open socket is not a working feed. AISStream keeps the connection up and
# answers pings while sending nothing at all if the key is over quota — only a
# bad key gets disconnected. The strait is busy enough that this long a gap
# means the feed has stopped, whatever the socket says.
AIS_SILENCE_SECONDS = 120
AIS_MESSAGE_TYPES = [
    "PositionReport", "StandardClassBPositionReport",
    "ExtendedClassBPositionReport", "ShipStaticData",
]
# When the feed goes quiet, subscribe to the whole world for a moment. Silence
# over our own bounding box has three causes that look identical from here: the
# service is down, the account is over quota, or we are asking for the wrong
# box. Traffic anywhere on earth separates the third from the other two.
AIS_PROBE_BOX = [[-90.0, -180.0], [90.0, 180.0]]
AIS_PROBE_SECONDS = 20.0
# aisstream.io publishes no status page of its own. This one is unofficial, run
# by a third party against their own key, and it has a state for exactly the
# fault we hit: the socket connected and no positions arriving. If it sees the
# same thing we do, the trouble is not ours. Its own wording is passed through
# rather than reworded.
AIS_STATUS_URL = "https://aisuptime.buttermilkgreen.fyi/api/v1/status?simple=true"

# Point Roberts (9449639) is a reference station with its own harmonics, but it
# has no gauge — predictions only. Cherry Point (9449424) has the nearest live
# gauge, 27 km southeast, where the tide runs about 0.1 m lower and arrives at a
# different time. So take the non-tidal residual measured at Cherry Point, which
# is weather-driven surge and stays coherent over that distance, and carry it
# onto Point Roberts' own prediction:
#
#   level = predicted_PR(t) + (observed_CP(t) - predicted_CP(t))
#
# That keeps the live surge and puts the astronomical tide where the view is.
TIDE_GAUGE_STATION = "9449424"    # Cherry Point, observed water level
TIDE_STATION = "9449639"          # Point Roberts, predictions
TIDE_DATUM = "MLLW"
TIDE_POLL_SECONDS = 300
RETRY_SECONDS = 20  # after a failed fetch, retry soon instead of the full poll
COOPS_BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"

POINT = (48.989009, -123.085318)
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
WEATHER_POLL_SECONDS = 300

# ---- .env (only the AIS key; keep dependencies minimal) --------------------


def load_env() -> None:
    env_path = REPO_ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env()
AIS_API_KEY = os.environ.get("AISSTREAM_API_KEY", "").strip()


# ---- shared world state ----------------------------------------------------


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def parse_time(text: str | None) -> datetime | None:
    """Parse the assorted upstream timestamp forms into aware UTC datetimes."""
    if not text:
        return None
    text = text.strip()
    # AISStream: "2022-12-29 18:22:32.318353 +0000 UTC"
    if text.endswith(" UTC"):
        text = text[:-4].strip()
        try:
            return datetime.strptime(text, "%Y-%m-%d %H:%M:%S.%f %z")
        except ValueError:
            pass
    # NOAA CO-OPS: "2026-08-04 14:54" (GMT, no tz marker)
    try:
        return datetime.strptime(text, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
    except ValueError:
        pass
    # ISO 8601 (Open-Meteo gives GMT with no offset, e.g. "2026-08-04T16:30")
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


class World:
    def __init__(self) -> None:
        self.vessels: dict[str, dict] = {}          # mmsi -> VesselState
        self.vessel_seen: dict[str, datetime] = {}  # mmsi -> source_time
        self.weather: dict | None = None
        self.weather_time: datetime | None = None
        self.tide: dict | None = None
        self.tide_time: datetime | None = None
        # Why vessels are offline, in the monitor's words. Empty when they are not.
        self.vessels_note = ""
        self.health = {
            "weather": "offline",
            "tide": "offline",
            "vessels": "offline",
            "aircraft": "offline",
        }


world = World()


# ---- browser connections ---------------------------------------------------


class Clients:
    def __init__(self) -> None:
        self._sockets: set[WebSocket] = set()

    async def add(self, ws: WebSocket) -> None:
        await ws.accept()
        self._sockets.add(ws)

    def remove(self, ws: WebSocket) -> None:
        self._sockets.discard(ws)

    async def broadcast(self, message: dict) -> None:
        dead = []
        for ws in list(self._sockets):
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._sockets.discard(ws)


clients = Clients()


def envelope(message_type: str, source: str, source_time: datetime | None,
             data: dict, stale_seconds: float | None) -> dict:
    now = utcnow()
    age = (now - source_time).total_seconds() if source_time else None
    stale = bool(age is not None and stale_seconds is not None and age > stale_seconds)
    return {
        "schema_version": SCHEMA_VERSION,
        "message_type": message_type,
        "source": source,
        "source_time": iso(source_time) if source_time else None,
        "received_time": iso(now),
        "quality": {
            "stale": stale,
            "age_seconds": round(age, 1) if age is not None else None,
            "warnings": [],
        },
        "data": data,
    }


def snapshot() -> dict:
    vessels = [
        envelope("vessel.position", "aisstream.io", world.vessel_seen.get(mmsi),
                 state, STALE_SECONDS["vessels"])
        for mmsi, state in world.vessels.items()
    ]
    weather = (
        envelope("weather.state", "open-meteo.com", world.weather_time,
                 world.weather, None)
        if world.weather else None
    )
    tide = (
        envelope("tide.state", "tidesandcurrents.noaa.gov", world.tide_time,
                 world.tide, None)
        if world.tide else None
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "message_type": "initial.snapshot",
        "server_time": iso(utcnow()),
        "data": {
            "schema_version": SCHEMA_VERSION,
            "server_time": iso(utcnow()),
            "weather": weather,
            "tide": tide,
            "vessels": vessels,
            "aircraft": [],
            "provider_health": dict(world.health),
            "vessels_note": world.vessels_note,
        },
    }


# ---- AISStream vessel feed --------------------------------------------------

# AIS true-heading 511 and course 360 are the "not available" sentinels.
def _clean_heading(value):
    return None if value is None or value >= 511 else float(value)


def _clean_course(value):
    return None if value is None or value >= 360 else float(value)


def _clean_speed(value):
    # 102.3 kn is the AIS "not available" sentinel.
    return None if value is None or value >= 102.3 else float(value)


def _apply_static_fields(state: dict, src: dict) -> None:
    name = (src.get("Name") or "").strip()
    if name:
        state["name"] = name
    if src.get("Type") is not None:
        state["vessel_type"] = src.get("Type")
    dim = src.get("Dimension") or {}
    a, b, c, d = dim.get("A"), dim.get("B"), dim.get("C"), dim.get("D")
    if None not in (a, b, c, d):
        state["dimensions_m"] = {
            "length": float(a) + float(b),
            "beam": float(c) + float(d),
            "to_bow": float(a),
            "to_stern": float(b),
        }


# Class A sends PositionReport (msg 1/2/3); small craft send Class B, which
# AISStream labels StandardClassBPositionReport (18) and
# ExtendedClassBPositionReport (19). All three carry position, sog, cog, heading;
# the extended Class B report also carries name/type/dimensions.
def apply_position_report(msg: dict, kind: str = "PositionReport") -> str | None:
    meta = msg.get("MetaData", {})
    report = msg.get("Message", {}).get(kind, {})
    mmsi = meta.get("MMSI") or report.get("UserID")
    if mmsi is None:
        return None
    mmsi = str(mmsi)
    state = world.vessels.setdefault(mmsi, {"mmsi": mmsi})
    lat = report.get("Latitude", meta.get("latitude"))
    lon = report.get("Longitude", meta.get("longitude"))
    if lat is None or lon is None:
        return None
    state["latitude"] = float(lat)
    state["longitude"] = float(lon)
    state["speed_over_ground_knots"] = _clean_speed(report.get("Sog"))
    state["course_over_ground_degrees"] = _clean_course(report.get("Cog"))
    state["true_heading_degrees"] = _clean_heading(report.get("TrueHeading"))
    if "NavigationalStatus" in report:
        state["navigation_status"] = report.get("NavigationalStatus")
    if kind == "ExtendedClassBPositionReport":
        _apply_static_fields(state, report)
    name = (meta.get("ShipName") or "").strip()
    if name:
        state["name"] = name
    world.vessel_seen[mmsi] = parse_time(meta.get("time_utc")) or utcnow()
    return mmsi


def apply_static_data(msg: dict) -> str | None:
    meta = msg.get("MetaData", {})
    static = msg.get("Message", {}).get("ShipStaticData", {})
    mmsi = meta.get("MMSI") or static.get("UserID")
    if mmsi is None:
        return None
    mmsi = str(mmsi)
    state = world.vessels.setdefault(mmsi, {"mmsi": mmsi})
    _apply_static_fields(state, static)
    if not state.get("name"):
        name = (meta.get("ShipName") or "").strip()
        if name:
            state["name"] = name
    return mmsi


async def probe_ais_worldwide() -> str:
    """Ask AISStream for the whole world for a few seconds and report back.

    Returns one of "delivering", "silent", or "disconnected: <reason>". Opens its
    own short-lived connection rather than disturbing the live subscription. If
    AISStream caps concurrent connections per key the probe is the one that gets
    dropped, which reads as "disconnected" — so that answer is reported as
    inconclusive rather than as a bad key.
    """
    subscribe = {
        "APIKey": AIS_API_KEY,
        "BoundingBoxes": [AIS_PROBE_BOX],
        "FilterMessageTypes": AIS_MESSAGE_TYPES,
    }
    try:
        async with websockets.connect(AIS_URL, ping_interval=20) as ws:
            await ws.send(json.dumps(subscribe))
            loop = asyncio.get_running_loop()
            deadline = loop.time() + AIS_PROBE_SECONDS
            while True:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    return "silent"
                try:
                    raw = await asyncio.wait_for(ws.recv(), remaining)
                except asyncio.TimeoutError:
                    return "silent"
                if json.loads(raw).get("MessageType") in AIS_MESSAGE_TYPES:
                    return "delivering"
    except Exception as exc:
        return f"disconnected: {type(exc).__name__} {exc}"


async def ais_upstream_state() -> str | None:
    """What an independent monitor makes of aisstream.io right now. Returns its
    own state string, or None if the monitor itself could not be reached."""
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(AIS_STATUS_URL)
            response.raise_for_status()
            return response.json().get("state")
    except Exception as exc:
        log.warning("AIS status monitor unreachable: %s", exc)
        return None


async def ais_task() -> None:
    if not AIS_API_KEY:
        world.health["vessels"] = "offline"
        log.error(
            "AISSTREAM_API_KEY is not set. Vessels will be offline. "
            "Add it to %s (free key from https://aisstream.io). "
            "Weather and tide are unaffected.",
            REPO_ROOT / ".env",
        )
        return

    subscribe = {
        "APIKey": AIS_API_KEY,
        "BoundingBoxes": [[
            [BBOX["min_lat"], BBOX["min_lon"]],
            [BBOX["max_lat"], BBOX["max_lon"]],
        ]],
        "FilterMessageTypes": AIS_MESSAGE_TYPES,
    }
    backoff = 2.0
    while True:
        try:
            async with websockets.connect(AIS_URL, ping_interval=20) as ws:
                await ws.send(json.dumps(subscribe))
                backoff = 2.0
                # Not "live" yet. The socket being open proves only that the key
                # was not rejected; vessels count as live once one actually lands.
                log.info("AISStream connected, bbox %s", BBOX)
                unhandled: set[str] = set()
                silence_reported = False
                while True:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), AIS_SILENCE_SECONDS)
                    except asyncio.TimeoutError:
                        world.health["vessels"] = "offline"
                        # Report on the silence itself, not on a change of health.
                        # Health starts offline, so keying off a transition says
                        # nothing at all when the feed never delivers to begin with.
                        if not silence_reported:
                            silence_reported = True
                            log.error(
                                "AISStream has sent nothing for %.0fs with the socket "
                                "still open, so vessels are now reported offline. "
                                "Probing the whole world to see whose fault it is.",
                                AIS_SILENCE_SECONDS,
                            )
                            verdict = await probe_ais_worldwide()
                            if verdict == "delivering":
                                log.error(
                                    "AISStream is delivering worldwide but nothing for "
                                    "%s. The key and the service are fine; our bounding "
                                    "box or message filter is what is wrong.", BBOX,
                                )
                            elif verdict == "silent":
                                log.error(
                                    "AISStream is silent worldwide too, so this is not "
                                    "our bounding box. The key is still being accepted, "
                                    "so check the aisstream.io account for a quota or "
                                    "rate limit, or the service itself.",
                                )
                            else:
                                log.error(
                                    "The worldwide probe could not stay connected (%s), "
                                    "so it settles nothing. AISStream may cap concurrent "
                                    "connections per key, in which case the probe is the "
                                    "one that gets dropped.", verdict,
                                )
                            upstream = await ais_upstream_state()
                            if upstream is None:
                                world.vessels_note = "monitor unreachable"
                            else:
                                world.vessels_note = upstream.lower()
                                log.error(
                                    "An independent monitor of aisstream.io reports it "
                                    "as %r, so this is the service, not our key.",
                                    upstream,
                                )
                        continue
                    msg = json.loads(raw)
                    kind = msg.get("MessageType")
                    if kind in ("PositionReport", "StandardClassBPositionReport",
                                "ExtendedClassBPositionReport"):
                        mmsi = apply_position_report(msg, kind)
                    elif kind == "ShipStaticData":
                        mmsi = apply_static_data(msg)
                    else:
                        # Anything else is AISStream telling us something. Dropping
                        # it silently is how a rejected subscription looked healthy.
                        if kind not in unhandled:
                            unhandled.add(kind)
                            log.warning("AISStream sent an unhandled message: %s", raw[:300])
                        continue
                    silence_reported = False
                    if world.health["vessels"] != "live":
                        world.health["vessels"] = "live"
                        world.vessels_note = ""
                        log.info("AISStream delivering positions; vessels live")
                    if mmsi:
                        await clients.broadcast(envelope(
                            "vessel.position", "aisstream.io",
                            world.vessel_seen.get(mmsi), world.vessels[mmsi],
                            STALE_SECONDS["vessels"],
                        ))
        except Exception as exc:
            world.health["vessels"] = "offline"
            log.error("AISStream connection lost: %s. Retrying in %.0fs.", exc, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60.0)


# ---- NOAA tide feed ---------------------------------------------------------


async def coops(client: httpx.AsyncClient, station: str, **params) -> dict:
    """One CO-OPS call. NOAA reports failures in a 200 body, so check for them."""
    response = await client.get(COOPS_BASE, params={
        "application": "PointRobertsOceanView",
        "station": station,
        "datum": TIDE_DATUM,
        "time_zone": "gmt",
        "units": "metric",
        "format": "json",
        **params,
    })
    response.raise_for_status()
    payload = response.json()
    if "error" in payload:
        raise RuntimeError(
            f"NOAA CO-OPS station {station} product={params.get('product')}: "
            f"{payload['error'].get('message')}"
        )
    return payload


async def fetch_tide(client: httpx.AsyncClient) -> dict:
    """Point Roberts water level: its own prediction plus the surge measured at
    Cherry Point. See the TIDE_STATION comment for why."""
    observed = (await coops(client, TIDE_GAUGE_STATION,
                            product="water_level", date="latest"))["data"][0]
    observed_at = parse_time(observed["t"])
    if observed_at is None:
        raise RuntimeError(f"NOAA water_level: unparsable timestamp {observed['t']!r}")
    observed_m = float(observed["v"])

    # 6-minute predictions for both stations over the gauge reading's day, so the
    # residual and the Point Roberts level are read at the same instant.
    day = observed_at.strftime("%Y%m%d")
    series = {}
    for station in (TIDE_GAUGE_STATION, TIDE_STATION):
        rows = (await coops(client, station, product="predictions",
                            begin_date=day, range=48, interval="6"))["predictions"]
        series[station] = {row["t"]: float(row["v"]) for row in rows}

    # The surge is read at the gauge's timestamp, which runs about ten minutes
    # behind. The astronomical tide is read at now. Surge is weather and drifts
    # over hours; the tide moves up to a metre an hour here, so reading it ten
    # minutes late puts the waterline metres down the beach.
    now = utcnow()
    surge_slot = observed["t"]
    level_slot = now.replace(
        minute=now.minute - now.minute % 6, second=0, microsecond=0
    ).strftime("%Y-%m-%d %H:%M")
    for slot, station in ((surge_slot, TIDE_GAUGE_STATION), (level_slot, TIDE_STATION)):
        if slot not in series[station]:
            raise RuntimeError(
                f"NOAA predictions for station {station} have no 6-minute slot "
                f"at {slot}; cannot transfer the surge"
            )
    surge_m = observed_m - series[TIDE_GAUGE_STATION][surge_slot]
    level_m = series[TIDE_STATION][level_slot] + surge_m
    extremes = (await coops(client, TIDE_STATION, product="predictions",
                            begin_date=now.strftime("%Y%m%d"), range=48,
                            interval="hilo"))["predictions"]
    trend = None
    prediction_m = None
    for ext in extremes:
        when = parse_time(ext["t"])
        if when and when > now:
            trend = "rising" if ext["type"] == "H" else "falling"
            prediction_m = float(ext["v"])
            break

    return {
        "state": {
            "station_id": TIDE_STATION,
            "water_level_m": level_m,
            "prediction_m": prediction_m,
            "datum": TIDE_DATUM,
            "trend": trend,
            "surge_m": surge_m,
            "gauge_station_id": TIDE_GAUGE_STATION,
        },
        "time": observed_at,
    }


async def tide_task() -> None:
    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            ok = False
            try:
                result = await fetch_tide(client)
                world.tide = result["state"]
                world.tide_time = result["time"]
                world.health["tide"] = "live"
                await clients.broadcast(envelope(
                    "tide.state", "tidesandcurrents.noaa.gov",
                    world.tide_time, world.tide, None))
                log.info("Tide %.3f m %s (%s), surge %+.3f m from %s",
                         world.tide["water_level_m"], TIDE_DATUM,
                         world.tide["trend"], world.tide["surge_m"],
                         TIDE_GAUGE_STATION)
                ok = True
            except Exception as exc:
                world.health["tide"] = "offline"
                log.error("Tide fetch failed: %s", exc)
            await asyncio.sleep(TIDE_POLL_SECONDS if ok else RETRY_SECONDS)


# ---- Open-Meteo weather + marine feed ---------------------------------------

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


async def fetch_weather(client: httpx.AsyncClient) -> dict:
    forecast = await client.get(FORECAST_URL, params={
        "latitude": POINT[0], "longitude": POINT[1],
        "current": "temperature_2m,relative_humidity_2m,cloud_cover,wind_speed_10m,"
                   "wind_direction_10m,precipitation,weather_code",
        "hourly": "visibility,precipitation_probability",
        "wind_speed_unit": "ms", "timezone": "GMT", "forecast_days": 1,
    })
    forecast.raise_for_status()
    data = forecast.json()
    cur = data["current"]
    hourly = data.get("hourly", {})
    now = utcnow()
    idx = hour_index(hourly.get("time", []), now)
    vis = hourly.get("visibility", [None])[idx] if idx is not None else None
    pprob = hourly.get("precipitation_probability", [None])[idx] if idx is not None else None

    wave_h = wave_dir = wave_period = None
    try:
        marine = await client.get(MARINE_URL, params={
            "latitude": POINT[0], "longitude": POINT[1],
            "current": "wave_height,wave_direction,wave_period",
        })
        marine.raise_for_status()
        m = marine.json().get("current", {})
        wave_h, wave_dir, wave_period = m.get("wave_height"), m.get("wave_direction"), m.get("wave_period")
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
            "precipitation_probability_percent": pprob,
            "description": WMO_CODES.get(cur.get("weather_code")),
            "wave_height_m": wave_h,
            "wave_direction_degrees": wave_dir,
            "wave_period_s": wave_period,
        },
        "time": parse_time(cur.get("time")) or now,
    }


async def weather_task() -> None:
    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            ok = False
            try:
                result = await fetch_weather(client)
                world.weather = result["state"]
                world.weather_time = result["time"]
                world.health["weather"] = "live"
                await clients.broadcast(envelope(
                    "weather.state", "open-meteo.com",
                    world.weather_time, world.weather, None))
                log.info("Weather %s, wind %s m/s from %s, waves %s m",
                         world.weather["description"],
                         world.weather["wind_speed_mps"],
                         world.weather["wind_direction_degrees"],
                         world.weather["wave_height_m"])
                ok = True
            except Exception as exc:
                world.health["weather"] = "offline"
                log.error("Weather fetch failed: %s", exc)
            await asyncio.sleep(WEATHER_POLL_SECONDS if ok else RETRY_SECONDS)


# ---- heartbeat --------------------------------------------------------------


async def heartbeat_task() -> None:
    while True:
        await clients.broadcast({
            "schema_version": SCHEMA_VERSION,
            "message_type": "heartbeat",
            "server_time": iso(utcnow()),
        })
        await asyncio.sleep(HEARTBEAT_SECONDS)


# ---- app --------------------------------------------------------------------

app = FastAPI()

# The terrain heightmaps are the bulk of a page load. As int16 decimetres they
# gzip to about a tenth of their size, so serve them compressed. Level 6 rather
# than the default 9: on a 7 MB heightmap the last level buys a few per cent for
# several times the CPU, and this is re-compressed on every cold request.
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)

_tasks: list[asyncio.Task] = []


@app.on_event("startup")
async def startup() -> None:
    _tasks.append(asyncio.create_task(ais_task()))
    _tasks.append(asyncio.create_task(tide_task()))
    _tasks.append(asyncio.create_task(weather_task()))
    _tasks.append(asyncio.create_task(heartbeat_task()))


@app.on_event("shutdown")
async def shutdown() -> None:
    for task in _tasks:
        task.cancel()


@app.websocket("/ws/live")
async def ws_live(ws: WebSocket) -> None:
    await clients.add(ws)
    try:
        await ws.send_text(json.dumps(snapshot()))
        while True:
            await ws.receive_text()  # ignore client input; keep the socket open
    except WebSocketDisconnect:
        clients.remove(ws)
    except Exception:
        clients.remove(ws)


# Static site last so the WebSocket route wins for /ws/live. This is a local dev
# server for source files, so serve them no-cache: edits show on reload without
# stale ES modules lingering in the browser.
class NoCacheStatic(StaticFiles):
    def is_not_modified(self, *args, **kwargs) -> bool:
        return False

    async def get_response(self, path: str, scope) -> Response:
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-store"
        return response


app.mount("/", NoCacheStatic(directory=str(REPO_ROOT), html=True), name="site")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server.proxy:app", host="127.0.0.1", port=8080, reload=False)
