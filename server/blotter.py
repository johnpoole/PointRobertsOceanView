"""The Sheriff's daily activity log, kept for the calls on the peninsula.

Whatcom County publishes a Law Incident Media Summary Report for every day, as
a PDF in their document centre. It is public record. Each row is one call for
service: an incident number, what it was called, the street, the day and the
second, the deputy who took it, and a three letter disposition. Some rows carry
an arrest with a name, an age and the offences.

    https://www.whatcomcounty.us/2120/Activity-Reports

The peninsula has a resident deputy, so about one call a day lands here out of
seventy across the county. What this keeps is the Point Roberts rows.

The reports are filed at a minute to midnight, so this looks once an hour, takes
whatever days it has not read, and keeps them on disk. Two hundred days are
listed at a time; the first run reads BACKFILL_DAYS of them and after that there
is one new one a day.

A call is a report, not a finding. The disposition is the only outcome there is,
and most rows do not carry one.
"""

from __future__ import annotations

import io
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
from pypdf import PdfReader

log = logging.getLogger("blotter")

LISTING = "https://www.whatcomcounty.us/2120/Activity-Reports"
DOCUMENT = "https://www.whatcomcounty.us/DocumentCenter/View/{doc}/{name}"
AGENT = {"User-Agent": "PointRobertsOceanView/1.0 (+https://ptrob.pgyard.ca)"}

# The Sheriff stamps a call in the county's own time, not in UTC.
PENINSULA = ZoneInfo("America/Vancouver")

HERE = "POINT ROBERTS"
BACKFILL_DAYS = 30
KEEP_DAYS = 120

LINK = re.compile(r"/DocumentCenter/View/(\d+)/(Activity-Report-(\d{4})_(\d{2})_(\d{2})[\d_]*)")


def tidy(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def read_report(body: bytes) -> list[dict]:
    """Every call in one day's report, whichever town it was in.

    pypdf gives the page back a label at a time, so the record is put together
    from the labels rather than from the line breaks, which do not survive.
    """
    pages = PdfReader(io.BytesIO(body)).pages
    text = "\n".join(p.extract_text() or "" for p in pages)
    calls: list[dict] = []
    for chunk in text.split("Number: ")[1:]:
        def field(pattern: str) -> str:
            m = re.search(pattern, chunk, re.S)
            return tidy(m.group(1)) if m else ""

        when = field(r"Date\s*:\s*(\d+/\d+/\d+ [\d:]+ [AP]M)")
        if not when:
            continue
        call = {
            "number": tidy(chunk.split("\n")[0]),
            "nature": field(r"Nature\s*:\s*(.*?)\s*Date\s*:"),
            "when": when,
            "disposition": field(r"Disp\s*:\s*(.*?)\s*Location\s*:") or None,
            # Their page footer runs into the last row on a page.
            "location": re.sub(r"\s*Page \d+$", "",
                               field(r"Location\s*:\s*(.*?)\s*Deputy\s*:")),
            "deputy": field(r"Deputy\s*:\s*(.*?)(?:\s*Number:|\s*Arrested:|\s*$)") or None,
        }
        arrest = re.search(
            r"Arrested:\s*(.*?)\s*Age\s*:\s*(\d+)\s*Offenses:\s*(.*?)(?:\s*Number:|\s*$)",
            chunk, re.S)
        if arrest:
            call["arrest"] = {"name": tidy(arrest.group(1)),
                              "age": int(arrest.group(2)),
                              "offences": tidy(arrest.group(3))}
        calls.append(call)
    if not calls:
        raise RuntimeError(
            "A Sheriff's report parsed to no calls at all. Their layout has "
            "changed: the record is read off the labels Number/Nature/Date/"
            "Disp/Location/Deputy and one of those is no longer there.")
    return calls


def street(location: str) -> str | None:
    """The street off the front of a location, or None when there is none.

    Theirs read "GULF RD , POINT ROBERTS, WA , 98281", and some are a junction:
    "APA RD & BOUNDARY BAY RD". A few carry no street at all.
    """
    head = location.split(",")[0].strip()
    return head or None


@dataclass
class Blotter:
    path: Path
    days: dict[str, list[dict]] = field(default_factory=dict)   # yyyy-mm-dd -> calls
    read: dict[str, str] = field(default_factory=dict)          # doc id -> day

    def load(self) -> None:
        if not self.path.exists():
            return
        try:
            saved = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            raise RuntimeError(
                f"{self.path} is there but unreadable: {exc}. Move it aside and "
                "the next pass will read the reports again.") from exc
        self.days = saved.get("days", {})
        self.read = saved.get("read", {})
        log.info("Blotter: %d days off disk, %d calls",
                 len(self.days), sum(len(v) for v in self.days.values()))

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({"days": self.days, "read": self.read}),
                             encoding="utf-8")

    def trim(self) -> None:
        for day in sorted(self.days)[:-KEEP_DAYS]:
            self.days.pop(day, None)
        keep = set(self.days)
        self.read = {d: day for d, day in self.read.items() if day in keep}

    @property
    def calls(self) -> list[dict]:
        """Every call kept, newest first."""
        out = [c for day in sorted(self.days, reverse=True) for c in self.days[day]]
        return out

    async def refresh(self, client: httpx.AsyncClient) -> int:
        page = await client.get(LISTING, headers=AGENT, follow_redirects=True)
        page.raise_for_status()
        listed = LINK.findall(page.text)
        if not listed:
            raise RuntimeError(
                f"No reports listed at {LISTING}. Their page has changed shape; "
                "the links read /DocumentCenter/View/<id>/Activity-Report-<date>.")

        # Newest first, and only the ones not read yet.
        wanted = []
        for doc, name, y, m, d in listed:
            day = f"{y}-{m}-{d}"
            if doc in self.read:
                continue
            wanted.append((doc, name, day))
        # A standing instance has one new report a day. A cold one would take
        # all two hundred they list, which is a lot of somebody else's bandwidth
        # for a peninsula that logs a call a day.
        if not self.days:
            wanted = wanted[:BACKFILL_DAYS]

        added = 0
        for doc, name, day in wanted:
            body = await client.get(DOCUMENT.format(doc=doc, name=name),
                                    headers=AGENT, follow_redirects=True)
            body.raise_for_status()
            here = []
            for call in read_report(body.content):
                if HERE not in call["location"].upper():
                    continue
                call["street"] = street(call["location"])
                call["day"] = day
                here.append(call)
            self.days[day] = here
            self.read[doc] = day
            added += len(here)
            log.info("Blotter %s: %d calls on the point", day, len(here))
        if wanted:
            self.trim()
            self.save()
        return added

    def as_data(self) -> dict:
        calls = self.calls
        return {
            "source": "Whatcom County Sheriff, Law Incident Media Summary Report",
            "days": len(self.days),
            "calls": calls,
            "latest_day": max(self.days) if self.days else None,
        }


def latest_time(store: Blotter) -> datetime:
    """The second of the most recent call, for the envelope's own stamp."""
    calls = store.calls
    if not calls:
        return datetime.now(timezone.utc)
    try:
        when = datetime.strptime(calls[0]["when"], "%m/%d/%Y %I:%M:%S %p")
    except ValueError:
        return datetime.now(timezone.utc)
    return when.replace(tzinfo=PENINSULA).astimezone(timezone.utc)
