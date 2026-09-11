"""Checks for reading the golf club's booking sheet.

Run:
    python server/test_tee.py

The sheet says what is open; what is booked is what is missing from it. That
inference is the whole feature and everything below guards it, along with the
two things it cannot know: that a gap might be a tournament rather than a
foursome, and that the morning is unknown to a server that only started looking
at noon.

No network. The sheet is built here, so this says the same thing at any hour.
"""

from __future__ import annotations

import asyncio
import logging
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import tee  # noqa: E402

logging.disable(logging.CRITICAL)

PASSED = FAILED = 0
DAY = "2026-09-10"


def check(name, fn):
    global PASSED, FAILED
    try:
        fn()
    except Exception as exc:  # noqa: BLE001
        FAILED += 1
        print(f"FAIL {name}: {exc!r}")
    else:
        PASSED += 1
        print(f"ok   {name}")


def clock(hhmm):
    return datetime.strptime(f"{DAY} {hhmm}", "%Y-%m-%d %H:%M")


def slot(hhmm, spots=4):
    return {"time": f"{DAY} {hhmm}", "available_spots": spots}


def sheet_at(now, slots):
    sheet = tee.Sheet(day="09-10-2026")
    sheet.read(slots, clock(now))
    return sheet


def test_an_open_slot_is_nobody():
    sheet = sheet_at("09:00", [slot("09:10"), slot("09:20")])
    assert all(v == 0 for v in sheet.booked.values()), sheet.booked


def test_spots_gone_are_players_out():
    sheet = sheet_at("09:00", [slot("09:10", 1), slot("09:20", 2)])
    assert sheet.booked[clock("09:10")] == 3, sheet.booked
    assert sheet.booked[clock("09:20")] == 2, sheet.booked


def test_a_hole_in_the_grid_is_a_full_slot():
    # 09:20 is not offered at all, and it is in the future: taken or held.
    sheet = sheet_at("09:00", [slot("09:10"), slot("09:30")])
    assert sheet.booked[clock("09:20")] == tee.FULL, sheet.booked


def test_the_same_minute_twice_is_one_slot():
    # foreUP answers once per booking class; the most generous is what is left.
    sheet = sheet_at("09:00", [slot("09:10", 1), slot("09:10", 3)])
    assert sheet.booked[clock("09:10")] == 1, sheet.booked


def test_who_is_out_and_which_hole_they_are_on():
    # Every slot on the grid is offered, so the only booking is the 09:10.
    sheet = sheet_at("09:00", [slot("09:10", 1), slot("09:20"), slot("09:30")])
    out = sheet.out_now(clock("10:55"))
    assert len(out) == 1, out
    assert out[0]["tee"] == "09:10" and out[0]["players"] == 3, out
    # 105 minutes at fifteen a hole is the eighth.
    assert out[0]["hole"] == 8, out
    assert 0 <= out[0]["through"] <= 1, out


def test_a_solid_morning_is_not_an_empty_one():
    # The sheet's earliest entry is hours away because everything before it is
    # taken. Those slots are missing from the grid and they are bookings.
    sheet = sheet_at("09:45", [slot("13:00"), slot("13:10")])
    assert sheet.booked[clock("09:50")] == tee.FULL, sheet.booked
    assert sheet.booked[clock("12:50")] == tee.FULL, sheet.booked
    # Both the 09:50 and the 10:00 are out by five past ten.
    out = sheet.out_now(clock("10:05"))
    assert [g["tee"] for g in out] == ["09:50", "10:00"], out


def test_a_group_comes_off_after_the_round():
    sheet = sheet_at("07:00", [slot("07:10", 0)])
    assert len(sheet.out_now(clock("11:30"))) == 1, "still out at four and a half hours"
    assert sheet.out_now(clock("11:41")) == [], "off the eighteenth"


def test_a_group_is_not_out_before_it_tees():
    # 09:10 and 09:20 are open, so the only booking is the 09:30.
    sheet = sheet_at("09:00", [slot("09:10"), slot("09:20"), slot("09:30", 0)])
    assert sheet.out_now(clock("09:20")) == []
    assert len(sheet.out_now(clock("09:35"))) == 1


def test_the_eighteenth_is_the_last_hole():
    sheet = sheet_at("07:00", [slot("07:00", 0)])
    out = sheet.out_now(clock("11:29"))
    assert out and out[0]["hole"] <= tee.HOLES, out


def test_the_morning_is_unknown_rather_than_empty():
    # A server that first looked at noon must not report an empty morning.
    sheet = sheet_at("12:00", [slot("12:10")])
    data = sheet.as_data(clock("12:05"))
    assert data["known_from"] == "12:00", data
    assert data["groups"] == [], data


def test_a_past_slot_that_was_never_seen_is_not_invented():
    # 08:00 is before the first look and is not offered: it stays unknown.
    sheet = sheet_at("09:00", [slot("09:10")])
    assert clock("08:00") not in sheet.booked, sheet.booked


def test_what_was_seen_stays_seen():
    sheet = tee.Sheet(day="09-10-2026")
    sheet.read([slot("09:10", 1), slot("09:20")], clock("09:00"))
    # An hour later the sheet no longer offers 09:10 at all.
    sheet.read([slot("10:10"), slot("10:20")], clock("10:00"))
    assert sheet.booked[clock("09:10")] == 3, "the booking was forgotten"
    assert sheet.seen_from == clock("09:00"), sheet.seen_from
    assert len(sheet.out_now(clock("10:05"))) == 1


def test_rubbish_in_the_sheet_is_skipped_not_guessed():
    sheet = sheet_at("09:00", [slot("09:10"), {"time": "nonsense"}, {"no": "time"}])
    assert clock("09:10") in sheet.booked
    assert len(sheet.booked) == 1, sheet.booked


def test_a_page_instead_of_a_sheet_raises_with_the_url():
    class Response:
        def raise_for_status(self): pass
        def json(self): return {"error": "nope"}

    class Client:
        async def get(self, url, **kw): return Response()

    try:
        asyncio.run(tee.sample(Client(), None, clock("09:00")))
    except ValueError as exc:
        assert "foreupsoftware.com" in str(exc), exc
        assert "not a list" in str(exc), exc
    else:
        raise AssertionError("a dict was accepted as a tee sheet")


def test_the_pace_is_johns_figure():
    assert tee.MINUTES_PER_HOLE == 15.0
    assert tee.ROUND_MINUTES == 270.0, "eighteen holes at a quarter of an hour"


for name, fn in sorted((n, f) for n, f in list(globals().items())
                       if n.startswith("test_") and callable(f)):
    check(name, fn)

print(f"\n{PASSED} passed, {FAILED} failed")
sys.exit(1 if FAILED else 0)
