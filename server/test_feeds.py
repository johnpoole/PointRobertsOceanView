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

import asyncio
import logging
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import proxy  # noqa: E402
from server import wait as wait_feed  # noqa: E402

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
    "desc": "BOEING 737 MAX 8", "ownOp": "WestJet", "year": "2018",
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
    # What the feed knows about the airframe, not just about the flight.
    assert state["model"] == "BOEING 737 MAX 8"
    assert state["operator"] == "WestJet"
    assert state["built"] == "2018"
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


def test_a_feed_that_answers_without_a_list_is_an_error() -> None:
    """An empty sky and a feed that has changed shape must not look the same.
    The old one answered 200 with no error and nothing in it for a whole day."""
    assert proxy.aircraft_records({"aircraft": []}) == []
    assert proxy.aircraft_records({"aircraft": [FULL]}) == [FULL]
    try:
        proxy.aircraft_records({"ac": [], "msg": "No error"})
    except KeyError as exc:
        assert "aircraft" in str(exc)
    else:
        raise AssertionError("a payload with no aircraft list came back as no aircraft")


def test_an_aircraft_with_no_position_is_not_placed() -> None:
    assert proxy.aircraft_state({"hex": "abc123", "alt_baro": 3000}) is None


# ---- adsbdb, what the airframe is and where the flight is between ------------
# Both payloads are their answers, cut down to the fields that are read.

ADSBDB_AIRCRAFT = {
    "type": "A321 212", "icao_type": "A321", "manufacturer": "Airbus",
    "mode_s": "C010EA", "registration": "C-FGKN",
    "registered_owner_country_iso_name": "CA",
    "registered_owner_country_name": "Canada",
    "registered_owner_operator_flag_code": "ACA",
    "registered_owner": "Air Canada", "url_photo": None,
}

ADSBDB_ROUTE = {
    "callsign": "KFA574", "callsign_iata": "KW574",
    "airline": {"name": "Kelowna Flightcraft Air Charter", "icao": "KFA"},
    "origin": {"iata_code": "YYJ", "icao_code": "CYYJ", "municipality": "Victoria",
               "name": "Victoria International Airport"},
    "destination": {"iata_code": "YVR", "icao_code": "CYVR", "municipality": "Vancouver",
                    "name": "Vancouver International Airport"},
}


def test_the_airframe_reads_off_adsbdb() -> None:
    assert proxy.registry_fields(ADSBDB_AIRCRAFT) == {
        "registration": "C-FGKN",
        "model": "A321 212",
        "manufacturer": "Airbus",
        "operator": "Air Canada",
        "operator_country": "Canada",
    }


def test_an_airframe_they_do_not_know_gives_nothing() -> None:
    assert proxy.registry_fields({}) == {}


def test_the_route_reads_off_adsbdb() -> None:
    assert proxy.route_fields(ADSBDB_ROUTE) == {
        "airline": "Kelowna Flightcraft Air Charter",
        "origin": "Victoria International Airport (CYYJ)",
        "destination": "Vancouver International Airport (CYVR)",
    }


def test_an_airport_with_no_name_still_gives_its_code() -> None:
    fields = proxy.route_fields({"origin": {"icao_code": "CYXX"}})
    assert fields["origin"] == "CYXX"
    assert "destination" not in fields


# ---- BC Ferries, which sailing a boat is on ---------------------------------

FERRIES = {"routes": [
    {"routeCode": "SWBTSA", "fromTerminalCode": "SWB", "toTerminalCode": "TSA",
     "sailings": [
         {"time": "5:59 am", "arrivalTime": "7:34 am", "sailingStatus": "current",
          "fill": 0, "vesselName": "Coastal Celebration", "vesselStatus": ""},
         {"time": "9:00 am", "arrivalTime": "", "sailingStatus": "future",
          "fill": 54, "vesselName": "Coastal Celebration", "vesselStatus": ""},
         {"time": "4:00 am", "arrivalTime": "5:35 am", "sailingStatus": "past",
          "fill": 0, "vesselName": "Queen of Alberni", "vesselStatus": ""},
     ]},
    {"routeCode": "TSASGI", "fromTerminalCode": "TSA", "toTerminalCode": "SGI",
     "sailings": [
         {"time": "9:10 am", "arrivalTime": "", "sailingStatus": "future",
          "fill": 76, "vesselName": "Salish Heron", "vesselStatus": ""},
         {"time": "", "arrivalTime": "", "sailingStatus": "", "fill": 0,
          "vesselName": "", "vesselStatus": ""},
     ]},
    {"routeCode": "XXXYYY", "fromTerminalCode": "XXX", "toTerminalCode": "YYY",
     "sailings": [
         {"time": "8:00 am", "arrivalTime": "", "sailingStatus": "future",
          "fill": 0, "vesselName": "Queen of Nowhere", "vesselStatus": ""},
     ]},
]}


def test_the_sailing_a_boat_is_on() -> None:
    sailings = proxy.ferry_sailings(FERRIES)
    # Under way beats the one it has not left on yet.
    assert sailings["COASTAL CELEBRATION"] == {
        "ferry_route": "Swartz Bay to Tsawwassen",
        "ferry_status": "under way",
        "ferry_departure": "5:59 am",
        "ferry_arrival": "7:34 am",
    }
    assert sailings["SALISH HERON"] == {
        "ferry_route": "Tsawwassen to Southern Gulf Islands",
        "ferry_status": "at the berth",
        "ferry_departure": "9:10 am",
        "ferry_fill_percent": 76,
    }
    # A crossing that has already arrived is nobody's sailing, and neither is a
    # blank row.
    assert "QUEEN OF ALBERNI" not in sailings
    assert "" not in sailings


def test_a_terminal_nobody_has_written_down_shows_as_its_code() -> None:
    assert proxy.ferry_sailings(FERRIES)["QUEEN OF NOWHERE"]["ferry_route"] == "XXX to YYY"


def test_the_sailing_goes_on_the_ship_and_comes_off_again() -> None:
    sailings = proxy.ferry_sailings(FERRIES)
    state = {"mmsi": "316001234", "name": "Coastal Celebration"}
    proxy.apply_ferry(state, sailings)
    assert state["ferry_route"] == "Swartz Bay to Tsawwassen"
    assert state["also_from"] == "bcferriesapi.ca"
    # Off the board, off the ship. Yesterday's crossing must not stay on it.
    proxy.apply_ferry(state, {})
    for field in proxy.FERRY_FIELDS:
        assert field not in state
    assert "also_from" not in state


def test_a_ship_that_is_not_a_ferry_is_left_alone() -> None:
    state = {"mmsi": "1", "name": "OOCL OAKLAND"}
    proxy.apply_ferry(state, proxy.ferry_sailings(FERRIES))
    assert state == {"mmsi": "1", "name": "OOCL OAKLAND"}


# ---- ships and aircraft that have gone --------------------------------------


def _stock(seconds_ago: dict, positionless: list[str]) -> tuple[dict, dict]:
    """A fleet in a record: each track last heard from so many seconds back, and
    the positionless ones with no fix at all. Returns the store and the times,
    to hand to reap."""
    now = proxy.utcnow()
    store: dict = {}
    seen: dict = {}
    for key, age in seconds_ago.items():
        store[key] = {"latitude": 49.0, "longitude": -123.0}
        seen[key] = now - timedelta(seconds=age)
    for key in positionless:
        store[key] = {"name": "NO FIX"}
    return store, seen


def test_a_ship_that_has_gone_quiet_comes_off_the_water() -> None:
    store, seen = _stock({"live": 60, "greying": 400, "gone": 1200}, [])
    assert sorted(proxy.reap(store, seen, proxy.DROP_SECONDS["vessels"])) == ["gone"]
    assert sorted(store) == ["greying", "live"]
    assert "gone" not in seen


def test_a_ship_that_never_gave_a_position_comes_off_too() -> None:
    """AIS message 5 names a ship and says nothing about where it is."""
    store, seen = _stock({"live": 60}, ["named_only"])
    assert proxy.reap(store, seen, proxy.DROP_SECONDS["vessels"]) == ["named_only"]
    assert sorted(store) == ["live"]


def test_a_scraped_ship_survives_the_gap_between_two_passes() -> None:
    """A ship seen on the last shipfinder pass must still be there when the next
    one comes round."""
    store, seen = _stock({"scraped": proxy.SHIPFINDER_PERIOD_SECONDS}, [])
    assert proxy.reap(store, seen, proxy.DROP_SECONDS["vessels"]) == []
    assert sorted(store) == ["scraped"]


def test_an_aircraft_that_has_flown_out_of_range_comes_off() -> None:
    store, seen = _stock({"here": 30, "greying": 200, "gone": 400}, [])
    assert proxy.reap(store, seen, proxy.DROP_SECONDS["aircraft"]) == ["gone"]
    assert sorted(store) == ["greying", "here"]


def test_a_track_greys_before_it_goes() -> None:
    """The page dims a track at the stale threshold and the server takes it off
    at the drop. Equal thresholds would take it off the moment it dimmed."""
    for kind in ("vessels", "aircraft"):
        assert proxy.DROP_SECONDS[kind] > proxy.STALE_SECONDS[kind], kind


# ---- health that is written down but never sent -----------------------------
#
# provider_health rides in the snapshot and nowhere else, so a provider that
# stopped answering was recorded on the server, logged, and never mentioned
# again: a page already open went on reading "live" over the last good numbers.
# Nothing on screen looked wrong, which is why this is a test. Issue #65.


def _collect_broadcasts():
    """Swap clients.broadcast for a recorder. Returns (sent, restore)."""
    sent: list[dict] = []

    async def record(message: dict) -> None:
        sent.append(message)

    original = proxy.clients.broadcast
    proxy.clients.broadcast = record
    return sent, (lambda: setattr(proxy.clients, "broadcast", original))


def test_a_provider_going_offline_is_broadcast() -> None:
    sent, restore = _collect_broadcasts()
    try:
        proxy.world.health["weather"] = "live"
        asyncio.run(proxy.set_health("weather", "offline"))
        assert proxy.world.health["weather"] == "offline"
        assert len(sent) == 1, f"expected one broadcast, got {len(sent)}"
        assert sent[0]["message_type"] == "initial.snapshot"
        assert sent[0]["data"]["provider_health"]["weather"] == "offline"
    finally:
        restore()


def test_a_provider_coming_back_is_broadcast() -> None:
    sent, restore = _collect_broadcasts()
    try:
        proxy.world.health["tide"] = "offline"
        asyncio.run(proxy.set_health("tide", "live"))
        assert sent and sent[0]["data"]["provider_health"]["tide"] == "live"
    finally:
        restore()


def test_health_that_has_not_changed_sends_nothing() -> None:
    """A provider answering normally writes the same value every poll. That must
    not put a snapshot on the wire each time."""
    sent, restore = _collect_broadcasts()
    try:
        proxy.world.health["currents"] = "live"
        for _ in range(5):
            asyncio.run(proxy.set_health("currents", "live"))
        assert sent == [], f"expected no broadcast, got {len(sent)}"
    finally:
        restore()


def test_every_polled_provider_can_be_condemned_by_age() -> None:
    """The weather, tide and current envelopes carried no stale threshold, so
    quality.stale was computed as False whatever the age and no reading could be
    called old on its own."""
    for feed in ("weather", "tide", "currents"):
        assert proxy.STALE_SECONDS.get(feed), f"{feed} has no stale threshold"


def test_a_reading_older_than_its_threshold_is_flagged() -> None:
    for feed, message_type in (("weather", "weather.state"),
                               ("tide", "tide.state"),
                               ("currents", "current.state")):
        limit = proxy.STALE_SECONDS.get(feed)
        assert limit, f"{feed} has no stale threshold"
        fresh = proxy.envelope(message_type, "test",
                               proxy.utcnow() - timedelta(seconds=limit - 60),
                               {}, limit)
        old = proxy.envelope(message_type, "test",
                             proxy.utcnow() - timedelta(seconds=limit + 60),
                             {}, limit)
        assert fresh["quality"]["stale"] is False, feed
        assert old["quality"]["stale"] is True, feed


def test_the_snapshot_carries_the_thresholds_too() -> None:
    """A page that joins mid-flight reads the same envelopes out of the snapshot,
    so a threshold set only on the live broadcast would leave it unable to judge
    what it was handed on arrival."""
    limit = proxy.STALE_SECONDS.get("weather")
    assert limit, "weather has no stale threshold"
    proxy.world.weather = {"description": "test"}
    proxy.world.weather_time = proxy.utcnow() - timedelta(seconds=limit + 60)
    snap = proxy.snapshot()
    assert snap["data"]["weather"]["quality"]["stale"] is True


# ---- the queue at the line --------------------------------------------------
#
# CBP posts a lane as "Update Pending" with the delay blank when it has nothing
# to say. That is not a delay of zero, and a quiet crossing must not read as a
# fast one. These are their records, shortened.

WAIT_PORT = {
    "port_number": "300403",
    "border": "Canadian Border",
    "port_name": "Blaine",
    "crossing_name": "Point Roberts",
    "hours": "24 hrs/day",
    "date": "9/12/2026",
    "time": "08:07:16",
    "port_status": "Open",
    "commercial_vehicle_lanes": {
        "maximum_lanes": "1",
        "standard_lanes": {"update_time": "", "operational_status": "Update Pending",
                           "delay_minutes": "", "lanes_open": ""},
        "FAST_lanes": {"update_time": "", "operational_status": "Update Pending",
                       "delay_minutes": "", "lanes_open": ""},
    },
    "passenger_vehicle_lanes": {
        "maximum_lanes": "3",
        "standard_lanes": {"update_time": "8:00 am", "operational_status": "delay",
                           "delay_minutes": "15", "lanes_open": "2"},
        "NEXUS_SENTRI_lanes": {"update_time": "", "operational_status": "Update Pending",
                               "delay_minutes": "", "lanes_open": ""},
        "ready_lanes": {"update_time": "", "operational_status": "Update Pending",
                        "delay_minutes": "", "lanes_open": ""},
    },
    "pedestrian_lanes": {
        "maximum_lanes": "N/A",
        "standard_lanes": {"update_time": "", "operational_status": "Update Pending",
                           "delay_minutes": "", "lanes_open": ""},
        "ready_lanes": {"update_time": "", "operational_status": "Update Pending",
                        "delay_minutes": "", "lanes_open": ""},
    },
    "construction_notice": "",
}


class _Answer:
    def __init__(self, body):
        self._body = body

    def raise_for_status(self):
        return None

    def json(self):
        return self._body


class _Client:
    def __init__(self, body):
        self._body = body

    async def get(self, url, **kw):
        return _Answer(self._body)


def _wait(body):
    return asyncio.new_event_loop().run_until_complete(
        wait_feed.fetch_wait(_Client(body)))


def test_a_posted_lane_carries_its_delay_and_how_many_are_open() -> None:
    state = _wait([WAIT_PORT])["state"]
    cars = state["lanes"]["cars"]["reported"]["standard"]
    assert cars["delay_minutes"] == 15, cars
    assert cars["lanes_open"] == 2, cars
    assert cars["status"] == "delay", cars


def test_nothing_posted_is_not_a_delay_of_zero() -> None:
    state = _wait([WAIT_PORT])["state"]
    # Their NEXUS lane, the trucks and the footpath are all Update Pending.
    assert "nexus" not in state["lanes"]["cars"]["reported"]
    assert state["lanes"]["trucks"]["reported"] == {}
    assert state["lanes"]["on_foot"]["reported"] == {}


def test_the_lane_count_the_crossing_has_is_kept() -> None:
    state = _wait([WAIT_PORT])["state"]
    assert state["lanes"]["cars"]["maximum_lanes"] == 3
    assert state["lanes"]["trucks"]["maximum_lanes"] == 1
    # N/A is not a number of lanes.
    assert state["lanes"]["on_foot"]["maximum_lanes"] is None


def test_the_stamp_is_read_as_the_peninsula_s_own_clock() -> None:
    when = _wait([WAIT_PORT])["time"]
    # 08:07 on the point is 15:07 UTC in September.
    assert when.hour == 15 and when.minute == 7, when


def test_a_feed_without_our_port_is_an_error() -> None:
    other = dict(WAIT_PORT, port_number="070801", crossing_name="Thousand Islands")
    try:
        _wait([other])
    except RuntimeError as exc:
        assert "300403" in str(exc), exc
    else:
        raise AssertionError("a feed with no Point Roberts in it passed silently")


# ---- what nobody else keeps -------------------------------------------------

def _archive():
    import tempfile
    from pathlib import Path
    from server.archive import Archive
    return Archive(Path(tempfile.mkdtemp()) / "archive")


def test_a_reading_is_written_once_and_not_again() -> None:
    a = _archive()
    assert a.keep("wait", {"port_status": "Open"}) is True
    assert a.keep("wait", {"port_status": "Open"}) is False,         "the same reading was written twice"
    assert a.keep("wait", {"port_status": "Closed"}) is True


def test_a_feed_with_a_history_elsewhere_is_refused() -> None:
    a = _archive()
    # The crossings are kept on purpose — their server is not our copy — so
    # these are the ones that genuinely have a history elsewhere.
    for feed in ("weather", "tide", "currents", "vessels", "blotter"):
        try:
            a.keep(feed, {})
        except ValueError:
            pass
        else:
            raise AssertionError(f"{feed} was archived and it has a history already")


def test_every_reading_carries_the_second_it_was_taken() -> None:
    import json
    from datetime import datetime, timezone
    a = _archive()
    when = datetime(2026, 2, 12, 16, 12, 0, tzinfo=timezone.utc)
    a.keep("marina", {"boats": 3}, when)
    day = next((a.root / "marina").glob("*.jsonl"))
    line = json.loads(day.read_text(encoding="utf-8").splitlines()[0])
    assert line["t"] == "2026-02-12T16:12:00Z", line
    assert line["d"] == {"boats": 3}, line


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
