"""Who is out on the golf course, from the club's own booking sheet.

The club books through foreUP and foreUP answers a plain JSON request with every
slot still open, each with how many of its four spots are left. What is booked is
what is missing: a slot absent from the ten-minute grid is four players out, and
a slot showing one spot left is three.

Two things this cannot know, and neither is papered over:

A gap is not proof of golfers. A block held for a tournament, a maintenance
window or a shotgun start looks exactly like a foursome from here, and there is
no field that separates them. Everything out of this module is labelled as
booked rather than as people.

The sheet only lists times from now forward. To know who is on the course at
eleven you need what was booked at half past seven, and by eleven those slots
are gone from it. So this samples while somebody is looking and remembers what
it saw; a server that has just started knows nothing about this morning and says
so rather than reporting an empty course.

Pace of play is John's figure: fifteen minutes a hole, so a group that went off
at T is on hole (now - T) / 15 + 1 and is done four and a half hours later.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta

log = logging.getLogger("oceanview.tee")

COURSE = "Point Roberts Golf & Country Club"
SOURCE = "pointrobertsgc.com booking sheet (foreUP)"
URL = ("https://foreupsoftware.com/index.php/api/booking/times"
       "?time=all&date={date}&holes=all&players=0"
       "&schedule_id=2544&schedule_ids%5B%5D=2544&specials_only=0&api_key=no_limits")

# John's figure, and the whole of the pace model.
MINUTES_PER_HOLE = 15.0
HOLES = 18
ROUND_MINUTES = MINUTES_PER_HOLE * HOLES

# A slot holds four.
FULL = 4

# The sheet is a ten-minute grid. Used to tell a booked slot from no slot at all.
GRID_MINUTES = 10


@dataclass
class Sheet:
    """What has been seen of one day's sheet, and when it was seen.

    booked maps a tee time to how many of its four spots were taken the last
    time this looked. seen_from is the earliest time this module has had a look
    at; anything before it is unknown rather than empty.
    """
    day: str
    booked: dict[datetime, int] = field(default_factory=dict)
    seen_from: datetime | None = None
    open_until: datetime | None = None

    def read(self, slots: list[dict], now: datetime) -> None:
        """Fold one answer from the sheet into what is already known."""
        times = {}
        for slot in slots:
            try:
                at = datetime.strptime(slot["time"], "%Y-%m-%d %H:%M")
                spots = int(slot.get("available_spots", FULL))
            except (KeyError, TypeError, ValueError):
                continue
            # The same minute comes back once per booking class; the most
            # generous of them is what is actually left.
            times[at] = max(times.get(at, 0), min(spots, FULL))
        if not times:
            return
        first, last = min(times), max(times)
        self.open_until = last if self.open_until is None else max(self.open_until, last)
        # The first look of the day is the earliest this can speak for. It never
        # moves later: what has been seen stays seen.
        if self.seen_from is None:
            self.seen_from = now
        # Every slot the grid should hold between the first and last on offer.
        step = timedelta(minutes=GRID_MINUTES)
        at = first
        while at <= last:
            if at in times:
                self.booked[at] = FULL - times[at]
            elif at >= now:
                # On the grid, in the future, and not offered: taken or held.
                self.booked[at] = FULL
            at += step

    def out_now(self, now: datetime) -> list[dict]:
        """The groups still on the course, and which hole each is on."""
        groups = []
        for at, players in sorted(self.booked.items()):
            if players <= 0 or at > now:
                continue
            minutes = (now - at).total_seconds() / 60
            if minutes >= ROUND_MINUTES:
                continue
            hole = int(minutes // MINUTES_PER_HOLE) + 1
            groups.append({
                "tee": at.strftime("%H:%M"),
                "players": players,
                "hole": min(hole, HOLES),
                # How far through that hole they are, 0 to 1.
                "through": round((minutes % MINUTES_PER_HOLE) / MINUTES_PER_HOLE, 3),
                "minutes_out": round(minutes, 1),
            })
        return groups

    def as_data(self, now: datetime) -> dict:
        groups = self.out_now(now)
        return {
            "course": COURSE,
            "groups": groups,
            "players": sum(g["players"] for g in groups),
            "minutes_per_hole": MINUTES_PER_HOLE,
            # Everything before this was never looked at, so an empty morning
            # here means unwatched, not empty.
            "known_from": self.seen_from.strftime("%H:%M") if self.seen_from else None,
            "sheet_until": self.open_until.strftime("%H:%M") if self.open_until else None,
            "booked_slots": sum(1 for v in self.booked.values() if v > 0),
        }


async def sample(client, sheet: Sheet, now: datetime) -> Sheet:
    """One look at the sheet. Raises with the URL in it on anything unexpected."""
    day = now.strftime("%m-%d-%Y")
    if sheet is None or sheet.day != day:
        sheet = Sheet(day=day)
    url = URL.format(date=day)
    response = await client.get(url, timeout=45, headers={
        "User-Agent": "PointRobertsOceanView/1.0", "Accept": "application/json"})
    response.raise_for_status()
    try:
        slots = response.json()
    except ValueError as exc:
        raise ValueError(f"{url} did not answer JSON: {exc}") from exc
    if not isinstance(slots, list):
        raise ValueError(
            f"{url} answered {type(slots).__name__}, not a list of tee times; the "
            f"booking system has changed what it serves.")
    sheet.read(slots, now)
    return sheet
