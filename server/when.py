"""Clocks. What time it is here, what time it is on the peninsula, and how to
read the half-dozen shapes the upstream feeds stamp their readings with.

Every feed reader wants these and none of them should own them, or the same
timestamp gets parsed two ways in two places.
"""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def parse_time(text: str | None) -> datetime | None:
    """Parse the assorted upstream timestamp forms into aware UTC datetimes."""
    if not text:
        return None
    text = text.strip()
    # AISStream: "2022-12-29 18:22:32.318353 +0000 UTC"
    if text.endswith(" UTC"):
        text = text[:-4].strip()
        try:
            return datetime.strptime(text, "%Y-%m-%d %H:%M:%S.%f %z")
        except ValueError:
            pass
    # NOAA CO-OPS: "2026-08-04 14:54" (GMT, no tz marker)
    try:
        return datetime.strptime(text, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
    except ValueError:
        pass
    # ISO 8601 (Open-Meteo gives GMT with no offset, e.g. "2026-08-04T16:30")
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


PENINSULA = ZoneInfo("America/Vancouver")


def local_now() -> datetime:
    return datetime.now(PENINSULA).replace(tzinfo=None)
