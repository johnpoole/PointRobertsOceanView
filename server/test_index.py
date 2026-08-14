"""Checks that nothing in index.html reaches the screen as text by accident.

Run:
    python server/test_index.py

Plain asserts and a non-zero exit, because the project has no test runner and
this does not need one.

A comment that closes early is not a syntax error. The browser does not
complain, nothing throws, the page loads, and the rest of the comment is simply
printed over the water. That is what a stray '-->' on line 10 did for four
commits. These checks are the reading of the file that nobody was doing.
"""

from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "index.html"
SRC = ROOT / "src"

# The only elements in the head whose text belongs to them rather than to the
# page. Anything else with words in it is a comment that got loose.
HEAD_TEXT_OK = {"title", "style", "script"}


class Reader(HTMLParser):
    """Where the text is and what encloses it."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[str] = []
        self.text: list[tuple[int, list[str], str]] = []

    def handle_starttag(self, tag: str, attrs: object) -> None:
        self.stack.append(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag in self.stack:
            while self.stack.pop() != tag:
                pass

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.text.append((self.getpos()[0], list(self.stack), data.strip()))


def read(markup: str) -> Reader:
    r = Reader()
    r.feed(markup)
    return r


def comment_depth(markup: str) -> list[str]:
    """Every '<!--' and '-->' in order, complaining about any that is wrong."""
    faults = []
    depth = 0
    i = 0
    while i < len(markup):
        if markup.startswith("<!--", i):
            line = markup.count("\n", 0, i) + 1
            if depth:
                faults.append(f"line {line}: '<!--' inside a comment already open")
            depth += 1
            i += 4
        elif markup.startswith("-->", i):
            line = markup.count("\n", 0, i) + 1
            if depth == 0:
                faults.append(f"line {line}: '-->' with no comment open")
            else:
                depth -= 1
            i += 3
        else:
            i += 1
    if depth:
        faults.append(f"{depth} comment(s) never closed, so the markup after them is eaten")
    return faults


def test_every_comment_opens_and_closes_once() -> None:
    faults = comment_depth(PAGE.read_text(encoding="utf-8"))
    assert not faults, "in index.html: " + "; ".join(faults)


def test_the_head_holds_no_loose_words() -> None:
    loose = [
        (line, stack[-1] if stack else "head", said)
        for line, stack, said in read(PAGE.read_text(encoding="utf-8")).text
        if "head" in stack and (not stack or stack[-1] not in HEAD_TEXT_OK)
    ]
    assert not loose, (
        "text in the head of index.html that belongs to no element, so the "
        "browser closes the head and prints it on the page: "
        + "; ".join(f"line {n} after <{tag}>: {said!r}" for n, tag, said in loose)
    )


def test_no_comment_tail_is_left_standing_as_text() -> None:
    stray = [
        (line, said) for line, _stack, said in read(PAGE.read_text(encoding="utf-8")).text
        if "-->" in said or "<!--" in said
    ]
    assert not stray, (
        "comment punctuation in index.html that the parser read as page text: "
        + "; ".join(f"line {n}: {said!r}" for n, said in stray)
    )


def page_ids(markup: str) -> set[str]:
    """Every id the markup carries."""
    return set(re.findall(r'\bid="([^"]+)"', markup))


def wanted_ids() -> dict[str, set[str]]:
    """Every id the scripts reach for, and which file reaches for it."""
    out: dict[str, set[str]] = {}
    for js in sorted(SRC.rglob("*.js")):
        for name in re.findall(r"""getElementById\(\s*["']([^"']+)["']\s*\)""",
                               js.read_text(encoding="utf-8")):
            out.setdefault(name, set()).add(js.relative_to(ROOT).as_posix())
    return out


def test_every_id_the_scripts_reach_for_is_in_the_page() -> None:
    """A button renamed in the markup is a null in the script, and says nothing.

    getElementById on an id that is not there returns null. The page loads, the
    scene renders, and the failure waits in the console until somebody presses
    the thing.
    """
    have = page_ids(PAGE.read_text(encoding="utf-8"))
    missing = {name: who for name, who in wanted_ids().items() if name not in have}
    assert not missing, (
        "ids the scripts ask index.html for and index.html does not carry: "
        + "; ".join(f"{name} (from {', '.join(sorted(who))})"
                    for name, who in sorted(missing.items()))
    )


def test_the_id_check_catches_a_button_that_was_renamed() -> None:
    """A guard that passes on a page missing the button is worth nothing."""
    assert "mode-btn" in wanted_ids(), "main.js no longer asks for #mode-btn"
    assert "mode-btn" not in page_ids('<button id="mode-pill">mode</button>')


def test_the_checks_catch_the_comment_that_shipped_broken() -> None:
    """d09363e, in the flesh. A guard that misses it is worth nothing."""
    broken = (
        "<!DOCTYPE html>\n<html><head>\n"
        "  <!-- Inline, and before the stylesheet, because a linked stylesheet\n"
        "       arrives after the first paint. -->\n"
        "       Only these two rules. An id selector here would out-specify the\n"
        "       rules in styles.css. -->\n"
        "  <style>.hidden { display: none !important; }</style>\n"
        "</head><body><canvas id=\"scene\"></canvas></body></html>\n"
    )
    faults = comment_depth(broken)
    assert faults, "the comment walk let the broken page through"

    loose = [said for _l, stack, said in read(broken).text
             if "head" in stack and stack[-1] not in HEAD_TEXT_OK]
    assert loose, "the head check let the broken page through"
    assert "Only these two rules" in loose[0], loose


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
