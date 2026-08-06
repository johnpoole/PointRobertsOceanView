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
and only every ten minutes. Their own map polls the same endpoint every ten
seconds, so one ordinary visitor to their site is worth about sixty of these.

The payload is base64 over JSON and decodes as fixed 43-byte records. Only four
fields are certain and only those are read. Course is not among them, so it is
worked out from where a vessel was last time rather than guessed at from a byte
that looked about right.
"""

from __future__ import annotations

import base64
import logging
import math
import struct

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


def bearing(from_lat: float, from_lon: float, to_lat: float, to_lon: float) -> float | None:
    """Degrees true. None when the two fixes are close enough that the bearing
    between them is noise rather than a course."""
    mean_lat = math.radians((from_lat + to_lat) / 2)
    north = (to_lat - from_lat) * 111320.0
    east = (to_lon - from_lon) * 111320.0 * math.cos(mean_lat)
    if math.hypot(north, east) < 30.0:
        return None
    return math.degrees(math.atan2(east, north)) % 360.0


async def fetch(box: dict) -> list[dict]:
    """One pass. Opens a browser, reads the largest payload their map asks for,
    and returns the vessels inside the box."""
    from playwright.async_api import async_playwright

    payloads: list[str] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            context = await browser.new_context(
                user_agent=USER_AGENT, viewport={"width": 1280, "height": 900})
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
            await page.evaluate(
                "([lat, lon, z]) => { if (window.map) window.map.setView([lat, lon], z); }",
                [VIEW_LAT, VIEW_LON, VIEW_ZOOM])
            await page.wait_for_timeout(COLLECT_MS)
        finally:
            await browser.close()

    if not payloads:
        raise RuntimeError(
            "shipfinder returned no vessel payload. Their map made no "
            "getareasimple call that carried data, so either the page did not "
            "load or the endpoint has changed."
        )

    # Their polls send a small empty delta between full answers; the biggest one
    # is the full picture.
    vessels = decode(base64.b64decode(max(payloads, key=len)))
    inside = [v for v in vessels if in_box(v, box)]
    log.info("shipfinder: %d vessels, %d inside the box", len(vessels), len(inside))
    return inside
