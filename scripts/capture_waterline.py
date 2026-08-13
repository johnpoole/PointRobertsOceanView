"""Capture the Ocean View camera through a falling tide, with the water level
recorded against every frame.

The waterline in a frame is a contour line at a known height. Where it sits in
the picture is a measurement of the seabed, because the camera's position, aim
and lens are all known and the tide is known to a few centimetres. One frame
cannot separate an error in the ground from an error in the camera. A set of
frames across the whole range can: at high water the waterline is eight metres
out on the steep upper beach and almost nothing moves it, and at low water it is
a hundred and twenty metres out on the flat where a tenth of a degree of camera
pitch moves it eight centimetres. Forty times the leverage between the two ends.

So this runs from a high to the low after it, fourteen frames spaced evenly
through the fall in height rather than on the clock, and writes each one with
the water level at the instant it was taken.

The window is clipped to daylight, and if the next fall is in the dark it looks
for the one after. A camera cannot see a waterline at night.

Run:
    .venv/Scripts/python scripts/capture_waterline.py --plan
    .venv/Scripts/python scripts/capture_waterline.py --once
    .venv/Scripts/python scripts/capture_waterline.py

Output:
    assets/reference/waterline/ocean_view-<utc timestamp>.png
    assets/reference/waterline/waterline.json
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from grab_camera_frame import grab, token_from_env   # noqa: E402

OUT_DIR = ROOT / "assets" / "reference" / "waterline"
MANIFEST = "waterline.json"

# Point Roberts (9449639) is a reference station with its own harmonics and no
# gauge. Cherry Point (9449424) has the nearest live gauge, 27 km southeast. The
# non-tidal residual measured there is weather and stays coherent over that
# distance, so it is carried onto Point Roberts' own prediction. Same arithmetic
# as fetch_tide in server/proxy.py.
COOPS = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
TIDE_STATION = "9449639"
TIDE_GAUGE = "9449424"
TIDE_DATUM = "MLLW"

SUN_URL = "https://api.open-meteo.com/v1/forecast"
SITE_LAT, SITE_LON = 48.989009, -123.085318

# Fourteen contours through the fall. Each one costs about half a minute of
# camera time and buys a line across the beach at a height nothing else knows.
DEFAULT_FRAMES = 14

# A blip should not cost the rest of the tide, but a camera that has stopped
# answering should not burn six hours pretending. Three in a row and it stops.
MAX_CONSECUTIVE_FAILURES = 3

# How far ahead to look for a fall with the sun on it, and how much of one is
# worth sitting up for. The tides here run about fifty minutes later each day, so
# a fall that is dark today is lit within a week.
SEARCH_DAYS = 7
MIN_USABLE_MIN = 90


def get_json(url: str, params: dict) -> dict:
    full = f"{url}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(full, timeout=60) as response:
        return json.load(response)


def coops(**params) -> dict:
    """One CO-OPS call. NOAA reports failures in a 200 body, so check for them."""
    payload = get_json(COOPS, {
        "application": "PointRobertsOceanView",
        "time_zone": "gmt",
        "units": "metric",
        "format": "json",
        **params,
    })
    if "error" in payload:
        raise RuntimeError(
            f"NOAA CO-OPS station {params.get('station')} "
            f"product={params.get('product')}: {payload['error'].get('message')}")
    return payload


def slot_of(when: datetime) -> str:
    """The 6-minute prediction slot a time falls in."""
    floored = when.replace(minute=when.minute - when.minute % 6,
                           second=0, microsecond=0)
    return floored.strftime("%Y-%m-%d %H:%M")


def predictions(station: str, day: datetime) -> dict[str, float]:
    """Six-minute predictions from the day before to the day after.

    The day before because the Cherry Point gauge runs about ten minutes behind,
    and a frame taken just after midnight UTC needs a reading from the day that
    has just ended to have its surge transferred.
    """
    rows = coops(station=station, datum=TIDE_DATUM, product="predictions",
                 begin_date=(day - timedelta(days=1)).strftime("%Y%m%d"),
                 range=72, interval="6")["predictions"]
    return {row["t"]: float(row["v"]) for row in rows}


def prediction_at(when: datetime) -> float:
    """The astronomical tide alone. All there is for a time that has not come:
    surge is a measurement and there is nothing yet to measure."""
    slot = slot_of(when)
    pr = predictions(TIDE_STATION, when)
    if slot not in pr:
        raise RuntimeError(
            f"NOAA predictions for station {TIDE_STATION} have no 6-minute slot "
            f"at {slot}.")
    return pr[slot]


def tide_at(when: datetime) -> dict:
    """Point Roberts water level at an instant: its own prediction with the
    surge measured at Cherry Point carried onto it."""
    slot = slot_of(when)
    pr = predictions(TIDE_STATION, when)
    cp = predictions(TIDE_GAUGE, when)
    if slot not in pr:
        raise RuntimeError(
            f"NOAA predictions for station {TIDE_STATION} have no 6-minute slot "
            f"at {slot}. Cannot put a water level on this frame.")

    observed = coops(station=TIDE_GAUGE, datum=TIDE_DATUM,
                     product="water_level", date="latest")["data"][0]
    if observed["t"] not in cp:
        raise RuntimeError(
            f"The Cherry Point gauge reading at {observed['t']} has no matching "
            f"6-minute prediction, so the surge cannot be transferred.")
    surge = float(observed["v"]) - cp[observed["t"]]
    return {
        "water_level_m": round(pr[slot] + surge, 3),
        "prediction_m": pr[slot],
        "surge_m": round(surge, 3),
        "surge_measured_at": observed["t"] + "Z",
        "datum": TIDE_DATUM,
    }


def falling_windows(after: datetime, days: int) -> list[tuple[datetime, datetime]]:
    """Every high with the low that follows it, over the next few days."""
    rows = coops(station=TIDE_STATION, datum=TIDE_DATUM, product="predictions",
                 begin_date=after.strftime("%Y%m%d"), range=24 * days,
                 interval="hilo")["predictions"]
    extremes = [(datetime.strptime(r["t"], "%Y-%m-%d %H:%M")
                 .replace(tzinfo=timezone.utc), r["type"], float(r["v"]))
                for r in rows]
    windows = []
    for i, (when, kind, high_m) in enumerate(extremes):
        if kind != "H" or when < after:
            continue
        for later, later_kind, low_m in extremes[i + 1:]:
            if later_kind == "L":
                windows.append((when, later, high_m - low_m))
                break
    if not windows:
        raise RuntimeError(
            f"NOAA gave no high followed by a low in the {days} days after "
            f"{after:%Y-%m-%d %H:%M}Z. Cannot pick a window.")
    return windows


def lit_intervals(first: datetime, days: int) -> list[tuple[datetime, datetime]]:
    """Daylight as spans of real time, not as days.

    This coast is seven hours behind UTC, so a UTC day's sunset falls before its
    sunrise: on 2026-08-14 the sun sets at 03:29Z and rises again at 13:03Z. A
    day's daylight is therefore its sunrise paired with the next day's sunset,
    and pairing them the obvious way gives an empty interval every time.
    """
    start = first - timedelta(days=1)
    payload = get_json(SUN_URL, {
        "latitude": SITE_LAT, "longitude": SITE_LON,
        "daily": "sunrise,sunset", "timezone": "UTC",
        "start_date": start.strftime("%Y-%m-%d"),
        "end_date": (first + timedelta(days=days)).strftime("%Y-%m-%d"),
    })
    daily = payload.get("daily") or {}
    if not daily.get("sunrise") or not daily.get("sunset"):
        raise RuntimeError(
            f"Open-Meteo gave no sunrise and sunset from {start:%Y-%m-%d} at "
            f"{SITE_LAT},{SITE_LON}, so a window cannot be clipped to "
            f"daylight: {payload}")
    parse = lambda s: datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
    ups = sorted(parse(s) for s in daily["sunrise"])
    downs = sorted(parse(s) for s in daily["sunset"])
    spans = []
    for up in ups:
        after = [d for d in downs if d > up]
        if after:
            spans.append((up, after[0]))
    return spans


def clip_to_daylight(start: datetime, end: datetime,
                     spans: list[tuple[datetime, datetime]]
                     ) -> tuple[datetime, datetime] | None:
    """The longest stretch of the window that has the sun on it."""
    best = None
    for up, down in spans:
        lo, hi = max(start, up), min(end, down)
        if lo < hi and (best is None or hi - lo > best[1] - best[0]):
            best = (lo, hi)
    return best


def schedule(start: datetime, end: datetime, frames: int) -> list[datetime]:
    """Frame times spaced evenly in tide height, not evenly on the clock.

    The tide crawls at the turn and runs in the middle, so a frame every half
    hour puts three pictures on the same two metres of beach at the top of the
    window and then jumps forty metres in one step lower down. Even steps of
    height put the waterlines where they are wanted: evenly through the range,
    which is the thing being measured against.

    Height, not distance along the ground. Spacing them evenly on the ground
    would need the seabed, and the seabed is the unknown.
    """
    pr = predictions(TIDE_STATION, start)
    series = [(t, pr[slot_of(t)]) for t in
              (start + timedelta(minutes=6 * i)
               for i in range(int((end - start).total_seconds() // 360) + 1))]
    hi, lo = series[0][1], series[-1][1]
    if hi <= lo:
        raise RuntimeError(
            f"The window from {start:%H:%M} to {end:%H:%M}Z does not fall: "
            f"{hi:+.3f} m to {lo:+.3f} m. Cannot space frames through it.")
    slots = []
    for i in range(frames):
        want = hi - (hi - lo) * i / (frames - 1)
        when = min(series, key=lambda row: abs(row[1] - want))[0]
        if when not in slots:
            slots.append(when)
    return slots


def capture(entity: str, token: str, out_dir: Path, when: datetime) -> dict:
    png, width, height = grab(entity, token, headed=False)
    stamp = when.strftime("%Y%m%dT%H%M%SZ")
    name = f"{entity.split('.', 1)[1]}-{stamp}.png"
    (out_dir / name).write_bytes(png)
    row = {"file": name, "grabbed_utc": when.isoformat().replace("+00:00", "Z"),
           "width": width, "height": height, **tide_at(when)}
    print(f"  {name}  {width}x{height}  "
          f"{row['water_level_m']:+.3f} m {row['datum']} "
          f"(prediction {row['prediction_m']:+.3f}, surge {row['surge_m']:+.3f})")
    return row


def write_manifest(out_dir: Path, entity: str, rows: list[dict]) -> None:
    """Rewritten after every frame, so a run that dies keeps what it got."""
    (out_dir / MANIFEST).write_text(json.dumps({
        "camera": entity,
        "site": {"lat": SITE_LAT, "lon": SITE_LON},
        "tide_station": TIDE_STATION,
        "gauge_station": TIDE_GAUGE,
        "frames": rows,
    }, indent=2), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--entity", default="camera.ocean_view")
    ap.add_argument("--frames", type=int, default=DEFAULT_FRAMES,
                    help="how many, spaced evenly in tide height")
    ap.add_argument("--plan", action="store_true",
                    help="print the window and the frame times, take nothing")
    ap.add_argument("--once", action="store_true",
                    help="take one frame now and stop, to prove the path works "
                         "before sitting up for a whole tide")
    ap.add_argument("--out", default=str(OUT_DIR))
    args = ap.parse_args()

    now = datetime.now(timezone.utc)
    out_dir = Path(args.out)
    if args.once:
        out_dir.mkdir(parents=True, exist_ok=True)
        row = capture(args.entity, token_from_env(), out_dir, now)
        write_manifest(out_dir, args.entity, [row])
        return 0

    windows = falling_windows(now, SEARCH_DAYS)
    spans = lit_intervals(now, SEARCH_DAYS)
    lit = None
    for high, low, fall in windows:
        lit = clip_to_daylight(high, low, spans)
        if lit and lit[1] - lit[0] >= timedelta(minutes=MIN_USABLE_MIN):
            break
        why = ("dark all through" if not lit
               else f"only {(lit[1] - lit[0]).total_seconds() / 60:.0f} min of sun")
        print(f"skipping the fall at {high:%a %d %H:%M}Z: {why}")
        lit = None
    if not lit:
        raise SystemExit(
            f"capture_waterline: no falling tide in the next {SEARCH_DAYS} days "
            f"has {MIN_USABLE_MIN} minutes of daylight on it. The tides here run "
            f"about fifty minutes later each day, so wait and run this again.")

    print(f"falling tide {high:%a %Y-%m-%d %H:%M}Z to {low:%H:%M}Z, "
          f"{fall:.2f} m of fall in {(low - high).total_seconds() / 3600:.1f} h")
    if lit[0] > high:
        print(f"  {(lit[0] - high).total_seconds() / 60:.0f} min off the front, "
              f"before sunrise")
    if lit[1] < low:
        print(f"  {(low - lit[1]).total_seconds() / 60:.0f} min off the end, "
              f"after sunset")
    slots = schedule(lit[0], lit[1], args.frames)
    print(f"  {len(slots)} frames, spaced evenly in height, "
          f"first {slots[0]:%H:%M}Z last {slots[-1]:%H:%M}Z")
    if slots[0] > now:
        print(f"  starts in {(slots[0] - now).total_seconds() / 3600:.1f} h")

    if args.plan:
        pr = predictions(TIDE_STATION, slots[0])
        for t in slots:
            print(f"    {t:%Y-%m-%d %H:%M}Z  {pr[slot_of(t)]:+.3f} m predicted")
        return 0

    token = token_from_env()
    out_dir.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []
    failures = 0
    for i, t in enumerate(slots, 1):
        wait = (t - datetime.now(timezone.utc)).total_seconds()
        if wait > 0:
            print(f"[{i}/{len(slots)}] waiting {wait / 60:.1f} min for {t:%H:%M}Z",
                  flush=True)
            time.sleep(wait)
        else:
            print(f"[{i}/{len(slots)}] {t:%H:%M}Z", flush=True)
        try:
            rows.append(capture(args.entity, token, out_dir,
                                datetime.now(timezone.utc)))
            failures = 0
        except Exception as exc:
            # Recorded, not swallowed: it goes in the manifest and on the screen,
            # and three in a row stops the run.
            failures += 1
            print(f"  FAILED: {exc}", file=sys.stderr, flush=True)
            rows.append({"grabbed_utc": t.isoformat().replace("+00:00", "Z"),
                         "failed": str(exc)})
            if failures >= MAX_CONSECUTIVE_FAILURES:
                write_manifest(out_dir, args.entity, rows)
                raise SystemExit(
                    f"capture_waterline: {failures} frames in a row failed, the "
                    f"last with: {exc}\nGot {sum('file' in r for r in rows)} "
                    f"frames before that. They and their tides are in "
                    f"{out_dir / MANIFEST}.")
        write_manifest(out_dir, args.entity, rows)

    got = sum("file" in r for r in rows)
    print(f"{got} of {len(slots)} frames in {out_dir}")
    if got == 0:
        raise SystemExit(
            f"capture_waterline: every one of {len(slots)} frames failed. "
            f"Nothing to measure. See {out_dir / MANIFEST} for why.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
