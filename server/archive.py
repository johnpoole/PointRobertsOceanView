"""Keep what nobody else keeps.

Some of what this proxy reads has an archive somewhere and needs none here. The
weather has Open-Meteo going back to 1940, the tide and the currents have NOAA,
the monthly crossing counts are historical by nature, and the Sheriff's reports
sit on the county's own site.

Three things have no archive anywhere:

  wait    US Customs publish the queue at the line live and keep nothing. Their
          own historical endpoint returns null for every crossing, the one
          dataset on data.gov stopped in 2022, and the Cascade Gateway archive
          covers the other four Whatcom crossings. For Point Roberts the
          reading worth having may be how often CBP posts nothing at all, which
          nobody records.
  marina  Counts read off the camera by this proxy. It is our own measurement
          and it exists nowhere else.
  tee     The club's booking sheet shows today. Yesterday's is gone.

One file a day per feed, one line per reading, appended. JSON lines because a
line can be read without the file being whole, which matters for something a
container can be killed in the middle of.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("archive")

# What is kept, and why it has to be. Anything not here has a history already.
KEPT = {
    "wait": "US CBP publish it live and keep nothing",
    "marina": "counted off the camera here; it exists nowhere else",
    "tee": "the club's sheet shows today only",
}


class Archive:
    def __init__(self, root: Path):
        self.root = root
        self.last: dict[str, str] = {}      # feed -> the last line written

    def keep(self, feed: str, data: dict, when: datetime | None = None) -> bool:
        """Append one reading. Returns whether anything was written.

        A reading that says exactly what the last one said is not written
        again. The border posts nothing for hours at a time and the marina is
        idle unless somebody is looking, and a hundred and forty-four identical
        lines a day is not a record of anything.
        """
        if feed not in KEPT:
            raise ValueError(
                f"{feed} is not archived. Anything kept here has to have no "
                f"history anywhere else; the ones that do are listed in "
                f"{__name__}.KEPT. Add it there with the reason, or leave it.")
        stamp = (when or datetime.now(timezone.utc)).astimezone(timezone.utc)
        body = json.dumps(data, sort_keys=True, separators=(",", ":"))
        if self.last.get(feed) == body:
            return False
        line = json.dumps({"t": stamp.strftime("%Y-%m-%dT%H:%M:%SZ"),
                           "d": data}, sort_keys=True, separators=(",", ":"))
        path = self.root / feed / f"{stamp:%Y-%m-%d}.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
        self.last[feed] = body
        return True

    def counts(self) -> dict[str, dict]:
        """What is on disk, for the log and for anyone asking."""
        out = {}
        for feed in KEPT:
            days = sorted((self.root / feed).glob("*.jsonl")) \
                if (self.root / feed).exists() else []
            lines = 0
            for day in days:
                with day.open(encoding="utf-8") as f:
                    lines += sum(1 for _ in f)
            out[feed] = {
                "days": len(days),
                "readings": lines,
                "first": days[0].stem if days else None,
                "last": days[-1].stem if days else None,
            }
        return out
