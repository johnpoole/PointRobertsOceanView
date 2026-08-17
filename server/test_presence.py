"""Checks for the balls that stand where other people are, and for the visitor
record surviving a restart.

Run:
    python server/test_presence.py

Plain asserts and a non-zero exit, because the project has no test runner and
this does not need one.

Two things are being guarded here and only one of them is a feature.

The feature is that a browser can see where the others are. The other thing is
that it can see nothing else: the position that goes out to every browser on the
site comes from the same socket whose address goes in the admin's list, and those
two must never meet. Several of the checks below exist only to say that an
address is not in the broadcast.
"""

from __future__ import annotations

import json
import logging
import sys
import tempfile
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from server import proxy  # noqa: E402

logging.disable(logging.CRITICAL)

HERE = {"type": "here", "lat": 48.989, "lon": -123.085, "y": 22.5, "heading": 270}


def fresh() -> TestClient:
    proxy.visitors = proxy.Visitors()
    proxy.clients = proxy.Clients()
    return TestClient(proxy.app)


# ---- what a browser is allowed to say ---------------------------------------


def test_a_position_is_read_and_rounded() -> None:
    at = proxy.read_position(json.dumps(HERE))
    assert at == {"lat": 48.989, "lon": -123.085, "y": 22.5, "heading": 270.0}, at


def test_a_heading_comes_back_inside_the_circle() -> None:
    at = proxy.read_position(json.dumps({**HERE, "heading": 725.0}))
    assert at["heading"] == 5.0, at
    at = proxy.read_position(json.dumps({**HERE, "heading": -90.0}))
    assert at["heading"] == 270.0, at


def test_rubbish_is_dropped_rather_than_passed_on() -> None:
    # This is the only path on the site that takes a number from a browser and
    # hands it to every other browser, so each of these is a marker that would
    # otherwise stand somewhere impossible, or a crash in somebody else's frame.
    for bad in (
        "not json at all",
        json.dumps([1, 2, 3]),
        json.dumps({"type": "something-else", "lat": 48.9, "lon": -123.0}),
        json.dumps({"type": "here"}),
        json.dumps({"type": "here", "lat": "north", "lon": -123.0}),
        json.dumps({"type": "here", "lat": 91.0, "lon": -123.0}),
        json.dumps({"type": "here", "lat": 48.9, "lon": 181.0}),
        json.dumps({"type": "here", "lat": 48.9, "lon": -123.0, "y": 1e9}),
        json.dumps({"type": "here", "lat": 48.9, "lon": -123.0, "y": float("inf")}),
        json.dumps({"type": "here", "lat": float("nan"), "lon": -123.0}),
    ):
        assert proxy.read_position(bad) is None, bad


# ---- what goes out ----------------------------------------------------------


def test_a_browser_is_told_its_own_name_first() -> None:
    c = fresh()
    with c.websocket_connect("/ws/live") as ws:
        first = json.loads(ws.receive_text())
        assert first["message_type"] == "presence.you", first
        assert first["data"]["id"], first
        # And the snapshot still follows it, or every reading on the page would
        # wait for the next tick of whichever feed owns it.
        assert json.loads(ws.receive_text())["message_type"] == "initial.snapshot"


def test_two_names_are_not_the_same_name() -> None:
    c = fresh()
    with c.websocket_connect("/ws/live") as a, c.websocket_connect("/ws/live") as b:
        one = json.loads(a.receive_text())["data"]["id"]
        two = json.loads(b.receive_text())["data"]["id"]
        assert one != two, (one, two)


def test_a_position_sent_is_a_position_carried() -> None:
    c = fresh()
    with c.websocket_connect("/ws/live") as ws:
        ws.receive_text()
        ws.receive_text()
        ws.send_text(json.dumps(HERE))
        # The send is handled on the server's side of the socket, so ask it for
        # something afterwards to be sure it has got there.
        ws.send_text(json.dumps(HERE))
        here = proxy.clients.placed()
        assert len(here) == 1, here
        assert here[0]["lat"] == 48.989 and here[0]["y"] == 22.5, here


def test_nobody_is_carried_until_they_say_where_they_are() -> None:
    c = fresh()
    with c.websocket_connect("/ws/live") as ws:
        ws.receive_text()
        assert proxy.clients.placed() == []


def test_a_position_never_carries_an_address() -> None:
    c = fresh()
    ip = "203.0.113.9"
    with c.websocket_connect("/ws/live", headers={"x-real-ip": ip}) as ws:
        ws.receive_text()
        ws.receive_text()
        ws.send_text(json.dumps(HERE))
        ws.send_text(json.dumps(HERE))
        here = proxy.clients.placed()
        assert len(here) == 1, here
        blob = json.dumps(here)
        assert ip not in blob, blob
        assert set(here[0]) == {"id", "lat", "lon", "y", "heading"}, here[0]


def test_leaving_takes_the_marker_with_it() -> None:
    c = fresh()
    with c.websocket_connect("/ws/live") as ws:
        ws.receive_text()
        ws.receive_text()
        ws.send_text(json.dumps(HERE))
        ws.send_text(json.dumps(HERE))
        assert len(proxy.clients.placed()) == 1
    assert proxy.clients.placed() == []


def test_rubbish_does_not_close_the_socket() -> None:
    # A browser with a bug is not a reason to hang up on it: the page is a view
    # of a beach and it should go on showing one.
    c = fresh()
    with c.websocket_connect("/ws/live") as ws:
        ws.receive_text()
        ws.receive_text()
        ws.send_text("{]")
        ws.send_text(json.dumps(HERE))
        ws.send_text(json.dumps(HERE))
        assert len(proxy.clients.placed()) == 1


# ---- surviving a deploy -----------------------------------------------------


def test_the_record_comes_back_after_a_restart() -> None:
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "visitors.json"
        before = proxy.Visitors()
        before.opened("203.0.113.1")
        before.closed("203.0.113.1")
        before.opened("203.0.113.1")
        before.opened("198.51.100.2")
        before.save(path)

        after = proxy.Visitors()
        after.load(path)
        rows = {r["ip"]: r for r in after.listing()}
        assert set(rows) == {"203.0.113.1", "198.51.100.2"}, rows
        assert rows["203.0.113.1"]["visits"] == 2, rows
        assert rows["198.51.100.2"]["visits"] == 1, rows
        assert rows["203.0.113.1"]["first_seen"] <= rows["203.0.113.1"]["last_seen"]


def test_nobody_is_still_here_after_a_restart() -> None:
    # open counts sockets. After a restart there are none, and a record that
    # said otherwise would show a permanent crowd.
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "visitors.json"
        before = proxy.Visitors()
        before.opened("203.0.113.3")     # never closed: still connected when it died
        before.save(path)
        after = proxy.Visitors()
        after.load(path)
        assert after.listing()[0]["open"] == 0, after.listing()


def test_a_missing_record_is_a_first_run_and_not_an_error() -> None:
    with tempfile.TemporaryDirectory() as d:
        v = proxy.Visitors()
        v.load(Path(d) / "nothing-here.json")
        assert v.listing() == []


def test_a_broken_record_says_so_rather_than_starting_over_quietly() -> None:
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "visitors.json"
        path.write_text("{ this is not json", encoding="utf-8")
        try:
            proxy.Visitors().load(path)
        except RuntimeError as exc:
            assert str(path) in str(exc), exc
        else:
            raise AssertionError("a corrupt record loaded without complaint")

        path.write_text(json.dumps({"203.0.113.4": {"visits": 1}}), encoding="utf-8")
        try:
            proxy.Visitors().load(path)
        except RuntimeError as exc:
            assert "203.0.113.4" in str(exc), exc
        else:
            raise AssertionError("a record missing its dates loaded without complaint")


def test_writing_is_atomic_enough_to_survive_being_killed() -> None:
    # The file is replaced, not written through. A kill during the write leaves
    # the old record whole rather than half of a new one.
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "visitors.json"
        v = proxy.Visitors()
        v.opened("203.0.113.5")
        v.save(path)
        first = path.read_text(encoding="utf-8")
        v.opened("203.0.113.6")
        v.save(path)
        assert not path.with_suffix(".tmp").exists(), "the scratch file was left behind"
        assert len(json.loads(path.read_text(encoding="utf-8"))) == 2
        assert len(json.loads(first)) == 1


def test_nothing_is_written_when_nothing_changed() -> None:
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "visitors.json"
        v = proxy.Visitors()
        v.opened("203.0.113.8")
        v.save_if_dirty(path)
        stamp = path.stat().st_mtime_ns
        v.save_if_dirty(path)
        assert path.stat().st_mtime_ns == stamp, "an unchanged record was rewritten"


def test_the_cap_still_holds_over_a_reload() -> None:
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "visitors.json"
        v = proxy.Visitors()
        for i in range(proxy.VISITOR_LIMIT + 20):
            ip = f"198.51.100.{i}"
            v.opened(ip)
            v.closed(ip)
            # Spread them, or the prune has no oldest to choose.
            v._by_ip[ip]["last_seen"] -= timedelta(seconds=proxy.VISITOR_LIMIT - i)
        v.save(path)
        after = proxy.Visitors()
        after.load(path)
        assert len(after.listing()) <= proxy.VISITOR_LIMIT, len(after.listing())


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
