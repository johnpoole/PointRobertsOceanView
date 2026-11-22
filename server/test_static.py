"""Only the page is served as files. The visitor record, the server's own
source and everything else in the checkout are not.
Run: python server/test_static.py (no network or upstream tasks).
"""
import asyncio
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from server import proxy

SITE = next(r.app for r in proxy.app.routes if getattr(r, "name", None) == "site")


def status(url_path: str) -> int:
    """What a GET for this path answers, through the mounted app itself."""
    scope = {"type": "http", "method": "GET", "path": url_path, "root_path": "", "headers": []}
    try:
        response = asyncio.run(SITE.get_response(SITE.get_path(scope), scope))
    except HTTPException as exc:
        return exc.status_code
    return response.status_code


def test_the_page_and_what_it_loads_are_served():
    for path in ["/", "/index.html", "/styles.css", "/favicon.svg", "/llms.txt",
                 "/README.md", "/REQUIREMENTS.md", "/src/main.js", "/src/scene/terrain.js",
                 "/assets/places.json", "/assets/terrain/meta.json",
                 "/renders/marina-comparison.html"]:
        assert status(path) == 200, f"{path} answered {status(path)}, and the page needs it"


def test_nothing_else_in_the_checkout_is_served():
    # Files that exist here and must not come down. If one is missing from the
    # checkout the test says so, because a 404 for a file that is not there
    # proves nothing.
    root = proxy.REPO_ROOT
    for path in ["/server/proxy.py", "/server/test_static.py", "/requirements.txt",
                 "/Dockerfile", "/docker-compose.yml", "/package.json", "/CONTINUE.md",
                 "/scripts/build_terrain.py", "/.gitignore"]:
        assert (root / path.lstrip("/")).is_file(), f"{path} is not in the checkout to be tested"
        assert status(path) == 404, f"{path} answered {status(path)} and is not part of the page"


def test_the_visitor_record_is_not_served():
    # Written here if it is not there, so the test does not pass for want of a
    # file. Left as it was afterwards.
    record = proxy.VISITORS_PATH
    made = not record.exists()
    if made:
        record.parent.mkdir(parents=True, exist_ok=True)
        record.write_text("{}", encoding="utf-8")
    try:
        assert record.is_file()
        assert status("/data/visitors.json") == 404
        assert status("/data/") == 404
        assert status("/data") == 404
    finally:
        if made:
            os.unlink(record)


def test_a_folder_name_alone_is_not_a_way_in():
    for path in ["/src", "/assets", "/src/../server/proxy.py", "/assets/../data/visitors.json",
                 "/.env", "/.git/config"]:
        assert status(path) == 404, f"{path} answered {status(path)}"


def test_is_public_reads_either_separator():
    assert proxy.is_public("src/main.js")
    assert proxy.is_public(os.path.join("src", "scene", "terrain.js"))
    assert proxy.is_public(os.path.join("renders", "marina-comparison.html"))
    assert not proxy.is_public(os.path.join("renders", "novel", "shield.png"))
    assert not proxy.is_public(os.path.join("data", "visitors.json"))
    assert not proxy.is_public(os.path.join("src", "..", "data", "visitors.json"))
    assert not proxy.is_public("server")


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok  ", name)
    print("PASS: only the page is served")
