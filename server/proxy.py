"""Local proxy for the Point Roberts ocean view.

Serves the static site and bridges the upstream feeds into one browser
WebSocket at /ws/live. What is here is the socket, the client registry, the
snapshot, the health table, and a polling loop for each feed. The call to each
upstream and the arithmetic on what it hands back is its own module beside this
one:

  - vessels   : AISStream.io, here (needs AISSTREAM_API_KEY in .env)
  - aircraft  : adsb.fi, here. Community-fed ADS-B, 20 km around the bluff
  - tide      : server/noaa.py
  - currents  : server/noaa.py
  - weather   : server/weather.py
  - wait      : server/wait.py, the queue at the line now
  - crossings : server/crossings.py, the monthly count through the booth
  - blotter   : server/blotter.py, the Sheriff's daily log
  - golf      : server/tee.py
  - marina    : server/marina.py, counted off the camera

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
import colorsys
import hashlib
import html
import json
import logging
import math
import os
import secrets
import time
from collections import deque
from datetime import datetime, timedelta
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

# The Sheriff's daily report reader. Its own module because reading a PDF has
# nothing to do with the rest of this.
from server import blotter  # noqa: E402
# What nobody else keeps. The reason each feed is in there is written down in
# the module, because the test of whether something belongs is whether it has a
# history somewhere already.
from server import archive as archive_store  # noqa: E402
# The feeds. Each is the call to one upstream and the arithmetic on what it
# hands back. What stays here is the loop that polls it, what it does to the
# world, and who is told.
from server import crossings as crossings_feed  # noqa: E402
from server import noaa  # noqa: E402
from server import wait as wait_feed  # noqa: E402
from server import weather as weather_feed  # noqa: E402
from server.when import iso, local_now, parse_time, utcnow  # noqa: E402

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
# A reading older than this is no longer the present one. Vessels and aircraft
# are live positions and go stale quickly. The three polled providers are asked
# every 300 s, so 900 s is three missed polls: long enough that one slow answer
# is not a fault, short enough that nobody reads a quarter-hour-old sky as now.
# These were None, which made quality.stale false for those three whatever the
# age, so a reading could not be condemned by age at all.
STALE_SECONDS = {"vessels": 300, "aircraft": 120,
                 "weather": 900, "tide": 900, "currents": 900}

# When a ship stops being a ship on the water. Nothing upstream ever says a
# vessel has gone: AISStream simply stops sending once it leaves the box, and so
# the record only ever grew. Every hull that crossed the strait since the
# container started stayed in it and went on being drawn, greyed out, sitting
# where it was hours ago.
#
# Longer than the stale threshold, so a track greys before it goes and is not
# taken off the moment the feed hiccups. For ships, longer than the shipfinder
# pass at 300s too, so a scraped one is not reaped between two good passes.
DROP_SECONDS = {"vessels": 900, "aircraft": 300}
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

TIDE_POLL_SECONDS = 300
RETRY_SECONDS = 20  # after a failed fetch, retry soon instead of the full poll
CURRENT_POLL_SECONDS = 300

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

# Where the view stands. The aircraft feed asks for a radius round it and the
# weather feed is asked for the sky over it.
POINT = (48.989009, -123.085318)
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
# ---- what the deputy was called out to -------------------------------------
#
# Whatcom County files a Law Incident Media Summary Report every day and the
# peninsula's calls are in it. Public record, one PDF a day, read in
# server/blotter.py. The point has a resident deputy and logs about a call a
# day against seventy across the county.
ARCHIVE_PATH = REPO_ROOT / "data" / "archive"
archive = archive_store.Archive(ARCHIVE_PATH)

BLOTTER_PATH = REPO_ROOT / "data" / "blotter.json"
BLOTTER_POLL_SECONDS = 3600


# ---- the queue at the line, now ---------------------------------------------
#
# US Customs publishes what every land crossing is doing as open JSON. The
# monthly counts below say how many came through last year; this says whether
# there is anybody in the lane at this minute, which is the thing the page opens
# looking at.
#
# The port is filed under Blaine with the crossing named Point Roberts. Three
# passenger lanes, one commercial, twenty-four hours. CBP leaves a lane as
# "Update Pending" when it has nothing to report, and for a crossing this quiet
# that is most of the time — which is itself the reading, and is why the empty
# case is carried through rather than treated as a failure.
WAIT_POLL_SECONDS = 600

# A figure that changes four times a year does not want asking for more often.
CROSSINGS_POLL_SECONDS = 6 * 3600

AIRCRAFT_POLL_SECONDS = 6.0
FT_TO_M = 0.3048

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
        self.wait: dict | None = None
        self.wait_time: datetime | None = None
        self.blotter: dict | None = None
        self.blotter_time: datetime | None = None
        # The last thing the marina camera was read to hold, and when.
        self.marina: dict | None = None
        self.marina_time: datetime | None = None
        # The club's booking sheet as far as it has been watched today.
        self.tee_sheet = None
        self.tee: dict | None = None
        self.tee_time: datetime | None = None
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
            "wait": "offline",
            "blotter": "offline",
            # Idle until somebody opens the marina, which is the whole point of
            # it: this feed costs the marina's provider a picture every minute.
            "marina": "idle",
            # Idle until the first read of the day, which is at six.
            "golf": "idle",
        }


world = World()


# ---- browser connections ---------------------------------------------------


# A slow reader must not hold up every feed or accumulate stale state forever.
# These limits include queued identity/snapshot/feed events and one latest
# presence list; there can also be one send in flight, bounded by the timeout.
CLIENT_QUEUE_MESSAGES = 128
CLIENT_QUEUE_BYTES = 2 * 1024 * 1024
CLIENT_SEND_SECONDS = 5.0
CLIENT_CLOSE_SECONDS = 1.0


class ClientDelivery:
    """One writer per socket; only unsent presence may be superseded."""

    def __init__(self, owner, ws):
        self.owner, self.ws = owner, ws
        self.pending = deque()
        self.presence = None
        self.bytes = 0
        self.ready = asyncio.Event()
        self.task = None
        self.running = False
        self.closing = False
        self.close_code = 1000

    def offer(self, item):
        if self.closing:
            return
        if item[0] and self.presence is not None:
            # Append the replacement at its new chronological position. Feed
            # events between the two snapshots retain their relative order.
            self.pending.remove(self.presence)
            self.bytes -= self.presence[2]
            self.owner.delivery_stats["coalesced"] += 1
        if len(self.pending) >= CLIENT_QUEUE_MESSAGES or self.bytes + item[2] > CLIENT_QUEUE_BYTES:
            self.owner.delivery_stats["overflow"] += 1
            self.owner.remove(self.ws, code=1013)
            return
        self.pending.append(item)
        self.bytes += item[2]
        if item[0]:
            self.presence = item
        self.ready.set()

    def stop(self, code=1000):
        if self.closing:
            return
        self.closing, self.close_code = True, code
        self.pending.clear()
        self.presence = None
        self.bytes = 0
        self.ready.set()
        # If it hasn't started yet, let run enter its finally block and close.
        if self.running and self.task is not asyncio.current_task():
            self.task.cancel()

    async def run(self):
        self.running = True
        try:
            while not self.closing:
                await self.ready.wait()
                if self.closing:
                    break
                item = self.pending.popleft()
                self.bytes -= item[2]
                if item is self.presence:
                    self.presence = None
                if not self.pending:
                    self.ready.clear()
                await asyncio.wait_for(self.ws.send_text(item[1]), CLIENT_SEND_SECONDS)
                self.owner.delivery_stats["sent"] += 1
        except asyncio.TimeoutError:
            self.owner.delivery_stats["timeouts"] += 1
            self.close_code = 1013
        except asyncio.CancelledError:
            pass
        except Exception:
            self.owner.delivery_stats["send_errors"] += 1
            self.close_code = 1011
        finally:
            self.owner.remove(self.ws, code=self.close_code)
            self.pending.clear()
            self.presence = None
            self.bytes = 0
            try:
                await asyncio.wait_for(self.ws.close(code=self.close_code), CLIENT_CLOSE_SECONDS)
            except (Exception, asyncio.CancelledError):
                pass


class Clients:
    """Everyone with the page open, and where each of them is standing.

    The position is held here rather than in Visitors on purpose. Visitors is
    keyed by address and is written to disk; this is keyed by socket and is
    thrown away when the socket closes. The two must not meet: a visitor's
    address is the admin's business and nobody else's, and where somebody is
    looking goes out to every other browser on the site."""

    def __init__(self) -> None:
        self._sockets: dict[WebSocket, dict] = {}
        self._senders: dict[WebSocket, asyncio.Task] = {}
        self.delivery_stats = dict(sent=0, coalesced=0, overflow=0, timeouts=0, send_errors=0)

    async def add(self, ws: WebSocket) -> str:
        await ws.accept()
        # What every other browser will call this one. Random per connection, so
        # it says nothing about who or where they are, and a reconnection is a
        # new stranger rather than the same one recognised.
        who = secrets.token_hex(4)
        # The colour every other browser will draw this one in, from the address
        # and settled here so the address itself never goes out on the wire.
        ip = client_ip(ws)
        delivery = ClientDelivery(self, ws)
        self._sockets[ws] = {"id": who, "at": None, "delivery": delivery,
                             "color": ip_color(ip), "watching": {}}
        visitors.opened(ip)
        task = delivery.task = asyncio.create_task(delivery.run(), name="visitor-delivery")
        self._senders[ws] = task
        task.add_done_callback(lambda done: self._senders.pop(ws, None))
        # No await between registration and these two enqueues: even a broadcast
        # during a busy connection ramp cannot precede identity/initial state.
        delivery.offer(self._encoded({"schema_version": SCHEMA_VERSION,
                                     "message_type": "presence.you",
                                     "data": {"id": who, "color": self._sockets[ws]["color"]}}))
        delivery.offer(self._encoded(snapshot()))
        return who

    @property
    def count(self) -> int:
        return len(self._sockets)

    def remove(self, ws: WebSocket, code=1000) -> None:
        seat = self._sockets.pop(ws, None)
        if seat is not None:
            visitors.closed(client_ip(ws))
            seat["delivery"].stop(code)

    async def disconnect(self, ws: WebSocket) -> None:
        task = self._senders.get(ws)
        self.remove(ws)
        if task is not None:
            try:
                # ASGI may cancel the receiving task as the peer disconnects.
                # Do not relay a second cancellation into its writer's bounded
                # close; it stays tracked until done (and shutdown awaits it).
                await asyncio.shield(task)
            except asyncio.CancelledError:
                pass

    async def shutdown(self) -> None:
        tasks = list(self._senders.values())
        for ws in list(self._sockets):
            self.remove(ws, code=1001)
        if tasks:
            # A normal cancelled send and close finish within CLOSE_SECONDS.
            # Do not let a misbehaving transport hold server shutdown forever.
            _, pending = await asyncio.wait(tasks, timeout=CLIENT_CLOSE_SECONDS + 1)
            for task in pending:
                task.cancel()

    def place(self, ws: WebSocket, at: dict | None) -> None:
        seat = self._sockets.get(ws)
        if seat is not None:
            seat["at"] = at

    def watching(self, ws: WebSocket, area: str) -> None:
        seat = self._sockets.get(ws)
        if seat is not None:
            seat["watching"][area] = time.monotonic()

    def anyone_watching(self, area: str, within: float) -> bool:
        """True while at least one open browser has said so lately.

        Browsers repeat it while they are looking, so silence means they have
        moved on or gone, and the feed it gates stops being polled.
        """
        cutoff = time.monotonic() - within
        return any(seat["watching"].get(area, 0) > cutoff
                   for seat in self._sockets.values())

    def placed(self) -> list[dict]:
        """Everyone who has said where they are. Id, position and colour."""
        return [dict(seat["at"], id=seat["id"], color=seat["color"])
                for seat in self._sockets.values() if seat["at"]]

    async def broadcast(self, message: dict) -> None:
        item = self._encoded(message)
        for seat in list(self._sockets.values()):
            seat["delivery"].offer(item)
        # Buffered upstream events can arrive without yielding in their reader.
        # Give writers a turn without waiting for any particular connection.
        await asyncio.sleep(0)

    @staticmethod
    def _encoded(message):
        text = json.dumps(message)
        # The immutable string and byte count are shared by all recipients.
        return (message.get("message_type") == "presence.state", text, len(text.encode("utf-8")))


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
    at = _presence_pose(msg)
    if at is None:
        return None
    mode = msg.get("mode")
    if isinstance(mode, str) and mode in {"orbit", "fly", "live", "walk", "bike", "cart", "boat", "ultralight"}:
        at["mode"] = mode
        body = msg.get("body")
        if mode in {"walk", "bike", "cart", "boat", "ultralight"} and isinstance(body, dict):
            pose = _presence_pose(body)
            try:
                pitch, roll = float(body.get("pitch", 0)), float(body.get("roll", 0))
            except (TypeError, ValueError):
                pitch = roll = float("nan")
            if pose is not None and -180 <= pitch <= 180 and -180 <= roll <= 180:
                at["body"] = {**pose, "pitch": round(pitch, 1), "roll": round(roll, 1)}
    return at


# Areas a browser may say it is looking at. Anything else is dropped: this is
# not a free-text channel and it must never grow into one.
WATCHABLE = {"marina"}


def read_watching(text: str) -> str | None:
    """A browser saying which detailed area it is looking at, or None.

    This is deliberately not part of the position message. A position goes out
    to every other browser on the site; what somebody is looking at stays on
    this side of the socket and is used for one thing only — deciding whether a
    feed that costs somebody else bandwidth is worth polling at all.
    """
    try:
        msg = json.loads(text)
    except (ValueError, TypeError):
        return None
    if not isinstance(msg, dict) or msg.get("type") != "watching":
        return None
    area = msg.get("area")
    return area if isinstance(area, str) and area in WATCHABLE else None


def _presence_pose(msg: dict) -> dict | None:
    """Copy only finite, bounded pose fields; never forward arbitrary metadata."""
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
def ip_color(ip: str) -> str:
    """A colour for one address. The address never leaves the server; this does.

    Same address, same colour, every visit — which is the point of asking for it
    and is also the one thing the random per-socket id was written to prevent.
    Hue only: saturation and lightness are fixed so every avatar reads against
    grey water and dark trees, and two addresses cannot collide into black."""
    digest = hashlib.sha256(ip.encode("utf-8")).digest()
    hue = int.from_bytes(digest[:2], "big") / 65535
    r, g, b = colorsys.hls_to_rgb(hue, 0.62, 0.72)
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


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
                 world.weather, STALE_SECONDS["weather"])
        if world.weather else None
    )
    tide = (
        envelope("tide.state", "tidesandcurrents.noaa.gov", world.tide_time,
                 world.tide, STALE_SECONDS["tide"])
        if world.tide else None
    )
    current = (
        envelope("current.state", "tidesandcurrents.noaa.gov", world.current_time,
                 world.current, STALE_SECONDS["currents"])
        if world.current else None
    )
    # Monthly, and a month or two behind, so it carries the month it belongs to
    # rather than an age in seconds. Nothing on the page draws it yet.
    crossings = (
        envelope("crossings.state", "bts.gov (US CBP)", world.crossings_time,
                 world.crossings, None)
        if world.crossings else None
    )
    wait = (
        envelope("wait.state", "bwt.cbp.gov (US CBP)", world.wait_time,
                 world.wait, WAIT_POLL_SECONDS * 3)
        if world.wait else None
    )
    # No staleness on the log: the newest call is as old as the newest call is,
    # and on a quiet week that is days. That is the reading, not a fault.
    calls = (
        envelope("blotter.calls", "Whatcom County Sheriff activity reports",
                 world.blotter_time, world.blotter, None)
        if world.blotter else None
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
            "wait": wait,
            "calls": calls,
            "vessels": vessels,
            "aircraft": [
                envelope("aircraft.state", ADSB_SOURCE,
                         world.aircraft_seen.get(icao), state,
                         STALE_SECONDS["aircraft"])
                for icao, state in world.aircraft.items()
            ],
            "tee": (envelope("golf.tee",
                            "pointrobertsgc.com booking sheet (foreUP)",
                            world.tee_time, world.tee, TEE_TICK_SECONDS * 5)
                    if world.tee else None),
            "marina": (envelope("marina.presence",
                                "pointrobertsmarina.com webcam (HDOnTap still)",
                                world.marina_time, world.marina,
                                MARINA_PERIOD_SECONDS * 3)
                       if world.marina else None),
            "provider_health": dict(world.health),
            "vessels_note": world.vessels_note,
        },
    }


async def set_health(feed: str, status: str) -> None:
    """Write a provider's health down and, when it changes, tell the browsers.

    provider_health rides in the snapshot and nowhere else, so a provider that
    stopped answering used to be recorded here, logged, and never mentioned
    again: a page already open went on reading "live" over the last good numbers
    until something unrelated happened to rebroadcast. Health that is not sent
    is not health.

    Only a change is broadcast. A provider answering normally sets the same
    value every poll and that must not put a snapshot on the wire each time.
    """
    if world.health.get(feed) == status:
        return
    world.health[feed] = status
    try:
        await clients.broadcast(snapshot())
    except Exception as exc:
        # Saying a feed is down must never be the thing that takes it down. This
        # is called from the failure path of every poll loop, inside its except
        # block, where an exception would escape the while and stop the task for
        # the life of the container.
        log.error("Could not broadcast %s health %r: %s", feed, status, exc)


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


async def tide_task() -> None:
    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            ok = False
            try:
                result = await noaa.fetch_tide(client)
                world.tide = result["state"]
                world.tide_time = result["time"]
                await set_health("tide", "live")
                await clients.broadcast(envelope(
                    "tide.state", "tidesandcurrents.noaa.gov",
                    world.tide_time, world.tide, STALE_SECONDS["tide"]))
                log.info("Tide %.3f m %s (%s), surge %+.3f m from %s",
                         world.tide["water_level_m"], noaa.TIDE_DATUM,
                         world.tide["trend"], world.tide["surge_m"],
                         noaa.TIDE_GAUGE_STATION)
                ok = True
            except Exception as exc:
                await set_health("tide", "offline")
                log.error("Tide fetch failed: %s", exc)
            await asyncio.sleep(TIDE_POLL_SECONDS if ok else RETRY_SECONDS)


# ---- NOAA tidal current feed ------------------------------------------------


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
                    series = await noaa.fetch_current_series(client, now)
                    log.info("Current predictions %s bin %d: %d rows, %s to %s",
                             noaa.CURRENT_STATION, noaa.CURRENT_BIN, len(series),
                             series[0][0].strftime("%Y-%m-%d %H:%M"),
                             series[-1][0].strftime("%Y-%m-%d %H:%M"))
                world.current = noaa.current_at(series, now)
                # The whole prediction, so a page standing at another hour can
                # read the stream there. Every slot is worked out with the same
                # rule as the live one, rather than the rule being written twice.
                world.current["series"] = {
                    "start": series[0][0].strftime("%Y-%m-%d %H:%M") + "Z",
                    "step_s": int((series[1][0] - series[0][0]).total_seconds()),
                    "rows": [
                        [c["drift_mps"], c["set_degrees"], c["state"]]
                        for c in (noaa.current_at(series, row[0]) for row in series)
                    ],
                }
                world.current_time = now
                await set_health("currents", "live")
                await clients.broadcast(envelope(
                    "current.state", "tidesandcurrents.noaa.gov",
                    world.current_time, world.current, STALE_SECONDS["currents"]))
                log.info("Current %.2f kn %s (%s)", world.current["drift_kn"],
                         world.current["state"],
                         "slack" if world.current["set_degrees"] is None
                         else f"{world.current['set_degrees']:.0f}°")
                ok = True
            except Exception as exc:
                await set_health("currents", "offline")
                log.error("Current fetch failed: %s", exc)
            await asyncio.sleep(CURRENT_POLL_SECONDS if ok else RETRY_SECONDS)


# ---- Open-Meteo weather + marine feed ---------------------------------------



async def wait_task() -> None:
    async with httpx.AsyncClient(timeout=60) as client:
        while True:
            ok = False
            try:
                result = await wait_feed.fetch_wait(client)
                world.wait = result["state"]
                world.wait_time = result["time"]
                # Nobody keeps this but us.
                archive.keep("wait", world.wait, world.wait_time)
                await set_health("wait", "live")
                await clients.broadcast(envelope(
                    "wait.state", "bwt.cbp.gov (US CBP)",
                    world.wait_time, world.wait, WAIT_POLL_SECONDS * 3))
                cars = world.wait["lanes"]["cars"]["reported"].get("standard")
                log.info("Border wait: %s, cars %s", world.wait["port_status"],
                         f"{cars['delay_minutes']} min on {cars['lanes_open']} lane(s)"
                         if cars else "nothing posted")
                ok = True
            except Exception as exc:
                await set_health("wait", "offline")
                log.error("Border wait fetch failed: %s", exc)
            await asyncio.sleep(WAIT_POLL_SECONDS if ok else RETRY_SECONDS)


async def blotter_task() -> None:
    store = blotter.Blotter(BLOTTER_PATH)
    store.load()
    async with httpx.AsyncClient(timeout=120) as client:
        while True:
            ok = False
            try:
                added = await store.refresh(client)
                world.blotter = store.as_data()
                world.blotter_time = blotter.latest_time(store)
                await set_health("blotter", "live")
                await clients.broadcast(envelope(
                    "blotter.calls", "Whatcom County Sheriff activity reports",
                    world.blotter_time, world.blotter, None))
                log.info("Blotter: %d calls over %d days, %d new",
                         len(world.blotter["calls"]), world.blotter["days"], added)
                ok = True
            except Exception as exc:
                await set_health("blotter", "offline")
                log.error("Sheriff activity report fetch failed: %s", exc)
            await asyncio.sleep(BLOTTER_POLL_SECONDS if ok else RETRY_SECONDS)


async def crossings_task() -> None:
    async with httpx.AsyncClient(timeout=60) as client:
        while True:
            ok = False
            try:
                result = await crossings_feed.fetch_crossings(client)
                world.crossings = result["state"]
                world.crossings_time = result["time"]
                # A month at a time, and one line a month: the dedupe drops the
                # other twenty-seven reads between one month's figures and the
                # next.
                archive.keep("crossings", world.crossings, world.crossings_time)
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
                result = await weather_feed.fetch_weather(client, POINT)
                world.weather = result["state"]
                world.weather_time = result["time"]
                await set_health("weather", "live")
                await clients.broadcast(envelope(
                    "weather.state", "open-meteo.com",
                    world.weather_time, world.weather, STALE_SECONDS["weather"]))
                log.info("Weather %s, wind %s m/s from %s, waves %s m",
                         world.weather["description"],
                         world.weather["wind_speed_mps"],
                         world.weather["wind_direction_degrees"],
                         world.weather["wave_height_m"])
                ok = True
            except Exception as exc:
                await set_health("weather", "offline")
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


# ---- ships and aircraft that have gone ---------------------------------------


def reap(store: dict, seen: dict, cutoff: float, now: datetime | None = None) -> list[str]:
    """Take off everything whose last fix is older than the cutoff, and
    everything that has no fix at all. Returns the keys removed.

    No fix at all is not a corner case. AIS message 5 is a ship's account of
    itself and carries no position, so a ship that names itself from outside the
    box puts a record in with nothing to draw. Those were never reaped by an age
    they did not have."""
    now = now or utcnow()
    gone = [key for key in store
            if key not in seen or (now - seen[key]).total_seconds() > cutoff]
    for key in gone:
        del store[key]
        seen.pop(key, None)
    return gone


# ---- the marina camera ------------------------------------------------------

# One still a minute while somebody is looking, and nothing at all when nobody
# is. The marina's provider serves the picture; a browser open on the other side
# of the world should not be spending their bandwidth on an empty room.
MARINA_PERIOD_SECONDS = 60.0
MARINA_IDLE_CHECK_SECONDS = 5.0
# A browser repeats its interest every thirty seconds, so this is two missed
# repeats before the feed goes quiet again.
MARINA_INTEREST_SECONDS = 75.0


async def marina_task() -> None:
    from server import marina as marina_reader

    detector = None
    last_run: float | None = None
    async with httpx.AsyncClient(timeout=45) as client:
        while True:
            if not clients.anyone_watching("marina", MARINA_INTEREST_SECONDS):
                # Idle is not offline. Nothing is wrong; nobody is looking.
                if world.health["marina"] != "idle":
                    world.health["marina"] = "idle"
                    world.marina = None
                    await clients.broadcast(envelope(
                        "marina.presence", marina_reader.SOURCE, None,
                        {"watching": False}, None))
                await asyncio.sleep(MARINA_IDLE_CHECK_SECONDS)
                continue
            now = asyncio.get_running_loop().time()
            if last_run is not None and now - last_run < MARINA_PERIOD_SECONDS:
                await asyncio.sleep(MARINA_IDLE_CHECK_SECONDS)
                continue
            last_run = now
            try:
                if detector is None:
                    detector = marina_reader.Detector()
                reading = await marina_reader.sample(client, detector)
            except Exception as exc:
                # Zero cars and a broken camera look identical on a screen, so
                # this says which one it is and stops reporting counts.
                world.health["marina"] = "offline"
                world.marina = None
                log.error("Marina camera read failed: %s", exc)
                await clients.broadcast(envelope(
                    "marina.presence", marina_reader.SOURCE, None,
                    {"watching": True, "error": str(exc)[:200]}, None))
                await asyncio.sleep(RETRY_SECONDS)
                continue
            world.marina = dict(reading.as_data(), watching=True)
            world.marina_time = utcnow()
            # Counted here off the camera and recorded nowhere else.
            archive.keep("marina", world.marina, world.marina_time)
            world.health["marina"] = "live"
            log.info("Marina camera: %d vehicles, %d people, %d boats, %d in the lot",
                     reading.vehicles, reading.people, reading.boats, reading.in_lot)
            await clients.broadcast(envelope(
                "marina.presence", marina_reader.SOURCE, world.marina_time,
                world.marina, MARINA_PERIOD_SECONDS * 3))


# ---- who is out on the golf course ------------------------------------------

# The booking sheet's times carry no zone and mean the course's own clock, so
# this is what they are compared against wherever the server happens to be.
# The first read of the day is at six, before the course opens at half past, so
# the whole day's grid is on the sheet and nothing has slipped into the past yet.
# After that, once an hour. This one is not gated on anybody looking: the sheet
# stops listing a time the moment it is past, so a read missed is a booking that
# can never be recovered.
TEE_FIRST_HOUR = 6
TEE_TICK_SECONDS = 60.0
# Beside the visitor record, in the volume a rebuild keeps. A deploy is a
# restart, and a restart without this forgets every booking read so far today.
TEE_PATH = REPO_ROOT / "data" / "tee-sheet.json"


async def tee_task() -> None:
    from server import tee as tee_reader

    # The clock hour the sheet was last read in, and the day it was read for.
    read_hour: tuple[str, int] | None = None
    started = local_now()
    try:
        world.tee_sheet = tee_reader.load(TEE_PATH, started.strftime("%m-%d-%Y"))
    except RuntimeError as exc:
        log.error("%s", exc)
    if world.tee_sheet is not None:
        log.info("Tee sheet carried over from before the restart: %d booked slots, "
                 "known from %s", world.tee_sheet.as_data(started)["booked_slots"],
                 world.tee_sheet.as_data(started)["known_from"])
        world.health["golf"] = "live"
    async with httpx.AsyncClient(timeout=45) as client:
        while True:
            now = local_now()
            day = now.strftime("%m-%d-%Y")
            due = (now.hour >= TEE_FIRST_HOUR
                   and (read_hour is None or read_hour != (day, now.hour)))
            if due:
                try:
                    world.tee_sheet = await tee_reader.sample(
                        client, world.tee_sheet, now)
                    read_hour = (day, now.hour)
                    world.health["golf"] = "live"
                    try:
                        world.tee_sheet.save(TEE_PATH)
                    except OSError as exc:
                        log.error("Tee sheet could not be written to %s: %r",
                                  TEE_PATH, exc)
                    # The club's page shows today. Kept after every read, so
                    # the day builds up as it is played rather than being lost
                    # if the container goes down before closing time.
                    archive.keep("tee", world.tee_sheet.to_json(), utcnow())
                except Exception as exc:
                    world.health["golf"] = "offline"
                    world.tee = None
                    log.error("Tee sheet read failed: %s", exc)
                    await clients.broadcast(envelope(
                        "golf.tee", tee_reader.SOURCE, None,
                        {"error": str(exc)[:200]}, None))
                    await asyncio.sleep(RETRY_SECONDS)
                    continue
                log.info("Tee sheet read for %s at %s: %d booked slots, known from %s",
                         day, now.strftime("%H:%M"),
                         world.tee_sheet.as_data(now)["booked_slots"],
                         world.tee_sheet.as_data(now)["known_from"])
            if world.tee_sheet is not None:
                # Between reads the clock still moves the groups along, so the
                # page is told where they are now rather than where they were.
                world.tee = world.tee_sheet.as_data(now)
                world.tee_time = utcnow()
                await clients.broadcast(envelope(
                    "golf.tee", tee_reader.SOURCE, world.tee_time, world.tee,
                    TEE_TICK_SECONDS * 5))
            await asyncio.sleep(TEE_TICK_SECONDS)


async def reaper_task() -> None:
    """Runs whether or not anybody is watching, so the first visitor after a
    quiet night is handed the water as it is and not as it was.

    The aircraft used to take themselves off inside their own poll, which had
    two holes. It told nobody: the page only ever adds an aircraft and drops it
    when a snapshot arrives without it, so a plane the server had forgotten went
    on being drawn. And it sat inside the try, so a feed that stopped answering
    froze whatever was in the air and left it there."""
    while True:
        await asyncio.sleep(REAP_PERIOD_SECONDS)
        ships = reap(world.vessels, world.vessel_seen, DROP_SECONDS["vessels"])
        planes = reap(world.aircraft, world.aircraft_seen, DROP_SECONDS["aircraft"])
        if ships or planes:
            log.info("Reaped %d vessels and %d aircraft that had gone quiet; "
                     "%d vessels and %d aircraft left", len(ships), len(planes),
                     len(world.vessels), len(world.aircraft))
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
                             (wait_task(), "wait", "wait"),
                             (blotter_task(), "blotter", "blotter"),
                             (ferries_task(), "ferries", None),
                             (heartbeat_task(), "heartbeat", None),
                             (presence_task(), "presence", None),
                             (reaper_task(), "reaper", None),
                             (visitors_task(), "visitors", None),
                             (marina_task(), "marina", "marina"),
                             (tee_task(), "tee", "golf")):
        _tasks.append(_spawn(coro, name, feed))


@app.on_event("shutdown")
async def shutdown() -> None:
    for task in _tasks:
        task.cancel()
    await clients.shutdown()
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
    try:
        await clients.add(ws)
        while True:
            text = await ws.receive_text()
            area = read_watching(text)
            if area:
                clients.watching(ws, area)
                continue
            at = read_position(text)
            # Anything that is not a position is dropped and the socket stays
            # open. A browser sending nonsense is a browser with a bug, not a
            # reason to close on it.
            if at:
                clients.place(ws, at)
    except WebSocketDisconnect:
        pass
    except Exception:
        # A browser going away is WebSocketDisconnect above. Anything else here
        # is a fault in reading what it sent, and it used to disappear: the
        # socket closed and nothing was written down. Log it and let it go, so
        # one bad socket does not take the endpoint down but never goes unseen.
        log.exception("Socket handler failed; closing that client")
    finally:
        await clients.disconnect(ws)


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
