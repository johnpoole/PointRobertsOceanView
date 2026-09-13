"""Bake the golf course into assets/osm/golf.json.

The whole course is already in OpenStreetMap — eighteen holes with their greens,
tees, pins and fairways, sixty-three bunkers, the cart paths, the clubhouse and
the driving range — so none of it needs tracing off a photograph.

It is kept out of features.json on purpose. That file is the peninsula's roads
and buildings and it is baked by build_osm.py; re-running that to add golf would
renumber every building in it, and two landmark tests name their footprint by
index. This is its own file, fetched on its own, and nothing else moves.

    python scripts/build_golf.py

What is missing from OSM and would come off a scorecard: five holes carry no par
(4, 7, 8, 13, 14) and no hole carries a length. Both are written out as null
rather than guessed.
"""

from __future__ import annotations

import heapq
import json
import math
import sys
import urllib.parse
import urllib.request
from pathlib import Path

OVERPASS = "https://overpass-api.de/api/interpreter"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "osm" / "golf.json"
FEATURES = ROOT / "assets" / "osm" / "features.json"

# Most people who play here drive down from Canada for it, so a tee time is also
# a car at the border half an hour earlier. The road they take is baked once:
# Dijkstra from the US booth to the clubhouse over the same road network the
# cast uses. The times come off the live sheet in the page, not from here.
PORT_OF_ENTRY = (49.001325, -123.068427)
CLUBHOUSE = (48.996052, -123.082417)
DRIVEABLE = {"motorway", "trunk", "primary", "secondary", "tertiary",
             "residential", "unclassified", "service"}

# The course sits in the middle of the peninsula. This box is drawn round it
# with room to spare and nothing else in Point Roberts is tagged golf.
BBOX = (48.965, -123.10, 49.005, -123.02)

QUERY = """
[out:json][timeout:120];
(
  way["golf"]({s},{w},{n},{e});
  way["leisure"="golf_course"]({s},{w},{n},{e});
  node["golf"="pin"]({s},{w},{n},{e});
);
out geom tags;
"""

# What is drawn, and in what order, so a bunker sits on its fairway rather than
# under it. Anything else that carries a golf tag is kept but not drawn.
KINDS = ["golf_course", "driving_range", "rough", "fairway", "tee", "green",
         "bunker", "water_hazard", "cartpath", "path", "hole", "clubhouse", "pin"]


def metres(a, b):
    return math.hypot((b[1] - a[1]) * 111320 * math.cos(math.radians(a[0])),
                      (b[0] - a[0]) * 111320)


def arrival_route() -> list[list[float]]:
    """The road a car takes from the border booth to the clubhouse."""
    roads = json.loads(FEATURES.read_text(encoding="utf-8"))["roads"]
    edges: dict[tuple, list] = {}
    for way in roads:
        if way.get("kind") not in DRIVEABLE:
            continue
        points = [tuple(c) for c in way["coords"]]
        for a, b in zip(points, points[1:]):
            if a == b:
                continue
            cost = metres(a, b)
            edges.setdefault(a, []).append((b, cost))
            edges.setdefault(b, []).append((a, cost))
    if not edges:
        raise SystemExit(
            f"No driveable roads in {FEATURES}. Run scripts/build_osm.py first.")

    start = min(edges, key=lambda v: metres(v, PORT_OF_ENTRY))
    goal = min(edges, key=lambda v: metres(v, CLUBHOUSE))
    seen = {start: (0.0, None)}
    queue = [(0.0, start)]
    while queue:
        cost, here = heapq.heappop(queue)
        if here == goal:
            break
        if cost > seen[here][0]:
            continue
        for there, step in edges.get(here, ()):
            ahead = cost + step
            if there not in seen or ahead < seen[there][0]:
                seen[there] = (ahead, here)
                heapq.heappush(queue, (ahead, there))
    if goal not in seen:
        raise SystemExit(
            "No road from the border to the clubhouse. The two are not joined "
            "on the roads a car may use, which cannot be true here, so the "
            "network in features.json is broken.")
    path, at = [], goal
    while at is not None:
        path.append([round(at[0], 6), round(at[1], 6)])
        at = seen[at][1]
    path.reverse()
    return path


def fetch() -> dict:
    query = QUERY.format(s=BBOX[0], w=BBOX[1], n=BBOX[2], e=BBOX[3])
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    request = urllib.request.Request(
        OVERPASS, data=body,
        headers={"User-Agent": "PointRobertsOceanView/1.0 (golf bake)"})
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.loads(response.read())


def number(value):
    """A tag as a whole number, or None. A missing par is not a par of zero."""
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def main() -> int:
    data = fetch()
    features = []
    for element in data.get("elements", []):
        tags = element.get("tags", {})
        kind = tags.get("golf") or tags.get("leisure")
        if not kind:
            continue
        if element["type"] == "node":
            coords = [[element["lat"], element["lon"]]]
        else:
            coords = [[p["lat"], p["lon"]] for p in element.get("geometry", [])]
        if not coords:
            continue
        feature = {"id": element["id"], "type": element["type"],
                   "kind": kind, "coords": coords}
        if tags.get("name"):
            feature["name"] = tags["name"]
        if kind == "hole":
            feature["ref"] = number(tags.get("ref"))
            feature["par"] = number(tags.get("par"))
            # OSM's dist is metres when it is there at all. It never is here.
            feature["metres"] = number(tags.get("dist"))
            feature["handicap"] = number(tags.get("handicap"))
        features.append(feature)

    if not features:
        raise SystemExit(
            f"Overpass returned nothing tagged golf in {BBOX}. The course is "
            f"mapped, so this means the query or the box is wrong, not that the "
            f"course has gone.")

    holes = [f for f in features if f["kind"] == "hole"]
    if len(holes) != 18:
        print(f"warning: {len(holes)} holes, expected 18", file=sys.stderr)

    order = {kind: i for i, kind in enumerate(KINDS)}
    features.sort(key=lambda f: (order.get(f["kind"], len(KINDS)), f["id"]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    route = arrival_route()
    run = sum(metres(route[i], route[i + 1]) for i in range(len(route) - 1))
    OUT.write_text(json.dumps({"bbox": list(BBOX), "features": features,
                               "arrival": {"path": route,
                                           "metres": round(run, 1)}}),
                   encoding="utf-8")

    counts: dict[str, int] = {}
    for f in features:
        counts[f["kind"]] = counts.get(f["kind"], 0) + 1
    print(f"{OUT}: {len(features)} features, {OUT.stat().st_size / 1024:.0f} KB")
    print(f"  arrival road   {len(route)} points, {run / 1000:.2f} km "
          f"from the booth to the clubhouse")
    for kind in sorted(counts, key=lambda k: -counts[k]):
        print(f"  {kind:16s} {counts[kind]}")
    missing = [h["ref"] for h in sorted(holes, key=lambda h: h["ref"] or 0)
               if h["par"] is None]
    print(f"  holes without a par: {missing or 'none'}")
    print(f"  holes with a length: "
          f"{[h['ref'] for h in holes if h.get('metres')] or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
