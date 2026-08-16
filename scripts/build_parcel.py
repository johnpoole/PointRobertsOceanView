"""Bake the Nielson Campground parcel from Whatcom County's parcel service.

The campground is a proposal, not a thing on the ground, and the one piece of it
that is surveyed is the lot it would stand on. That comes from the county's own
parcel layer rather than from OSM, which does not carry parcels, and it is baked
once so the app never hits the county at runtime.

The parcel comes back as three separate closed rings, all wound the same way, so
none of them is a hole. The largest is the body of the lot. The other two are a
narrow frontage strip along Johnson Road at the south, which is where the private
access road comes in.

Source:
  Whatcom County GIS, EnterprisePublishing/WhatcomCo_Property/MapServer layer 2,
  "All Tax Parcels", geo_id 4153344520730000.

Output:
  assets/site/nielson-campground.json

Run once:
  .venv/Scripts/python scripts/build_parcel.py
"""

from __future__ import annotations

import datetime
import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

# The lot. Unaddressed, off Dogwood Way, Point Roberts. Whatcom County Hearing
# Examiner decision CUP2024-00005, 7 July 2026, page 2.
APN = "4153344520730000"
LEGAL_ACRES = 46.31

SERVICE = ("https://gis.whatcomcounty.us/arcgis/rest/services/"
           "EnterprisePublishing/WhatcomCo_Property/MapServer/2/query")

OUT = Path(__file__).resolve().parent.parent / "assets" / "site" / "nielson-campground.json"

# The app's own projection constants, so the acreage this script reports is the
# acreage the app will measure off the same numbers.
ORIGIN_LAT = 48.989009
M_PER_DEG_LAT = 111320.0


def fetch() -> dict:
    params = {
        "where": f"geo_id='{APN}'",
        "outFields": "geo_id,prop_id,zoning,zoning_description",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "json",
    }
    url = SERVICE + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "pointroberts-oceanview/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        body = json.load(r)
    if "error" in body:
        raise RuntimeError(
            f"Whatcom County parcel query failed for geo_id {APN}: "
            f"{body['error']}. Query was {url}")
    feats = body.get("features") or []
    if len(feats) != 1:
        raise RuntimeError(
            f"Expected exactly one parcel for geo_id {APN}, got {len(feats)} "
            f"from {url}. The county may have re-segregated the lot.")
    return feats[0]


def ring_area_m2(ring: list[list[float]]) -> float:
    """Shoelace in local metres, using the app's own equirectangular scaling."""
    cos_lat = math.cos(math.radians(ORIGIN_LAT))
    pts = [((lon * M_PER_DEG_LAT * cos_lat), (lat * M_PER_DEG_LAT))
           for lon, lat in ring]
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2


def main() -> None:
    feat = fetch()
    attrs = feat["attributes"]
    rings = feat["geometry"]["rings"]

    # Written lat,lon because that is the order everything else in this project
    # reads, and because toWorld takes it that way.
    out_rings = []
    for ring in rings:
        area = ring_area_m2(ring)
        out_rings.append({
            "area_m2": round(area, 1),
            "acres": round(area / 4046.8564224, 3),
            "coords": [[round(lat, 7), round(lon, 7)] for lon, lat in ring],
        })
    out_rings.sort(key=lambda r: -r["area_m2"])

    body = out_rings[0]
    if abs(body["acres"] - LEGAL_ACRES) > 1.0:
        raise RuntimeError(
            f"The largest ring measures {body['acres']} acres and the decision "
            f"says the lot is {LEGAL_ACRES}. More than an acre apart means the "
            f"geometry is not the lot the permit is about. Check geo_id {APN} "
            f"in the county parcel viewer before trusting this bake.")

    doc = {
        "source": ("Whatcom County GIS, EnterprisePublishing/WhatcomCo_Property "
                   "MapServer layer 2 (All Tax Parcels), geo_id " + APN),
        "fetched": datetime.date.today().isoformat(),
        "apn": APN,
        "prop_id": attrs.get("prop_id"),
        "zoning": (attrs.get("zoning") or "").strip(),
        "zoning_description": (attrs.get("zoning_description") or "").strip(),
        "permit": "Whatcom County CUP2024-00005, granted 7 July 2026",
        "legal_acres": LEGAL_ACRES,
        "rings": out_rings,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=1), encoding="utf-8")

    print(f"{OUT}")
    for i, r in enumerate(out_rings):
        print(f"  ring {i}: {len(r['coords'])} points, {r['acres']} acres")


if __name__ == "__main__":
    main()
