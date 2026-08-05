"""Bake Point Roberts land features from OpenStreetMap.

Pulls roads, building footprints, the coastline, and a few landmarks (lighthouse,
marina, parks) from the Overpass API for the peninsula, and writes them as one
static asset the app drapes onto the terrain. Baked once so the app never hits
Overpass at runtime.

Output:
  assets/osm/features.json

Run once:
  .venv/Scripts/python scripts/build_osm.py
"""

from __future__ import annotations

import array
import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

# south, west, north, east — the Point Roberts peninsula. The east edge has to
# clear -123.0217, the far side of the marina and Maple Beach, or the roads and
# buildings over there are never fetched.
BBOX = (48.968, -123.098, 49.006, -123.020)
# The Tsawwassen ferry terminal sits 3.9 km northwest, off the end of a causeway
# and well outside BBOX, but it is the one built thing on the water in the view
# north. Pull it on its own so the peninsula query stays small — a full bbox out
# to Tsawwassen would drag in all of Delta's roads and buildings.
FERRY_BBOX = (48.998, -123.145, 49.012, -123.120)
OVERPASS = "https://overpass-api.de/api/interpreter"

# Landmarks outside the near terrain tile cannot be draped on it — sampling
# clamps to the tile edge, which out west is 90 m of water, and the marker would
# vanish under the sea. Those carry an explicit height read from the far tile.
NEAR_BOX = {"min_lon": -123.13, "max_lon": -123.02, "min_lat": 48.97, "max_lat": 49.00}
FAR_TERRAIN = "heightmap_far.bin", "meta_far.json"

# The old wharf south of the bluff, now only pilings.
#
# The chart's own geometry is no good for drawing it. NOAA ENC US4WA1LI carries
# it as two adjoining SLCONS areas (object class 122, CATSLC pier (jetty),
# CONDTN ruined), but those are a 255 x 58 m bounding box around the structure,
# not its shape, so drawing their outline stood posts round a large rectangle
# that is not there.
#
# Measured instead off USGS NAIP aerial imagery at 0.146 m/pixel. The pilings
# read as a single row of dark dots at a constant latitude: the row sits at
# 48.98421, runs due east and west, and the darkness profile along it rises out
# of the open-water baseline at -123.08667 and falls back at -123.08460. That is
# a 151 m line carrying about 30 posts, near enough 5 m apart. The ENC box
# centre and this line's centre agree to within a few metres.
#
# Neither source gives a height. The chart says only WATLEV "always under water
# /submerged", which describes the deck and not the posts left standing, so
# PILING_TOP_M is a drawing choice.
RUINED_PIERS = [
    {
        "name": "Old wharf",
        "line": [[48.9842144, -123.086670], [48.9842144, -123.084600]],
    },
]

QUERY = """
[out:json][timeout:90];
(
  way["highway"]({s},{w},{n},{e});
  way["building"]({s},{w},{n},{e});
  way["natural"="coastline"]({s},{w},{n},{e});
  way["man_made"="lighthouse"]({s},{w},{n},{e});
  node["man_made"="lighthouse"]({s},{w},{n},{e});
  way["leisure"="marina"]({s},{w},{n},{e});
  node["leisure"="marina"]({s},{w},{n},{e});
  way["leisure"="park"]["name"]({s},{w},{n},{e});
  way["aeroway"="aerodrome"]({s},{w},{n},{e});
  way["aeroway"="runway"]({s},{w},{n},{e});
  way["amenity"="ferry_terminal"]({fs},{fw},{fn},{fe});
);
out geom;
"""


def fetch() -> dict:
    query = QUERY.format(s=BBOX[0], w=BBOX[1], n=BBOX[2], e=BBOX[3],
                         fs=FERRY_BBOX[0], fw=FERRY_BBOX[1],
                         fn=FERRY_BBOX[2], fe=FERRY_BBOX[3])
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request(OVERPASS, data=body, headers={
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "PointRobertsOceanView/0.1 (jdpoole@gmail.com)",
    })
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def far_terrain_sampler():
    """Nearest-cell height in metres MLLW from the baked far tile."""
    terrain = Path(__file__).resolve().parents[1] / "assets" / "terrain"
    bin_path, meta_path = terrain / FAR_TERRAIN[0], terrain / FAR_TERRAIN[1]
    if not bin_path.exists() or not meta_path.exists():
        raise RuntimeError(
            f"{bin_path} and {meta_path} are needed to place landmarks outside "
            f"the near terrain tile. Run scripts/build_terrain.py first."
        )
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    grid = meta["grid"]
    # The tile is stored as int16 decimetres; read whatever it says it is.
    code = {"int16": "h", "float32": "f"}.get(grid.get("dtype"))
    if code is None:
        raise RuntimeError(
            f"{meta_path}: grid dtype is {grid.get('dtype')!r}, expected int16 "
            f"or float32. Rerun scripts/build_terrain.py."
        )
    scale = grid.get("scale_m", 1.0)
    values = array.array(code)
    values.frombytes(bin_path.read_bytes())
    nrows, ncols = grid["nrows"], grid["ncols"]
    if len(values) != nrows * ncols:
        raise RuntimeError(
            f"{bin_path} holds {len(values)} {grid['dtype']} values but "
            f"{meta_path} says {nrows}x{ncols}={nrows * ncols}."
        )

    def sample(lat: float, lon: float) -> float:
        i = round((grid["north_lat"] - lat) / grid["cellsize_deg"])
        j = round((lon - grid["west_lon"]) / grid["cellsize_deg"])
        if not (0 <= i < nrows and 0 <= j < ncols):
            raise ValueError(f"({lat}, {lon}) is outside the far terrain tile")
        return values[i * ncols + j] * scale

    return sample


def outside_near_tile(lat: float, lon: float) -> bool:
    return not (NEAR_BOX["min_lat"] <= lat <= NEAR_BOX["max_lat"]
                and NEAR_BOX["min_lon"] <= lon <= NEAR_BOX["max_lon"])


def coords(el: dict) -> list[list[float]]:
    return [[p["lat"], p["lon"]] for p in el.get("geometry", [])]


def centroid(pts: list[list[float]]) -> list[float]:
    lat = sum(p[0] for p in pts) / len(pts)
    lon = sum(p[1] for p in pts) / len(pts)
    return [lat, lon]


def runway_width(tags: dict) -> float:
    """Metres. OSM tags the width on 1RL; fall back to the narrowest strip a
    light aircraft field would have rather than guess wide."""
    if "width" in tags:
        try:
            return float(str(tags["width"]).split()[0])
        except ValueError:
            pass
    return 18.0


def building_height(tags: dict) -> float:
    if "height" in tags:
        try:
            return float(str(tags["height"]).split()[0])
        except ValueError:
            pass
    if "building:levels" in tags:
        try:
            return float(tags["building:levels"]) * 3.0
        except ValueError:
            pass
    return 5.0


def main() -> None:
    result = fetch()
    elements = result.get("elements", [])

    roads, buildings, coastline, landmarks = [], [], [], []
    aerodromes, runways = [], []
    for el in elements:
        tags = el.get("tags", {})
        if el["type"] == "way" and "highway" in tags:
            pts = coords(el)
            if len(pts) >= 2:
                roads.append({"coords": pts, "kind": tags["highway"]})
        elif el["type"] == "way" and "building" in tags:
            pts = coords(el)
            if len(pts) >= 3:
                buildings.append({"coords": pts, "height": building_height(tags)})
        elif el["type"] == "way" and tags.get("natural") == "coastline":
            pts = coords(el)
            if len(pts) >= 2:
                coastline.append({"coords": pts})
        elif tags.get("man_made") == "lighthouse":
            pt = [el["lat"], el["lon"]] if el["type"] == "node" else centroid(coords(el))
            landmarks.append({"lat": pt[0], "lon": pt[1],
                              "name": tags.get("name", "Lighthouse"), "kind": "lighthouse"})
        elif tags.get("leisure") == "marina":
            pt = [el["lat"], el["lon"]] if el["type"] == "node" else centroid(coords(el))
            landmarks.append({"lat": pt[0], "lon": pt[1],
                              "name": tags.get("name", "Marina"), "kind": "marina"})
        elif tags.get("aeroway") == "aerodrome":
            pt = [el["lat"], el["lon"]] if el["type"] == "node" else centroid(coords(el))
            aerodromes.append({"lat": pt[0], "lon": pt[1],
                               "name": tags.get("name", "Airfield")})
        elif tags.get("aeroway") == "runway":
            pts = coords(el)
            if len(pts) >= 2:
                runways.append({"coords": pts, "ref": tags.get("ref"),
                                "width": runway_width(tags),
                                "surface": tags.get("surface")})
        elif tags.get("amenity") == "ferry_terminal":
            pt = [el["lat"], el["lon"]] if el["type"] == "node" else centroid(coords(el))
            landmarks.append({"lat": pt[0], "lon": pt[1],
                              "name": tags.get("name", "Ferry terminal"), "kind": "ferry"})
        elif tags.get("leisure") == "park" and tags.get("name"):
            pts = coords(el)
            if pts:
                c = centroid(pts)
                landmarks.append({"lat": c[0], "lon": c[1], "name": tags["name"], "kind": "park"})

    # OSM often has the same place twice (e.g. a marina node and a marina resort
    # way). Drop near-duplicate landmarks of the same kind, keeping the shorter
    # name.
    def metres(a: dict, b: dict) -> float:
        dlat = (a["lat"] - b["lat"]) * 111320
        dlon = (a["lon"] - b["lon"]) * 111320 * math.cos(math.radians(a["lat"]))
        return math.hypot(dlat, dlon)

    deduped: list[dict] = []
    for lm in landmarks:
        dup = next((x for x in deduped if x["kind"] == lm["kind"] and metres(x, lm) < 500), None)
        if dup:
            if len(lm["name"]) < len(dup["name"]):
                dup["name"] = lm["name"]
            continue
        deduped.append(lm)
    landmarks = deduped

    far_sample = far_terrain_sampler()
    for lm in landmarks:
        if outside_near_tile(lm["lat"], lm["lon"]):
            lm["elev"] = round(far_sample(lm["lat"], lm["lon"]), 2)

    # The runway carries the field's name so hovering it reads like a landmark.
    # OSM names the aerodrome, not the strip.
    for rw in runways:
        mid = centroid(rw["coords"])
        near = min(aerodromes, key=lambda a: metres(a, {"lat": mid[0], "lon": mid[1]}),
                   default=None)
        rw["name"] = near["name"] if near else "Runway"

    out = {"bbox": BBOX, "roads": roads, "buildings": buildings,
           "coastline": coastline, "landmarks": landmarks, "runways": runways,
           "ruined_piers": [dict(p) for p in RUINED_PIERS]}
    out_dir = Path(__file__).resolve().parents[1] / "assets" / "osm"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "features.json").write_text(json.dumps(out), encoding="utf-8")
    print(f"roads {len(roads)}  buildings {len(buildings)}  "
          f"coastline {len(coastline)}  landmarks {len(landmarks)}  "
          f"runways {len(runways)}")
    for lm in landmarks:
        print(f"  landmark: {lm['kind']:10} {lm['name']}  ({lm['lat']:.4f},{lm['lon']:.4f})")
    for rw in runways:
        print(f"  runway:   {rw['ref'] or '?':10} {rw['name']}  "
              f"{rw['width']:.0f} m wide, {rw['surface'] or 'unknown'}")


if __name__ == "__main__":
    main()
