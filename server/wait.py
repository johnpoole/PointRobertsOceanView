"""US Customs: the queue at the line, now.

CBP publishes what every land crossing is doing as open JSON. The monthly counts
in crossings.py say how many came through last year. This says whether there is
anybody in the lane at this minute, which is the thing the page opens looking
at.

The port is filed under Blaine with the crossing named Point Roberts. Three
passenger lanes, one commercial, twenty-four hours. CBP leaves a lane as Update
Pending when it has nothing to report, and for a crossing this quiet that is
most of the time, which is itself the reading.
"""

from __future__ import annotations

from datetime import datetime, timezone

import httpx

from server.when import PENINSULA, utcnow


WAIT_URL = "https://bwt.cbp.gov/api/waittimes"
WAIT_PORT_NUMBER = "300403"


# What CBP calls a lane, and what this calls it. Everything else in their
# record is a lane type this port does not have.
WAIT_LANES = {
    "passenger_vehicle_lanes": "cars",
    "commercial_vehicle_lanes": "trucks",
    "pedestrian_lanes": "on_foot",
}


def wait_lane(block: dict | None) -> dict | None:
    """One lane, or None when CBP has nothing posted for it.

    Their empty state is the string "Update Pending" with the delay and the
    lane count left blank, which is not a delay of zero and must not be read as
    one. A quiet crossing is quiet, not fast.
    """
    if not block:
        return None
    status = (block.get("operational_status") or "").strip()
    if not status or status == "Update Pending":
        return None
    delay = (block.get("delay_minutes") or "").strip()
    lanes = (block.get("lanes_open") or "").strip()
    return {
        "status": status,
        "delay_minutes": int(delay) if delay.isdigit() else None,
        "lanes_open": int(lanes) if lanes.isdigit() else None,
        "update_time": (block.get("update_time") or "").strip() or None,
    }


async def fetch_wait(client: httpx.AsyncClient) -> dict:
    rows = await client.get(WAIT_URL, headers={"Accept": "application/json"})
    rows.raise_for_status()
    ports = rows.json()
    port = next((p for p in ports
                 if str(p.get("port_number")) == WAIT_PORT_NUMBER), None)
    if port is None:
        raise RuntimeError(
            f"CBP listed {len(ports)} crossings and none of them is port "
            f"{WAIT_PORT_NUMBER}. Either the port number has changed or the "
            f"feed behind {WAIT_URL} has. Their crossing is filed under Blaine "
            "with the crossing name Point Roberts.")

    lanes: dict[str, dict] = {}
    for key, name in WAIT_LANES.items():
        block = port.get(key) or {}
        kinds = {}
        for sub, label in (("standard_lanes", "standard"),
                           ("NEXUS_SENTRI_lanes", "nexus"),
                           ("ready_lanes", "ready"),
                           ("FAST_lanes", "fast")):
            got = wait_lane(block.get(sub))
            if got:
                kinds[label] = got
        maximum = (block.get("maximum_lanes") or "").strip()
        lanes[name] = {
            "maximum_lanes": int(maximum) if maximum.isdigit() else None,
            # Empty when CBP is posting nothing for this crossing, which for one
            # this quiet is most of the day.
            "reported": kinds,
        }

    # CBP stamps each port with its own local date and time.
    when = utcnow()
    try:
        stamped = datetime.strptime(f"{port['date']} {port['time']}",
                                    "%m/%d/%Y %H:%M:%S")
        when = stamped.replace(tzinfo=PENINSULA).astimezone(timezone.utc)
    except (KeyError, ValueError):
        pass

    return {
        "state": {
            "port_number": WAIT_PORT_NUMBER,
            "port_name": port.get("port_name"),
            "crossing_name": port.get("crossing_name"),
            "port_status": port.get("port_status"),
            "hours": port.get("hours"),
            "construction_notice": (port.get("construction_notice") or "").strip()
                                   or None,
            "lanes": lanes,
        },
        "time": when,
    }
