"""NOAA CO-OPS: the water level at the beach and the stream off the bluff.

Two feeds off one API. The tide is Point Roberts' own prediction with the surge
measured at Cherry Point carried onto it, because the station in the view has no
gauge. The current is a prediction for a point four and a half miles offshore,
which is the nearest published station there is.

The loops that poll these live in proxy.py. What is here is the call, the
arithmetic, and the reasons for both.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import httpx

from server.when import parse_time, utcnow


# Point Roberts (9449639) is a reference station with its own harmonics, but it
# has no gauge — predictions only. Cherry Point (9449424) has the nearest live
# gauge, 27 km southeast, where the tide runs about 0.1 m lower and arrives at a
# different time. So take the non-tidal residual measured at Cherry Point, which
# is weather-driven surge and stays coherent over that distance, and carry it
# onto Point Roberts' own prediction:
#
#   level = predicted_PR(t) + (observed_CP(t) - predicted_CP(t))
#
# That keeps the live surge and puts the astronomical tide where the view is.
TIDE_GAUGE_STATION = "9449424"    # Cherry Point, observed water level
TIDE_STATION = "9449639"          # Point Roberts, predictions
TIDE_DATUM = "MLLW"
COOPS_BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"


# The tidal stream, from the nearest current station: PUG1726, "Strait of
# Georgia, 4.5 nm SW of Point Roberts", 8.1 km off the bluff. That is the water
# in the view, which is as close as a published station gets.
#
# The station has 36 bins two metres apart and publishes predictions for three of
# them. Bin 35 sits 9.4 m down and is the shallowest of the three, so it is the
# one a boat is in. Bin 11 is 57 m down and is what the API hands back when no
# bin is named, which would be the current well under the keel.
#
# Velocity_Major is signed along the channel: positive runs toward meanFloodDir,
# negative toward meanEbbDir. In metric units it is centimetres a second.
#
# This is one point eight kilometres offshore, and the stream along the West
# Bluff is not the stream out there. See issue #13.
CURRENT_STATION = "PUG1726"
CURRENT_BIN = 35
CURRENT_STATION_KM = 8.1          # from the bluff, for the readout to own up to
# Predictions for a whole day arrive in one call and do not change, so the day is
# held and interpolated locally. Refetched when the held day runs out.
CURRENT_FETCH_DAYS = 2
CURRENT_SLACK_MPS = 0.05          # under this it is slack and has no direction
CM_PER_S_TO_M_PER_S = 0.01
KNOT_MPS = 0.514444


async def coops(client: httpx.AsyncClient, station: str,
                datum: str | None = TIDE_DATUM, **params) -> dict:
    """One CO-OPS call. NOAA reports failures in a 200 body, so check for them.

    A current prediction is a speed and has no datum, so it passes datum=None and
    the parameter is left off the query rather than sent empty."""
    query = {
        "application": "PointRobertsOceanView",
        "station": station,
        "time_zone": "gmt",
        "units": "metric",
        "format": "json",
        **params,
    }
    if datum:
        query["datum"] = datum
    response = await client.get(COOPS_BASE, params=query)
    response.raise_for_status()
    payload = response.json()
    if "error" in payload:
        raise RuntimeError(
            f"NOAA CO-OPS station {station} product={params.get('product')}: "
            f"{payload['error'].get('message')}"
        )
    return payload


def series_block(slots: dict[str, float], step_s: int) -> dict:
    """A 6-minute prediction dict, as an evenly stepped run the browser can index.

    NOAA hands back {"2026-08-11 13:54": 2.31, ...} in the station's own local
    time. The gaps have to be even for an index to work, so this checks that they
    are rather than trusting it: a missing slot would silently shift every value
    after it by six minutes.
    """
    keys = sorted(slots)
    if len(keys) < 2:
        raise RuntimeError(
            f"a prediction series needs at least two slots and this has {len(keys)}")
    start = datetime.strptime(keys[0], "%Y-%m-%d %H:%M")
    values = []
    for i, key in enumerate(keys):
        when = datetime.strptime(key, "%Y-%m-%d %H:%M")
        want = start + timedelta(seconds=step_s * i)
        if when != want:
            raise RuntimeError(
                f"prediction series has a gap: slot {i} is {key} and an even "
                f"{step_s} s step wants {want:%Y-%m-%d %H:%M}. Indexing it would "
                f"put every value after this one at the wrong time.")
        values.append(round(slots[key], 3))
    return {"start": keys[0] + "Z", "step_s": step_s, "values": values}


async def fetch_tide(client: httpx.AsyncClient) -> dict:
    """Point Roberts water level: its own prediction plus the surge measured at
    Cherry Point. See the TIDE_STATION comment for why."""
    observed = (await coops(client, TIDE_GAUGE_STATION,
                            product="water_level", date="latest"))["data"][0]
    observed_at = parse_time(observed["t"])
    if observed_at is None:
        raise RuntimeError(f"NOAA water_level: unparsable timestamp {observed['t']!r}")
    observed_m = float(observed["v"])

    # 6-minute predictions for both stations over the gauge reading's day, so the
    # residual and the Point Roberts level are read at the same instant.
    day = observed_at.strftime("%Y%m%d")
    series = {}
    for station in (TIDE_GAUGE_STATION, TIDE_STATION):
        rows = (await coops(client, station, product="predictions",
                            begin_date=day, range=48, interval="6"))["predictions"]
        series[station] = {row["t"]: float(row["v"]) for row in rows}

    # The surge is read at the gauge's timestamp, which runs about ten minutes
    # behind. The astronomical tide is read at now. Surge is weather and drifts
    # over hours; the tide moves up to a metre an hour here, so reading it ten
    # minutes late puts the waterline metres down the beach.
    now = utcnow()
    surge_slot = observed["t"]
    level_slot = now.replace(
        minute=now.minute - now.minute % 6, second=0, microsecond=0
    ).strftime("%Y-%m-%d %H:%M")
    for slot, station in ((surge_slot, TIDE_GAUGE_STATION), (level_slot, TIDE_STATION)):
        if slot not in series[station]:
            raise RuntimeError(
                f"NOAA predictions for station {station} have no 6-minute slot "
                f"at {slot}; cannot transfer the surge"
            )
    surge_m = observed_m - series[TIDE_GAUGE_STATION][surge_slot]
    level_m = series[TIDE_STATION][level_slot] + surge_m
    extremes = (await coops(client, TIDE_STATION, product="predictions",
                            begin_date=now.strftime("%Y%m%d"), range=48,
                            interval="hilo"))["predictions"]
    trend = None
    prediction_m = None
    for ext in extremes:
        when = parse_time(ext["t"])
        if when and when > now:
            trend = "rising" if ext["type"] == "H" else "falling"
            prediction_m = float(ext["v"])
            break

    return {
        "state": {
            "station_id": TIDE_STATION,
            "water_level_m": level_m,
            "prediction_m": prediction_m,
            "datum": TIDE_DATUM,
            "trend": trend,
            "surge_m": surge_m,
            "gauge_station_id": TIDE_GAUGE_STATION,
            # The whole prediction, so a page standing at another hour can read
            # the water there. Astronomical only: the surge is a measurement made
            # ten minutes ago and it is weather, so carrying it six hours out
            # would be inventing. A page off the present hour shows this and says
            # it is a prediction.
            "series": series_block(series[TIDE_STATION], 360),
        },
        "time": observed_at,
    }


async def fetch_current_series(client: httpx.AsyncClient, start: datetime) -> list[tuple]:
    """The station's predicted stream over the next couple of days, as
    (time, centimetres a second, flood bearing, ebb bearing, bin depth)."""
    rows = (await coops(
        client, CURRENT_STATION, datum=None, product="currents_predictions",
        bin=CURRENT_BIN, begin_date=start.strftime("%Y%m%d"),
        range=24 * CURRENT_FETCH_DAYS, interval="30",
    ))["current_predictions"]["cp"]
    series = []
    for row in rows:
        when = parse_time(row["Time"])
        if when is None:
            raise RuntimeError(
                f"NOAA currents_predictions station {CURRENT_STATION} bin "
                f"{CURRENT_BIN}: unparsable timestamp {row['Time']!r}"
            )
        series.append((
            when,
            float(row["Velocity_Major"]),
            float(row["meanFloodDir"]),
            float(row["meanEbbDir"]),
            float(row["Depth"]),
        ))
    if not series:
        raise RuntimeError(
            f"NOAA currents_predictions station {CURRENT_STATION} bin "
            f"{CURRENT_BIN} returned no rows for {start:%Y-%m-%d}"
        )
    series.sort(key=lambda r: r[0])
    return series


def current_at(series: list[tuple], when: datetime) -> dict:
    """Straight-line interpolation between the half-hourly predictions. Returns
    the set — the bearing the water is going — and the drift."""
    if when < series[0][0] or when > series[-1][0]:
        raise RuntimeError(
            f"NOAA currents_predictions for {CURRENT_STATION} cover "
            f"{series[0][0]:%Y-%m-%d %H:%M} to {series[-1][0]:%Y-%m-%d %H:%M} "
            f"and {when:%Y-%m-%d %H:%M} is outside that. Refetch the series."
        )
    later = next(i for i, row in enumerate(series) if row[0] >= when)
    if later == 0:
        row, span = series[0], 0.0
        velocity = row[1]
    else:
        before, after = series[later - 1], series[later]
        span = (after[0] - before[0]).total_seconds()
        t = 0.0 if span == 0 else (when - before[0]).total_seconds() / span
        velocity = before[1] + (after[1] - before[1]) * t
        row = before

    _, _, flood_dir, ebb_dir, depth_m = row
    speed = abs(velocity) * CM_PER_S_TO_M_PER_S
    if speed < CURRENT_SLACK_MPS:
        state, set_deg = "slack", None
    elif velocity >= 0:
        state, set_deg = "flooding", flood_dir
    else:
        state, set_deg = "ebbing", ebb_dir
    return {
        "station_id": CURRENT_STATION,
        "bin": CURRENT_BIN,
        "bin_depth_m": depth_m,
        "station_distance_km": CURRENT_STATION_KM,
        "set_degrees": set_deg,
        "drift_mps": round(speed, 3),
        "drift_kn": round(speed / KNOT_MPS, 2),
        "state": state,
        "flood_direction_deg": flood_dir,
        "ebb_direction_deg": ebb_dir,
        # This is a prediction for one point offshore, not a measurement of the
        # water the boat is in. Anything showing it has to say so.
        "kind": "prediction",
    }
