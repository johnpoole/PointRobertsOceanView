"""Checks for the shipfinder payload decoder.

Run:
    python server/test_shipfinder.py

No network. The decoder is fed bytes built to the layout confirmed against a
captured payload, so a change to the format shows up here rather than as boats
in a field.
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.shipfinder import (  # noqa: E402
    HEADER_BYTES, RECORD_BYTES, bearing, decode, in_box,
)

BOX = {"min_lat": 48.80, "min_lon": -123.50, "max_lat": 49.18, "max_lon": -122.95}


def payload(vessels: list[tuple[str, int, float, float]]) -> bytes:
    out = bytearray(b"\x00" * HEADER_BYTES)
    for ship_id, kind, lat, lon in vessels:
        assert len(ship_id) == 16
        out += b"\x10\x00" + ship_id.encode()
        out += bytes([kind])
        out += struct.pack("<ii", round(lon * 1e6), round(lat * 1e6))
        out += b"\x00" * (RECORD_BYTES - 27)
    return bytes(out)


def test_a_record_decodes_to_its_position() -> None:
    blob = payload([("414A6385EF5C492B", 1, 48.97091, -123.73380)])
    got = decode(blob)
    assert len(got) == 1, got
    v = got[0]
    assert v["id"] == "414A6385EF5C492B"
    assert v["kind"] == 1
    assert abs(v["latitude"] - 48.97091) < 1e-6, v
    assert abs(v["longitude"] + 123.73380) < 1e-6, v


def test_many_records_all_decode() -> None:
    ships = [(f"{i:016X}", 1, 48.9 + i / 1000, -123.1 - i / 1000) for i in range(40)]
    got = decode(payload(ships))
    assert len(got) == 40, len(got)
    assert got[7]["id"] == f"{7:016X}"


def test_an_empty_payload_is_no_vessels_not_an_error() -> None:
    assert decode(b"\x00" * HEADER_BYTES) == []
    assert decode(b"") == []


def test_a_payload_that_does_not_divide_raises() -> None:
    blob = payload([("414A6385EF5C492B", 1, 48.9, -123.1)])[:-5]
    try:
        decode(blob)
    except ValueError as exc:
        assert "format has changed" in str(exc), exc
    else:
        raise AssertionError("a short payload decoded without complaint")


def test_a_record_missing_its_marker_raises() -> None:
    blob = bytearray(payload([("414A6385EF5C492B", 1, 48.9, -123.1),
                              ("B7C398ED3BAFA36B", 2, 48.8, -123.2)]))
    at = HEADER_BYTES + RECORD_BYTES
    blob[at:at + 2] = b"\x99\x99"
    try:
        decode(bytes(blob))
    except ValueError as exc:
        assert "format has changed" in str(exc), exc
    else:
        raise AssertionError("a broken record decoded without complaint")


def test_the_box_filter_keeps_what_is_inside_it() -> None:
    inside = {"latitude": 48.99, "longitude": -123.09}
    north = {"latitude": 49.90, "longitude": -123.09}
    west = {"latitude": 48.99, "longitude": -124.90}
    assert in_box(inside, BOX)
    assert not in_box(north, BOX)
    assert not in_box(west, BOX)


def test_bearing_is_degrees_true() -> None:
    assert abs(bearing(48.99, -123.09, 49.00, -123.09) - 0.0) < 0.5
    assert abs(bearing(48.99, -123.09, 48.99, -123.06) - 90.0) < 0.5
    assert abs(bearing(48.99, -123.09, 48.98, -123.09) - 180.0) < 0.5
    assert abs(bearing(48.99, -123.09, 48.99, -123.12) - 270.0) < 0.5


def test_bearing_between_two_fixes_a_few_metres_apart_is_not_a_course() -> None:
    assert bearing(48.99, -123.09, 48.99009, -123.09) is None


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
