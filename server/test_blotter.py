"""Reading the Sheriff's daily report, and what came of a call.

Run:
    python server/test_blotter.py

The report is one line per call for service. It says what was called in, when,
where, who took it and how it was filed. It does not say what happened: the
deputy's own account is the incident report and that is not published, and there
is no second document anywhere.

So the disposition is the whole of the outcome, and two rows in three carry
none. This checks that the three letters are read and turned into words nobody
has to look up, and that a code their table does not carry is left alone rather
than guessed at.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server.blotter import OUTCOMES, calls_in, street  # noqa: E402

logging.disable(logging.CRITICAL)

# A page of their report, copied out of a real one. pypdf hands the text back a
# label at a time and the line breaks do not survive, which is why it looks like
# this and why the reading goes by label rather than by line.
PAGE = """WHATCOM COUNTY SHERIFF'S OFFICE
Law Incident Media Summary Report
Date: 
Tuesday, September 8, 2026
Number: 
26A31575
Nature
: 
WELFARE CHECK IN PROGRESS      
Date
: 
9/8/2026 8:21:32 PM
Disp
: 
CLO 
Location
: 
APA RD & BOUNDARY BAY RD
, POINT ROBERTS, WA
Deputy
: 
CUELLAR, R      
 
Number: 
26A31576
Nature
: 
MUSIC IN PROGRESS              
Date
: 
9/6/2026 12:35:16 AM
Disp
: 
    
Location
: 
S BEACH RD
, POINT ROBERTS, WA
, 98281
Deputy
: 
STREUBEL, A     
 
Number: 
26A31580
Nature
: 
TRAFFIC STOP                   
Date
: 
9/6/2026 1:37:02 AM
Disp
: 
CAA 
Location
: 
GULF RD
, POINT ROBERTS, WA
Deputy
: 
VANBOVEN, B     
 
"""


def rows():
    return calls_in(PAGE)


# ---- what the report carries ------------------------------------------------

def test_a_call_is_read_off_the_page() -> None:
    calls = rows()
    assert len(calls) == 3, calls
    first = calls[0]
    assert first["nature"] == "WELFARE CHECK IN PROGRESS", first
    assert first["when"] == "9/8/2026 8:21:32 PM", first
    assert first["deputy"] == "CUELLAR, R", first
    assert "APA RD" in first["location"], first
    assert first["number"] == "26A31575", first


# ---- what came of it --------------------------------------------------------

def test_the_three_letters_become_words() -> None:
    first = rows()[0]
    assert first["disposition"] == "CLO", first
    assert first["outcome"] == "closed", first


def test_a_row_filed_with_nothing_says_nothing() -> None:
    """Two rows in three carry no disposition at all. That is the record, and an
    empty one must not come out as a word."""
    second = rows()[1]
    assert second["disposition"] is None, second
    assert second["outcome"] is None, second


def test_an_arrest_is_read_as_an_arrest() -> None:
    third = rows()[2]
    assert third["disposition"] == "CAA", third
    assert third["outcome"] == "cleared, adult arrested", third


def test_a_code_their_table_does_not_carry_is_left_alone() -> None:
    odd = calls_in(PAGE.replace("CLO ", "ZZQ "))[0]
    assert odd["disposition"] == "ZZQ", odd
    assert odd["outcome"] is None, \
        "a code nobody has written down was given a meaning anyway"


def test_every_code_on_their_table_is_here() -> None:
    """Off https://www.whatcomcounty.us/DocumentCenter/View/12645. A code that
    turns up and is not in here shows as three letters and tells nobody
    anything, which is what this whole table is for."""
    theirs = {"ACT", "CAA", "CAC", "CAM", "CJA", "CJC", "CJM", "CLO", "ECD",
              "ECE", "ECP", "ECV", "EJD", "EJE", "EJN", "EJP", "EJV", "INA",
              "INF", "PEN", "SGJ", "TRA", "UNF"}
    assert set(OUTCOMES) == theirs, \
        f"missing {sorted(theirs - set(OUTCOMES))}, extra {sorted(set(OUTCOMES) - theirs)}"


def test_the_arrest_codes_all_say_an_arrest() -> None:
    # Three codes for an adult arrest and three for a juvenile, because the
    # codes are shaped for NIBRS reporting rather than for reading.
    for code in ("CAA", "CAC", "CAM"):
        assert OUTCOMES[code] == "cleared, adult arrested", code
    for code in ("CJA", "CJC", "CJM"):
        assert OUTCOMES[code] == "cleared, juvenile arrested", code


def test_nothing_reads_as_a_finding() -> None:
    """A call is a report. None of these may say somebody did something: the
    strongest thing the record supports is that it was cleared by an arrest."""
    for code, words in OUTCOMES.items():
        for loaded in ("guilty", "convicted", "committed", "offender was"):
            assert loaded not in words, f"{code} reads as a finding: {words}"


# ---- the street, which is all the location gives ---------------------------

def test_the_street_is_taken_off_the_location() -> None:
    assert street("APA RD & BOUNDARY BAY RD , POINT ROBERTS, WA") \
        == "APA RD & BOUNDARY BAY RD"
    assert street("S BEACH RD , POINT ROBERTS, WA , 98281") == "S BEACH RD"


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
