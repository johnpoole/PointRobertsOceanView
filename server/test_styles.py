"""Checks that every rule in styles.css is a rule and not a piece of another one.

Run:
    python server/test_styles.py

Plain asserts and a non-zero exit, the same as test_index.py, and written for
the same reason. A comment opened straight after a selector is not a syntax
error. The browser reads the selector, reads past the comment, reads the next
selector, and quietly makes one descendant rule out of the two. Nothing throws.
The page loads. The panel simply has no styling on it and comes up as a block of
text across the top of the screen.

That shipped: the whole of the card's block was pasted onto the end of
.gyro-note.hidden, so every rule in it read as .gyro-note .track and matched
nothing at all.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHEET = ROOT / "styles.css"

# Panels that are positioned by a rule of their own. Each must be the whole of
# some selector at the top level of the file — not part of a longer one.
POSITIONED = [".hud", ".track", ".tracks", ".vessel-tip", ".chooser", ".views"]


def rules(text: str):
    """Every (selector, depth) in the sheet, selectors as written."""
    out = []
    depth = 0
    start = 0
    i = 0
    while i < len(text):
        if text.startswith("/*", i):
            end = text.find("*/", i + 2)
            assert end != -1, "a comment is opened and never closed"
            i = end + 2
            continue
        c = text[i]
        if c == "{":
            out.append((text[start:i], depth))
            depth += 1
            start = i + 1
        elif c == "}":
            depth -= 1
            assert depth >= 0, f"a closing brace with nothing open at character {i}"
            start = i + 1
        i += 1
    assert depth == 0, f"{depth} rule(s) left open at the end of the file"
    return out


def strip_comments(text: str) -> str:
    return re.sub(r"/\*.*?\*/", " ", text, flags=re.S)


def test_no_comment_opens_against_a_selector() -> None:
    text = SHEET.read_text(encoding="utf-8")
    depth = 0
    for i, c in enumerate(text):
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        elif text.startswith("/*", i) and depth == 0:
            before = text[:i].rstrip(" \t")
            assert not before or before.endswith(("\n", "}", ";")), (
                f"styles.css: a comment opens against {before[-40:]!r} at "
                f"character {i}, which glues it to that selector and makes the "
                f"rule that follows a descendant of it")


def test_the_check_catches_the_comment_that_shipped_broken() -> None:
    broken = ".gyro-note.hidden { display: none; }\n.gyro-note/* the card */\n.track { top: 60px; }"
    text = broken
    depth = 0
    caught = False
    for i, c in enumerate(text):
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        elif text.startswith("/*", i) and depth == 0:
            before = text[:i].rstrip(" \t")
            if before and not before.endswith(("\n", "}", ";")):
                caught = True
    assert caught, "the check would not have caught the rule that shipped broken"


def test_every_panel_has_a_rule_of_its_own() -> None:
    text = SHEET.read_text(encoding="utf-8")
    selectors = [strip_comments(sel).strip() for sel, depth in rules(text) if depth == 0]
    parts = {p.strip() for sel in selectors for p in sel.split(",")}
    for name in POSITIONED:
        assert name in parts, (
            f"styles.css has no rule whose selector is exactly {name}. It is "
            f"either gone or it has been swallowed by the selector above it.")


def test_the_braces_balance() -> None:
    rules(SHEET.read_text(encoding="utf-8"))


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
