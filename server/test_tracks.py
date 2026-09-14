"""Checks for the record of where ships and aircraft were.

Run:
    python server/test_tracks.py
"""

from __future__ import annotations

import logging
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server.tracks import TrackLog  # noqa: E402

logging.disable(logging.CRITICAL)

T0 = datetime(2026, 9, 13, 23, 50, tzinfo=timezone.utc)


def ship(lat, lon, name="QUEEN OF ALBERNI", sog=17.0):
    return {"mmsi": "316001234", "name": name, "vessel_type": 60,
            "latitude": lat, "longitude": lon, "speed_over_ground_knots": sog,
            "course_over_ground_degrees": 271.0, "true_heading_degrees": 270}


def log():
    return TrackLog(Path(tempfile.mkdtemp()))


def lines(t, kind, day):
    path = t.root / kind / f"{day}.jsonl"
    return path.read_text(encoding="utf-8").splitlines() if path.exists() else []


def test_a_ship_lying_still_is_not_written_every_report() -> None:
    t = log()
    assert t.record("vessels", "1", T0, ship(49.0, -123.1))
    for s in range(5, 55, 5):
        assert not t.record("vessels", "1", T0 + timedelta(seconds=s), ship(49.0, -123.1))
    assert len(lines(t, "vessels", "2026-09-13")) == 1


def test_a_minute_on_or_fifty_metres_on_it_is_written_again() -> None:
    t = log()
    t.record("vessels", "1", T0, ship(49.0, -123.1))
    assert t.record("vessels", "1", T0 + timedelta(seconds=61), ship(49.0, -123.1))
    assert t.record("vessels", "1", T0 + timedelta(seconds=65), ship(49.0006, -123.1))


def test_what_it_is_is_written_once_a_day_and_when_it_changes() -> None:
    t = log()
    t.record("vessels", "1", T0, ship(49.0, -123.1))
    t.record("vessels", "1", T0 + timedelta(seconds=70), ship(49.001, -123.1))
    t.record("vessels", "1", T0 + timedelta(seconds=140), ship(49.002, -123.1, name="RENAMED"))
    got = lines(t, "vessels", "2026-09-13")
    assert '"info"' in got[0] and '"info"' not in got[1] and '"RENAMED"' in got[2], got


def test_positions_land_in_the_day_they_were_made() -> None:
    t = log()
    t.record("vessels", "1", T0, ship(49.0, -123.1))
    t.record("vessels", "1", T0 + timedelta(minutes=15), ship(49.01, -123.1))
    assert len(lines(t, "vessels", "2026-09-13")) == 1
    assert len(lines(t, "vessels", "2026-09-14")) == 1
    # And the new day starts with what the ship is, so a day read alone is whole.
    assert '"info"' in lines(t, "vessels", "2026-09-14")[0]


def test_a_window_crosses_midnight_and_carries_the_points_either_side() -> None:
    t = log()
    for m in range(0, 30, 2):
        t.record("vessels", "1", T0 + timedelta(minutes=m), ship(49.0 + m * 0.001, -123.1))
    got = t.window("vessels", T0 + timedelta(minutes=10), T0 + timedelta(minutes=20))
    points = got["tracks"]["1"]["points"]
    times = [p[0] for p in points]
    assert min(times) < (T0 + timedelta(minutes=10)).timestamp(), "no point before the window"
    assert max(times) > (T0 + timedelta(minutes=20)).timestamp(), "no point after the window"
    assert got["tracks"]["1"]["info"]["name"] == "QUEEN OF ALBERNI"
    assert got["fields"][:3] == ["t", "lat", "lon"]


def test_a_track_with_nothing_near_the_window_is_not_sent() -> None:
    t = log()
    t.record("vessels", "1", T0, ship(49.0, -123.1))
    got = t.window("vessels", T0 + timedelta(hours=2), T0 + timedelta(hours=2, minutes=10))
    assert got["tracks"] == {}


def test_aircraft_are_kept_apart_from_ships_with_their_own_motion() -> None:
    t = log()
    plane = {"icao": "a1b2c3", "callsign": "ACA553", "latitude": 49.02, "longitude": -123.15,
             "altitude_m": 1219.2, "ground_speed_kn": 250, "track_degrees": 91.6}
    assert t.record("aircraft", "a1b2c3", T0, plane)
    got = t.window("aircraft", T0 - timedelta(minutes=1), T0 + timedelta(minutes=1))
    assert got["tracks"]["a1b2c3"]["points"][0][3:] == [1219.2, 250, 91.6]
    assert got["fields"] == ["t", "lat", "lon", "altitude_m", "ground_speed_kn", "track_degrees"]
    assert t.window("vessels", T0 - timedelta(minutes=1), T0 + timedelta(minutes=1))["tracks"] == {}


def test_a_window_that_is_backwards_or_too_long_is_refused() -> None:
    t = log()
    for start, end in ((T0, T0 - timedelta(minutes=1)), (T0, T0 + timedelta(hours=4))):
        try:
            t.window("vessels", start, end)
        except ValueError:
            pass
        else:
            raise AssertionError(f"a window from {start} to {end} was served")


def test_the_record_says_when_it_starts() -> None:
    t = log()
    assert t.recorded_since("vessels") is None
    t.record("vessels", "1", T0, ship(49.0, -123.1))
    assert t.recorded_since("vessels") == "2026-09-13"


def test_a_position_with_no_place_is_not_written() -> None:
    t = log()
    assert not t.record("vessels", "1", T0, {"mmsi": "1", "name": "NO FIX"})


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for test in tests:
        try:
            test()
        except AssertionError as exc:
            failed += 1
            print(f"FAIL {test.__name__}: {exc}")
        else:
            print(f"ok   {test.__name__}")
    print(f"\n{len(tests) - failed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
