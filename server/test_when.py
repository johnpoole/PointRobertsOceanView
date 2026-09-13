"""Checks for reading the timestamps the feeds stamp their readings with.

Run:
    python server/test_when.py

Five upstreams, five spellings of the same instant, and one of them carries no
zone at all. A form that stops parsing returns None here and the reading it came
with is filed under whatever the caller falls back to, which is now. That is a
measurement made an hour ago shown as the present one, and nothing on the page
would say so.
"""

from __future__ import annotations

import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.when import PENINSULA, iso, local_now, parse_time, utcnow  # noqa: E402

logging.disable(logging.CRITICAL)

WHEN = datetime(2026, 8, 4, 14, 54, tzinfo=timezone.utc)


def test_noaa_co_ops_has_no_zone_marker_and_means_gmt():
    # "2026-08-04 14:54". Read as local time this is off by seven hours in
    # summer, which is most of a tide.
    assert parse_time("2026-08-04 14:54") == WHEN


def test_open_meteo_is_iso_with_no_offset_and_means_gmt():
    assert parse_time("2026-08-04T14:54") == WHEN


def test_an_offset_is_honoured_where_one_is_given():
    assert parse_time("2026-08-04T07:54-07:00") == WHEN
    assert parse_time("2026-08-04T14:54Z") == WHEN


def test_aisstream_stamps_microseconds_and_the_word_utc():
    assert parse_time("2026-08-04 14:54:00.000000 +0000 UTC") == WHEN


def test_everything_comes_back_aware():
    # A naive datetime compared against an aware one raises, and the comparison
    # is how a reading is found to be stale.
    for text in ("2026-08-04 14:54", "2026-08-04T14:54",
                 "2026-08-04 14:54:00.000000 +0000 UTC"):
        assert parse_time(text).tzinfo is not None, text


def test_nothing_is_nothing_and_says_so():
    assert parse_time(None) is None
    assert parse_time("") is None
    assert parse_time("   ") is None


def test_a_form_nobody_sends_is_refused_rather_than_guessed_at():
    assert parse_time("4 August 2026") is None
    assert parse_time("1754318040") is None
    assert parse_time("Update Pending") is None


def test_whitespace_around_a_stamp_does_not_lose_it():
    assert parse_time("  2026-08-04 14:54  ") == WHEN


def test_iso_is_utc_whatever_it_was_handed():
    assert iso(WHEN) == "2026-08-04T14:54:00+00:00"
    assert iso(WHEN.astimezone(PENINSULA)) == "2026-08-04T14:54:00+00:00"


def test_now_is_aware_and_the_peninsula_is_not():
    # The tee sheet's times carry no zone and mean the course's own clock, so
    # local_now is naive on purpose and must stay that way.
    assert utcnow().tzinfo is not None
    assert local_now().tzinfo is None


def test_the_peninsula_keeps_its_own_clock():
    # Vancouver, not wherever the container is. In August that is seven hours
    # behind GMT.
    assert WHEN.astimezone(PENINSULA).hour == 7


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
