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
# The surveyed border, 229 m north of the geodetic 49th parallel (OSM way
# 229415789). Roads and buildings are pulled past it so Tsawwassen is there to
# look at, but a landmark north of it is in Canada and is not a Point Roberts
# landmark — Diefenbaker Park was arriving that way. The ferry terminal is over
# the line on purpose and has its own query above.
BORDER_LAT = 49.00206
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
# Measured instead off Whatcom County 2022 aerial orthoimagery at 0.128 m per
# pixel, which resolves every piling top and the shadow it throws. Each post
# below is one that was still standing when that flight went over.
#
# The trestle runs due east and west on three rows 1.89 m apart, on bents
# 4.57 m apart along it. It is thirty-six bents long and 71 of its 108 posts
# are left. At the seaward end the wharf widens into a head that runs 28 m
# south, and 17 posts are left in that. Nothing stands north of the trestle,
# nothing west of the head, and nothing east of the last bent, which is 36 m
# short of the high-water line.
#
# Neither source gives a height. The chart says only WATLEV "always under water
# /submerged", which describes the deck and not the posts left standing, so
# PILING_TOP_M is a drawing choice.
RUINED_PIERS = [
    {
        "name": "Old wharf",
        "posts": [
            [48.9842187, -123.0846913], [48.9841864, -123.0846916],
            [48.9842050, -123.0847531], [48.9841863, -123.0847533],
            [48.9842213, -123.0847539], [48.9841872, -123.0848147],
            [48.9842035, -123.0848157], [48.9841868, -123.0848782],
            [48.9842048, -123.0848793], [48.9842203, -123.0848794],
            [48.9841916, -123.0849425], [48.9842239, -123.0849425],
            [48.9842079, -123.0849434], [48.9842067, -123.0850021],
            [48.9842230, -123.0850034], [48.9841905, -123.0850640],
            [48.9842071, -123.0850657], [48.9842242, -123.0850666],
            [48.9841902, -123.0851255], [48.9842086, -123.0851265],
            [48.9842243, -123.0851276], [48.9842086, -123.0851894],
            [48.9842247, -123.0851906], [48.9841900, -123.0852505],
            [48.9842067, -123.0852525], [48.9842234, -123.0852541],
            [48.9841900, -123.0853198], [48.9842069, -123.0853237],
            [48.9842237, -123.0853246], [48.9842068, -123.0853854],
            [48.9842233, -123.0853873], [48.9841902, -123.0854458],
            [48.9842059, -123.0854489], [48.9841897, -123.0855729],
            [48.9842070, -123.0855743], [48.9842225, -123.0855744],
            [48.9841892, -123.0856354], [48.9842214, -123.0856354],
            [48.9841877, -123.0856979], [48.9842059, -123.0856980],
            [48.9842227, -123.0856984], [48.9842053, -123.0857601],
            [48.9841873, -123.0858182], [48.9842217, -123.0858186],
            [48.9842226, -123.0858796], [48.9841865, -123.0858813],
            [48.9842045, -123.0858819], [48.9842064, -123.0860062],
            [48.9842201, -123.0860086], [48.9842049, -123.0860692],
            [48.9842053, -123.0861359], [48.9842073, -123.0861941],
            [48.9842211, -123.0861968], [48.9841892, -123.0861981],
            [48.9842045, -123.0862576], [48.9842238, -123.0863176],
            [48.9841889, -123.0863190], [48.9841879, -123.0863803],
            [48.9842244, -123.0863813], [48.9842062, -123.0863825],
            [48.9842231, -123.0864409], [48.9841892, -123.0864421],
            [48.9842061, -123.0864425], [48.9842216, -123.0865046],
            [48.9841858, -123.0865613], [48.9842031, -123.0865654],
            [48.9842201, -123.0865660], [48.9842199, -123.0866288],
            [48.9840183, -123.0867473], [48.9840610, -123.0867512],
            [48.9841451, -123.0867532], [48.9839774, -123.0867713],
            [48.9840597, -123.0867808], [48.9841439, -123.0867818],
            [48.9839739, -123.0867932], [48.9839916, -123.0868027],
            [48.9840169, -123.0868088], [48.9841443, -123.0868090],
            [48.9841003, -123.0868114], [48.9842045, -123.0868131],
            [48.9839914, -123.0868275], [48.9839729, -123.0868324],
            [48.9840150, -123.0868365], [48.9840000, -123.0868436],
            [48.9839751, -123.0868471], [48.9840569, -123.0868641],
            [48.9842042, -123.0868735], [48.9841860, -123.0868760],
        ],
    },
]

QUERY = """
[out:json][timeout:90];
(
  way["highway"]({s},{w},{n},{e});
  way["building"]({s},{w},{n},{e});
  way["natural"="coastline"]({s},{w},{n},{e});
  way["man_made"="lighthouse"]({s},{w},{b},{e});
  node["man_made"="lighthouse"]({s},{w},{b},{e});
  way["leisure"="marina"]({s},{w},{b},{e});
  node["leisure"="marina"]({s},{w},{b},{e});
  way["leisure"="park"]["name"]({s},{w},{b},{e});
  way["aeroway"="aerodrome"]({s},{w},{b},{e});
  way["aeroway"="runway"]({s},{w},{n},{e});
  way["amenity"="ferry_terminal"]({fs},{fw},{fn},{fe});
);
out geom;
"""


def fetch() -> dict:
    query = QUERY.format(s=BBOX[0], w=BBOX[1], n=BBOX[2], e=BBOX[3],
                         b=BORDER_LAT,
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


# 389 W Bluff Rd. OSM carries the address as a standalone node, 9485003908, and
# not on any footprint, so the house is the footprint nearest that point. The
# nearest one has to be close or the match is wrong and the bake says so rather
# than marking a neighbour's roof.
HOME = {"lat": 48.9890765, "lon": -123.0857900}
HOME_MAX_M = 40.0

# Places worth telling apart from the four thousand grey boxes. OSM tags two of
# these on the building and one, the Pier Restaurant, as a node inside the
# marina building, so all three are matched by the footprint the point falls in.
PLACES = [
    {"name": "Kiniski's Reef", "lat": 48.984570, "lon": -123.083454},   # way 440752837
    {"name": "Saltwater Cafe", "lat": 48.984035, "lon": -123.081844},   # way 440751025
    {"name": "Pier Restaurant", "lat": 48.977073, "lon": -123.063032},  # node 2165488384
]


# Which buildings get a flat roof. Point Roberts is houses: 2,397 tagged house,
# 1,666 tagged yes, and 334 sheds, garages, caravans and cabins, against 35 that
# are trading premises. So a peak is the default and this is the exception.
FLAT_TAGS = ("amenity", "shop", "office", "tourism", "craft")
FLAT_BUILDINGS = {"commercial", "retail", "industrial", "warehouse", "office",
                  "public", "school", "civic", "hospital", "supermarket",
                  "hangar", "roof"}


def flat_roofed(tags: dict) -> bool:
    if any(k in tags for k in FLAT_TAGS):
        return True
    return tags.get("building") in FLAT_BUILDINGS


def in_ring(lat: float, lon: float, ring: list[list[float]]) -> bool:
    """Crossing count. The ring is [[lat, lon], ...] and need not be closed."""
    pts = ring if ring[0] == ring[-1] else ring + [ring[0]]
    hit = False
    for i in range(len(pts) - 1):
        y1, x1 = pts[i]
        y2, x2 = pts[i + 1]
        if (y1 > lat) != (y2 > lat):
            if lon < x1 + (lat - y1) * (x2 - x1) / (y2 - y1):
                hit = not hit
    return hit


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
                b = {"coords": pts, "height": building_height(tags)}
                if flat_roofed(tags):
                    b["flat"] = True
                buildings.append(b)
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

    # Mark the house. Nearest footprint centroid to the address node wins.
    if not buildings:
        raise SystemExit("No buildings came back from Overpass, so the house "
                         "cannot be matched. Re-run the bake.")
    home = min(buildings,
               key=lambda b: metres(HOME, dict(zip(("lat", "lon"), centroid(b["coords"])))))
    home_c = centroid(home["coords"])
    home_m = metres(HOME, {"lat": home_c[0], "lon": home_c[1]})
    if home_m > HOME_MAX_M:
        raise SystemExit(
            f"Nearest building to the 389 W Bluff Rd address node is {home_m:.0f} m "
            f"away, past the {HOME_MAX_M:.0f} m limit, so this is somebody else's "
            f"house. Check HOME in {Path(__file__).name} against OSM node 9485003908."
        )
    home["home"] = True

    # Named places. The point falls inside its own footprint, so no distance
    # guess is needed and a miss means the place has moved or OSM has changed.
    for place in PLACES:
        hit = next((b for b in buildings
                    if in_ring(place["lat"], place["lon"], b["coords"])), None)
        if hit is None:
            raise SystemExit(
                f"No building footprint contains {place['name']} at "
                f"{place['lat']},{place['lon']}. Check the point against OSM; "
                f"PLACES is in {Path(__file__).name}."
            )
        hit["name"] = place["name"]
        # Trading premises, so flat, even where OSM tags the business on a node
        # inside the building and leaves the building itself plain. That is how
        # the Pier Restaurant sits in the marina.
        hit["flat"] = True

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
    print(f"  home:     {home_m:.0f} m from the address node, "
          f"({home_c[0]:.5f},{home_c[1]:.5f})")
    for b in buildings:
        if b.get("name"):
            c = centroid(b["coords"])
            print(f"  place:    {b['name']:20} ({c[0]:.5f},{c[1]:.5f})")
    flat = sum(1 for b in buildings if b.get("flat"))
    print(f"  roofs:    {len(buildings) - flat} peaked, {flat} flat")
    for lm in landmarks:
        print(f"  landmark: {lm['kind']:10} {lm['name']}  ({lm['lat']:.4f},{lm['lon']:.4f})")
    for rw in runways:
        print(f"  runway:   {rw['ref'] or '?':10} {rw['name']}  "
              f"{rw['width']:.0f} m wide, {rw['surface'] or 'unknown'}")


if __name__ == "__main__":
    main()
