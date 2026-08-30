"""Vessels read off shipfinder.com's own map.

Not an AIS feed. AISStream went silent and stayed silent, so this stands in and
says so: everything it produces is marked scraped, and the HUD reports it that
way rather than as data of ours.

The request their map makes is a plain GET with a bounding box, but nothing
outside a browser gets past it. Replaying the whole sequence from a plain HTTP
client — homepage, getauth, Home/Login, getships — returns Unauthorized every
time, including on calls that succeed from their own page with the same two
cookies. Their JavaScript authorises it somehow and that was not worked out. So
the browser runs, their code does whatever it does, and the answer is read off
the wire.

That costs a page load, which is why this only runs while somebody is watching
and only every five minutes. Their own map polls the same endpoint every ten
seconds, so one ordinary visitor to their site is worth about thirty of these.

The payload is base64 over JSON and decodes as fixed 43-byte records. Only four
fields are certain and only those are read. Course is not among them, so it is
worked out from where a vessel was last time rather than guessed at from a byte
that looked about right.
"""

from __future__ import annotations

import base64
import json
import logging
import math
import re
import struct
from pathlib import Path

log = logging.getLogger("proxy.shipfinder")

MAP_URL = "https://www.shipfinder.com/"
USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")

# Their map polls whatever area it is showing, so it gets pointed at the strait
# and the answer is filtered to the box we care about.
VIEW_LAT, VIEW_LON, VIEW_ZOOM = 48.99, -123.09, 11

PAGE_TIMEOUT_MS = 90_000
SETTLE_MS = 8_000        # before the map exists to be moved
COLLECT_MS = 20_000      # after moving it, for the poll to come back

# Record layout, confirmed against a captured payload: 576 records, 43 bytes
# each, no remainder. The first record starts at 23; what comes before it is a
# header that has not been worked out and is not needed.
HEADER_BYTES = 23
RECORD_BYTES = 43
ID_LENGTH = b"\x10\x00"     # uint16 16, the length of the ship id that follows


def decode(blob: bytes) -> list[dict]:
    """Vessels out of one payload. Raises if the stride does not hold, because a
    format that has quietly changed should stop rather than produce nonsense."""
    if len(blob) <= HEADER_BYTES:
        return []
    body = len(blob) - HEADER_BYTES
    count, remainder = divmod(body, RECORD_BYTES)
    if remainder:
        raise ValueError(
            f"shipfinder payload is {len(blob)} bytes: {body} after the "
            f"{HEADER_BYTES}-byte header does not divide by the {RECORD_BYTES}-byte "
            f"record, {remainder} left over. The format has changed."
        )
    out = []
    for k in range(count):
        at = HEADER_BYTES + k * RECORD_BYTES
        if blob[at:at + 2] != ID_LENGTH:
            raise ValueError(
                f"shipfinder record {k} of {count} does not start with the id "
                f"length marker at byte {at}. The format has changed."
            )
        ship_id = blob[at + 2:at + 18].decode("ascii", "replace")
        lon, lat = struct.unpack_from("<ii", blob, at + 19)
        out.append({
            "id": ship_id,
            "kind": blob[at + 18],
            "longitude": lon / 1e6,
            "latitude": lat / 1e6,
        })
    return out


def in_box(vessel: dict, box: dict) -> bool:
    return (box["min_lat"] <= vessel["latitude"] <= box["max_lat"]
            and box["min_lon"] <= vessel["longitude"] <= box["max_lon"])


# ---- the detail panel -------------------------------------------------------

# Their map answers a click with a panel of everything the payload leaves out.
# It is read off the page rather than asked for: every endpoint that serves the
# same thing refuses anything not issued by their own code, a nonsense MMSI and
# a real one alike.
#
# The labels use a full-width colon, and the panel is laid out two columns to a
# row, so a value runs to the next label rather than to the end of the line.
DETAIL_FIELDS = {
    "MMSI": "mmsi",
    "Call Sign": "call_sign",
    "IMO": "imo",
    "Type": "vessel_type_name",
    "Length": "length_m",
    "Width": "width_m",
    "Course": "course",
    "Speed": "speed",
    "Lat": "lat_text",
    "Lon": "lon_text",
}
BLANK = {"", "-", "UNKNOWN", "Unknown"}
# The page's own tabs, which sit where a nameless ship's name would be.
PAGE_LABELS = {"Map", "Chart", "Weather", "Voyage", "Ship Info", "Ship Track",
               "Port Call", "Alert", "Forecast", "Coastal AIS"}

# A click that lands on nothing leaves the previous ship's panel up, and a click
# in a crowded anchorage lands on whichever hull is on top. So the panel is only
# believed when the ship it reports is nearer to the ship that was aimed at than
# to any other, and within this far of it. A plain radius does not do: at 400 m
# two moored boats both took the same panel, and at 60 m the ship's own drift
# between the payload and the click threw away more than half of the good ones.
DETAIL_MATCH_M = 300.0

# Their type names, as the equivalent AIS code, so the renderer classifies these
# the same way it classifies a real AIS vessel. The type byte in the payload is
# no use for this: it is the AIS message type, 1, 2 or 18, and a tug, a yacht
# and a sailing boat all arrive as 1.
TYPE_CODES = {
    "passenger ship": 60, "passenger": 60, "ferry": 60,
    "cargo": 70, "cargo ship": 70, "general cargo": 70, "container ship": 70,
    "container": 70, "bulk carrier": 70, "vehicles carrier": 70,
    "reefer": 70, "ro-ro": 70,
    "tanker": 80, "oil tanker": 80, "chemical tanker": 80, "lng tanker": 80,
    "fishing": 30, "fishing vessel": 30,
    "tug": 52, "towing": 52, "pilot": 50, "pilot vessel": 50,
    "search and rescue": 51, "search and rescue vessel": 51,
    "port tender": 53, "dredger": 33,
    "law enforcement": 55, "military": 35,
    "sailing": 36, "sailing vessel": 36,
    "pleasure craft": 37, "yacht": 37,
}


def type_code(name: str | None) -> int | None:
    """The AIS type code their type name stands for, or None when it is one we
    have not seen. None leaves the vessel unclassified rather than guessed at."""
    if not name:
        return None
    return TYPE_CODES.get(name.strip().lower())


def dm_to_degrees(text: str) -> float | None:
    """"48-51.482N" is 48 degrees and 51.482 minutes north."""
    m = re.match(r"\s*(\d+)\s*[-º°]\s*([\d.]+)\s*([NSEW])\s*", text or "")
    if not m:
        return None
    deg = int(m.group(1)) + float(m.group(2)) / 60.0
    return -deg if m.group(3) in ("S", "W") else deg


def parse_detail(text: str) -> dict:
    """The fields out of the clicked ship's panel.

    The panel is two columns of label and value separated by tabs, so it is
    read as tokens rather than by matching to the end of a line: a ship with an
    empty call sign would otherwise have the next label read as its value."""
    out: dict = {}
    if not text:
        return out

    tokens = [t.strip() for t in re.split(r"[\t\n]", text)]
    for i, token in enumerate(tokens):
        label = token.rstrip("：:").strip()
        if token == label or label not in DETAIL_FIELDS:
            continue
        value = tokens[i + 1] if i + 1 < len(tokens) else ""
        # The next token is the value only if it is not itself a label.
        if value.endswith("：") or value.endswith(":") or value in BLANK:
            continue
        out.setdefault(DETAIL_FIELDS[label], value)

    # The name carries no label. It stands on its own line above the tabs that
    # run along the top of the panel. A ship with no name has no line at all,
    # and the page's own tab labels sit immediately above where it would be, so
    # they have to be refused or every nameless ship comes out called Map.
    anchor = text.find("Coastal AIS")
    if anchor > 0:
        before = [ln.strip() for ln in text[:anchor].splitlines() if ln.strip()]
        if before and before[-1] not in BLANK and before[-1] not in PAGE_LABELS:
            out["name"] = before[-1]
    for key in ("length_m", "width_m"):
        if key in out:
            n = re.match(r"([\d.]+)", out[key])
            out[key] = float(n.group(1)) if n else None
            if out[key] is None:
                del out[key]
    for key, target in (("course", "course_over_ground_degrees"),
                        ("speed", "speed_over_ground_knots")):
        if key in out:
            n = re.match(r"([\d.]+)", out.pop(key))
            if n:
                out[target] = float(n.group(1))
    lat = dm_to_degrees(out.pop("lat_text", ""))
    lon = dm_to_degrees(out.pop("lon_text", ""))
    if lat is not None and lon is not None:
        out["panel_latitude"] = lat
        out["panel_longitude"] = lon
    return out


def bearing(from_lat: float, from_lon: float, to_lat: float, to_lon: float) -> float | None:
    """Degrees true. None when the two fixes are close enough that the bearing
    between them is noise rather than a course."""
    mean_lat = math.radians((from_lat + to_lat) / 2)
    north = (to_lat - from_lat) * 111320.0
    east = (to_lon - from_lon) * 111320.0 * math.cos(mean_lat)
    if math.hypot(north, east) < 30.0:
        return None
    return math.degrees(math.atan2(east, north)) % 360.0


# ---- what a ship is, remembered ---------------------------------------------

# A name, an MMSI and a hull's dimensions do not change, so a ship is looked up
# once and never again. The file outlives the process; the docker-compose volume
# is what makes it outlive the container.
CACHE_PATH = Path(__file__).resolve().parents[1] / "data" / "shipfinder_ships.json"

# How many unknown ships to look up per pass. Each one is a click and a read, so
# a full box fills in over a few passes rather than in one long burst.
ENRICH_PER_PASS = 60
CLICK_SETTLE_MS = 1500
# Clicks land on the icon, which is drawn around the position. If the first
# point misses, a few pixels either way usually finds it.
CLICK_OFFSETS = ((0, 0), (0, -5), (5, 0), (-5, 0), (0, 5))


def load_cache(path: Path = CACHE_PATH) -> dict:
    if not path.exists():
        return {}
    try:
        cache = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError(
            f"The shipfinder ship cache at {path} could not be read: {exc}. "
            f"Delete it to start over; it is only a lookup table."
        ) from exc
    # Nameless ships were once stored under the page tab that sits where their
    # name would be. Drop those names so the ship is asked about again.
    for ship in cache.values():
        if ship.get("name") in PAGE_LABELS:
            del ship["name"]
    return cache


def save_cache(cache: dict, path: Path = CACHE_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(cache), encoding="utf-8")
    tmp.replace(path)


DISMISS_DIALOGS = """() => {
    let n = 0;
    document.querySelectorAll('.layui-layer-close, [class*=close]').forEach(el => {
        try { el.click(); n++; } catch (e) {}
    });
    document.querySelectorAll('.layui-layer, .layui-layer-shade, [class*=modal], [class*=popup]')
        .forEach(el => { el.style.display = 'none'; n++; });
    return n;
}"""


async def fetch(box: dict, cache: dict | None = None) -> tuple[list[dict], dict]:
    """One pass. Opens a browser, reads the largest payload their map asks for,
    and looks up a few ships it has not seen before.

    Returns the vessels inside the box and the ships newly learned about."""
    from playwright.async_api import async_playwright

    cache = cache or {}
    payloads: list[str] = []
    learned: dict = {}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            context = await browser.new_context(
                user_agent=USER_AGENT, viewport={"width": 1500, "height": 1000})
            page = await context.new_page()

            async def on_response(response):
                if "getareasimple" not in response.url:
                    return
                try:
                    body = await response.json()
                except Exception:
                    return
                if body.get("data"):
                    payloads.append(body["data"])

            page.on("response", on_response)
            await page.goto(MAP_URL, wait_until="domcontentloaded",
                            timeout=PAGE_TIMEOUT_MS)
            await page.wait_for_timeout(SETTLE_MS)
            # The map cannot be moved with a dialog over it, and it stays where
            # it started, which is nowhere near here.
            await page.evaluate(DISMISS_DIALOGS)
            await page.wait_for_timeout(1000)
            await page.evaluate(
                "([lat, lon, z]) => { if (window.map) window.map.setView([lat, lon], z); }",
                [VIEW_LAT, VIEW_LON, VIEW_ZOOM])
            await page.wait_for_timeout(COLLECT_MS)

            if not payloads:
                raise RuntimeError(
                    "shipfinder returned no vessel payload. Their map made no "
                    "getareasimple call that carried data, so either the page "
                    "did not load or the endpoint has changed."
                )

            # Their polls send a small empty delta between full answers; the
            # biggest one is the full picture.
            vessels = decode(base64.b64decode(max(payloads, key=len)))
            inside = [v for v in vessels if in_box(v, box)]
            log.info("shipfinder: %d vessels, %d inside the box",
                     len(vessels), len(inside))

            unknown = [v for v in inside if v["id"] not in cache][:ENRICH_PER_PASS]
            # One boat cannot be two boats. If a panel gives an MMSI already
            # spoken for, the click landed on a neighbour and the answer is
            # thrown away rather than written against the wrong hull.
            claimed = {d["mmsi"] for d in cache.values() if d.get("mmsi")}
            clashes = 0
            for vessel in unknown:
                detail = await _read_detail(page, vessel, inside)
                if not detail:
                    continue
                mmsi = detail.get("mmsi")
                if mmsi and mmsi in claimed:
                    clashes += 1
                    continue
                if mmsi:
                    claimed.add(mmsi)
                learned[vessel["id"]] = detail
            if unknown:
                log.info("shipfinder: looked up %d of %d unknown, %d answered, "
                         "%d thrown away as another ship's panel",
                         len(unknown),
                         sum(1 for v in inside if v["id"] not in cache),
                         len(learned), clashes)
        finally:
            await browser.close()

    return inside, learned


def metres_between(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    return math.hypot((lat1 - lat2) * 111320.0,
                      (lon1 - lon2) * 111320.0 * math.cos(math.radians(lat1)))


def nearest(lat: float, lon: float, vessels: list[dict]) -> dict | None:
    """The vessel closest to a point, or None if there are none."""
    if not vessels:
        return None
    return min(vessels, key=lambda v: metres_between(lat, lon, v["latitude"], v["longitude"]))


async def _read_detail(page, vessel: dict, neighbours: list[dict] | None = None) -> dict | None:
    """Click a ship and read its panel. None when the click missed, which is
    normal: icons overlap and some are under the chrome."""
    point = await page.evaluate(
        "([lat, lon]) => { const p = window.map.latLngToContainerPoint([lat, lon]);"
        " return [p.x, p.y]; }", [vessel["latitude"], vessel["longitude"]])
    x, y = point
    if not (40 < x < 1460 and 40 < y < 940):
        return None
    for dx, dy in CLICK_OFFSETS:
        await page.mouse.click(x + dx, y + dy)
        await page.wait_for_timeout(CLICK_SETTLE_MS)
        text = await page.evaluate("() => document.body.innerText")
        detail = parse_detail(text)
        if not detail.get("mmsi"):
            continue
        # The panel keeps the last ship up if the click hit water, and in a
        # crowd it shows whichever hull is on top. So it counts only when the
        # ship it describes is the one that was aimed at.
        plat = detail.pop("panel_latitude", None)
        plon = detail.pop("panel_longitude", None)
        if plat is None or plon is None:
            continue
        if metres_between(plat, plon, vessel["latitude"], vessel["longitude"]) > DETAIL_MATCH_M:
            continue
        closest = nearest(plat, plon, neighbours or [vessel])
        if closest is not None and closest["id"] != vessel["id"]:
            continue
        return detail
    return None
