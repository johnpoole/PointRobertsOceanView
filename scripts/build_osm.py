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

# south, west, north, east — the Point Roberts peninsula.
BBOX = (48.968, -123.098, 49.006, -123.048)
# The Tsawwassen ferry terminal sits 3.9 km northwest, off the end of a causeway
# and well outside BBOX, but it is the one built thing on the water in the view
# north. Pull it on its own so the peninsula query stays small — a full bbox out
# to Tsawwassen would drag in all of Delta's roads and buildings.
FERRY_BBOX = (48.998, -123.145, 49.012, -123.120)
OVERPASS = "https://overpass-api.de/api/interpreter"

# Landmarks outside the near terrain tile cannot be draped on it — sampling
# clamps to the tile edge, which out west is 90 m of water, and the marker would
# vanish under the sea. Those carry an explicit height read from the far tile.
NEAR_BOX = {"min_lon": -123.13, "max_lon": -123.05, "min_lat": 48.97, "max_lat": 49.00}
FAR_TERRAIN = "heightmap_far.bin", "meta_far.json"

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
    values = array.array("f")
    values.frombytes(bin_path.read_bytes())
    nrows, ncols = grid["nrows"], grid["ncols"]

    def sample(lat: float, lon: float) -> float:
        i = round((grid["north_lat"] - lat) / grid["cellsize_deg"])
        j = round((lon - grid["west_lon"]) / grid["cellsize_deg"])
        if not (0 <= i < nrows and 0 <= j < ncols):
            raise ValueError(f"({lat}, {lon}) is outside the far terrain tile")
        return values[i * ncols + j]

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

    out = {"bbox": BBOX, "roads": roads, "buildings": buildings,
           "coastline": coastline, "landmarks": landmarks}
    out_dir = Path(__file__).resolve().parents[1] / "assets" / "osm"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "features.json").write_text(json.dumps(out), encoding="utf-8")
    print(f"roads {len(roads)}  buildings {len(buildings)}  "
          f"coastline {len(coastline)}  landmarks {len(landmarks)}")
    for lm in landmarks:
        print(f"  landmark: {lm['kind']:10} {lm['name']}  ({lm['lat']:.4f},{lm['lon']:.4f})")


if __name__ == "__main__":
    main()
