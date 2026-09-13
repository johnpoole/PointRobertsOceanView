"""The harmonics that make the tide at Point Roberts.

    python scripts/build_tides.py

Writes assets/tide/harmonics.json.

The tide is a sum of cosines. Thirty-seven of them here, each one a pull with
its own size, its own speed and its own head start, and NOAA publish this
station's for nothing. With them in hand the water level at any minute of any
year is arithmetic and needs no network at all.

    https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9449639/harcon.json

They are published in feet above mean sea level. Everything in this model is
metres above MLLW, which is the chart datum and the level the shoreline is cut
at, so the offset between the two datums is baked in with them.

These change when NOAA re-analyses the station, which is rarely and never
without warning. So this is an asset, not a feed.
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "tide" / "harmonics.json"

STATION = "9449639"          # Point Roberts
BASE = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations"
FOOT_M = 0.3048

# The predictor sums about mean sea level. The scene measures off MLLW. Both
# datums come from the same call so the difference is theirs, not a number
# written down here.
FROM_DATUM = "MSL"
TO_DATUM = "MLLW"


def fetch(what: str) -> dict:
    url = f"{BASE}/{STATION}/{what}.json"
    r = httpx.get(url, timeout=60)
    r.raise_for_status()
    return r.json()


def main() -> int:
    harcon = fetch("harcon")
    if (harcon.get("units") or "").lower() != "feet":
        raise SystemExit(
            f"NOAA now publish {STATION}'s constituents in "
            f"{harcon.get('units')!r} and this converts from feet. Check the "
            f"units before trusting anything that comes out of it.")
    cons = harcon["HarmonicConstituents"]
    if len(cons) < 30:
        raise SystemExit(
            f"NOAA returned {len(cons)} constituents for {STATION}. A full "
            f"analysis is thirty-seven; anything much short of that is a "
            f"partial answer and the tide built from it will be wrong.")

    datums = fetch("datums")
    if (datums.get("units") or "").lower() != "feet":
        raise SystemExit(f"datums are in {datums.get('units')!r}, not feet")
    by_name = {d["name"]: d["value"] for d in datums["datums"]}
    for name in (FROM_DATUM, TO_DATUM):
        if name not in by_name:
            raise SystemExit(
                f"{STATION} publishes no {name} datum, so there is no way to "
                f"put the prediction on the datum the scene is cut at. "
                f"It has: {sorted(by_name)}")
    offset_m = (by_name[FROM_DATUM] - by_name[TO_DATUM]) * FOOT_M

    kept = []
    for c in cons:
        if not c.get("name") or c.get("amplitude") is None:
            continue
        kept.append({
            "name": c["name"],
            # Metres, so nothing downstream has to know the tide came in feet.
            "amplitude": round(c["amplitude"] * FOOT_M, 6),
            "phase": c["phase_GMT"],
            "speed": c["speed"],
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "station_id": STATION,
        "station_name": harcon.get("self", "").split("/")[-2] if harcon.get("self") else None,
        "datum": TO_DATUM,
        "units": "metres",
        # What to add to a prediction about mean sea level to put it on the
        # chart datum, which is what every height in this model is measured off.
        "datum_offset_m": round(offset_m, 4),
        "constituents": kept,
    }, indent=1), encoding="utf-8")

    biggest = sorted(kept, key=lambda c: -c["amplitude"])[:5]
    print(f"{len(kept)} constituents -> {OUT.relative_to(ROOT)}")
    print(f"  {FROM_DATUM} is {offset_m:.3f} m above {TO_DATUM}")
    for c in biggest:
        print(f"  {c['name']:<5} {c['amplitude']:.3f} m  "
              f"{c['speed']:.6f} deg/hr  phase {c['phase']:.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
