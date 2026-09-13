"""Checks that llms.txt still describes this program.

Run:
    python server/test_llms.py

llms.txt tells a reader that has never seen the screen how to drive the page and
how to read what it knows. A wrong line in it is worse than no line: it sends
somebody after a parameter that does not exist, or has them looking for a feed
that was renamed. Documentation nobody checks goes stale in weeks.

So every claim in it that can be checked against the code is checked here: the
hash parameters, the switches, the feeds, the endpoints, the files, and the
keyboard. What cannot be checked is the prose, and that is kept short.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import proxy  # noqa: E402

GUIDE = (ROOT / "llms.txt").read_text(encoding="utf-8")
SHARE = (ROOT / "src" / "share.js").read_text(encoding="utf-8")
MAIN = (ROOT / "src" / "main.js").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")


def test_it_is_a_markdown_file_with_a_title_and_a_summary() -> None:
    lines = [ln for ln in GUIDE.splitlines() if ln.strip()]
    assert lines[0].startswith("# "), "llms.txt needs an H1 title on its first line"
    assert lines[1].startswith("> "), "and a blockquote summary under it"


def test_every_switch_it_documents_is_one_the_page_reads() -> None:
    """The hash switches, against readViewHash, which is what actually reads them."""
    reads = set(re.findall(r"^\s*(\w+): got\.\w+ === \"1\"", SHARE, re.M))
    assert reads, "no switches found in share.js; has readViewHash changed shape?"
    written = set(re.findall(r"`(\w+)=1`", GUIDE))
    missing = reads - written
    invented = written - reads
    assert not invented, f"llms.txt documents switches the page does not read: {invented}"
    assert not missing, f"llms.txt does not mention these switches: {missing}"


def test_the_view_parameters_are_the_ones_the_page_reads() -> None:
    for key in ("eye", "aim", "fov"):
        assert re.search(rf"got\.{key}\b", SHARE), \
            f"share.js no longer reads {key}, which llms.txt says it does"
        assert f"`{key}=" in GUIDE, f"llms.txt does not document {key}"


def test_the_hour_range_it_quotes_is_the_one_the_reader_enforces() -> None:
    clock = (ROOT / "src" / "clock-control.js").read_text(encoding="utf-8")
    m = re.search(r"want < 0 \|\| want >= (\d+)", clock)
    assert m, "hourFromHash no longer bounds the hour the way llms.txt describes"
    assert f"`hour=0` to `hour={int(m.group(1)) - 0.01:g}`" in GUIDE, \
        f"llms.txt quotes the wrong hour range; the reader accepts 0 to {m.group(1)}"


def test_it_lists_every_feed_the_health_table_carries() -> None:
    """The table of sources against the feeds the server actually runs. A feed
    added without a line here is one nobody reading this would know about."""
    table = GUIDE[GUIDE.index("| feed | source |"):]
    listed = set(re.findall(r"^\| (\w+) \|", table, re.M)) - {"feed"}
    running = set(proxy.world.health)
    missing = running - listed
    invented = listed - running
    assert not invented, f"llms.txt lists feeds that do not exist: {invented}"
    assert not missing, f"llms.txt does not list these feeds: {missing}"


def test_every_endpoint_it_points_at_is_served() -> None:
    served = {r.path for r in proxy.app.routes if hasattr(r, "path")}
    for path in re.findall(r"\]\((/api/[\w/]+|/openapi\.json|/docs)\)", GUIDE):
        assert path in served, f"llms.txt links {path} and nothing serves it"


def test_every_file_it_names_is_there() -> None:
    named = re.findall(r"`((?:src|server|scripts|assets)/[\w\-./*]+)`", GUIDE)
    assert named, "llms.txt names no source files at all"
    for rel in named:
        if "*" in rel:
            assert list(ROOT.glob(rel)), f"llms.txt names {rel} and nothing matches it"
        else:
            assert (ROOT / rel).exists(), f"llms.txt names {rel} and it is not there"


def test_the_documents_it_offers_at_the_end_exist() -> None:
    for rel in re.findall(r"\]\(/([\w.\-]+\.md)\)", GUIDE):
        assert (ROOT / rel).exists(), f"llms.txt offers /{rel} and it is not there"


def test_the_keys_it_lists_are_the_keys_the_page_shows() -> None:
    """Against the panel the ? button opens, which is what a person is told."""
    panel = INDEX[INDEX.index('id="keys"'):]
    panel = panel[:panel.index('id="', 10)]
    shown = set(re.findall(r'class="keys-k">(\w+)<', panel))
    assert len(shown) > 8, "no keys found in the panel; has index.html changed shape?"
    told = set(re.findall(r"`(\w+)` ", GUIDE[GUIDE.index("## At the keyboard"):]))
    missing = shown - told
    assert not missing, f"llms.txt does not list these keys: {missing}"


def test_the_envelope_it_prints_is_the_envelope_that_goes_out() -> None:
    """The worked example, field for field against what envelope() builds."""
    block = GUIDE[GUIDE.index('{ "message_type"'):]
    block = block[:block.index("```")]
    example = json.loads(block)
    real = proxy.envelope("tide.state", "tidesandcurrents.noaa.gov", None,
                          {"water_level_m": 2.914}, 900)
    for key in example:
        assert key in real, f"llms.txt shows a field called {key} that is not sent"
    for key in example["quality"]:
        assert key in real["quality"], \
            f"llms.txt shows quality.{key} and the envelope has no such field"


def test_the_words_it_says_health_can_be_are_words_it_can_be() -> None:
    said = set(re.findall(r"`(live|offline|scraped|idle)`", GUIDE))
    written = set(re.findall(r'set_health\([^,]+, "(\w+)"\)',
                             (ROOT / "server" / "proxy.py").read_text(encoding="utf-8")))
    missing = written - said
    assert not missing, f"llms.txt does not explain these health words: {missing}"


def test_the_places_file_is_built_and_says_what_it_claims() -> None:
    path = ROOT / "assets" / "places.json"
    assert path.exists(), \
        "assets/places.json is missing; build it with python scripts/build_places.py"
    got = json.loads(path.read_text(encoding="utf-8"))
    assert got["places"], "the places file has no places in it"
    for p in got["places"]:
        for key in ("id", "name", "what", "note", "lat", "lon", "view", "hash",
                    "also_called"):
            assert key in p, f"{p.get('id')} has no {key}"
        # The hash has to be one the page will accept, or the place cannot be
        # reached by the one thing this file exists to provide.
        assert p["hash"].startswith("#eye="), p["hash"]
        assert "&aim=" in p["hash"] and "&fov=" in p["hash"], p["hash"]
        assert -124 < p["lon"] < -122 and 48 < p["lat"] < 50, \
            f"{p['id']} is not on the peninsula: {p['lat']}, {p['lon']}"
    ids = [p["id"] for p in got["places"]]
    assert len(ids) == len(set(ids)), "two places share an id"


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
