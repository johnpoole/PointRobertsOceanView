"""Checks for the border crossing feed.

Run:
    python server/test_crossings.py

Plain asserts and a non-zero exit, because the project has no test runner and
this does not need one.

BTS hands back one row per port, month and measure, and this folds them into
months. The folding is the only thing here worth getting wrong, so it is tested
against rows shaped like theirs rather than against the network.
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import proxy  # noqa: E402

logging.disable(logging.CRITICAL)


class FakeResponse:
    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows

    def raise_for_status(self) -> None:
        pass

    def json(self) -> list[dict]:
        return self._rows


class FakeClient:
    """Answers the one call fetch_crossings makes, and remembers the params."""

    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows
        self.params: dict | None = None

    async def get(self, url: str, params: dict | None = None) -> FakeResponse:
        self.params = params
        return FakeResponse(self._rows)


def row(month: str, measure: str, value: int) -> dict:
    return {
        "port_name": "Point Roberts", "port_code": "3017",
        "state": "Washington", "border": "US-Canada Border",
        "date": f"{month}-01T00:00:00.000", "measure": measure, "value": str(value),
    }


def fetch(rows: list[dict]) -> dict:
    client = FakeClient(rows)
    return asyncio.run(proxy.fetch_crossings(client)), client


def test_measures_fold_into_the_month_they_belong_to() -> None:
    (result, _client) = fetch([
        row("2026-06", "Personal Vehicles", 51928),
        row("2026-06", "Personal Vehicle Passengers", 73771),
        row("2026-06", "Trucks", 677),
        row("2026-06", "Pedestrians", 561),
        row("2026-05", "Personal Vehicles", 51998),
        row("2026-05", "Pedestrians", 469),
    ])
    s = result["state"]
    assert s["month"] == "2026-06", s["month"]
    assert s["personal_vehicles"] == 51928, s["personal_vehicles"]
    assert s["personal_vehicle_passengers"] == 73771
    assert s["pedestrians"] == 561
    assert len(s["recent_months"]) == 2, s["recent_months"]
    assert s["recent_months"][1]["personal_vehicles"] == 51998


def test_the_newest_month_leads_however_the_rows_arrive() -> None:
    (result, _c) = fetch([
        row("2025-11", "Personal Vehicles", 10),
        row("2026-06", "Personal Vehicles", 30),
        row("2026-01", "Personal Vehicles", 20),
    ])
    months = [m["month"] for m in result["state"]["recent_months"]]
    assert months == ["2026-06", "2026-01", "2025-11"], months
    assert result["state"]["month"] == "2026-06"


def test_the_reading_is_dated_to_its_month_and_not_to_now() -> None:
    (result, _c) = fetch([row("2026-06", "Personal Vehicles", 1)])
    when = result["time"]
    assert (when.year, when.month, when.day) == (2026, 6, 1), when
    assert when.tzinfo is not None, "a naive time would compare wrong against the rest"


def test_it_asks_for_the_port_it_means() -> None:
    (_r, client) = fetch([row("2026-06", "Personal Vehicles", 1)])
    assert proxy.CROSSINGS_PORT_CODE in client.params["$where"], client.params
    assert client.params["$order"] == "date DESC", client.params


def test_it_keeps_no_more_months_than_it_says() -> None:
    rows = []
    for i in range(proxy.CROSSINGS_MONTHS + 12):
        rows.append(row(f"20{25 - i // 12:02d}-{12 - i % 12:02d}", "Personal Vehicles", i))
    (result, _c) = fetch(rows)
    held = len(result["state"]["recent_months"])
    assert held == proxy.CROSSINGS_MONTHS, held


def test_a_measure_this_port_does_not_file_is_ignored_not_fatal() -> None:
    (result, _c) = fetch([
        row("2026-06", "Personal Vehicles", 5),
        row("2026-06", "Trains", 99),          # not a Point Roberts measure
    ])
    s = result["state"]
    assert s["personal_vehicles"] == 5
    assert "trains" not in s, s.keys()


def test_an_empty_answer_is_an_error_and_says_where_to_look() -> None:
    try:
        fetch([])
    except RuntimeError as exc:
        assert proxy.CROSSINGS_PORT_CODE in str(exc), exc
        assert "bts.gov" in str(exc), exc
    else:
        raise AssertionError("no rows should raise, not return an empty reading")


def test_rows_with_no_measure_this_understands_are_an_error() -> None:
    try:
        fetch([row("2026-06", "Trains", 1)])
    except RuntimeError as exc:
        assert "CROSSING_MEASURES" in str(exc), exc
    else:
        raise AssertionError("a whole answer of unknown measures should raise")


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
