"""What neighbours post publicly, when it names a place on the point.

Two sources can be read without an account. Nextdoor puts the newest posts from
Point Roberts on two public pages, and their data is in the page as JSON with
the exact time each was posted. r/PointRoberts has an RSS feed. Facebook and X
cannot be read without signing in, so they are not here.

A post goes on the map only when something happened and its words say where.
Where is a road the OSM bake has, or a place people call by name, like Lily Point
or the marina, and it stands on the first one the text mentions. Something
happened means it is not a question or a request, and it says when or says what:
6pm, tonight, Thursday, or lost, stolen, a fire, the police, orcas. The Reddit
feed is mostly people asking about the border and the post office, and a map of
questions says nothing about the point.

Only the post is kept: when it was posted, what it says, and a link back to it.
Not who wrote it, and phone numbers are taken out of the text.

Nextdoor shows the newest two dozen and nothing older without signing in, so
posts are kept on disk as they are read and the map grows from there.
"""

from __future__ import annotations

import html
import json
import logging
import math
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

log = logging.getLogger("oceanview.community")

SOURCE = "Nextdoor public pages and r/PointRoberts"
NEXTDOOR_PAGES = [
    "https://nextdoor.com/city/point-roberts--wa/",
    "https://nextdoor.com/neighborhood/pointroberts--point-roberts--wa/",
]
REDDIT_FEED = "https://www.reddit.com/r/PointRoberts/new/.rss?limit=100"
# Both answer a browser and turn away anything that does not look like one.
BROWSER = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/140.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}
KEEP_DAYS = 365
# The border runs along 49 degrees. A road north of it is in Tsawwassen, and a
# post about 56 Street is not about the point.
BORDER_LAT = 49.0

ATOM = {"a": "http://www.w3.org/2005/Atom"}
PHONE = re.compile(r"\(?\b\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b")

# What people call a place, and which of the named places it is. The names in
# places.json are the formal ones; nobody writes Lily Point Marine Reserve.
ALIASES = {
    "lily point": "lily-point-marine-reserve",
    "lilly point": "lily-point-marine-reserve",
    "maple beach": "maple-beach-tidelands-park",
    "marina": "marina-building",
    "marketplace": "marketplace",
    "the reef": "reef",
    "@ reef": "reef",
    "lighthouse park": "lighthouse-marine-park",
    "lighthouse marine park": "lighthouse-marine-park",
    "duty free": "border-station",
    "truck crossing": "border-station",
    "post office": "post-office",
    "community center": "community-centre",
    "community centre": "community-centre",
    "golf course": "clubhouse",
    "golf club": "clubhouse",
    "airpark": "point-roberts-airpark",
    "saltwater cafe": "saltwater",
    "saltwater café": "saltwater",
    "monument park": "monument-park",
}

# How a road's last word is written in a post.
SUFFIXES = {
    "Street": "street|st", "Road": "road|rd", "Drive": "drive|dr",
    "Avenue": "avenue|ave|av", "Lane": "lane|ln", "Way": "way|wy|wa",
    "Place": "place|pl", "Court": "court|ct", "Crescent": "crescent|cres",
    "Terrace": "terrace|ter", "Wynd": "wynd",
}
COMPASS = {"North": "north|n", "South": "south|s", "East": "east|e", "West": "west|w"}


def strip_phones(text: str) -> str:
    return PHONE.sub("[phone]", text)


# Asking, not telling. Any of these and the post is somebody wanting something.
ASKING = re.compile(
    r"\b(looking for|seeking|does anyone|anyone know|does my|how do|how long|"
    r"is there any|are there any|can i|should i|where can|recommend\w*|advice|"
    r"tips\b|help with|planning to|considering|would like to ask|needed|for sale|"
    r"hiring|jobs available)\b|\$\d+\s*/\s*hr", re.I)
# Telling when: a clock time, a day, a date.
WHEN = re.compile(
    r"\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\b(tonight|today|yesterday|this (morning|"
    r"afternoon|evening|weekend)|just (took|saw|now)|monday|tuesday|wednesday|"
    r"thursday|friday|saturday|sunday)\b|\b\d{1,2}/\d{1,2}(/\d{2,4})?\b|"
    r"\b(january|february|march|april|may|june|july|august|september|october|"
    r"november|december)\s+\d{1,2}", re.I)
# Telling what: the words a thing that happened is reported in.
WHAT = re.compile(
    r"\b(lost|missing|stolen|taken|attack\w*|bitten|fire|campfire|smoke|crash\w*|"
    r"police|sheriff|911|orcas?|whales?|seals?|cougar|coyote|bear|shipwreck|"
    r"flood\w*|burst|outage|closure|closed|accident|found)\b", re.I)


def is_event(text: str) -> bool:
    """Whether a post tells of something that happened, rather than asks."""
    if ASKING.search(text):
        return False
    return bool(WHEN.search(text) or WHAT.search(text))


class PlaceFinder:
    """Finds the first place a piece of text names, out of the OSM roads and the
    named places the scene already has."""

    def __init__(self, root: Path):
        places = json.loads((root / "assets" / "places.json").read_text(encoding="utf-8"))
        by_id = {p["id"]: p for p in places["places"]}
        self.patterns: list[tuple[re.Pattern, str, float, float]] = []
        for said, pid in ALIASES.items():
            if pid not in by_id:
                raise RuntimeError(
                    f"community.py calls {said!r} {pid}, and assets/places.json has "
                    f"no place with that id. Rebuild places or fix the alias.")
            p = by_id[pid]
            self.patterns.append((re.compile(r"(?<![a-z])" + re.escape(said) + r"(?![a-z])", re.I),
                                  p["name"], p["lat"], p["lon"]))

        roads = json.loads((root / "assets" / "osm" / "features.json")
                           .read_text(encoding="utf-8"))["roads"]
        longest: dict[str, list] = {}
        for road in roads:
            name = road.get("name")
            if not name or len(road["coords"]) < 2:
                continue
            if name not in longest or _length(road["coords"]) > _length(longest[name]):
                longest[name] = road["coords"]
        for name, coords in longest.items():
            lat, lon = _midpoint(coords)
            if lat >= BORDER_LAT:
                continue
            words = name.split()
            suffix = SUFFIXES.get(words[-1])
            if not suffix or len(words) < 2:
                continue
            base = words[:-1]
            first = COMPASS.get(base[0])
            head = f"(?:{first})" if first else re.escape(base[0])
            rest = [re.escape(w) for w in base[1:]]
            body = r"\s+".join([head] + rest)
            self.patterns.append((re.compile(
                rf"(?<![a-z0-9]){body}\.?\s+(?:{suffix})\b\.?", re.I), name, lat, lon))
            # A road of two or more words is distinctive enough on its own:
            # "near the south Beach House" is South Beach Road. One word is not,
            # because Johnson is a surname before it is a road.
            if len(base) >= 2:
                self.patterns.append((re.compile(
                    rf"(?<![a-z0-9]){body}(?![a-z])", re.I), name, lat, lon))

    def find(self, text: str) -> dict | None:
        best = None
        for pattern, name, lat, lon in self.patterns:
            m = pattern.search(text)
            if m and (best is None or m.start() < best[0]):
                best = (m.start(), name, lat, lon)
        if best is None:
            return None
        return {"place": best[1], "lat": round(best[2], 6), "lon": round(best[3], 6)}


def _length(coords) -> float:
    return sum(math.hypot(b[0] - a[0], (b[1] - a[1]) * 0.657)
               for a, b in zip(coords, coords[1:]))


def _midpoint(coords) -> tuple[float, float]:
    half, run = _length(coords) / 2, 0.0
    for a, b in zip(coords, coords[1:]):
        step = math.hypot(b[0] - a[0], (b[1] - a[1]) * 0.657)
        if run + step >= half and step > 0:
            k = (half - run) / step
            return a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k
        run += step
    return coords[-1][0], coords[-1][1]


# ---- reading the sources ----------------------------------------------------

def read_nextdoor(page: str) -> list[dict]:
    """The posts in one of Nextdoor's public pages."""
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', page, re.S)
    if not m:
        raise RuntimeError(
            "Nextdoor's page carries no __NEXT_DATA__ script, so its posts cannot "
            "be read. The page has changed shape, or they served a sign-in wall.")
    data = json.loads(m.group(1))
    posts: list[dict] = []

    def walk(o):
        if isinstance(o, dict):
            if o.get("__typename") == "SeoPost" and o.get("creationDate") and o.get("body"):
                link = o.get("link") or ""
                pid = re.search(r"/p/([^/?#]+)", link)
                if pid:
                    posts.append({
                        "id": f"nextdoor:{pid.group(1)}",
                        "source": "nextdoor",
                        "url": link.split("?")[0],
                        "posted": o["creationDate"],
                        "text": o["body"],
                    })
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(data)
    return posts


def read_reddit(feed: str) -> list[dict]:
    """The posts in r/PointRoberts's Atom feed."""
    try:
        root = ET.fromstring(feed)
    except ET.ParseError as exc:
        raise RuntimeError(f"r/PointRoberts did not answer with a feed: {exc}") from exc
    posts = []
    for e in root.findall("a:entry", ATOM):
        pid = e.findtext("a:id", default="", namespaces=ATOM)
        title = e.findtext("a:title", default="", namespaces=ATOM)
        body = html.unescape(re.sub(r"<[^>]+>", " ", e.findtext("a:content", default="", namespaces=ATOM)))
        body = re.sub(r"\s*submitted by\s+/u/\S+.*$", "", re.sub(r"\s+", " ", body)).strip()
        link = e.find("a:link", ATOM)
        posted = e.findtext("a:published", default="", namespaces=ATOM)
        if not pid or not posted:
            continue
        posts.append({
            "id": f"reddit:{pid}",
            "source": "reddit",
            "url": link.get("href") if link is not None else None,
            "posted": posted,
            "text": f"{title}. {body}".strip(". ") if body else title,
        })
    return posts


# ---- keeping them -----------------------------------------------------------

@dataclass
class Community:
    path: Path
    finder: PlaceFinder
    posts: dict[str, dict] = field(default_factory=dict)     # id -> post

    def load(self) -> None:
        if not self.path.exists():
            return
        try:
            self.posts = json.loads(self.path.read_text(encoding="utf-8"))["posts"]
        except (json.JSONDecodeError, OSError, KeyError) as exc:
            raise RuntimeError(
                f"{self.path} is there but unreadable: {exc}. Move it aside and the "
                "next pass will start the posts again.") from exc
        log.info("Community: %d posts off disk", len(self.posts))

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({"posts": self.posts}), encoding="utf-8")

    def take(self, raw: list[dict]) -> int:
        """Keep the posts that tell of something happening at a place and are not
        kept already. Returns how many were new."""
        added = 0
        for post in raw:
            if post["id"] in self.posts or not is_event(post["text"]):
                continue
            where = self.finder.find(post["text"])
            if where is None:
                continue
            self.posts[post["id"]] = {**post, "text": strip_phones(post["text"]), **where}
            added += 1
        return added

    def trim(self, now: datetime) -> None:
        cutoff = now - timedelta(days=KEEP_DAYS)
        self.posts = {k: p for k, p in self.posts.items() if _when(p["posted"]) >= cutoff}

    async def refresh(self, client: httpx.AsyncClient) -> int:
        """Read both sources. What one source gives is kept even if the other
        fails, and then the failure is raised so the feed says so."""
        added, failed = 0, []
        for url in NEXTDOOR_PAGES:
            try:
                page = await client.get(url, headers=BROWSER, follow_redirects=True)
                page.raise_for_status()
                added += self.take(read_nextdoor(page.text))
            except (httpx.HTTPError, RuntimeError) as exc:
                failed.append(f"{url}: {exc}")
        try:
            feed = await client.get(REDDIT_FEED, headers=BROWSER, follow_redirects=True)
            feed.raise_for_status()
            added += self.take(read_reddit(feed.text))
        except (httpx.HTTPError, RuntimeError) as exc:
            failed.append(f"{REDDIT_FEED}: {exc}")
        self.trim(datetime.now(timezone.utc))
        self.save()
        if failed:
            raise RuntimeError("; ".join(failed))
        return added

    def as_data(self) -> dict:
        newest = sorted(self.posts.values(), key=lambda p: _when(p["posted"]), reverse=True)
        return {"posts": newest, "sources": ["nextdoor", "reddit"]}

    def latest_time(self) -> datetime | None:
        return max((_when(p["posted"]) for p in self.posts.values()), default=None)


def _when(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))
