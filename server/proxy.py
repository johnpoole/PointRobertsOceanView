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

BBOX = {"min_lat": 48.94, "min_lon": -123.25, "max_lat": 49.015, "max_lon": -123.0}
STALE_SECONDS = {"vessels": 300, "aircraft": 120}
HEARTBEAT_SECONDS = 10.0

AIS_URL = "wss://stream.aisstream.io/v0/stream"

TIDE_STATION = "9449424"
TIDE_DATUM = "MLLW"
TIDE_POLL_SECONDS = 300
RETRY_SECONDS = 20  # after a failed fetch, retry soon instead of the full poll
COOPS_BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"

NWS_UA = "PointRobertsOceanView/0.1 (jdpoole@gmail.com)"
NWS_POINT = (48.989, -123.0853)  # 4 decimals: NWS 301-redirects on more
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
    # ISO 8601 (NWS)
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
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
        envelope("weather.state", "api.weather.gov", world.weather_time,
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


def apply_position_report(msg: dict) -> str | None:
    meta = msg.get("MetaData", {})
    report = msg.get("Message", {}).get("PositionReport", {})
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
    state["navigation_status"] = report.get("NavigationalStatus")
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
    name = (static.get("Name") or meta.get("ShipName") or "").strip()
    if name:
        state["name"] = name
    if static.get("Type") is not None:
        state["vessel_type"] = static.get("Type")
    dim = static.get("Dimension") or {}
    a, b, c, d = dim.get("A"), dim.get("B"), dim.get("C"), dim.get("D")
    if None not in (a, b, c, d):
        state["dimensions_m"] = {
            "length": float(a) + float(b),
            "beam": float(c) + float(d),
            "to_bow": float(a),
            "to_stern": float(b),
        }
    return mmsi


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
        "FilterMessageTypes": ["PositionReport", "ShipStaticData"],
    }
    backoff = 2.0
    while True:
        try:
            async with websockets.connect(AIS_URL, ping_interval=20) as ws:
                await ws.send(json.dumps(subscribe))
                world.health["vessels"] = "live"
                backoff = 2.0
                log.info("AISStream connected, bbox %s", BBOX)
                async for raw in ws:
                    msg = json.loads(raw)
                    kind = msg.get("MessageType")
                    if kind == "PositionReport":
                        mmsi = apply_position_report(msg)
                    elif kind == "ShipStaticData":
                        mmsi = apply_static_data(msg)
                    else:
                        continue
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


async def fetch_tide(client: httpx.AsyncClient) -> dict:
    common = {
        "application": "PointRobertsOceanView",
        "station": TIDE_STATION,
        "datum": TIDE_DATUM,
        "time_zone": "gmt",
        "units": "metric",
        "format": "json",
    }
    level = await client.get(COOPS_BASE, params={**common, "product": "water_level", "date": "latest"})
    level.raise_for_status()
    level_json = level.json()
    if "error" in level_json:
        raise RuntimeError(f"NOAA water_level: {level_json['error'].get('message')}")
    point = level_json["data"][0]

    now = utcnow()
    begin = now.strftime("%Y%m%d")
    preds = await client.get(COOPS_BASE, params={
        **common, "product": "predictions", "begin_date": begin,
        "range": 48, "interval": "hilo",
    })
    preds.raise_for_status()
    extremes = preds.json().get("predictions", [])

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
            "water_level_m": float(point["v"]),
            "prediction_m": prediction_m,
            "datum": TIDE_DATUM,
            "trend": trend,
        },
        "time": parse_time(point["t"]) or now,
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
                log.info("Tide %.3f m %s (%s)", world.tide["water_level_m"],
                         TIDE_DATUM, world.tide["trend"])
                ok = True
            except Exception as exc:
                world.health["tide"] = "offline"
                log.error("Tide fetch failed: %s", exc)
            await asyncio.sleep(TIDE_POLL_SECONDS if ok else RETRY_SECONDS)


# ---- NWS weather feed -------------------------------------------------------


def pick_active(values: list[dict]):
    """Pick the gridpoint time-series value active now.

    Values are ordered by time; each has an ISO interval like
    "2026-08-04T14:00:00+00:00/PT1H". The current value is the last one whose
    start is at or before now. Falls back to the first value.
    """
    if not values:
        return None
    now = utcnow()
    chosen = values[0].get("value")
    for item in values:
        start = parse_time(item.get("validTime", "").split("/")[0])
        if start is None:
            continue
        if start <= now:
            chosen = item.get("value")
        else:
            break
    return chosen


async def resolve_nws(client: httpx.AsyncClient) -> tuple[str, str]:
    point = await client.get(
        f"https://api.weather.gov/points/{NWS_POINT[0]},{NWS_POINT[1]}")
    point.raise_for_status()
    props = point.json()["properties"]
    stations = await client.get(props["observationStations"])
    stations.raise_for_status()
    station_id = stations.json()["features"][0]["id"]
    grid = props["forecastGridData"]
    return station_id, grid


def _mps(speed: dict | None) -> float | None:
    if not speed or speed.get("value") is None:
        return None
    value = float(speed["value"])
    unit = speed.get("unitCode", "")
    if unit.endswith("km_h-1"):
        return round(value / 3.6, 2)
    return value


def _num(field: dict | None) -> float | None:
    if not field or field.get("value") is None:
        return None
    return float(field["value"])


async def fetch_weather(client: httpx.AsyncClient, station_id: str, grid: str) -> dict:
    obs = await client.get(f"{station_id}/observations/latest")
    obs.raise_for_status()
    p = obs.json()["properties"]

    cloud = precip = None
    try:
        g = (await client.get(grid)).json()["properties"]
        cloud = pick_active(g.get("skyCover", {}).get("values", []))
        precip = pick_active(g.get("probabilityOfPrecipitation", {}).get("values", []))
    except Exception as exc:
        log.warning("NWS gridpoint sky/precip unavailable: %s", exc)

    return {
        "state": {
            "station_id": station_id.rsplit("/", 1)[-1],
            "temperature_c": _num(p.get("temperature")),
            "wind_speed_mps": _mps(p.get("windSpeed")),
            "wind_direction_degrees": _num(p.get("windDirection")),
            "relative_humidity_percent": _num(p.get("relativeHumidity")),
            "visibility_m": _num(p.get("visibility")),
            "cloud_cover_percent": cloud,
            "precipitation_probability_percent": precip,
            "description": p.get("textDescription") or None,
        },
        "time": parse_time(p.get("timestamp")) or utcnow(),
    }


async def weather_task() -> None:
    async with httpx.AsyncClient(timeout=30, headers={"User-Agent": NWS_UA}) as client:
        station_id = grid = None
        while station_id is None:
            try:
                station_id, grid = await resolve_nws(client)
                log.info("NWS station %s", station_id.rsplit("/", 1)[-1])
            except Exception as exc:
                log.error("NWS resolve failed: %s. Retrying in 30s.", exc)
                await asyncio.sleep(30)
        while True:
            ok = False
            try:
                result = await fetch_weather(client, station_id, grid)
                world.weather = result["state"]
                world.weather_time = result["time"]
                world.health["weather"] = "live"
                await clients.broadcast(envelope(
                    "weather.state", "api.weather.gov",
                    world.weather_time, world.weather, None))
                log.info("Weather %s, wind %s m/s from %s",
                         world.weather["description"],
                         world.weather["wind_speed_mps"],
                         world.weather["wind_direction_degrees"])
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
