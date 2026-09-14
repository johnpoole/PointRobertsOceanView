"""Where every ship and aircraft was, kept so the clock can run back.

The feeds carry where things are now and nothing keeps where they were: no free
AIS or ADS-B source serves a history. So every position the server receives is
written down here, one line a position, one file a day for ships and one for
aircraft, under data/tracks in the volume a rebuild keeps.

A ship lying at anchor reports every few seconds and moves nowhere, so a
position is written only when enough time has passed or it has moved far enough.
What the ship or aircraft is (its name, type, size, callsign) is written with its
first position of the day and again whenever it changes, not on every line.
"""

from __future__ import annotations

import json
import logging
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

log = logging.getLogger("oceanview.tracks")

KINDS = ("vessels", "aircraft")

# Write a position when this long has passed or it has moved this far. A ship
# at 12 knots covers 50 m in eight seconds; an airliner covers 200 m in two.
EVERY = {"vessels": (60.0, 50.0), "aircraft": (10.0, 200.0)}

# How far apart two written positions may be and still be joined by a straight
# line when replaying. Past this there is a hole in the record, not a voyage.
GAP_S = {"vessels": 900.0, "aircraft": 120.0}

# The motion written on every line, as [epoch seconds, lat, lon, a, b, c].
MOTION = {
    "vessels": ("speed_over_ground_knots", "course_over_ground_degrees",
                "true_heading_degrees"),
    "aircraft": ("altitude_m", "ground_speed_kn", "track_degrees"),
}
# What it is, written when it changes.
INFO = {
    "vessels": ("mmsi", "name", "vessel_type", "vessel_type_name", "dimensions_m",
                "call_sign", "imo", "destination", "navigation_status", "source"),
    "aircraft": ("icao", "callsign", "registration", "aircraft_type", "on_ground"),
}

# The most a single request may ask for, so the page cannot ask for a month.
MAX_WINDOW = timedelta(hours=3)


def _metres(lat1, lon1, lat2, lon2) -> float:
    k = math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot((lat2 - lat1) * 111320.0, (lon2 - lon1) * 111320.0 * k)


class TrackLog:
    def __init__(self, root: Path):
        self.root = root
        self._last: dict[tuple[str, str], tuple[float, float, float]] = {}
        self._info: dict[tuple[str, str, str], dict] = {}

    def _file(self, kind: str, day: str) -> Path:
        return self.root / kind / f"{day}.jsonl"

    def record(self, kind: str, tid: str, when: datetime, state: dict) -> bool:
        """Write one position if it is far enough from the last one written.
        Returns whether it was written. Raises when the disk will not take it."""
        if kind not in KINDS:
            raise ValueError(f"tracks are kept for {KINDS}, not {kind!r}")
        lat, lon = state.get("latitude"), state.get("longitude")
        if lat is None or lon is None:
            return False
        t = when.timestamp()
        every_s, every_m = EVERY[kind]
        last = self._last.get((kind, tid))
        if last and t - last[0] < every_s and _metres(last[1], last[2], lat, lon) < every_m:
            return False

        day = when.astimezone(timezone.utc).strftime("%Y-%m-%d")
        line = {"t": round(t, 1), "id": tid, "lat": round(float(lat), 6),
                "lon": round(float(lon), 6),
                "m": [state.get(f) for f in MOTION[kind]]}
        info = {f: state[f] for f in INFO[kind] if state.get(f) is not None}
        if self._info.get((kind, tid, day)) != info:
            line["info"] = info
        path = self._file(kind, day)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(line, separators=(",", ":")) + "\n")
        except OSError as exc:
            raise RuntimeError(f"{path} could not be written: {exc}") from exc
        self._last[(kind, tid)] = (t, float(lat), float(lon))
        self._info[(kind, tid, day)] = info
        return True

    def window(self, kind: str, start: datetime, end: datetime) -> dict:
        """Every track with a position between start and end, and the positions
        either side of the window within a gap, so the first and last moments
        can be drawn between two real points."""
        if kind not in KINDS:
            raise ValueError(f"tracks are kept for {KINDS}, not {kind!r}")
        if end <= start:
            raise ValueError("the window ends before it starts")
        if end - start > MAX_WINDOW:
            raise ValueError(f"a window may be at most {MAX_WINDOW}")
        gap = timedelta(seconds=GAP_S[kind])
        lo, hi = (start - gap).timestamp(), (end + gap).timestamp()
        tracks: dict[str, dict] = {}
        day = (start - gap).astimezone(timezone.utc).date()
        while day <= (end + gap).astimezone(timezone.utc).date():
            path = self._file(kind, day.isoformat())
            if path.exists():
                for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                    try:
                        line = json.loads(raw)
                    except json.JSONDecodeError as exc:
                        raise RuntimeError(f"{path} line {n} is not JSON: {exc}") from exc
                    track = tracks.setdefault(line["id"], {"info": {}, "points": []})
                    if "info" in line:
                        track["info"] = line["info"]
                    if lo <= line["t"] <= hi:
                        track["points"].append([line["t"], line["lat"], line["lon"], *line["m"]])
            day += timedelta(days=1)
        kept = {tid: tr for tid, tr in tracks.items() if tr["points"]}
        return {"kind": kind, "start": start.isoformat(), "end": end.isoformat(),
                "gap_s": GAP_S[kind], "fields": ["t", "lat", "lon", *MOTION[kind]],
                "recorded_since": self.recorded_since(kind), "tracks": kept}

    def recorded_since(self, kind: str) -> str | None:
        folder = self.root / kind
        days = sorted(p.stem for p in folder.glob("*.jsonl")) if folder.exists() else []
        return days[0] if days else None
