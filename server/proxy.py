"""Local proxy for the Point Roberts ocean view.

Serves the static site and bridges four upstream feeds into one browser
WebSocket at /ws/live:

  - vessels  : AISStream.io  (needs AISSTREAM_API_KEY in .env)
  - aircraft : adsb.fi, community-fed ADS-B, 20 km around the bluff, no key
  - tide     : NOAA CO-OPS 9449639 (Point Roberts) with the surge measured at
               9449424 (Cherry Point) carried onto it, MLLW, metres
  - weather  : Open-Meteo forecast and marine at the exact coordinates

The browser talks only to this process, so there is no CORS and the AISStream
key never leaves the server. Nothing is invented: each feed carries a health
status of live / offline, and a feed that fails is reported, not faked.

/admin/visitors lists the addresses that have connected and which are connected
now. It needs OCEANVIEW_ADMIN_PASSWORD set in .env and asks for it as a browser
password. No visitor ever sees another visitor's address.

Run:
    python -m uvicorn server.proxy:app --port 8080
or:
    python server/proxy.py
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import html
import json
import logging
import math
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import websockets
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("proxy")

SCHEMA_VERSION = "1.0"
REPO_ROOT = Path(__file__).resolve().parents[1]

# ---- fixed constants (documented, not fetched) -----------------------------

# Ten kilometres round the bluff. The eye is 20 m above the sea, so the horizon
# is 17.3 km of open water and everything in here is well inside it and big
# enough on screen to be worth drawing.
#
# This is the near water: the beach, the ferry terminal, the marina, and the
# inshore edge of the shipping lane. The box has been 30 km west and 20 km round
# before this, at 211 and 130 vessels; ten leaves what is close enough to pick
# out from the window.
BBOX = {"min_lat": 48.899, "min_lon": -123.222, "max_lat": 49.079, "max_lon": -122.949}
STALE_SECONDS = {"vessels": 300, "aircraft": 120}

# When a ship stops being a ship on the water. Nothing upstream ever says a
# vessel has gone: AISStream simply stops sending once it leaves the box, and so
# the record only ever grew. Every hull that crossed the strait since the
# container started stayed in it and went on being drawn, greyed out, sitting
# where it was hours ago.
#
# Longer than the stale threshold, so a ship greys before it goes and is not
# taken off the water the moment the feed hiccups. Longer than the shipfinder
# pass at 300s, so a scraped ship is not reaped between two good passes.
DROP_SECONDS = {"vessels": 900}
REAP_PERIOD_SECONDS = 60.0
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

# The tidal stream, from the nearest current station: PUG1726, "Strait of
# Georgia, 4.5 nm SW of Point Roberts", 8.1 km off the bluff. That is the water
# in the view, which is as close as a published station gets.
#
# The station has 36 bins two metres apart and publishes predictions for three of
# them. Bin 35 sits 9.4 m down and is the shallowest of the three, so it is the
# one a boat is in. Bin 11 is 57 m down and is what the API hands back when no
# bin is named, which would be the current well under the keel.
#
# Velocity_Major is signed along the channel: positive runs toward meanFloodDir,
# negative toward meanEbbDir. In metric units it is centimetres a second.
#
# This is one point eight kilometres offshore, and the stream along the West
# Bluff is not the stream out there. See issue #13.
CURRENT_STATION = "PUG1726"
CURRENT_BIN = 35
CURRENT_STATION_KM = 8.1          # from the bluff, for the readout to own up to
CURRENT_POLL_SECONDS = 300
# Predictions for a whole day arrive in one call and do not change, so the day is
# held and interpolated locally. Refetched when the held day runs out.
CURRENT_FETCH_DAYS = 2
CURRENT_SLACK_MPS = 0.05          # under this it is slack and has no direction
CM_PER_S_TO_M_PER_S = 0.01
KNOT_MPS = 0.514444

# Aircraft from adsb.fi's open data: community-fed, no key, the same readsb JSON
# every one of these aggregators serves.
#
# It was adsb.lol, which stopped. Not for us and not for our bounding box: their
# whole-world military feed answered empty too, and so did fifty miles of
# Heathrow. They answer 200 with no error and an empty list, which is the worst
# way for a feed to fail, and the page dutifully drew an empty sky over a strait
# that had thirty-five aircraft in it.
#
# Twenty kilometres. It was 30 nm, which is 56, and at that range everything was
# a speck: the far edge sets how big a thing is drawn, so a wide feed makes a
# small one. Six seconds is well inside their tolerance and the client
# interpolates between polls.
ADSB_URL = "https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{nm}"
ADSB_SOURCE = "opendata.adsb.fi"
ADSB_RADIUS_NM = 10.8      # 20 km. It was 30 nm, which is 56.
# ---- border crossings -------------------------------------------------------
#
# Point Roberts can only be reached by driving through Canada, so its trade is
# Canadians coming down for fuel, parcels, the marina and a meal. Every one of
# them is counted at the booth. That makes the crossing count the closest thing
# to a measure of what the place is doing.
#
# US Customs hands the counts to the Bureau of Transportation Statistics about
# once a quarter and BTS publishes them by port and by month, back to 1994. So
# this is monthly and runs a month or two behind. It is not live and must never
# be dressed as live: the month it belongs to travels with it.
#
# Nothing on the page shows it yet.
CROSSINGS_URL = "https://data.bts.gov/resource/keg4-3bc2.json"
CROSSINGS_PORT_CODE = "3017"          # Point Roberts, Washington
CROSSINGS_MONTHS = 24
# A figure that changes four times a year does not want asking for more often.
CROSSINGS_POLL_SECONDS = 6 * 3600

AIRCRAFT_POLL_SECONDS = 6.0
FT_TO_M = 0.3048

POINT = (48.989009, -123.085318)
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
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
# Guards /admin/visitors, which lists the addresses of everyone who has
# connected. Unset means that page is shut, not open.
ADMIN_PASSWORD = os.environ.get("OCEANVIEW_ADMIN_PASSWORD", "").strip()


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
        self.aircraft: dict[str, dict] = {}         # icao -> AircraftState
        self.aircraft_seen: dict[str, datetime] = {}
        self.weather: dict | None = None
        self.weather_time: datetime | None = None
        self.tide: dict | None = None
        self.tide_time: datetime | None = None
        self.current: dict | None = None
        self.current_time: datetime | None = None
        self.crossings: dict | None = None
        self.crossings_time: datetime | None = None
        # Why vessels are offline, in the monitor's words. Empty when they are not.
        self.vessels_note = ""
        # What the lookups have answered, kept so the same question is not asked
        # twice. An empty dict is an answer: they were asked and had never heard
        # of it. A key that is not here has not been asked yet.
        self.aircraft_registry: dict[str, dict] = {}   # icao hex -> fields
        self.flight_routes: dict[str, dict] = {}       # callsign -> fields
        self.ferry_sailings: dict[str, dict] = {}      # vessel name, upper -> fields
        self.health = {
            "weather": "offline",
            "tide": "offline",
            "currents": "offline",
            "vessels": "offline",
            "aircraft": "offline",
            "crossings": "offline",
        }


world = World()


# ---- browser connections ---------------------------------------------------


class Clients:
    """Everyone with the page open, and where each of them is standing.

    The position is held here rather than in Visitors on purpose. Visitors is
    keyed by address and is written to disk; this is keyed by socket and is
    thrown away when the socket closes. The two must not meet: a visitor's
    address is the admin's business and nobody else's, and where somebody is
    looking goes out to every other browser on the site."""

    def __init__(self) -> None:
        self._sockets: dict[WebSocket, dict] = {}

    async def add(self, ws: WebSocket) -> str:
        await ws.accept()
        # What every other browser will call this one. Random per connection, so
        # it says nothing about who or where they are, and a reconnection is a
        # new stranger rather than the same one recognised.
        who = secrets.token_hex(4)
        self._sockets[ws] = {"id": who, "at": None}
        visitors.opened(client_ip(ws))
        return who

    @property
    def count(self) -> int:
        return len(self._sockets)

    def remove(self, ws: WebSocket) -> None:
        if ws in self._sockets:
            del self._sockets[ws]
            visitors.closed(client_ip(ws))

    def place(self, ws: WebSocket, at: dict | None) -> None:
        seat = self._sockets.get(ws)
        if seat is not None:
            seat["at"] = at

    def placed(self) -> list[dict]:
        """Everyone who has said where they are. Id and position, nothing else."""
        return [dict(seat["at"], id=seat["id"])
                for seat in self._sockets.values() if seat["at"]]

    async def broadcast(self, message: dict) -> None:
        dead = []
        for ws in list(self._sockets):
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.remove(ws)


clients = Clients()


# What a browser may say about itself, and what is done with anything else it
# says. The socket was read-only until now and it is worth keeping the reason it
# stopped being read-only narrow: one message type, four numbers, all bounded.
PRESENCE_SECONDS = 1.0


def read_position(text: str) -> dict | None:
    """A browser's "here I am", or None if it was anything else.

    Everything is range-checked. This is the only thing on the site that takes a
    number from a browser and hands it to every other browser, so a value that
    would put a marker in orbit or off the map is dropped rather than passed on."""
    try:
        msg = json.loads(text)
    except (ValueError, TypeError):
        return None
    if not isinstance(msg, dict) or msg.get("type") != "here":
        return None
    try:
        lat = float(msg["lat"])
        lon = float(msg["lon"])
        y = float(msg.get("y", 0.0))
        heading = float(msg.get("heading", 0.0))
    except (KeyError, TypeError, ValueError):
        return None
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        return None
    if not (-1000.0 <= y <= 100000.0):
        return None
    if not all(map(math.isfinite, (lat, lon, y, heading))):
        return None
    return {"lat": round(lat, 6), "lon": round(lon, 6),
            "y": round(y, 1), "heading": round(heading % 360.0, 1)}


# ---- who is here ------------------------------------------------------------

# nginx sets X-Real-IP on both / and /ws/live, so behind it this is the browser's
# address rather than the proxy's. Straight to port 8091 there is no header and
# the socket's own peer is the truth. Anything reaching 8091 directly could put
# whatever it liked in the header, so this is a record of who says they are here,
# which for a view of a beach is the question being asked.
def client_ip(ws: WebSocket) -> str:
    forwarded = ws.headers.get("x-real-ip")
    if forwarded:
        return forwarded.strip()
    return ws.client.host if ws.client else "unknown"


# Bounded because an address is one dictionary entry and nothing else prunes
# them.
VISITOR_LIMIT = 500

# Where the record lives between restarts. The same directory the ship cache
# uses, which docker-compose mounts as a named volume, so a rebuild and a
# recreate of the container leave it where it is. Deploying the site no longer
# forgets who has been.
VISITORS_PATH = REPO_ROOT / "data" / "visitors.json"
VISITORS_SAVE_SECONDS = 30.0


class Visitors:
    def __init__(self) -> None:
        self._by_ip: dict[str, dict] = {}
        self._dirty = False

    def opened(self, ip: str) -> None:
        now = utcnow()
        seen = self._by_ip.get(ip)
        if seen is None:
            seen = {"first_seen": now, "visits": 0, "open": 0}
            self._by_ip[ip] = seen
        seen["last_seen"] = now
        seen["visits"] += 1
        seen["open"] += 1
        self._dirty = True
        self._prune()

    def closed(self, ip: str) -> None:
        seen = self._by_ip.get(ip)
        if seen is None:
            return
        seen["last_seen"] = utcnow()
        seen["open"] = max(0, seen["open"] - 1)
        self._dirty = True

    # ---- surviving a deploy --------------------------------------------------
    #
    # open is not written. It counts sockets, and after a restart there are none,
    # so persisting it would show everybody as still here for ever. first_seen,
    # last_seen and visits are the record; open is the moment.

    def load(self, path: Path = VISITORS_PATH) -> None:
        if not path.exists():
            return
        try:
            rows = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise RuntimeError(
                f"The visitor record at {path} could not be read: {exc}. It is a "
                f"log and not a source of truth — delete it to start over — but "
                f"nothing here will silently drop it."
            ) from exc
        for ip, row in rows.items():
            try:
                self._by_ip[ip] = {
                    "first_seen": datetime.fromisoformat(row["first_seen"]),
                    "last_seen": datetime.fromisoformat(row["last_seen"]),
                    "visits": int(row["visits"]),
                    "open": 0,
                }
            except (KeyError, TypeError, ValueError) as exc:
                raise RuntimeError(
                    f"The visitor record at {path} holds a row for {ip} that "
                    f"cannot be read: {exc}. Delete the file to start over."
                ) from exc
        log.info("Visitors: %d addresses read from %s", len(self._by_ip), path)

    def save(self, path: Path = VISITORS_PATH) -> None:
        rows = {
            ip: {
                "first_seen": iso(seen["first_seen"]),
                "last_seen": iso(seen["last_seen"]),
                "visits": seen["visits"],
            }
            for ip, seen in self._by_ip.items()
        }
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(rows), encoding="utf-8")
        # Replace rather than write in place, so a kill halfway through leaves
        # the old record whole instead of half a new one.
        tmp.replace(path)
        self._dirty = False

    def save_if_dirty(self, path: Path = VISITORS_PATH) -> None:
        if self._dirty:
            self.save(path)

    def listing(self) -> list[dict]:
        rows = [dict(seen, ip=ip) for ip, seen in self._by_ip.items()]
        # Everyone here now, then the rest by how recently they left.
        rows.sort(key=lambda r: (r["open"] == 0, -r["last_seen"].timestamp()))
        return rows

    def _prune(self) -> None:
        if len(self._by_ip) <= VISITOR_LIMIT:
            return
        idle = [(v["last_seen"], k) for k, v in self._by_ip.items() if v["open"] == 0]
        idle.sort()
        for _, ip in idle[: len(self._by_ip) - VISITOR_LIMIT]:
            del self._by_ip[ip]


visitors = Visitors()


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
    # Each vessel says where it actually came from. A scraped position must not
    # go out labelled as an AIS one.
    vessels = [
        envelope("vessel.position",
                 "shipfinder.com (scraped)" if state.get("source") == "shipfinder"
                 else "aisstream.io",
                 world.vessel_seen.get(mmsi), state, STALE_SECONDS["vessels"])
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
    current = (
        envelope("current.state", "tidesandcurrents.noaa.gov", world.current_time,
                 world.current, None)
        if world.current else None
    )
    # Monthly, and a month or two behind, so it carries the month it belongs to
    # rather than an age in seconds. Nothing on the page draws it yet.
    crossings = (
        envelope("crossings.state", "bts.gov (US CBP)", world.crossings_time,
                 world.crossings, None)
        if world.crossings else None
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
            "current": current,
            "crossings": crossings,
            "vessels": vessels,
            "aircraft": [
                envelope("aircraft.state", ADSB_SOURCE,
                         world.aircraft_seen.get(icao), state,
                         STALE_SECONDS["aircraft"])
                for icao, state in world.aircraft.items()
            ],
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


def _eta_text(eta: dict | None) -> str | None:
    """The ETA out of an AIS message 5, as the day and the hour, UTC.

    The field carries no year. A month or a day of zero is the standard's way of
    saying it was not given, and so are hour 24 and minute 60, so those parts are
    left off rather than printed as a time nobody sent.
    """
    if not eta:
        return None
    month, day = eta.get("Month"), eta.get("Day")
    if not month or not day:
        return None
    text = f"{int(month):02d}-{int(day):02d}"
    hour, minute = eta.get("Hour"), eta.get("Minute")
    if hour is not None and minute is not None and int(hour) < 24 and int(minute) < 60:
        text += f" {int(hour):02d}:{int(minute):02d} UTC"
    return text


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
    # The rest of message 5. A ship says where it is going and how deep it sits,
    # and none of it was being kept. Zero is the standard's not-given for the
    # IMO number and for the draught, and an empty string is for the two names.
    call_sign = (src.get("CallSign") or "").strip()
    if call_sign:
        state["call_sign"] = call_sign
    if src.get("ImoNumber"):
        state["imo"] = src["ImoNumber"]
    destination = (src.get("Destination") or "").strip()
    if destination:
        state["destination"] = destination
    if src.get("MaximumStaticDraught"):
        state["draught_m"] = float(src["MaximumStaticDraught"])
    eta = _eta_text(src.get("Eta"))
    if eta:
        state["eta_utc"] = eta


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
    apply_ferry(state, world.ferry_sailings)
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
    apply_ferry(state, world.ferry_sailings)
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


# ---- what else is known about a ship or an aircraft --------------------------
#
# The position feeds say where a thing is. Neither says what it is. adsbdb.com
# will turn a transponder address into an airframe and its owner, and a callsign
# into the airports at either end of the flight; bcferriesapi.ca will say which
# sailing one of the Tsawwassen boats is on and how full it is. Both are free and
# neither wants a key.
#
# Every answer is kept. An aircraft's registration does not change while it is
# crossing the strait, and asking twice is only rudeness to somebody giving this
# away.

ADSBDB_AIRCRAFT_URL = "https://api.adsbdb.com/v0/aircraft/{ident}"
ADSBDB_CALLSIGN_URL = "https://api.adsbdb.com/v0/callsign/{callsign}"
# How many are asked about on one pass of the aircraft feed. The feed polls every
# six seconds and there is rarely more than a handful in the air here.
LOOKUPS_PER_POLL = 3
UA = {"User-Agent": "PointRobertsOceanView/0.1 (+https://oceanview.johnpoole.ca)"}

BCFERRIES_URL = "https://www.bcferriesapi.ca/v2/capacity/"
BCFERRIES_POLL_SECONDS = 120
# Their terminal codes are all the payload carries. These are the terminals the
# boats crossing this water run between. A code that is not here is shown as the
# code rather than guessed at.
TERMINALS = {
    "TSA": "Tsawwassen", "SWB": "Swartz Bay", "SGI": "Southern Gulf Islands",
    "DUK": "Duke Point", "NAN": "Departure Bay", "HSB": "Horseshoe Bay",
    "LNG": "Langdale", "BOW": "Snug Cove", "FUL": "Fulford Harbour",
}


def registry_fields(aircraft: dict) -> dict:
    """What adsbdb knows about one airframe, under our own names."""
    return {k: v for k, v in {
        "registration": aircraft.get("registration"),
        "model": aircraft.get("type"),
        "manufacturer": aircraft.get("manufacturer"),
        "operator": aircraft.get("registered_owner"),
        "operator_country": aircraft.get("registered_owner_country_name"),
    }.items() if v}


def route_fields(flightroute: dict) -> dict:
    """The airports at either end of one callsign, and whose flight it is."""
    def where(airport: dict | None) -> str | None:
        if not airport:
            return None
        name = airport.get("name")
        code = airport.get("icao_code") or airport.get("iata_code")
        if not name:
            return code
        return f"{name} ({code})" if code else name

    return {k: v for k, v in {
        "airline": (flightroute.get("airline") or {}).get("name"),
        "origin": where(flightroute.get("origin")),
        "destination": where(flightroute.get("destination")),
    }.items() if v}


async def _adsbdb(client: httpx.AsyncClient, url: str) -> dict | None:
    """One adsbdb answer, or None when the question could not be asked.

    An empty dict means they were asked and had never heard of it, which is an
    answer and is kept. A failure is not kept, so it is asked again later.
    """
    response = await client.get(url, headers=UA)
    if response.status_code == 404:
        return {}
    response.raise_for_status()
    body = response.json().get("response")
    # They answer an unknown with a string where the object would be.
    return {} if isinstance(body, str) else (body or {})


async def look_up_aircraft(client: httpx.AsyncClient, icao: str) -> None:
    try:
        body = await _adsbdb(client, ADSBDB_AIRCRAFT_URL.format(ident=icao.upper()))
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("adsbdb: could not look up aircraft %s: %r", icao, exc)
        return
    world.aircraft_registry[icao] = registry_fields(body.get("aircraft") or {})


async def look_up_route(client: httpx.AsyncClient, callsign: str) -> None:
    try:
        body = await _adsbdb(client, ADSBDB_CALLSIGN_URL.format(callsign=callsign))
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("adsbdb: could not look up callsign %s: %r", callsign, exc)
        return
    world.flight_routes[callsign] = route_fields(body.get("flightroute") or {})


def ferry_sailings(payload: dict) -> dict[str, dict]:
    """The sailing each boat is on, by vessel name in capitals.

    A boat under way beats one still at the berth, and of two of a kind the
    first listed wins, which is the earlier one. A sailing that has already
    arrived is nobody's current sailing and is dropped.
    """
    rank = {"current": 0, "future": 1}
    out: dict[str, dict] = {}
    for route in payload.get("routes") or []:
        frm = TERMINALS.get(route.get("fromTerminalCode"), route.get("fromTerminalCode"))
        to = TERMINALS.get(route.get("toTerminalCode"), route.get("toTerminalCode"))
        for sailing in route.get("sailings") or []:
            name = (sailing.get("vesselName") or "").strip()
            status = sailing.get("sailingStatus")
            if not name or status not in rank:
                continue
            key = name.upper()
            if key in out and out[key]["_rank"] <= rank[status]:
                continue
            fields = {
                "_rank": rank[status],
                "ferry_route": f"{frm} to {to}",
                "ferry_status": "under way" if status == "current" else "at the berth",
                "ferry_departure": sailing.get("time") or None,
                "ferry_arrival": (sailing.get("arrivalTime") or "").strip() or None,
            }
            # The fill is only given for a sailing that has not gone yet.
            if status == "future" and sailing.get("fill"):
                fields["ferry_fill_percent"] = sailing["fill"]
            out[key] = {k: v for k, v in fields.items() if v is not None}
    for fields in out.values():
        fields.pop("_rank", None)
    return out


FERRY_FIELDS = ("ferry_route", "ferry_status", "ferry_departure",
                "ferry_arrival", "ferry_fill_percent")


def apply_ferry(state: dict, sailings: dict[str, dict]) -> None:
    """Stamp a vessel with the sailing it is on, or take one off it that has
    ended. A boat that is no longer on the board must not keep yesterday's
    crossing."""
    found = sailings.get((state.get("name") or "").strip().upper())
    for field in FERRY_FIELDS:
        state.pop(field, None)
    state.pop("also_from", None)
    if not found:
        return
    state.update(found)
    state["also_from"] = "bcferriesapi.ca"


async def ferries_task() -> None:
    async with httpx.AsyncClient(timeout=25) as client:
        while True:
            try:
                response = await client.get(BCFERRIES_URL, headers=UA)
                response.raise_for_status()
                world.ferry_sailings = ferry_sailings(response.json())
            except (httpx.HTTPError, ValueError) as exc:
                log.warning("BC Ferries: no sailings this pass: %r", exc)
            else:
                for state in world.vessels.values():
                    apply_ferry(state, world.ferry_sailings)
            await asyncio.sleep(BCFERRIES_POLL_SECONDS)


# ---- aircraft feed ----------------------------------------------------------


def aircraft_state(a: dict) -> dict | None:
    """One record as our own shape, or None if it cannot be placed."""
    lat, lon = a.get("lat"), a.get("lon")
    if lat is None or lon is None:
        return None
    alt = a.get("alt_baro")
    on_ground = alt == "ground"
    altitude_m = 0.0 if on_ground else (float(alt) * FT_TO_M if alt is not None else None)
    callsign = (a.get("flight") or "").strip() or None
    state = {
        "icao": a.get("hex"),
        "callsign": callsign,
        "registration": a.get("r"),
        "aircraft_type": a.get("t"),
        "latitude": lat,
        "longitude": lon,
        "altitude_m": altitude_m,
        "on_ground": on_ground,
        "ground_speed_kn": a.get("gs"),
        "track_degrees": a.get("track"),
        "distance_nm": a.get("dst"),
    }

    # The rest of what the transponder sent. Under our own names, with the units
    # in them, and only the ones this aircraft actually reported — an old Mode S
    # box sends a handful of these and a new one sends all of them.
    extra = {
        "squawk": a.get("squawk"),
        "category": a.get("category"),
        "indicated_airspeed_kn": a.get("ias"),
        "true_airspeed_kn": a.get("tas"),
        "mach": a.get("mach"),
        "magnetic_heading_degrees": a.get("mag_heading"),
        "true_heading_degrees": a.get("true_heading"),
        "roll_degrees": a.get("roll"),
        "selected_altitude_ft": a.get("nav_altitude_mcp"),
        "outside_air_temp_c": a.get("oat"),
        "wind_kn": a.get("ws"),
        "wind_from_degrees": a.get("wd"),
        "signal_dbm": a.get("rssi"),
        "messages": a.get("messages"),
        "seen_s": a.get("seen"),
        # What the feed itself knows about the airframe rather than the flight.
        "model": a.get("desc"),
        "operator": a.get("ownOp"),
        "built": a.get("year"),
    }
    # Barometric rate if it sent one, and the GPS one if that is all there is.
    rate = a.get("baro_rate")
    if rate is None:
        rate = a.get("geom_rate")
    extra["vertical_rate_fpm"] = rate
    # Height off the ellipsoid rather than off the pressure datum.
    if a.get("alt_geom") is not None:
        extra["altitude_geometric_m"] = round(float(a["alt_geom"]) * FT_TO_M, 1)
    # "none" is the field saying there is no emergency, which is not news.
    if a.get("emergency") not in (None, "none"):
        extra["emergency"] = a["emergency"]

    state.update({k: v for k, v in extra.items() if v is not None})
    return state


def aircraft_records(payload: dict) -> list:
    """The list of aircraft out of one answer.

    Raises when the key is not there. This is the whole reason the sky went
    empty for a day: the old feed's key was read with a .get and a default, so
    a service that had stopped and a service whose shape had changed both came
    out as no aircraft, which draws exactly like a quiet afternoon.
    """
    records = payload.get("aircraft")
    if records is None:
        raise KeyError(
            f"{ADSB_SOURCE} answered without an 'aircraft' list. It had "
            f"{sorted(payload)!r}. The feed shape has changed and nothing here "
            f"can read it.")
    return records


def callsign_of(state: dict) -> str | None:
    """The callsign to ask adsbdb about, or None when it did not send one."""
    callsign = (state.get("callsign") or "").strip()
    return callsign or None


async def aircraft_task() -> None:
    url = ADSB_URL.format(lat=POINT[0], lon=POINT[1], nm=ADSB_RADIUS_NM)
    async with httpx.AsyncClient(timeout=25) as client:
        while True:
            ok = False
            try:
                response = await client.get(url, headers={"User-Agent": "PointRobertsOceanView/0.1"})
                response.raise_for_status()
                records = aircraft_records(response.json())
                now = utcnow()
                seen_now = set()
                for record in records:
                    state = aircraft_state(record)
                    if not state or not state["icao"]:
                        continue
                    icao = state["icao"]
                    seen_now.add(icao)
                    state.update(world.aircraft_registry.get(icao) or {})
                    if callsign_of(state):
                        state.update(world.flight_routes.get(callsign_of(state)) or {})
                    if world.aircraft_registry.get(icao) or \
                            world.flight_routes.get(callsign_of(state) or ""):
                        state["also_from"] = "adsbdb.com"
                    world.aircraft[icao] = state
                    world.aircraft_seen[icao] = now
                    await clients.broadcast(envelope(
                        "aircraft.state", ADSB_SOURCE, now, state,
                        STALE_SECONDS["aircraft"]))
                # Drop anything that has been out of range long enough to be gone.
                for icao in [k for k, t in world.aircraft_seen.items()
                             if (now - t).total_seconds() > STALE_SECONDS["aircraft"]]:
                    world.aircraft.pop(icao, None)
                    world.aircraft_seen.pop(icao, None)
                # Live means aircraft arrived, not that the request returned.
                if seen_now:
                    if world.health["aircraft"] != "live":
                        world.health["aircraft"] = "live"
                        log.info("%s delivering; aircraft live (%d in range)",
                                 ADSB_SOURCE, len(seen_now))
                elif world.health["aircraft"] != "offline":
                    world.health["aircraft"] = "offline"
                    log.warning("%s answered with no aircraft within %d nm.",
                                ADSB_SOURCE, ADSB_RADIUS_NM)
                ok = True
            except Exception as exc:
                world.health["aircraft"] = "offline"
                log.error("Aircraft fetch failed: %s", exc)

            # And ask adsbdb about a few of the ones nobody has asked about yet.
            # After the broadcast, so a slow lookup never holds up a position.
            asked = 0
            for icao in list(world.aircraft):
                if asked >= LOOKUPS_PER_POLL:
                    break
                if icao not in world.aircraft_registry:
                    await look_up_aircraft(client, icao)
                    asked += 1
                callsign = callsign_of(world.aircraft[icao])
                if asked < LOOKUPS_PER_POLL and callsign and \
                        callsign not in world.flight_routes:
                    await look_up_route(client, callsign)
                    asked += 1

            await asyncio.sleep(AIRCRAFT_POLL_SECONDS if ok else RETRY_SECONDS)


# ---- NOAA tide feed ---------------------------------------------------------


async def coops(client: httpx.AsyncClient, station: str,
                datum: str | None = TIDE_DATUM, **params) -> dict:
    """One CO-OPS call. NOAA reports failures in a 200 body, so check for them.

    A current prediction is a speed and has no datum, so it passes datum=None and
    the parameter is left off the query rather than sent empty."""
    query = {
        "application": "PointRobertsOceanView",
        "station": station,
        "time_zone": "gmt",
        "units": "metric",
        "format": "json",
        **params,
    }
    if datum:
        query["datum"] = datum
    response = await client.get(COOPS_BASE, params=query)
    response.raise_for_status()
    payload = response.json()
    if "error" in payload:
        raise RuntimeError(
            f"NOAA CO-OPS station {station} product={params.get('product')}: "
            f"{payload['error'].get('message')}"
        )
    return payload


def series_block(slots: dict[str, float], step_s: int) -> dict:
    """A 6-minute prediction dict, as an evenly stepped run the browser can index.

    NOAA hands back {"2026-08-11 13:54": 2.31, ...} in the station's own local
    time. The gaps have to be even for an index to work, so this checks that they
    are rather than trusting it: a missing slot would silently shift every value
    after it by six minutes.
    """
    keys = sorted(slots)
    if len(keys) < 2:
        raise RuntimeError(
            f"a prediction series needs at least two slots and this has {len(keys)}")
    start = datetime.strptime(keys[0], "%Y-%m-%d %H:%M")
    values = []
    for i, key in enumerate(keys):
        when = datetime.strptime(key, "%Y-%m-%d %H:%M")
        want = start + timedelta(seconds=step_s * i)
        if when != want:
            raise RuntimeError(
                f"prediction series has a gap: slot {i} is {key} and an even "
                f"{step_s} s step wants {want:%Y-%m-%d %H:%M}. Indexing it would "
                f"put every value after this one at the wrong time.")
        values.append(round(slots[key], 3))
    return {"start": keys[0] + "Z", "step_s": step_s, "values": values}


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
            # The whole prediction, so a page standing at another hour can read
            # the water there. Astronomical only: the surge is a measurement made
            # ten minutes ago and it is weather, so carrying it six hours out
            # would be inventing. A page off the present hour shows this and says
            # it is a prediction.
            "series": series_block(series[TIDE_STATION], 360),
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


# ---- NOAA tidal current feed ------------------------------------------------


async def fetch_current_series(client: httpx.AsyncClient, start: datetime) -> list[tuple]:
    """The station's predicted stream over the next couple of days, as
    (time, centimetres a second, flood bearing, ebb bearing, bin depth)."""
    rows = (await coops(
        client, CURRENT_STATION, datum=None, product="currents_predictions",
        bin=CURRENT_BIN, begin_date=start.strftime("%Y%m%d"),
        range=24 * CURRENT_FETCH_DAYS, interval="30",
    ))["current_predictions"]["cp"]
    series = []
    for row in rows:
        when = parse_time(row["Time"])
        if when is None:
            raise RuntimeError(
                f"NOAA currents_predictions station {CURRENT_STATION} bin "
                f"{CURRENT_BIN}: unparsable timestamp {row['Time']!r}"
            )
        series.append((
            when,
            float(row["Velocity_Major"]),
            float(row["meanFloodDir"]),
            float(row["meanEbbDir"]),
            float(row["Depth"]),
        ))
    if not series:
        raise RuntimeError(
            f"NOAA currents_predictions station {CURRENT_STATION} bin "
            f"{CURRENT_BIN} returned no rows for {start:%Y-%m-%d}"
        )
    series.sort(key=lambda r: r[0])
    return series


def current_at(series: list[tuple], when: datetime) -> dict:
    """Straight-line interpolation between the half-hourly predictions. Returns
    the set — the bearing the water is going — and the drift."""
    if when < series[0][0] or when > series[-1][0]:
        raise RuntimeError(
            f"NOAA currents_predictions for {CURRENT_STATION} cover "
            f"{series[0][0]:%Y-%m-%d %H:%M} to {series[-1][0]:%Y-%m-%d %H:%M} "
            f"and {when:%Y-%m-%d %H:%M} is outside that. Refetch the series."
        )
    later = next(i for i, row in enumerate(series) if row[0] >= when)
    if later == 0:
        row, span = series[0], 0.0
        velocity = row[1]
    else:
        before, after = series[later - 1], series[later]
        span = (after[0] - before[0]).total_seconds()
        t = 0.0 if span == 0 else (when - before[0]).total_seconds() / span
        velocity = before[1] + (after[1] - before[1]) * t
        row = before

    _, _, flood_dir, ebb_dir, depth_m = row
    speed = abs(velocity) * CM_PER_S_TO_M_PER_S
    if speed < CURRENT_SLACK_MPS:
        state, set_deg = "slack", None
    elif velocity >= 0:
        state, set_deg = "flooding", flood_dir
    else:
        state, set_deg = "ebbing", ebb_dir
    return {
        "station_id": CURRENT_STATION,
        "bin": CURRENT_BIN,
        "bin_depth_m": depth_m,
        "station_distance_km": CURRENT_STATION_KM,
        "set_degrees": set_deg,
        "drift_mps": round(speed, 3),
        "drift_kn": round(speed / KNOT_MPS, 2),
        "state": state,
        "flood_direction_deg": flood_dir,
        "ebb_direction_deg": ebb_dir,
        # This is a prediction for one point offshore, not a measurement of the
        # water the boat is in. Anything showing it has to say so.
        "kind": "prediction",
    }


async def current_task() -> None:
    async with httpx.AsyncClient(timeout=30) as client:
        series: list[tuple] = []
        while True:
            ok = False
            try:
                now = utcnow()
                # One call a day rather than one every poll: a prediction for a
                # given minute is the same answer whenever it is asked for.
                if not series or now > series[-1][0] - timedelta(hours=2):
                    series = await fetch_current_series(client, now)
                    log.info("Current predictions %s bin %d: %d rows, %s to %s",
                             CURRENT_STATION, CURRENT_BIN, len(series),
                             series[0][0].strftime("%Y-%m-%d %H:%M"),
                             series[-1][0].strftime("%Y-%m-%d %H:%M"))
                world.current = current_at(series, now)
                # The whole prediction, so a page standing at another hour can
                # read the stream there. Every slot is worked out with the same
                # rule as the live one, rather than the rule being written twice.
                world.current["series"] = {
                    "start": series[0][0].strftime("%Y-%m-%d %H:%M") + "Z",
                    "step_s": int((series[1][0] - series[0][0]).total_seconds()),
                    "rows": [
                        [c["drift_mps"], c["set_degrees"], c["state"]]
                        for c in (current_at(series, row[0]) for row in series)
                    ],
                }
                world.current_time = now
                world.health["currents"] = "live"
                await clients.broadcast(envelope(
                    "current.state", "tidesandcurrents.noaa.gov",
                    world.current_time, world.current, None))
                log.info("Current %.2f kn %s (%s)", world.current["drift_kn"],
                         world.current["state"],
                         "slack" if world.current["set_degrees"] is None
                         else f"{world.current['set_degrees']:.0f}°")
                ok = True
            except Exception as exc:
                world.health["currents"] = "offline"
                log.error("Current fetch failed: %s", exc)
            await asyncio.sleep(CURRENT_POLL_SECONDS if ok else RETRY_SECONDS)


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


async def fetch_weather(client: httpx.AsyncClient) -> dict:
    forecast = await client.get(FORECAST_URL, params={
        "latitude": POINT[0], "longitude": POINT[1],
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
            "latitude": POINT[0], "longitude": POINT[1],
            "current": "aerosol_optical_depth",
        })
        air.raise_for_status()
        aod = air.json().get("current", {}).get("aerosol_optical_depth")
    except Exception as exc:
        log.warning("Aerosol optical depth unavailable, sky turbidity held: %s", exc)

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
            "cloud_cover_low_percent": cur.get("cloud_cover_low"),
            "cloud_cover_mid_percent": cur.get("cloud_cover_mid"),
            "cloud_cover_high_percent": cur.get("cloud_cover_high"),
            "aerosol_optical_depth": aod,
            "precipitation_probability_percent": pprob,
            "description": WMO_CODES.get(cur.get("weather_code")),
            "wave_height_m": wave_h,
            "wave_direction_degrees": wave_dir,
            "wave_period_s": wave_period,
            # The hourly run, for a page standing at another hour. The sea state
            # is not in it: Open-Meteo's marine call gives the wave now and no
            # forecast, so a page off the present hour keeps the present sea and
            # nothing pretends otherwise.
            "series": hourly_block(hourly),
        },
        "time": parse_time(cur.get("time")) or now,
    }


# BTS publishes one row per port, month and measure. Fold them into a month.
CROSSING_MEASURES = {
    "Personal Vehicles": "personal_vehicles",
    "Personal Vehicle Passengers": "personal_vehicle_passengers",
    "Trucks": "trucks",
    "Truck Containers Full": "truck_containers_full",
    "Truck Containers Empty": "truck_containers_empty",
    "Buses": "buses",
    "Bus Passengers": "bus_passengers",
    "Pedestrians": "pedestrians",
}


async def fetch_crossings(client: httpx.AsyncClient) -> dict:
    rows = await client.get(CROSSINGS_URL, params={
        "$where": f"port_code='{CROSSINGS_PORT_CODE}'",
        "$order": "date DESC",
        # Eight measures a month, so ask for enough rows to fill the months.
        "$limit": CROSSINGS_MONTHS * len(CROSSING_MEASURES),
    })
    rows.raise_for_status()
    data = rows.json()
    if not data:
        raise RuntimeError(
            f"BTS returned no rows for port_code {CROSSINGS_PORT_CODE}. Either the "
            f"port code has changed or the dataset behind {CROSSINGS_URL} has "
            "moved; check https://www.bts.gov/border-crossing-entry-data.")

    months: dict[str, dict] = {}
    for row in data:
        month = row["date"][:7]
        key = CROSSING_MEASURES.get(row.get("measure"))
        if key is None:
            continue                        # a measure this port does not carry
        months.setdefault(month, {"month": month})[key] = int(row["value"])
    if not months:
        raise RuntimeError(
            "BTS rows carried no measure this understands. Their names are in "
            f"CROSSING_MEASURES; the rows said {sorted({r.get('measure') for r in data})}.")

    # This port does not file every measure every month, so the row budget
    # stretches further than the months asked for. Cut it back to what was asked.
    ordered = [months[m] for m in sorted(months, reverse=True)][:CROSSINGS_MONTHS]
    latest = ordered[0]
    # The month is the reading's own date. It is a month or two behind today and
    # saying so is the point of carrying it.
    when = datetime.strptime(latest["month"], "%Y-%m").replace(tzinfo=timezone.utc)
    return {
        "state": {
            "port_name": data[0].get("port_name"),
            "port_code": CROSSINGS_PORT_CODE,
            "border": data[0].get("border"),
            "month": latest["month"],
            **{k: latest.get(k) for k in CROSSING_MEASURES.values()},
            "recent_months": ordered,
        },
        "time": when,
    }


async def crossings_task() -> None:
    async with httpx.AsyncClient(timeout=60) as client:
        while True:
            ok = False
            try:
                result = await fetch_crossings(client)
                world.crossings = result["state"]
                world.crossings_time = result["time"]
                world.health["crossings"] = "live"
                await clients.broadcast(envelope(
                    "crossings.state", "bts.gov (US CBP)",
                    world.crossings_time, world.crossings, None))
                log.info("Crossings %s: %s personal vehicles, %s passengers, "
                         "%s trucks, %s on foot",
                         world.crossings["month"],
                         world.crossings["personal_vehicles"],
                         world.crossings["personal_vehicle_passengers"],
                         world.crossings["trucks"],
                         world.crossings["pedestrians"])
                ok = True
            except Exception as exc:
                world.health["crossings"] = "offline"
                log.error("Border crossings fetch failed: %s", exc)
            await asyncio.sleep(CROSSINGS_POLL_SECONDS if ok else RETRY_SECONDS)


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


# ---- scraped vessels --------------------------------------------------------

# Only while somebody is watching, and then rarely. Their map polls the same
# endpoint every ten seconds, so an ordinary visitor to their site is worth
# about thirty of these.
#
# A pass is a headless page load and a twenty-second wait for their poll to come
# back, so about half a minute once the ship cache is warm and every hull in the
# box is already known. Five minutes leaves ten times that idle between passes.
SHIPFINDER_PERIOD_SECONDS = 300.0
SHIPFINDER_IDLE_CHECK_SECONDS = 15.0
SHIPFINDER_NOTE = "scraped from shipfinder"


async def shipfinder_task() -> None:
    from server import shipfinder

    # None, not zero: the loop clock starts near zero too, so zero would read as
    # "ran a moment ago" and hold the first scrape back the full ten minutes.
    last_run: float | None = None
    while True:
        # Nobody watching, nothing to fetch. Nor if the real feed is working:
        # this is a stand-in for a dead feed, not a second opinion on a live one.
        if not clients.count or world.health["vessels"] == "live":
            await asyncio.sleep(SHIPFINDER_IDLE_CHECK_SECONDS)
            continue
        now = asyncio.get_running_loop().time()
        if last_run is not None and now - last_run < SHIPFINDER_PERIOD_SECONDS:
            await asyncio.sleep(SHIPFINDER_IDLE_CHECK_SECONDS)
            continue
        last_run = now
        try:
            ships = shipfinder.load_cache()
            found, learned = await shipfinder.fetch(BBOX, ships)
            if learned:
                ships.update(learned)
                shipfinder.save_cache(ships)
                log.info("Shipfinder: learned %d ships, %d known now",
                         len(learned), len(ships))
        except Exception as exc:
            world.health["vessels"] = "offline"
            world.vessels_note = "shipfinder unreachable"
            log.error("Shipfinder scrape failed: %s", exc)
            await asyncio.sleep(RETRY_SECONDS)
            continue

        seen_at = utcnow()
        fresh = set()
        # Their map lists some hulls under two of its own ids. One MMSI is one
        # boat, so the second copy is dropped rather than drawn alongside itself.
        afloat: set[str] = set()
        for v in found:
            key = v["id"]
            mmsi = (ships.get(key) or {}).get("mmsi")
            if mmsi:
                if mmsi in afloat:
                    continue
                afloat.add(mmsi)
            fresh.add(key)
            state = world.vessels.setdefault(key, {"mmsi": key})
            # Course from the last fix, because the payload does not carry one
            # that could be read with any confidence.
            course = shipfinder.bearing(
                state.get("latitude", v["latitude"]),
                state.get("longitude", v["longitude"]),
                v["latitude"], v["longitude"])
            if course is not None:
                state["course_over_ground_degrees"] = course
            state["latitude"] = v["latitude"]
            state["longitude"] = v["longitude"]
            state["source"] = "shipfinder"

            # What the ship is, if it has ever been looked up. The MMSI replaces
            # their internal id, which is meaningless outside their own system.
            known = ships.get(key)
            if known:
                if known.get("mmsi"):
                    state["mmsi"] = known["mmsi"]
                for field in ("name", "call_sign", "imo", "vessel_type_name"):
                    if known.get(field):
                        state[field] = known[field]
                # The type the panel gave, as the AIS code the renderer knows.
                # Unset when it is a name we have not met, so an unknown vessel
                # stays unclassified instead of being drawn as something else.
                code = shipfinder.type_code(known.get("vessel_type_name"))
                if code is not None:
                    state["vessel_type"] = code
                if known.get("length_m") and known.get("width_m"):
                    state["dimensions_m"] = {"length": known["length_m"],
                                             "width": known["width_m"]}
                if known.get("speed_over_ground_knots") is not None:
                    state["speed_over_ground_knots"] = known["speed_over_ground_knots"]
            apply_ferry(state, world.ferry_sailings)
            world.vessel_seen[key] = seen_at

        # Only ours. An AIS vessel that came back to life is not this task's to
        # throw away.
        stale = [k for k, s in world.vessels.items()
                 if s.get("source") == "shipfinder" and k not in fresh]
        for key in stale:
            del world.vessels[key]
            world.vessel_seen.pop(key, None)

        world.health["vessels"] = "scraped"
        world.vessels_note = SHIPFINDER_NOTE
        log.info("Shipfinder: %d vessels in the box", len(found))
        await clients.broadcast(snapshot())


# ---- ships that have gone ----------------------------------------------------


def reap_vessels(now: datetime | None = None) -> list[str]:
    """Take off every ship whose last fix is older than the cutoff, and every
    ship that has no fix at all. Returns the keys removed.

    No fix at all is not a corner case. AIS message 5 is a ship's account of
    itself and carries no position, so a ship that names itself from outside the
    box puts a record in with nothing to draw. Those were never reaped by an age
    they did not have."""
    now = now or utcnow()
    cutoff = DROP_SECONDS["vessels"]
    gone = [key for key in world.vessels
            if key not in world.vessel_seen
            or (now - world.vessel_seen[key]).total_seconds() > cutoff]
    for key in gone:
        del world.vessels[key]
        world.vessel_seen.pop(key, None)
    return gone


async def reaper_task() -> None:
    """Runs whether or not anybody is watching, so the first visitor after a
    quiet night is handed the water as it is and not as it was."""
    while True:
        await asyncio.sleep(REAP_PERIOD_SECONDS)
        gone = reap_vessels()
        if gone:
            log.info("Reaped %d vessels that had gone quiet, %d left",
                     len(gone), len(world.vessels))
            await clients.broadcast(snapshot())


# ---- heartbeat --------------------------------------------------------------


async def heartbeat_task() -> None:
    while True:
        await clients.broadcast({
            "schema_version": SCHEMA_VERSION,
            "message_type": "heartbeat",
            "server_time": iso(utcnow()),
        })
        await asyncio.sleep(HEARTBEAT_SECONDS)


# ---- who else is here -------------------------------------------------------


async def presence_task() -> None:
    """Everyone's position out to everyone, once a second.

    Sent on a tick rather than on arrival: a dozen browsers each moving would
    otherwise be a dozen broadcasts a frame. One list a second is a marker that
    slides rather than jumps, and the client does the sliding.

    Sent even when it is empty, so a browser whose only company just left is told
    so rather than being left with a marker standing where nobody is."""
    was = -1
    while True:
        here = clients.placed()
        if here or was != 0:
            await clients.broadcast({
                "schema_version": SCHEMA_VERSION,
                "message_type": "presence.state",
                "server_time": iso(utcnow()),
                "data": {"here": here},
            })
        was = len(here)
        await asyncio.sleep(PRESENCE_SECONDS)


# ---- the visitor record on disk ---------------------------------------------


async def visitors_task() -> None:
    """The record written out when it has changed, and not more often.

    Every open and close marks it dirty. Writing on each of those would be a file
    rewrite per page load; writing on a timer alone would rewrite an unchanged
    file all day. The shutdown hook catches whatever the last tick missed."""
    while True:
        await asyncio.sleep(VISITORS_SAVE_SECONDS)
        try:
            visitors.save_if_dirty()
        except OSError as exc:
            log.error("Visitors: could not write %s: %r", VISITORS_PATH, exc)


# ---- app --------------------------------------------------------------------

app = FastAPI()

# The terrain heightmaps are the bulk of a page load. As int16 decimetres they
# gzip to about a tenth of their size, so serve them compressed. Level 6 rather
# than the default 9: on a 7 MB heightmap the last level buys a few per cent for
# several times the CPU, and this is re-compressed on every cold request.
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)

_tasks: list[asyncio.Task] = []


def _spawn(coro, name: str, feed: str | None = None) -> asyncio.Task:
    """A task that dies takes its feed with it, and asyncio says nothing unless
    somebody asks. This asks.

    feed is the health key the task keeps up to date. Logging the death is not
    enough on its own: the last thing a task did before dying was probably set
    its health to live, and nothing else ever sets it back, so the page would go
    on showing LIVE over numbers that had stopped moving. So the death sets it
    offline. A surviving task that shares the key will put it back on its next
    good cycle, which is what should happen — the vessels key has two owners."""
    task = asyncio.create_task(coro, name=name)

    def done(t: asyncio.Task) -> None:
        if t.cancelled():
            return
        exc = t.exception()
        if exc is not None:
            log.error("Feed task %s died and its feed has stopped: %r", name, exc,
                      exc_info=exc)
        else:
            log.error("Feed task %s returned and its feed has stopped.", name)
        if feed:
            world.health[feed] = "offline"
            if feed == "vessels":
                world.vessels_note = f"{name} task died"

    task.add_done_callback(done)
    return task


@app.on_event("startup")
async def startup() -> None:
    # Before any socket opens, or the first visitor of the new container would be
    # counted against an empty table and then overwrite the old one.
    visitors.load()
    # The third column is the health key the task owns, so its death takes that
    # reading down with it. The heartbeat owns none: it is not a feed.
    for coro, name, feed in ((ais_task(), "ais", "vessels"),
                             (shipfinder_task(), "shipfinder", "vessels"),
                             (tide_task(), "tide", "tide"),
                             (current_task(), "current", "currents"),
                             (aircraft_task(), "aircraft", "aircraft"),
                             (weather_task(), "weather", "weather"),
                             (crossings_task(), "crossings", "crossings"),
                             (ferries_task(), "ferries", None),
                             (heartbeat_task(), "heartbeat", None),
                             (presence_task(), "presence", None),
                             (reaper_task(), "reaper", None),
                             (visitors_task(), "visitors", None)):
        _tasks.append(_spawn(coro, name, feed))


@app.on_event("shutdown")
async def shutdown() -> None:
    for task in _tasks:
        task.cancel()
    # Whatever the last save tick missed. A deploy is a shutdown, and a deploy
    # losing the last half minute of the record is the thing this is here to
    # stop.
    try:
        visitors.save_if_dirty()
    except OSError as exc:
        log.error("Visitors: could not write %s on the way out: %r",
                  VISITORS_PATH, exc)


@app.websocket("/ws/live")
async def ws_live(ws: WebSocket) -> None:
    who = await clients.add(ws)
    try:
        # Its own name first, so it can leave itself out of the crowd it is about
        # to be sent. Without this every browser draws a marker on its own head.
        await ws.send_text(json.dumps({
            "schema_version": SCHEMA_VERSION,
            "message_type": "presence.you",
            "data": {"id": who},
        }))
        await ws.send_text(json.dumps(snapshot()))
        while True:
            at = read_position(await ws.receive_text())
            # Anything that is not a position is dropped and the socket stays
            # open. A browser sending nonsense is a browser with a bug, not a
            # reason to close on it.
            if at:
                clients.place(ws, at)
    except WebSocketDisconnect:
        clients.remove(ws)
    except Exception:
        clients.remove(ws)


def since(dt: datetime) -> str:
    seconds = int((utcnow() - dt).total_seconds())
    if seconds < 60:
        return f"{seconds}s ago"
    if seconds < 3600:
        return f"{seconds // 60}m ago"
    if seconds < 86400:
        return f"{seconds // 3600}h ago"
    return f"{seconds // 86400}d ago"


@app.get("/admin/visitors", response_class=HTMLResponse)
async def admin_visitors(request: Request) -> Response:
    if not ADMIN_PASSWORD:
        # A page listing people's addresses does not get to open itself because
        # nobody set a password.
        log.error(
            "GET /admin/visitors refused: OCEANVIEW_ADMIN_PASSWORD is not set. "
            "Put it in the .env beside docker-compose.yml and restart."
        )
        return HTMLResponse(
            "OCEANVIEW_ADMIN_PASSWORD is not set on the server, so this page is "
            "shut. Set it in .env and restart.",
            status_code=503,
        )

    header = request.headers.get("authorization", "")
    given = ""
    if header.startswith("Basic "):
        try:
            decoded = base64.b64decode(header[6:]).decode("utf-8")
            _, _, given = decoded.partition(":")
        except (binascii.Error, UnicodeDecodeError):
            given = ""
    if not secrets.compare_digest(given, ADMIN_PASSWORD):
        return Response(
            status_code=401,
            headers={"WWW-Authenticate": 'Basic realm="oceanview"'},
        )

    rows = visitors.listing()
    here = sum(1 for r in rows if r["open"])
    body = [
        "<title>Visitors</title>",
        "<style>body{font:14px system-ui;margin:2rem;color:#20262c}"
        "table{border-collapse:collapse}th,td{text-align:left;padding:.35rem 1.2rem .35rem 0}"
        "th{border-bottom:1px solid #c8ced4;font-weight:600}"
        "td{border-bottom:1px solid #eceff2;font-variant-numeric:tabular-nums}"
        ".here{color:#1a7f4b;font-weight:600}.gone{color:#8b939b}</style>",
        f"<p>{here} here now, {len(rows)} seen.</p>",
        "<table><tr><th>address<th>active<th>last seen<th>first seen<th>visits</tr>",
    ]
    for r in rows:
        live = r["open"] > 0
        body.append(
            "<tr>"
            f"<td>{html.escape(r['ip'])}"
            f"<td class='{'here' if live else 'gone'}'>{'yes' if live else 'no'}"
            f"<td>{'now' if live else since(r['last_seen'])}"
            f"<td>{since(r['first_seen'])}"
            f"<td>{r['visits']}"
            "</tr>"
        )
    body.append("</table>")
    return HTMLResponse("\n".join(body))


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
