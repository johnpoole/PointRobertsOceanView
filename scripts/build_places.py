"""Every named thing on the peninsula, with a camera position that looks at it.

    python scripts/build_places.py

Writes assets/places.json.

The page is driven by its URL. Where the camera stands and what it points at are
in the hash, so any view can be written down and handed to somebody. What was
missing is the names: you cannot ask for the marina, you can only ask for
48.977313, -123.063279, and nobody knows that number.

So this walks what is already baked and gives each named thing a viewpoint:

  - the landmarks, named buildings, runway and old wharf out of the OSM bake
  - the footprints of the buildings that were surveyed by hand, which are
    literal coordinate arrays in the plan modules under src/scene
  - a few places that are not buildings at all and had to be written down here

Nothing is typed twice. A building that moves in the bake moves here with it.

The camera stands south of each thing at the distance that fits it in the
frame, at the lens the page actually uses, and looks north at it. South because
the sun is south: standing there puts the light on the face of the thing rather
than behind it.
"""

from __future__ import annotations

import json
import math
import re
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OSM = ROOT / "assets" / "osm" / "features.json"
TERRAIN = ROOT / "assets" / "terrain"
SCENE = ROOT / "src" / "scene"
OUT = ROOT / "assets" / "places.json"

# The page's own lens, out of src/config.js. The framing has to be worked out
# for the lens that will actually be looking through it.
FOV_DEG = 25.0
# How much room round the subject, and how high to stand as a fraction of the
# distance back. 0.62 is what the brademy view uses and it looks down on a thing
# without looking down on it.
MARGIN = 1.25
HIGH = 0.62
# Nothing is framed closer than this, or a single small house puts the camera
# inside the hedge. And nothing further than this: past about four hundred
# metres the view stops being a place and becomes a map, and the page has a map.
# A thing wider than the frame will simply run off the sides of it.
MIN_BACK_M = 60.0
MAX_BACK_M = 420.0
# Two places within this of each other are the same place. The bake names the
# Reef both as a building and as a landmark, and the Pier Restaurant is inside
# the marina building. The first one added wins and the rest become its other
# names.
SAME_PLACE_M = 70.0

M_PER_DEG_LAT = 111320.0

# The buildings that were surveyed by hand. The module, the name it exports, the
# key its outline sits under, and what to call it. Those outlines are literal
# arrays and are read out of the file rather than copied here, so a building
# that moves in the survey moves here with it.
SURVEYED = [
    ("border-plan.js", "BORDER", "footprint", "border-station", "Boundary Bay border station",
     "the US port of entry, the only way on or off the peninsula by road"),
    ("clubhouse-plan.js", "CLUBHOUSE", "footprint", "clubhouse", "Point Roberts golf clubhouse",
     "the clubhouse at 1350 Pelican Place"),
    ("community-plan.js", "COMMUNITY", "center", "community-centre", "Point Roberts Community Center",
     "the community centre and its annex"),
    ("fire-station-plan.js", "FIRE_STATION", "footprint", "fire-station", "Whatcom County Fire District 5",
     "the fire station, four bays facing south"),
    ("marina-building-plan.js", "MARINA_BUILDING", "footprint", "marina-building", "The marina building",
     "the long building on the marina basin"),
    ("marketplace-plan.js", "MARKET", "footprint", "marketplace", "Point Roberts International Marketplace",
     "the grocery, the one supermarket on the point"),
    ("post-office-plan.js", "POST_OFFICE", "footprint", "post-office", "Point Roberts post office",
     "the post office, and the parcel trade that comes with the border"),
    ("reef-plan.js", "REEF", "footprint", "reef", "The Reef",
     "the tavern above the beach on Gulf Road"),
    ("saltwater-plan.js", "SALTWATER", "footprint", "saltwater", "Saltwater Cafe",
     "the cafe on Gulf Road"),
]

# What is not a building and is not in the bake under any name. Each is a place
# on the ground and how wide a view of it should be. Anything the bake does name
# is taken from there, because those coordinates were surveyed and these were
# not.
WRITTEN_DOWN = [
    ("the-bluff", "The bluff at 389 West Bluff Road", 48.989009, -123.085318, 120,
     "the cabin the whole model is measured from, above the beach on the west side"),
    ("the-crossing", "The border on the ground", 49.000000, -123.065000, 800,
     "the 49th parallel, cut through the trees the whole width of the peninsula"),
    ("gulf-road", "Gulf Road", 48.984400, -123.084500, 350,
     "the road down to the water, the tavern and the cafe on it"),
    ("the-flats", "The flats off the west bluff", 48.986000, -123.092000, 900,
     "the tide flat below the bluff, where the water goes out"),
]


# ---- the ground -------------------------------------------------------------

def load_terrain():
    meta = json.loads((TERRAIN / "meta.json").read_text(encoding="utf-8"))
    grid = meta["grid"]
    raw = (TERRAIN / "heightmap.bin").read_bytes()
    want = grid["nrows"] * grid["ncols"] * 2
    if len(raw) != want:
        raise SystemExit(
            f"heightmap.bin is {len(raw)} bytes and meta.json describes "
            f"{grid['nrows']}x{grid['ncols']} int16, which is {want}. "
            f"Rebuild it with scripts/build_terrain.py.")
    cells = struct.unpack(f"<{grid['nrows'] * grid['ncols']}h", raw)
    return meta, cells


def height_at(meta, cells, lat, lon):
    """Metres above MLLW. Outside the tile, the nearest edge, which is what the
    browser's sampler does."""
    g = meta["grid"]
    row = int(round((g["north_lat"] - lat) / g["cellsize_deg"]))
    col = int(round((lon - g["west_lon"]) / g["cellsize_deg"]))
    row = min(max(row, 0), g["nrows"] - 1)
    col = min(max(col, 0), g["ncols"] - 1)
    return cells[row * g["ncols"] + col] * g["scale_m"]


# ---- reading the surveyed footprints ----------------------------------------

PAIR = re.compile(r"\[\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\]")


def footprint_of(module: str, export: str, key: str) -> list[tuple[float, float]]:
    text = (SCENE / module).read_text(encoding="utf-8")
    at = text.find(f"{export}")
    if at < 0:
        raise SystemExit(f"{module} does not export {export}. Has it been renamed?")
    mark = text.find(key, at)
    if mark < 0:
        raise SystemExit(
            f"{module} has no {key} after {export}, so there is nothing to take a "
            f"centre from. The places file is built off those arrays.")
    # From the opening bracket of the footprint to its matching close.
    start = text.index("[", mark)
    depth, end = 0, start
    for i in range(start, len(text)):
        if text[i] == "[":
            depth += 1
        elif text[i] == "]":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    pairs = [(float(a), float(b)) for a, b in PAIR.findall(text[start:end])]
    if len(pairs) < 3:
        raise SystemExit(
            f"{module}: read {len(pairs)} corners out of {export}'s footprint and "
            f"a building needs at least three.")
    return pairs


def read_opening_view() -> dict:
    """OPENING_VIEW out of src/config.js, so the page and this file cannot
    disagree about where the page opens."""
    text = (ROOT / "src" / "config.js").read_text(encoding="utf-8")
    at = text.find("export const OPENING_VIEW")
    if at < 0:
        raise SystemExit(
            "src/config.js has no OPENING_VIEW. The places file quotes it rather "
            "than keeping a second copy of where the page opens.")
    block = text[at:text.index("};", at)]
    got = {}
    for part in ("eye", "aim"):
        m = re.search(part + r":\s*\{\s*lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+),"
                             r"\s*y:\s*(-?[\d.]+)", block)
        if not m:
            raise SystemExit(f"OPENING_VIEW in src/config.js has no {part}.")
        got[part] = {"lat": float(m.group(1)), "lon": float(m.group(2)),
                     "y": float(m.group(3))}
    got["fov"] = FOV_DEG
    return got


# ---- geometry ---------------------------------------------------------------

def centre_and_span(points: list[tuple[float, float]]):
    """The middle of a ring of lat/lon, and how far across it is in metres."""
    lat = sum(p[0] for p in points) / len(points)
    lon = sum(p[1] for p in points) / len(points)
    cos = math.cos(math.radians(lat))
    span = 0.0
    for a in points:
        for b in points:
            north = (b[0] - a[0]) * M_PER_DEG_LAT
            east = (b[1] - a[1]) * M_PER_DEG_LAT * cos
            span = max(span, math.hypot(north, east))
    return lat, lon, span


def view_for(meta, cells, lat, lon, span):
    """Where to stand to see a thing this wide, and what to point at.

    South of it and above it, at the distance its size needs through the page's
    own lens. The height comes off the terrain at both ends, so the camera is
    above the ground it is standing over and the aim is on the ground it is
    looking at rather than at sea level.
    """
    ground = height_at(meta, cells, lat, lon)
    back = (span / 2) / math.tan(math.radians(FOV_DEG / 2)) * MARGIN
    back = min(max(back, MIN_BACK_M), MAX_BACK_M)
    eye_lat = lat - back / M_PER_DEG_LAT
    eye_ground = height_at(meta, cells, eye_lat, lon)
    return {
        "eye": {"lat": round(eye_lat, 6), "lon": round(lon, 6),
                "y": round(max(eye_ground, ground) + back * HIGH, 1)},
        "aim": {"lat": round(lat, 6), "lon": round(lon, 6),
                "y": round(ground + 2.0, 1)},
        "fov": FOV_DEG,
    }


def hash_for(view: dict, extras: dict | None = None) -> str:
    parts = [
        f"eye={view['eye']['lat']:.6f},{view['eye']['lon']:.6f},{view['eye']['y']:.1f}",
        f"aim={view['aim']['lat']:.6f},{view['aim']['lon']:.6f},{view['aim']['y']:.1f}",
        f"fov={view['fov']:.3f}",
    ]
    for k, v in (extras or {}).items():
        parts.append(f"{k}={v}")
    return "#" + "&".join(parts)


# ---- building the list ------------------------------------------------------

def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def main() -> int:
    meta, cells = load_terrain()
    osm = json.loads(OSM.read_text(encoding="utf-8"))
    places: list[dict] = []
    seen: set[str] = set()

    def add(pid, name, what, lat, lon, span, note, extras=None):
        if pid in seen:
            return
        # The same ground under another name. The Reef is in the bake twice and
        # the Pier Restaurant is inside the marina building, so the one already
        # there keeps the entry and this becomes another name for it.
        for other in places:
            if other.get("starting_position"):
                continue
            cos = math.cos(math.radians(lat))
            gap = math.hypot((other["lat"] - lat) * M_PER_DEG_LAT,
                             (other["lon"] - lon) * M_PER_DEG_LAT * cos)
            if gap < SAME_PLACE_M:
                if name != other["name"] and name not in other["also_called"]:
                    other["also_called"].append(name)
                return
        seen.add(pid)
        view = view_for(meta, cells, lat, lon, span)
        places.append({
            "id": pid, "name": name, "what": what, "note": note,
            "lat": round(lat, 6), "lon": round(lon, 6),
            "ground_m_mllw": round(height_at(meta, cells, lat, lon), 1),
            "across_m": round(span, 1),
            "view": view,
            "hash": hash_for(view, extras),
            "also_called": [],
        })

    # Where the page opens, exactly as config.js has it, rather than a frame
    # worked out here. It is a driver's eye on Tyee waiting to be waved through
    # and no arithmetic would find that.
    opening = read_opening_view()
    places.append({
        "id": "the-view", "name": "Where the page opens", "what": "place",
        "note": "on Tyee Drive north of the US canopy, at a driver's eye height, "
                "looking south at the booths",
        "lat": round(opening["aim"]["lat"], 6), "lon": round(opening["aim"]["lon"], 6),
        "ground_m_mllw": round(height_at(meta, cells, opening["aim"]["lat"],
                                         opening["aim"]["lon"]), 1),
        "across_m": None,
        "view": opening,
        "hash": hash_for(opening),
        "also_called": [],
        # Not a place but a starting position. It stands on the border station's
        # ground on purpose, so it is kept out of the same-place check both ways
        # or one of the two would swallow the other.
        "starting_position": True,
    })
    seen.add("the-view")

    for pid, name, lat, lon, span, note in WRITTEN_DOWN:
        add(pid, name, "place", lat, lon, span, note)

    for module, export, key, pid, name, note in SURVEYED:
        lat, lon, span = centre_and_span(footprint_of(module, export, key))
        add(pid, name, "building", lat, lon, span, note)

    for mark in osm.get("landmarks", []):
        if not mark.get("name"):
            continue
        add(slug(mark["name"]), mark["name"], mark.get("kind") or "landmark",
            mark["lat"], mark["lon"], 200.0,
            f"{mark.get('kind') or 'landmark'}, off the OpenStreetMap bake")

    for b in osm.get("buildings", []):
        if not b.get("name") or not b.get("coords"):
            continue
        lat, lon, span = centre_and_span(b["coords"])
        add(slug(b["name"]), b["name"], "building", lat, lon, span,
            "a named building in the OpenStreetMap bake")

    for way in osm.get("runways", []):
        if not way.get("name") or not way.get("coords"):
            continue
        lat, lon, span = centre_and_span(way["coords"])
        add(slug(way["name"]), way["name"], "runway", lat, lon, span,
            f"grass strip {way.get('ref') or ''}".strip())

    for pier in osm.get("ruined_piers", []):
        if not pier.get("name") or not pier.get("posts"):
            continue
        lat, lon, span = centre_and_span(pier["posts"])
        add(slug(pier["name"]), pier["name"], "ruin", lat, lon, span,
            "the pilings of the old cannery wharf, standing on the flat")

    places.sort(key=lambda p: p["id"])
    OUT.write_text(json.dumps({
        "origin": meta["origin"],
        "fov_degrees": FOV_DEG,
        "datum": "heights are metres above MLLW, the same datum as the tide",
        "places": places,
    }, indent=1), encoding="utf-8")
    print(f"{len(places)} places -> {OUT.relative_to(ROOT)}")
    for p in places:
        across = "—" if p["across_m"] is None else f"{p['across_m']:.1f} m"
        also = f"  (also {', '.join(p['also_called'])})" if p["also_called"] else ""
        print(f"  {p['id']:<28} {across:>9} across, "
              f"eye {p['view']['eye']['y']:>6.1f} m{also}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
