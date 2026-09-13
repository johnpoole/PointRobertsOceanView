"""Checks for the two evenly stepped runs the browser indexes.

Run:
    python server/test_series.py

The page's clock moves twelve hours either way and reads the water and the sky
at that hour out of a flat array, by arithmetic on the index. That only works if
the gaps are even. NOAA hands back a dict keyed by local time and Open-Meteo
hands back parallel arrays, and neither promises anything about gaps.

A missing slot shifts every value after it. Nothing on the screen would look
wrong: the tide would simply be six minutes stale for the rest of the day and
grow staler with every gap. So both of these check the shape rather than trust
it, and that checking is what is tested here.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.noaa import series_block  # noqa: E402
from server.weather import hourly_block  # noqa: E402

logging.disable(logging.CRITICAL)


def slots(count: int, step_min: int = 6) -> dict[str, float]:
    """NOAA's shape: {"2026-08-04 14:54": 2.31, ...}, six minutes apart."""
    out = {}
    for i in range(count):
        minute = i * step_min
        out[f"2026-08-04 {minute // 60:02d}:{minute % 60:02d}"] = 2.0 + i * 0.01
    return out


def hourly(count: int) -> dict:
    """Open-Meteo's shape: a time array and one array per field beside it."""
    block = {"time": [f"2026-08-04T{i:02d}:00" for i in range(count)]}
    for field in ("cloud_cover", "cloud_cover_low", "cloud_cover_mid",
                  "cloud_cover_high", "wind_speed_10m", "wind_direction_10m",
                  "temperature_2m", "relative_humidity_2m", "visibility",
                  "precipitation_probability"):
        block[field] = list(range(count))
    block["weather_code"] = [0] * count
    return block


# ---- the tide's own run -----------------------------------------------------

def test_an_even_run_is_carried_through_in_order():
    block = series_block(slots(5), 360)
    assert block["start"] == "2026-08-04 00:00Z", block["start"]
    assert block["step_s"] == 360
    assert block["values"] == [2.0, 2.01, 2.02, 2.03, 2.04], block["values"]


def test_the_run_is_sorted_whatever_order_it_arrived_in():
    # A dict off JSON keeps insertion order, and NOAA's is not guaranteed.
    backwards = dict(reversed(list(slots(4).items())))
    assert series_block(backwards, 360)["values"] == [2.0, 2.01, 2.02, 2.03]


def test_a_gap_raises_and_says_which_slot_and_what_it_costs():
    holed = slots(5)
    del holed["2026-08-04 00:12"]
    try:
        series_block(holed, 360)
    except RuntimeError as exc:
        assert "00:18" in str(exc), exc
        assert "wrong time" in str(exc), exc
    else:
        raise AssertionError("a hole in the run was indexed as if it were even")


def test_a_step_that_is_not_the_step_raises():
    # Asking for six minutes and being handed ten is the same fault as a hole,
    # and it arrives the same way: a parameter changed upstream.
    try:
        series_block(slots(4, step_min=10), 360)
    except RuntimeError as exc:
        assert "gap" in str(exc), exc
    else:
        raise AssertionError("a ten minute run was carried through as six")


def test_a_run_too_short_to_index_raises():
    for count in (0, 1):
        try:
            series_block(slots(count), 360)
        except RuntimeError as exc:
            assert "at least two" in str(exc), exc
        else:
            raise AssertionError(f"{count} slots were called a series")


# ---- the weather's run ------------------------------------------------------

def test_the_hourly_run_is_renamed_to_what_the_page_reads():
    block = hourly_block(hourly(4))
    assert block["start"] == "2026-08-04T00:00Z"
    assert block["step_s"] == 3600
    # The browser's names, not Open-Meteo's.
    assert block["wind_speed_mps"] == [0, 1, 2, 3]
    assert block["cloud_cover_percent"] == [0, 1, 2, 3]
    assert block["visibility_m"] == [0, 1, 2, 3]
    assert "cloud_cover" not in block


def test_a_weather_code_becomes_words():
    run = hourly(3)
    run["weather_code"] = [0, 61, 95]
    assert hourly_block(run)["description"] == ["Clear", "Light rain", "Thunderstorm"]


def test_a_code_nobody_documents_is_carried_as_nothing_said():
    run = hourly(2)
    run["weather_code"] = [0, 4242]
    assert hourly_block(run)["description"] == ["Clear", None]


def test_a_field_that_stopped_arriving_raises_and_names_it():
    run = hourly(4)
    del run["visibility"]
    try:
        hourly_block(run)
    except RuntimeError as exc:
        assert "visibility" in str(exc), exc
        assert "parameter list" in str(exc), exc
    else:
        raise AssertionError("a missing field went through as an empty hour")


def test_a_field_of_the_wrong_length_raises_rather_than_being_indexed():
    run = hourly(4)
    run["temperature_2m"] = [1, 2, 3]
    try:
        hourly_block(run)
    except RuntimeError as exc:
        assert "3 samples against 4" in str(exc), exc
    else:
        raise AssertionError("a short field was lined up against the timestamps")


def test_an_hourly_run_too_short_to_index_raises():
    for count in (0, 1):
        try:
            hourly_block(hourly(count))
        except RuntimeError as exc:
            assert "at least two" in str(exc), exc
        else:
            raise AssertionError(f"{count} hourly samples were called a run")


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
