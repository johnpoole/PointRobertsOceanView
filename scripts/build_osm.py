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

import json
import urllib.parse
import urllib.request
from pathlib import Path

# south, west, north, east — the Point Roberts peninsula.
BBOX = (48.968, -123.098, 49.006, -123.048)
OVERPASS = "https://overpass-api.de/api/interpreter"

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
);
out geom;
"""


def fetch() -> dict:
    query = QUERY.format(s=BBOX[0], w=BBOX[1], n=BBOX[2], e=BBOX[3])
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request(OVERPASS, data=body, headers={
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "PointRobertsOceanView/0.1 (jdpoole@gmail.com)",
    })
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


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
        elif tags.get("leisure") == "park" and tags.get("name"):
            pts = coords(el)
            if pts:
                c = centroid(pts)
                landmarks.append({"lat": c[0], "lon": c[1], "name": tags["name"], "kind": "park"})

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
