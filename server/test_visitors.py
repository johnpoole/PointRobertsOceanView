"""Checks for the visitor list and the page that shows it.

Run:
    python server/test_visitors.py

Plain asserts and a non-zero exit, because the project has no test runner and
this does not need one.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from server import proxy  # noqa: E402

logging.disable(logging.CRITICAL)

PASSWORD = "a-password-only-this-test-uses"


def fresh() -> TestClient:
    proxy.visitors = proxy.Visitors()
    return TestClient(proxy.app)


def test_shut_when_no_password_is_set() -> None:
    proxy.ADMIN_PASSWORD = ""
    r = fresh().get("/admin/visitors")
    assert r.status_code == 503, r.status_code
    assert "OCEANVIEW_ADMIN_PASSWORD" in r.text


def test_password_is_required_and_checked() -> None:
    proxy.ADMIN_PASSWORD = PASSWORD
    c = fresh()
    assert c.get("/admin/visitors").status_code == 401
    assert c.get("/admin/visitors", auth=("admin", "wrong")).status_code == 401
    assert c.get("/admin/visitors", auth=("admin", PASSWORD)).status_code == 200


def test_open_socket_is_active_and_a_closed_one_is_not() -> None:
    proxy.ADMIN_PASSWORD = PASSWORD
    c = fresh()
    with c.websocket_connect("/ws/live", headers={"x-real-ip": "203.0.113.7"}) as ws:
        ws.receive_text()
        rows = proxy.visitors.listing()
        assert [r["ip"] for r in rows] == ["203.0.113.7"], rows
        assert rows[0]["open"] == 1
    assert proxy.visitors.listing()[0]["open"] == 0


def test_two_tabs_are_one_address_and_it_stays_active_until_both_close() -> None:
    proxy.ADMIN_PASSWORD = PASSWORD
    c = fresh()
    ip = {"x-real-ip": "198.51.100.4"}
    with c.websocket_connect("/ws/live", headers=ip) as a:
        a.receive_text()
        with c.websocket_connect("/ws/live", headers=ip) as b:
            b.receive_text()
            rows = proxy.visitors.listing()
            assert len(rows) == 1, rows
            assert rows[0]["open"] == 2
            assert rows[0]["visits"] == 2
        assert proxy.visitors.listing()[0]["open"] == 1
    assert proxy.visitors.listing()[0]["open"] == 0


def test_address_falls_back_to_the_socket_when_nginx_is_not_in_front() -> None:
    proxy.ADMIN_PASSWORD = PASSWORD
    c = fresh()
    with c.websocket_connect("/ws/live") as ws:
        ws.receive_text()
        rows = proxy.visitors.listing()
        assert len(rows) == 1, rows
        assert rows[0]["ip"] != "unknown"


def test_the_ones_here_now_are_listed_first() -> None:
    proxy.ADMIN_PASSWORD = PASSWORD
    c = fresh()
    with c.websocket_connect("/ws/live", headers={"x-real-ip": "203.0.113.1"}) as a:
        a.receive_text()
    with c.websocket_connect("/ws/live", headers={"x-real-ip": "203.0.113.2"}) as b:
        b.receive_text()
        rows = proxy.visitors.listing()
        assert rows[0]["ip"] == "203.0.113.2", rows
        assert rows[0]["open"] == 1
        assert rows[1]["open"] == 0


def test_the_cap_drops_idle_addresses_and_never_a_connected_one() -> None:
    v = proxy.Visitors()
    connected = []
    for i in range(proxy.VISITOR_LIMIT + 40):
        ip = f"10.0.{i // 256}.{i % 256}"
        v.opened(ip)
        if i % 100 == 0:
            connected.append(ip)
        else:
            v.closed(ip)
    rows = v.listing()
    assert len(rows) == proxy.VISITOR_LIMIT, len(rows)
    still_open = {r["ip"] for r in rows if r["open"]}
    assert still_open == set(connected), still_open ^ set(connected)


def test_the_page_shows_the_address_and_whether_it_is_active() -> None:
    proxy.ADMIN_PASSWORD = PASSWORD
    c = fresh()
    with c.websocket_connect("/ws/live", headers={"x-real-ip": "203.0.113.9"}) as ws:
        ws.receive_text()
        body = c.get("/admin/visitors", auth=("admin", PASSWORD)).text
        assert "203.0.113.9" in body
        assert "1 here now" in body


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
