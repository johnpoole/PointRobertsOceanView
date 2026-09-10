"""Checks for the marina camera read and the gate in front of it.

Run:
    python server/test_marina.py

Two things are guarded. The first is that the feed is not polled unless somebody
is looking at the marina, because every sample costs the marina's provider a
picture. The second is that nothing about it fails quietly: a broken endpoint
and an empty car park must not look the same on the way out.

The detector itself is exercised against a frame built here rather than against
the live camera, so this runs with no network and says the same thing at three
in the morning as at noon.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import marina  # noqa: E402
from server import proxy  # noqa: E402

logging.disable(logging.CRITICAL)

PASSED = FAILED = 0


def check(name, fn):
    global PASSED, FAILED
    try:
        fn()
    except Exception as exc:  # noqa: BLE001 - a test runner reports and carries on
        FAILED += 1
        print(f"FAIL {name}: {exc!r}")
    else:
        PASSED += 1
        print(f"ok   {name}")


# ---- the gate ---------------------------------------------------------------


class Socket:
    """Stands in for a browser's end of the websocket."""


def seats(*sockets):
    clients = proxy.Clients()
    for ws in sockets:
        clients._sockets[ws] = {"id": "x", "at": None, "delivery": None,
                                "color": "#000000", "watching": {}}
    return clients


def test_nobody_is_watching_until_a_browser_says_so():
    clients = seats(Socket())
    assert not clients.anyone_watching("marina", 75), "an open socket is not an interest"


def test_a_browser_that_says_so_is_watching():
    ws = Socket()
    clients = seats(ws)
    clients.watching(ws, "marina")
    assert clients.anyone_watching("marina", 75)
    # And only for the area it named.
    assert not clients.anyone_watching("elsewhere", 75)


def test_interest_expires_when_the_browser_stops_repeating():
    ws = Socket()
    clients = seats(ws)
    clients.watching(ws, "marina")
    assert not clients.anyone_watching("marina", 0), "a zero window holds nobody"


def test_leaving_takes_the_interest_with_it():
    ws = Socket()
    clients = seats(ws)
    clients.watching(ws, "marina")
    clients._sockets.pop(ws)
    assert not clients.anyone_watching("marina", 75)


def test_only_the_named_areas_are_accepted():
    assert proxy.read_watching(json.dumps({"type": "watching", "area": "marina"})) == "marina"
    for rubbish in [{"type": "watching", "area": "../etc/passwd"},
                    {"type": "watching", "area": 5},
                    {"type": "watching"},
                    {"type": "here", "area": "marina"},
                    "not json at all"]:
        text = rubbish if isinstance(rubbish, str) else json.dumps(rubbish)
        assert proxy.read_watching(text) is None, rubbish


def test_a_watching_message_is_not_a_position():
    # The two channels must not cross: what somebody looks at never becomes
    # something every other browser is told.
    assert proxy.read_position(json.dumps({"type": "watching", "area": "marina"})) is None


# ---- the read ---------------------------------------------------------------


def frame(cars=0):
    """A grey frame with dark rectangles low in it, encoded as a JPEG."""
    import cv2
    import numpy as np

    image = np.full((360, 640, 3), 170, np.uint8)
    for i in range(cars):
        x = 60 + i * 120
        cv2.rectangle(image, (x, 250), (x + 90, 300), (40, 40, 45), -1)
    ok, buf = cv2.imencode(".jpg", image)
    assert ok
    return buf.tobytes()


def test_a_frame_is_read_and_reports_its_own_size():
    reading = marina.Detector().read(frame())
    assert reading.width == 640 and reading.height == 360, (reading.width, reading.height)
    assert reading.as_data()["frame_width"] == 640


def test_counts_are_what_was_found_and_nothing_more():
    data = marina.Detector().read(frame()).as_data()
    assert set(data) == {"vehicles", "people", "boats", "in_lot", "on_water",
                         "detections", "confidence_min", "confidence_max",
                         "frame_width", "frame_height"}, data
    # No frame, no boxes, no pixels leave the module.
    assert "image" not in data and "boxes" not in data


def test_an_empty_frame_reports_nothing_rather_than_guessing():
    data = marina.Detector().read(frame()).as_data()
    assert data["detections"] == data["vehicles"] + data["people"] + data["boats"]
    assert data["confidence_min"] is None or data["confidence_min"] >= marina.CONFIDENCE


def test_one_thing_in_two_tiles_is_counted_once():
    box = (100.0, 100.0, 160.0, 180.0)
    nudged = (104.0, 103.0, 164.0, 183.0)
    kept = marina._merge([("vehicles", 0.9, box), ("vehicles", 0.5, nudged)])
    assert len(kept) == 1 and kept[0][1] == 0.9, kept


def test_a_person_beside_a_car_is_two_things():
    box = (100.0, 100.0, 160.0, 180.0)
    kept = marina._merge([("vehicles", 0.9, box), ("people", 0.6, box)])
    assert len(kept) == 2, kept


def test_two_cars_apart_stay_two():
    kept = marina._merge([("vehicles", 0.9, (0.0, 0.0, 60.0, 80.0)),
                          ("vehicles", 0.8, (400.0, 0.0, 460.0, 80.0))])
    assert len(kept) == 2, kept


def test_a_frame_smaller_than_a_tile_raises():
    import cv2
    import numpy as np
    ok, buf = cv2.imencode(".jpg", np.full((100, 100, 3), 128, np.uint8))
    assert ok
    try:
        marina.Detector().read(buf.tobytes())
    except ValueError as exc:
        assert "smaller than one" in str(exc), exc
    else:
        raise AssertionError("a 100 pixel frame was read as if it were the camera")


def test_the_tiles_reach_the_far_edge():
    # Stepping by the stride alone stopped 120 pixels short of the bottom of a
    # 720-high frame, which is the near field of the car park.
    for size in (720, 1280, 361, 300):
        starts = marina._offsets(size)
        assert starts[0] == 0, starts
        assert starts[-1] + marina.TILE >= size, (size, starts)
        assert all(b - a <= marina.STRIDE for a, b in zip(starts, starts[1:])), starts


def test_the_full_size_still_is_what_is_asked_for():
    # The default 640x360 still was tested against a daylight frame with cars
    # plainly in it and found none of them.
    assert "size=full" in marina.SNAPSHOT_URL


def test_rubbish_raises_rather_than_reporting_zero():
    try:
        marina.Detector().read(b"<html>Unauthorized</html>")
    except ValueError as exc:
        assert "not a decodable image" in str(exc), exc
    else:
        raise AssertionError("a page of HTML was read as an empty car park")


def test_a_wrong_content_type_raises_with_the_url_in_it():
    class Response:
        headers = {"content-type": "text/html"}
        content = b"<html/>"

        def raise_for_status(self): pass

    class Client:
        async def get(self, url, **kw): return Response()

    try:
        asyncio.run(marina.sample(Client(), object()))
    except ValueError as exc:
        assert marina.SNAPSHOT_URL in str(exc), exc
    else:
        raise AssertionError("an HTML page was accepted as a camera frame")


def test_the_model_is_required_rather_than_optional():
    # Point the module at a directory with nothing in it and it must refuse.
    saved = marina.PROTOTXT, marina.WEIGHTS
    marina.PROTOTXT = Path("/nowhere/mobilenet-ssd.prototxt")
    marina.WEIGHTS = Path("/nowhere/mobilenet-ssd.caffemodel")
    try:
        marina.Detector()
    except FileNotFoundError as exc:
        assert "cannot start" in str(exc), exc
    else:
        raise AssertionError("a detector started without a model")
    finally:
        marina.PROTOTXT, marina.WEIGHTS = saved


for name, fn in sorted((n, f) for n, f in list(globals().items())
                       if n.startswith("test_") and callable(f)):
    check(name, fn)

print(f"\n{PASSED} passed, {FAILED} failed")
sys.exit(1 if FAILED else 0)
