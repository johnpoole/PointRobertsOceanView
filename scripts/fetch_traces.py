"""Pull OpenStreetMap's public GPS traces over Point Roberts to data/traces.json.

    python scripts/fetch_traces.py

These are tracks real people uploaded — walks, rides, drives — under ODbL. The
API hands them back in pages of 5000 points, grouped into segments, most of them
with a timestamp on every point. That is enough to tell a walk from a drive and
to say what hour of the day a place is busy, which is what the cast wants.

What is deliberately thrown away here and never written to disk: the name of the
trace, its description, and the uploader. Those name people, and this project
does not put residents of a small town on a map. What is kept is a line on the
ground and the time it was walked.

Run it again to refresh. It is polite about it: one request at a time, with a
pause, because this is a free service.
"""

from __future__ import annotations

import json
import math
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "traces.json"

API = "https://api.openstreetmap.org/api/0.6/trackpoints"
# The peninsula and the water round it, a little wider than the terrain tile so
# a track that runs off the end is not cut mid-stride.
BBOX = (-123.095, 48.968, -123.018, 49.006)
PAGE_POINTS = 5000          # what the API returns when there is more to come
MAX_PAGES = 400             # a stop, in case the paging never ends
PAUSE_S = 1.0

POINT = re.compile(
    r'<trkpt lat="([-\d.]+)" lon="([-\d.]+)"\s*>(?:\s*<time>([^<]+)</time>)?',
    re.S)
SEGMENT = re.compile(r"<trkseg>(.*?)</trkseg>", re.S)


def fetch(page: int) -> str:
    url = (f"{API}?bbox={BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}&page={page}")
    req = urllib.request.Request(url, headers={
        "User-Agent": "PointRobertsOceanView/1.0 (+https://ptrob.pgyard.ca)",
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        if r.status != 200:
            raise RuntimeError(
                f"OpenStreetMap returned {r.status} for page {page} of "
                f"{url}. The trackpoints API refused the request.")
        return r.read().decode("utf-8", "replace")


def metres(a, b):
    return math.hypot((b[1] - a[1]) * 111320 * math.cos(math.radians(a[0])),
                      (b[0] - a[0]) * 111320)


def when(text: str | None) -> float | None:
    if not text:
        return None
    try:
        return datetime.strptime(text.strip(), "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc).timestamp()
    except ValueError:
        return None


def main() -> int:
    segments: list[dict] = []
    points = 0
    for page in range(MAX_PAGES):
        body = fetch(page)
        found = SEGMENT.findall(body)
        here = 0
        for seg in found:
            track = []
            for lat, lon, t in POINT.findall(seg):
                track.append([round(float(lat), 6), round(float(lon), 6),
                              when(t)])
            here += len(track)
            if len(track) < 2:
                continue
            run = sum(metres(track[i - 1], track[i]) for i in range(1, len(track)))
            segments.append({"points": track, "metres": round(run, 1)})
        points += here
        print(f"  page {page:3d}: {here:5d} points, {len(found)} segments",
              flush=True)
        # A short page is the end of them.
        if here < PAGE_POINTS:
            break
        time.sleep(PAUSE_S)
    else:
        raise RuntimeError(
            f"Still full pages after {MAX_PAGES}. Either the bbox is far too "
            f"big or the API has changed how it pages.")

    timed = sum(1 for s in segments if s["points"][0][2] is not None)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "source": "OpenStreetMap public GPS traces, ODbL",
        "bbox": list(BBOX),
        "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "segments": segments,
    }), encoding="utf-8")

    run = sum(s["metres"] for s in segments)
    print(f"\n{OUT}: {len(segments)} segments, {points} points, "
          f"{run / 1000:.0f} km, {OUT.stat().st_size / 1e6:.1f} MB")
    print(f"  {timed} of {len(segments)} carry timestamps")
    return 0


if __name__ == "__main__":
    sys.exit(main())
