"""Checks that what the two live feeds send is what the page is given.

Run:
    python server/test_feeds.py

Plain asserts and a non-zero exit, the same as the rest of the tests here.
No network: the records are shaped like theirs and read straight into the
functions that decode them.

The card on the page prints every field it is handed, so a field dropped here is
a field nobody can see. That is what this is for. A ship's destination, its ETA
and its draught all arrive in AIS message 5 and none of them was being kept.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import proxy  # noqa: E402

logging.disable(logging.CRITICAL)


# ---- AIS message 5, the ship's own account of itself ------------------------

STATIC = {
    "Name": "  QUEEN OF ALBERNI  ",
    "Type": 60,
    "CallSign": "CG2947 ",
    "ImoNumber": 7422446,
    "Destination": "TSAWWASSEN ",
    "MaximumStaticDraught": 5.4,
    "Eta": {"Month": 8, "Day": 19, "Hour": 14, "Minute": 30},
    "Dimension": {"A": 100, "B": 39, "C": 13, "D": 14},
}


def test_the_whole_of_message_five_is_kept() -> None:
    state: dict = {}
    proxy._apply_static_fields(state, STATIC)
    assert state["name"] == "QUEEN OF ALBERNI"
    assert state["vessel_type"] == 60
    assert state["call_sign"] == "CG2947"
    assert state["imo"] == 7422446
    assert state["destination"] == "TSAWWASSEN"
    assert state["draught_m"] == 5.4
    assert state["eta_utc"] == "08-19 14:30 UTC"
    assert state["dimensions_m"]["length"] == 139
    assert state["dimensions_m"]["beam"] == 27


def test_the_not_given_values_are_left_off() -> None:
    """Zero is the standard's way of saying a field was not filled in. A ship
    with no IMO number must not be given the number nought."""
    state: dict = {}
    proxy._apply_static_fields(state, {
        "Name": "", "CallSign": "   ", "ImoNumber": 0, "Destination": "",
        "MaximumStaticDraught": 0, "Eta": {"Month": 0, "Day": 0},
    })
    assert state == {}


def test_an_eta_with_no_hour_keeps_the_day() -> None:
    assert proxy._eta_text({"Month": 12, "Day": 1, "Hour": 24, "Minute": 60}) == "12-01"
    assert proxy._eta_text({"Month": 0, "Day": 4, "Hour": 3, "Minute": 0}) is None
    assert proxy._eta_text(None) is None


# ---- adsb.lol, one aircraft -------------------------------------------------

FULL = {
    "hex": "a1b2c3", "flight": "ACA553 ", "r": "C-FGKN", "t": "B738",
    "lat": 49.02, "lon": -123.15, "alt_baro": 4000, "alt_geom": 4150,
    "gs": 250.4, "track": 91.6, "dst": 8.42,
    "baro_rate": -640, "geom_rate": -700, "squawk": "1200", "category": "A3",
    "emergency": "none", "ias": 240, "tas": 262, "mach": 0.412,
    "mag_heading": 88.6, "true_heading": 91.2, "roll": -1.4,
    "nav_altitude_mcp": 5000, "oat": -4, "ws": 22, "wd": 310,
    "rssi": -18.7, "messages": 4213, "seen": 0.3,
}


def test_everything_the_transponder_sent_is_carried() -> None:
    state = proxy.aircraft_state(FULL)
    assert state["callsign"] == "ACA553"
    assert abs(state["altitude_m"] - 1219.2) < 0.1
    assert abs(state["altitude_geometric_m"] - 1264.9) < 0.1
    assert state["vertical_rate_fpm"] == -640      # the barometric one is preferred
    assert state["squawk"] == "1200"
    assert state["category"] == "A3"
    assert state["indicated_airspeed_kn"] == 240
    assert state["true_airspeed_kn"] == 262
    assert state["mach"] == 0.412
    assert state["magnetic_heading_degrees"] == 88.6
    assert state["true_heading_degrees"] == 91.2
    assert state["roll_degrees"] == -1.4
    assert state["selected_altitude_ft"] == 5000
    assert state["outside_air_temp_c"] == -4
    assert state["wind_kn"] == 22
    assert state["wind_from_degrees"] == 310
    assert state["signal_dbm"] == -18.7
    assert state["messages"] == 4213
    assert state["seen_s"] == 0.3
    # No emergency is not news, so the field saying so is left off.
    assert "emergency" not in state


def test_an_emergency_is_carried() -> None:
    state = proxy.aircraft_state({**FULL, "emergency": "general"})
    assert state["emergency"] == "general"


def test_a_plain_mode_s_box_gets_no_invented_fields() -> None:
    """Most of what flies over here sends a position and little else. What it
    did not send must not appear at all, rather than appear empty."""
    state = proxy.aircraft_state({"hex": "c00685", "lat": 49.0, "lon": -123.1,
                                  "alt_baro": 2300})
    assert state["icao"] == "c00685"
    for key in ("squawk", "mach", "wind_kn", "vertical_rate_fpm",
                "altitude_geometric_m", "signal_dbm"):
        assert key not in state, f"{key} was invented for an aircraft that never sent it"


def test_the_gps_climb_rate_stands_in_for_the_barometric_one() -> None:
    record = {k: v for k, v in FULL.items() if k != "baro_rate"}
    assert proxy.aircraft_state(record)["vertical_rate_fpm"] == -700


def test_an_aircraft_with_no_position_is_not_placed() -> None:
    assert proxy.aircraft_state({"hex": "abc123", "alt_baro": 3000}) is None


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
