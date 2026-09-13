"""Checks for the fire and medical calls off PulsePoint.

Run:
    python server/test_pulsepoint.py

The decryption is checked both ways: against a payload encrypted here in the
same form, and against the live feed, because the day PulsePoint changes the
password is the day this has to say so rather than show an empty map. The rest
is keeping to the peninsula and keeping calls up to date as they close.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import httpx  # noqa: E402
from Crypto.Cipher import AES  # noqa: E402

from server import pulsepoint  # noqa: E402
from server.peninsula import in_point_roberts  # noqa: E402

logging.disable(logging.CRITICAL)
TYPES = pulsepoint.load_call_types(ROOT)


def wrap(document: dict, password: bytes = pulsepoint.PASSWORD) -> dict:
    """Encrypt a document the way PulsePoint sends it."""
    salt = os.urandom(8)
    derived, prev = b"", b""
    while len(derived) < 48:
        prev = hashlib.md5(prev + password + salt).digest()
        derived += prev
    key, iv = derived[:32], derived[32:48]
    plain = json.dumps(json.dumps(document)).encode()
    pad = 16 - len(plain) % 16
    body = AES.new(key, AES.MODE_CBC, iv).encrypt(plain + bytes([pad]) * pad)
    return {"ct": base64.b64encode(body).decode(), "iv": iv.hex(), "s": salt.hex()}


def row(id_, code, lat, lon, address, received, closed=None, units=()):
    return {"ID": id_, "PulsePointIncidentCallType": code, "Latitude": str(lat),
            "Longitude": str(lon), "FullDisplayAddress": address,
            "CallReceivedDateTime": received, "ClosedDateTime": closed,
            "Unit": [{"UnitID": u} for u in units]}


# Real rows from 12 September 2026, and two that are not on the point.
FEED = {"incidents": {"alerts": [], "active": [
    row("1", "ME", 48.9969264987, -123.0369603556, "WICKLOW PL, POINT ROBERTS, WA",
        "2026-09-12T22:10:23Z", units=["A58"]),
], "recent": [
    row("2", "PS", 49.0003877817, -123.0355858997, "67 BAY VIEW DR, POINT ROBERTS, WA",
        "2026-09-12T19:38:55Z", "2026-09-12T20:30:00Z", ["B58", "E58", "E5802"]),
    row("3", "ME", 48.7519, -122.4787, "N STATE ST, BELLINGHAM, WA", "2026-09-12T19:00:00Z"),
    row("4", "TC", 49.0031, -123.0840, "56 ST, DELTA, BC", "2026-09-12T18:00:00Z"),
]}}


# ---- decrypting -------------------------------------------------------------

def test_a_payload_in_their_form_decrypts() -> None:
    assert pulsepoint.decrypt(wrap(FEED)) == FEED


def test_the_wrong_password_says_so() -> None:
    try:
        pulsepoint.decrypt(wrap(FEED, b"not-the-password"))
    except RuntimeError as exc:
        assert "password" in str(exc)
    else:
        raise AssertionError("a payload under another password decrypted")


def test_a_feed_not_in_their_form_says_so() -> None:
    try:
        pulsepoint.decrypt({"incidents": []})
    except RuntimeError as exc:
        assert "ct/iv/s" in str(exc)
    else:
        raise AssertionError("an unencrypted answer was treated as encrypted")


def test_the_live_feed_still_decrypts_with_their_password() -> None:
    async def fetch():
        async with httpx.AsyncClient(timeout=45) as client:
            r = await client.get(pulsepoint.FEED, headers=pulsepoint.HEADERS)
            r.raise_for_status()
            return r.json()
    feed = pulsepoint.decrypt(asyncio.run(fetch()))
    assert "incidents" in feed and "recent" in feed["incidents"], sorted(feed)


# ---- keeping to the point ---------------------------------------------------

def test_only_calls_on_the_peninsula_are_kept() -> None:
    calls = pulsepoint.read_calls(FEED, TYPES)
    assert [c["id"] for c in calls] == ["1", "2"], [c["address"] for c in calls]


def test_the_line_is_between_the_two_border_stations() -> None:
    assert in_point_roberts(49.00156, -123.0682), "the US station's north wall is outside"
    assert not in_point_roberts(49.00217, -123.0682), "the Canadian station is inside"
    assert not in_point_roberts(49.006435, -123.131738), "the ferry terminal is inside"
    assert in_point_roberts(48.972766, -123.082118), "Lighthouse Marine Park is outside"
    assert in_point_roberts(48.981614, -123.025868), "Lily Point is outside"


# ---- what a call says -------------------------------------------------------

def test_a_call_carries_its_type_in_words_and_its_units() -> None:
    first = pulsepoint.read_calls(FEED, TYPES)[0]
    assert first["type"] == "ME"
    assert first["description"] == TYPES["ME"]["description"] and first["category"] == "Medical"
    assert first["units"] == ["A58"] and first["active"] is True
    assert first["address"] == "WICKLOW PL, POINT ROBERTS, WA"


def test_a_code_their_table_does_not_carry_is_left_as_the_code() -> None:
    odd = {"incidents": {"active": [row("9", "ZZZ", 48.99, -123.05, "X, POINT ROBERTS, WA",
                                         "2026-09-12T10:00:00Z")], "recent": []}}
    [call] = pulsepoint.read_calls(odd, TYPES)
    assert call["type"] == "ZZZ" and call["description"] is None


def test_the_call_type_table_is_the_one_from_their_app() -> None:
    assert len(TYPES) > 100, len(TYPES)
    for code in ("ME", "SF", "TC", "PS", "VEG", "UNK"):
        assert code in TYPES, code


# ---- keeping them -----------------------------------------------------------

def store():
    return pulsepoint.FireCalls(Path(tempfile.mkdtemp()) / "fire.json", TYPES)


def test_a_call_seen_again_closes_and_gains_units_rather_than_doubling() -> None:
    s = store()
    assert s.take(pulsepoint.read_calls(FEED, TYPES)) == 2
    later = json.loads(json.dumps(FEED))
    moved = later["incidents"]["active"].pop(0)
    moved["ClosedDateTime"] = "2026-09-12T23:00:00Z"
    moved["Unit"] = [{"UnitID": "A58"}, {"UnitID": "M1"}]
    later["incidents"]["recent"].append(moved)
    assert s.take(pulsepoint.read_calls(later, TYPES)) == 0
    kept = s.calls["1"]
    assert kept["closed"] == "2026-09-12T23:00:00Z" and kept["active"] is False
    assert kept["units"] == ["A58", "M1"]


def test_calls_are_kept_on_disk_newest_first_for_a_year() -> None:
    s = store()
    s.take(pulsepoint.read_calls(FEED, TYPES))
    s.save()
    again = pulsepoint.FireCalls(s.path, TYPES)
    again.load()
    assert [c["id"] for c in again.as_data()["calls"]] == ["1", "2"]
    again.trim(datetime(2027, 9, 12, 21, 0, tzinfo=timezone.utc))
    assert [c["id"] for c in again.as_data()["calls"]] == ["1"], "a call over a year old stayed"


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for test in tests:
        try:
            test()
        except (AssertionError, RuntimeError, httpx.HTTPError) as exc:
            failed += 1
            print(f"FAIL {test.__name__}: {exc}")
        else:
            print(f"ok   {test.__name__}")
    print(f"\n{len(tests) - failed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
