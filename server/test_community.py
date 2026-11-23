"""Checks for putting what neighbours post on the map.

Run:
    python server/test_community.py

Most of this is the finding: whether the words in a post land on the place the
writer meant. It is checked against the real roads and places the scene is
built from, with sentences taken from real posts.
"""

from __future__ import annotations

import json
import logging
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import community  # noqa: E402

logging.disable(logging.CRITICAL)
FINDER = community.PlaceFinder(ROOT)


def place(text):
    got = FINDER.find(text)
    return got["place"] if got else None


# ---- finding the place ------------------------------------------------------

def test_a_place_people_call_by_name_is_found() -> None:
    assert place("My daughter was on a bike ride in lily point's north trail at 6pm") \
        == "Lily Point Marine Reserve"
    assert place("Orcas in the marina today . Awe inspiring") == "The marina building"
    assert place("outside the Marketplace tonight (Friday) until 7pm") \
        == "Point Roberts International Marketplace"


def test_a_misspelling_people_actually_use_is_found() -> None:
    assert place("the road going towards Lilly point") == "Lily Point Marine Reserve"


def test_a_road_is_found_however_its_suffix_is_written() -> None:
    assert place("the blue wagon from the wall at the end of Fir St at Maple beach") == "Fir Street"
    assert place("She lives on Whalen Drive. She is an indoor cat") == "Whalen Drive"
    assert place("tour this home with ocean views at 632 Highland Drive") == "Highland Drive"


def test_the_first_place_named_is_the_one_used() -> None:
    # She was walking at Maple Beach; Lily Point is only the direction.
    assert place("Walking in maple beach tonight at the end of the road going "
                 "towards Lilly point there was a house with a campfire") \
        == "Maple Beach Tidelands Park"
    assert place("Meet @ Reef 9-11am Ride @ Lighthouse Park 11am") == "The Reef"


def test_a_long_road_name_is_found_without_its_suffix() -> None:
    assert place("Burst Watermain near the south Beach House") == "South Beach Road"


def test_a_one_word_road_is_not_found_without_its_suffix() -> None:
    # Johnson is a surname before it is a road.
    assert place("I call this one Bike's Eye View. On Johnson, looking towards Tyee.") is None


def test_the_border_crossing_is_found_by_what_people_call_it() -> None:
    assert place("Gal @ Canadian Duty free truck crossing all nice staff") \
        == "Boundary Bay border station"


def test_a_road_across_the_border_is_not_on_the_point() -> None:
    assert place("stuck in traffic on 56 Street in Tsawwassen") is None


def test_a_post_that_names_nowhere_has_nowhere() -> None:
    assert place("Please keep an eye out. I had a 30ft metal extension ladder stolen.") is None
    assert place("Crab opening... Day 2.... Trap stolen already.") is None


def test_every_found_place_is_on_the_peninsula() -> None:
    for text in ("Fir St", "Whalen Drive", "lily point", "the marina", "South Beach Road"):
        got = FINDER.find(text)
        assert got and 48.96 < got["lat"] < 49.0 and -123.14 < got["lon"] < -123.0, (text, got)


# ---- something happened, or somebody is asking -------------------------------
#
# Real posts, the ones the first pass put on the map. The questions are not
# events.

def test_what_happened_somewhere_is_an_event() -> None:
    for text in (
        "My daughter was on a bike ride in lily point's north trail at 6pm this evening.",
        "Whoever just took the blue wagon from the wall at the end of Fir St at Maple beach",
        "Walking in maple beach tonight there was a house with a campfire going.",
        "Orcas in the marina today . Awe inspiring",
        "Gal @ Canadian Duty free truck crossing captured it on her car camera & called the police",
        "Have you seen Nala? She lives on Whalen Drive. She snuck out on Thursday.",
        "STILL LOST: AERYN SUN. Last seen near Cedar Park Drive.",
        "911 Memorial - 5th Annual Meet and Ride Meet @ Reef - 9-11am",
        "She's outside the Marketplace tonight (Friday) until 7pm, raising money to help send the kids",
        "Point Roberts shipwreck. Pics at low tide and high tide, just off the entrance to the marina.",
    ):
        assert community.is_event(text), text


def test_a_question_or_a_request_is_not_an_event() -> None:
    for text in (
        "Day trip to PR without the car. I am planning to visit PR this fall near Maple Beach",
        "Border crossing wait times / does my Post Office plan make sense?",
        "Jobs available on Point Roberts. I would like to ask if there are jobs at the marina",
        "The Reef Restaurant for Sale. Hopefully it stays open.",
        "RV Camping at Lighthouse Marine Park - Seeking Summer Border/Logistics Tips!",
        "Basic no-frills mowing service needed on Claire Lane",
        "Looking for some help taking out windows. $40/hr for six hours next week.",
        "Life in Point Roberts with Children. My husband and I are considering Boundary Bay Road",
    ):
        assert not community.is_event(text), text


def test_a_post_that_says_neither_when_nor_what_is_not_an_event() -> None:
    assert not community.is_event("BUILDING OUT MESHCORE IN THE POINT? The Point is heavily wooded.")


def test_a_question_is_not_kept_even_when_it_names_a_place() -> None:
    s = store()
    raw = [{"id": "nextdoor:q", "source": "nextdoor", "url": None,
            "posted": "2026-06-16T11:39:00+00:00",
            "text": "Day trip to PR without the car. I am planning to visit near Maple Beach"}]
    assert s.take(raw) == 0 and not s.posts


# ---- reading the sources ----------------------------------------------------

NEXTDOOR = """<html><script id="__NEXT_DATA__" type="application/json">""" + json.dumps({
    "props": {"pageProps": {"apolloState": {"SeoCity:city_260": {"safetyPosts": [
        {"__typename": "SeoPost", "authorName": "N. L.", "creationDate": "2026-09-07T02:13:37.825Z",
         "body": "Bike ride in lily point's north trail at 6pm. Text me 646-808-7535",
         "link": "https://nextdoor.com/p/563yjK-LmXX7?view=detail"},
        {"__typename": "SeoPost", "authorName": "T. B.", "creationDate": "2026-09-07T18:40:19.688Z",
         "body": "I had a 30ft metal extension ladder stolen from the side of my home.",
         "link": "https://nextdoor.com/p/2XfyWtmCXJBP?view=detail"},
    ]}}}}}) + """</script></html>"""

# A post as r/PointRoberts gave it while that feed was read. Some are still in
# the file on the server.
KEPT_FROM_REDDIT = {
    "id": "reddit:t3_abc123", "source": "reddit",
    "url": "https://www.reddit.com/r/PointRoberts/comments/abc123/point_roberts_shipwreck/",
    "posted": "2026-05-03T03:39:19+00:00",
    "text": "Point Roberts shipwreck. Pics at low tide and high tide, just off "
            "the entrance to the marina.",
    "place": "The marina building", "lat": 48.9745, "lon": -123.0645,
}


def test_nextdoor_posts_are_read_with_their_exact_time_and_a_link() -> None:
    posts = community.read_nextdoor(NEXTDOOR)
    assert len(posts) == 2, posts
    first = posts[0]
    assert first["posted"] == "2026-09-07T02:13:37.825Z"
    assert first["url"] == "https://nextdoor.com/p/563yjK-LmXX7"
    assert first["id"] == "nextdoor:563yjK-LmXX7"


def test_who_wrote_it_is_not_kept() -> None:
    for post in community.read_nextdoor(NEXTDOOR):
        assert "authorName" not in post and "N. L." not in json.dumps(post)


def test_a_page_with_no_data_is_an_error_not_an_empty_list() -> None:
    try:
        community.read_nextdoor("<html>Sign in to Nextdoor</html>")
    except RuntimeError as exc:
        assert "__NEXT_DATA__" in str(exc)
    else:
        raise AssertionError("a sign-in wall was read as no posts")


# ---- keeping them -----------------------------------------------------------

def store():
    return community.Community(Path(tempfile.mkdtemp()) / "community.json", FINDER)


def test_only_posts_that_name_a_place_are_kept() -> None:
    s = store()
    assert s.take(community.read_nextdoor(NEXTDOOR)) == 1
    [kept] = s.posts.values()
    assert kept["place"] == "Lily Point Marine Reserve"
    assert isinstance(kept["lat"], float) and isinstance(kept["lon"], float)


def test_phone_numbers_are_taken_out() -> None:
    s = store()
    s.take(community.read_nextdoor(NEXTDOOR))
    [kept] = s.posts.values()
    assert "646-808-7535" not in kept["text"] and "[phone]" in kept["text"]


def test_a_post_read_twice_is_kept_once() -> None:
    s = store()
    s.take(community.read_nextdoor(NEXTDOOR))
    assert s.take(community.read_nextdoor(NEXTDOOR)) == 0
    assert len(s.posts) == 1


def test_posts_are_kept_on_disk_and_come_back() -> None:
    s = store()
    s.take(community.read_nextdoor(NEXTDOOR))
    s.save()
    again = community.Community(s.path, FINDER)
    again.load()
    assert again.posts and again.posts == s.posts


def test_a_post_kept_from_reddit_is_not_sent() -> None:
    s = store()
    s.take(community.read_nextdoor(NEXTDOOR))
    s.posts[KEPT_FROM_REDDIT["id"]] = dict(KEPT_FROM_REDDIT)
    data = s.as_data()
    assert [p["source"] for p in data["posts"]] == ["nextdoor"], data
    assert data["sources"] == ["nextdoor"], data
    assert s.latest_time() == datetime(2026, 9, 7, 2, 13, 37, 825000, tzinfo=timezone.utc)


def test_a_post_more_than_a_year_old_goes() -> None:
    s = store()
    s.take(community.read_nextdoor(NEXTDOOR))
    assert len(s.posts) == 1
    s.trim(datetime(2027, 9, 1, tzinfo=timezone.utc))
    assert len(s.posts) == 1, "a post under a year old was dropped"
    s.trim(datetime(2027, 9, 8, tzinfo=timezone.utc))
    assert not s.posts, "a post more than a year old was kept"


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
