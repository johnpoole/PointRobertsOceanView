"""The Bureau of Transportation Statistics: how many came through the booth.

Point Roberts can only be reached by driving through Canada, so its trade is
Canadians coming down for fuel, parcels, the marina and a meal. Every one of
them is counted at the crossing, which makes the count the closest thing there
is to a measure of what the place is doing.

US Customs hands the figures to BTS about once a quarter and BTS publishes them
by port and by month, back to 1994. So this is monthly and runs a month or two
behind. It is not live and must never be dressed as live: the month it belongs
to travels with it.
"""

from __future__ import annotations

from datetime import datetime, timezone

import httpx


CROSSINGS_URL = "https://data.bts.gov/resource/keg4-3bc2.json"
CROSSINGS_PORT_CODE = "3017"          # Point Roberts, Washington
CROSSINGS_MONTHS = 24


# BTS publishes one row per port, month and measure. Fold them into a month.
CROSSING_MEASURES = {
    "Personal Vehicles": "personal_vehicles",
    "Personal Vehicle Passengers": "personal_vehicle_passengers",
    "Trucks": "trucks",
    "Truck Containers Full": "truck_containers_full",
    "Truck Containers Empty": "truck_containers_empty",
    "Buses": "buses",
    "Bus Passengers": "bus_passengers",
    "Pedestrians": "pedestrians",
}


async def fetch_crossings(client: httpx.AsyncClient) -> dict:
    rows = await client.get(CROSSINGS_URL, params={
        "$where": f"port_code='{CROSSINGS_PORT_CODE}'",
        "$order": "date DESC",
        # Eight measures a month, so ask for enough rows to fill the months.
        "$limit": CROSSINGS_MONTHS * len(CROSSING_MEASURES),
    })
    rows.raise_for_status()
    data = rows.json()
    if not data:
        raise RuntimeError(
            f"BTS returned no rows for port_code {CROSSINGS_PORT_CODE}. Either the "
            f"port code has changed or the dataset behind {CROSSINGS_URL} has "
            "moved; check https://www.bts.gov/border-crossing-entry-data.")

    months: dict[str, dict] = {}
    for row in data:
        month = row["date"][:7]
        key = CROSSING_MEASURES.get(row.get("measure"))
        if key is None:
            continue                        # a measure this port does not carry
        months.setdefault(month, {"month": month})[key] = int(row["value"])
    if not months:
        raise RuntimeError(
            "BTS rows carried no measure this understands. Their names are in "
            f"CROSSING_MEASURES; the rows said {sorted({r.get('measure') for r in data})}.")

    # This port does not file every measure every month, so the row budget
    # stretches further than the months asked for. Cut it back to what was asked.
    ordered = [months[m] for m in sorted(months, reverse=True)][:CROSSINGS_MONTHS]
    latest = ordered[0]
    # The month is the reading's own date. It is a month or two behind today and
    # saying so is the point of carrying it.
    when = datetime.strptime(latest["month"], "%Y-%m").replace(tzinfo=timezone.utc)
    return {
        "state": {
            "port_name": data[0].get("port_name"),
            "port_code": CROSSINGS_PORT_CODE,
            "border": data[0].get("border"),
            "month": latest["month"],
            **{k: latest.get(k) for k in CROSSING_MEASURES.values()},
            "recent_months": ordered,
        },
        "time": when,
    }
