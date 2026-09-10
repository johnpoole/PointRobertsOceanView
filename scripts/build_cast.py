"""Bake the cast to assets/cast.json: who goes where, when, and by what road.

These people are not real and the file says so on every one of them. What is
real is everything they are hung on: the places are the peninsula's own, the
routes are Dijkstra over the road network in assets/osm/features.json, and the
hours are the published ones wherever a business publishes them. Each character
carries the source of its own schedule, `published` with where it came from or
`assumed`, and the page shows that.

    python scripts/build_cast.py

Nobody here has a name. They are the job: the postmaster, the parcel driver, the
librarian. Inventing residents of a small town and putting them on a map of it
is not something this project does.
"""

from __future__ import annotations

import heapq
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FEATURES = ROOT / "assets" / "osm" / "features.json"
OUT = ROOT / "assets" / "cast.json"

# Where the wheels may go. Everything is walkable; a car keeps to the roads.
DRIVE = {"motorway", "trunk", "primary", "secondary", "tertiary", "residential",
         "unclassified", "service", "track"}
CYCLE = DRIVE | {"cycleway", "path", "bridleway"}
WALK = CYCLE | {"footway", "steps"}
ALLOWED = {"car": DRIVE, "van": DRIVE, "cart": CYCLE, "bike": CYCLE, "walk": WALK}

# Every place a character stands or drives to, from OpenStreetMap.
PLACES = {
    "post office":        (48.985005, -123.068574),
    "marketplace":        (48.985526, -123.066053),
    "library":            (48.984408, -123.077365),
    "community centre":   (48.984430, -123.076810),
    "point to point":     (48.999495, -123.068445),
    "in out parcel":      (48.997563, -123.068327),
    "us port of entry":   (49.001325, -123.068427),
    "golf clubhouse":     (48.996052, -123.082417),
    "marina office":      (48.977092, -123.063342),
    "pier restaurant":    (48.977070, -123.063030),
    "saltwater cafe":     (48.984040, -123.081840),
    "kiniski's reef":     (48.984570, -123.083450),
    "lighthouse park":    (48.972581, -123.081887),
    "monument park":      (49.001357, -123.089541),
    "maple beach":        (48.999596, -123.027120),
    "fire station 58":    (48.988850, -123.043990),
    "primary school":     (48.990430, -123.041960),
    "lily point":         (48.981614, -123.025868),
    "nielson's":          (48.988550, -123.068140),
    "shell":              (48.987290, -123.068400),
}

# The cast. Hours marked published carry where they were published; the rest say
# assumed and mean it.
CAST = [
    {
        "role": "the postmaster",
        "activity": "opens the post office on Gulf Road and closes it at half three",
        "mode": "car", "speed": 11.0,
        "hours": "Mo-Fr 08:30-15:30",
        "source": "published: OpenStreetMap opening_hours on the post office",
        "legs": [("08:05", "us port of entry", "post office"),
                 ("15:40", "post office", "us port of entry")],
    },
    {
        "role": "the parcel driver",
        "activity": "runs between the two parcel depots and the line all day",
        "mode": "van", "speed": 10.0,
        "hours": "Mo-Fr 09:00-16:00; Sa 09:00-15:00",
        "source": "published: OpenStreetMap opening_hours on Point To Point Parcel",
        "legs": [("08:40", "us port of entry", "point to point"),
                 ("10:30", "point to point", "in out parcel"),
                 ("11:10", "in out parcel", "post office"),
                 ("13:30", "post office", "point to point"),
                 ("16:10", "point to point", "us port of entry")],
    },
    {
        "role": "the librarian",
        "activity": "the library on Tuesday afternoons, Wednesdays and Saturdays",
        "mode": "car", "speed": 9.0,
        "hours": "Tu 13:00-19:00; We,Sa 10:00-17:00",
        "source": "published: OpenStreetMap opening_hours on Point Roberts Library",
        "legs": [("09:35", "marketplace", "library"),
                 ("17:10", "library", "community centre"),
                 ("17:40", "community centre", "marketplace")],
    },
    {
        "role": "the shop hand",
        "activity": "the International Marketplace, open every day of the week",
        "mode": "walk", "speed": 1.35,
        "hours": "Mo-Su 09:00-19:00",
        "source": "published: OpenStreetMap opening_hours on International Marketplace",
        "legs": [("08:45", "post office", "marketplace"),
                 ("13:00", "marketplace", "shell"),
                 ("13:25", "shell", "marketplace"),
                 ("19:10", "marketplace", "post office")],
    },
    {
        "role": "the greenkeeper",
        "activity": "round the course from the clubhouse before the first tee time",
        "mode": "cart", "speed": 5.5,
        "hours": "Mo-Su 06:30-20:30",
        "source": "published: the club's own contact page, pointrobertsgc.com",
        "legs": [("06:10", "monument park", "golf clubhouse"),
                 ("15:00", "golf clubhouse", "nielson's"),
                 ("15:45", "nielson's", "golf clubhouse")],
    },
    {
        "role": "the harbourmaster",
        "activity": "the marina office, Tuesday to Saturday, shut over lunch",
        "mode": "car", "speed": 10.0,
        "hours": "Tu-Sa 08:00-17:00",
        "source": "published: the marina's own site, pointrobertsmarina.com",
        "legs": [("07:35", "marketplace", "marina office"),
                 ("12:05", "marina office", "pier restaurant"),
                 ("13:10", "pier restaurant", "marina office"),
                 ("17:10", "marina office", "marketplace")],
    },
    {
        "role": "the cook",
        "activity": "the Saltwater Café on Gulf Road, and the tavern after",
        "mode": "walk", "speed": 1.3,
        "hours": "assumed 09:00-17:00",
        "source": "assumed: neither the cafe nor the tavern publishes hours",
        "legs": [("08:30", "library", "saltwater cafe"),
                 ("17:15", "saltwater cafe", "kiniski's reef"),
                 ("19:30", "kiniski's reef", "library")],
    },
    {
        "role": "the dog walker",
        "activity": "the beach at Lighthouse Marine Park, morning and evening",
        "mode": "walk", "speed": 1.25,
        "hours": "08:00-sunset",
        "source": "published: OpenStreetMap opening_hours on Lighthouse Marine Park",
        "legs": [("08:15", "saltwater cafe", "lighthouse park"),
                 ("09:40", "lighthouse park", "saltwater cafe"),
                 ("18:20", "saltwater cafe", "lighthouse park"),
                 ("19:45", "lighthouse park", "saltwater cafe")],
    },
    {
        "role": "the cyclist",
        "activity": "the length of the point and back, most mornings",
        "mode": "bike", "speed": 5.2,
        "hours": "assumed 07:00-09:00",
        "source": "assumed: nobody publishes this",
        "legs": [("07:00", "maple beach", "monument park"),
                 ("08:00", "monument park", "lighthouse park"),
                 ("09:00", "lighthouse park", "maple beach")],
    },
    {
        "role": "the school run",
        "activity": "down to the primary school on Benson Road and back",
        "mode": "car", "speed": 11.0,
        "hours": "assumed 08:20 and 15:10 on school days",
        "source": "assumed: the school does not publish its hours in the map",
        "legs": [("08:20", "maple beach", "primary school"),
                 ("08:45", "primary school", "maple beach"),
                 ("15:00", "maple beach", "primary school"),
                 ("15:25", "primary school", "maple beach")],
    },
    {
        "role": "the golfer",
        "activity": "an early tee time, and the clubhouse after the eighteenth",
        "mode": "car", "speed": 10.0,
        "hours": "a tee time, not office hours",
        "source": "assumed: a round is booked, not published. The course is open "
                  "06:30-20:30 and this one goes out early.",
        "legs": [("07:10", "marketplace", "golf clubhouse"),
                 ("12:20", "golf clubhouse", "marketplace")],
    },
    {
        "role": "the hiker",
        "activity": "out to Lily Point and back while the light lasts",
        "mode": "walk", "speed": 1.3,
        "hours": "daylight, not office hours",
        "source": "assumed: nobody publishes when a walk starts. Lily Point is a "
                  "park and the parks here open at 08:00 and shut at sunset.",
        "legs": [("09:30", "maple beach", "lily point"),
                 ("12:40", "lily point", "maple beach")],
    },
    {
        "role": "the fire crew",
        "activity": "out of Station 58 and back, on a drill run",
        "mode": "car", "speed": 12.0,
        "hours": "assumed: a weekly drill, not a call",
        "source": "assumed: nobody publishes when a volunteer crew drills",
        "legs": [("19:00", "fire station 58", "marketplace"),
                 ("19:35", "marketplace", "fire station 58")],
    },
]


def metres(a, b):
    return math.hypot((b[1] - a[1]) * 111320 * math.cos(math.radians(a[0])),
                      (b[0] - a[0]) * 111320)


def graph(roads, kinds):
    """Every road vertex, joined to its neighbours along the ways it lies on."""
    edges: dict[tuple, list] = {}
    for way in roads:
        if way.get("kind") not in kinds:
            continue
        points = [tuple(p) for p in way["coords"]]
        for a, b in zip(points, points[1:]):
            if a == b:
                continue
            cost = metres(a, b)
            edges.setdefault(a, []).append((b, cost))
            edges.setdefault(b, []).append((a, cost))
    return edges


def snap(edges, place):
    return min(edges, key=lambda v: metres(v, place))


def route(edges, start, goal):
    """Dijkstra. Returns the polyline, or None when the two are not joined."""
    seen: dict[tuple, tuple] = {start: (0.0, None)}
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
        return None
    path, at = [], goal
    while at is not None:
        path.append([at[0], at[1]])
        at = seen[at][1]
    path.reverse()
    return path


def main() -> int:
    data = json.loads(FEATURES.read_text(encoding="utf-8"))
    graphs = {mode: graph(data["roads"], kinds) for mode, kinds in ALLOWED.items()}
    out = []
    for person in CAST:
        edges = graphs[person["mode"]]
        legs = []
        for depart, start, end in person["legs"]:
            for name in (start, end):
                if name not in PLACES:
                    raise SystemExit(f"{person['role']}: there is no place called {name!r}")
            a, b = snap(edges, PLACES[start]), snap(edges, PLACES[end])
            path = route(edges, a, b)
            if path is None:
                raise SystemExit(
                    f"{person['role']}: no {person['mode']} route from {start} to {end}. "
                    f"The two are not joined on the roads that mode may use.")
            run = sum(metres(path[i], path[i + 1]) for i in range(len(path) - 1))
            legs.append({"depart": depart, "from": start, "to": end,
                         "metres": round(run, 1),
                         "minutes": round(run / person["speed"] / 60, 1),
                         "path": [[round(p[0], 6), round(p[1], 6)] for p in path]})
        out.append({
            "role": person["role"], "activity": person["activity"],
            "mode": person["mode"], "speed": person["speed"],
            "hours": person["hours"], "source": person["source"],
            "published": person["source"].startswith("published"),
            "legs": legs,
        })

    OUT.write_text(json.dumps({"invented": True, "cast": out}), encoding="utf-8")
    published = sum(1 for p in out if p["published"])
    print(f"{OUT}: {len(out)} characters, {OUT.stat().st_size / 1024:.0f} KB")
    print(f"  {published} on published hours, {len(out) - published} assumed")
    for person in out:
        run = sum(leg["metres"] for leg in person["legs"])
        longest = max(leg["metres"] for leg in person["legs"])
        print(f"  {person['role']:18s} {person['mode']:5s} {len(person['legs'])} legs, "
              f"{run / 1000:5.2f} km, longest {longest / 1000:4.2f} km")
    return 0


if __name__ == "__main__":
    sys.exit(main())
