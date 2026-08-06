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
    HEADER_BYTES, RECORD_BYTES, bearing, decode, dm_to_degrees, in_box,
    load_cache, parse_detail, save_cache,
)

# Verbatim from their page, MISTY BLUE, captured off a real click.
PANEL = (
    "API\nPlans & Pricing\nMMSI：316022604\n\n48º 51.314 N\n123º 29.921 W\n2nm\n+\n−\n"
    "©2026 ShipFinder-H5 - Chart@C-Map @OpenStreetMap Terms & Conditions\n"
    "11level - 410vessels\nUsing C-Map Chart, Pleaselogin now\n     \nChart\nMap\n\n"
    "MISTY BLUE\n\nCoastal AIS\nWeather\nVoyage\n\n"
    "MMSI：\t316022604\tHeading：\tUnknown\n"
    "Call Sign：\tUNKNOWN\tCourse：\t305.0Deg\n"
    "IMO：\t-\tSpeed：\t0.3kn\n"
    "Type：\tPleasure craft\tLat：\t48-51.479N\n"
    "Status：\t\tLon：\t123-30.028W\n"
    "Length：\t8m\tDest：\t-\n"
    "Width：\t2m\tETA：\t-\n"
    "Draught：\t-\tLast Update：\t2026-08-06 13:26:41\n"
    "Ship Info\nShip Track\nPort Call\n"
)

# The same panel for a ship whose call sign is blank. The empty field is what
# used to make the parser read the next label as the value.
PANEL_BLANK_CALLSIGN = PANEL.replace(
    "Call Sign：\tUNKNOWN\tCourse：\t305.0Deg",
    "Call Sign：\t\tCourse：\t322.1Deg")

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


def test_the_panel_gives_up_what_the_ship_is() -> None:
    d = parse_detail(PANEL)
    assert d["mmsi"] == "316022604", d
    assert d["name"] == "MISTY BLUE", d
    assert d["vessel_type_name"] == "Pleasure craft", d
    assert d["length_m"] == 8.0 and d["width_m"] == 2.0, d
    assert d["speed_over_ground_knots"] == 0.3, d
    assert d["course_over_ground_degrees"] == 305.0, d


def test_blanks_are_left_out_rather_than_stored_as_dashes() -> None:
    d = parse_detail(PANEL)
    assert "imo" not in d, d          # the panel shows "-"
    assert "call_sign" not in d, d    # the panel shows "UNKNOWN"


def test_an_empty_field_does_not_swallow_the_next_label() -> None:
    d = parse_detail(PANEL_BLANK_CALLSIGN)
    assert "call_sign" not in d, d
    assert d["course_over_ground_degrees"] == 322.1, d
    assert d["mmsi"] == "316022604", d


def test_the_name_is_found_though_it_carries_no_label() -> None:
    assert parse_detail(PANEL)["name"] == "MISTY BLUE"
    assert "name" not in parse_detail("MMSI：\t316022604\t")


def test_the_panel_position_comes_back_so_a_missed_click_can_be_caught() -> None:
    d = parse_detail(PANEL)
    assert abs(d["panel_latitude"] - 48.858033) < 1e-4, d
    assert abs(d["panel_longitude"] + 123.500483) < 1e-4, d


def test_degrees_and_minutes() -> None:
    assert abs(dm_to_degrees("48-51.482N") - 48.858033) < 1e-6
    assert abs(dm_to_degrees("123-30.029W") + 123.500483) < 1e-6
    assert abs(dm_to_degrees("48º 51.314 N") - 48.855233) < 1e-6
    assert dm_to_degrees("") is None
    assert dm_to_degrees("nonsense") is None


def test_an_empty_panel_yields_nothing_rather_than_junk() -> None:
    assert parse_detail("") == {}
    assert parse_detail("nothing to see here") == {}


def test_the_cache_survives_a_round_trip() -> None:
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "ships.json"
        assert load_cache(path) == {}
        save_cache({"ABC": {"mmsi": "316022604", "name": "MISTY BLUE"}}, path)
        assert load_cache(path)["ABC"]["name"] == "MISTY BLUE"


def test_a_corrupt_cache_says_so_rather_than_starting_empty() -> None:
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "ships.json"
        path.write_text("{not json", encoding="utf-8")
        try:
            load_cache(path)
        except RuntimeError as exc:
            assert "could not be read" in str(exc), exc
        else:
            raise AssertionError("a corrupt cache was read as empty")


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
