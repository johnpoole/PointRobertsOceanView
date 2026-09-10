"""Fetch the marina detector's weights into models/, and check them.

Run by the Dockerfile at build time. The files are 23 MB of MobileNet-SSD and do
not belong in the repository's history, so they are pulled here instead — with
their hashes checked, because a model that quietly became a different model
would show up as wrong counts and nothing else.

    python scripts/fetch_model.py

Any failure raises and stops the build. There is no fallback and no skip: a
container without the model cannot read the camera, and a build that pretends
otherwise produces a feed that is silently always empty.
"""

from __future__ import annotations

import hashlib
import sys
import urllib.request
from pathlib import Path

MODELS = Path(__file__).resolve().parents[1] / "models"

FILES = [
    ("mobilenet-ssd.prototxt",
     "https://raw.githubusercontent.com/chuanqi305/MobileNet-SSD/master/deploy.prototxt",
     "2d180f723b3109e21f8287f6b3c691390d07b60eed998327cd3259ffa0e50608"),
    ("mobilenet-ssd.caffemodel",
     "https://github.com/chuanqi305/MobileNet-SSD/raw/master/mobilenet_iter_73000.caffemodel",
     "52eed8be80522c152a17fb56740de705b79881bde1a167e0e747310523685fc7"),
]


def fetch(name: str, url: str, want: str) -> None:
    target = MODELS / name
    if target.exists():
        got = hashlib.sha256(target.read_bytes()).hexdigest()
        if got == want:
            print(f"{name}: already here and matches")
            return
        raise SystemExit(
            f"{target} is here but its sha256 is {got}, not {want}. Delete it and "
            f"run this again rather than trusting a model nobody can identify.")
    MODELS.mkdir(parents=True, exist_ok=True)
    print(f"{name}: fetching {url}")
    request = urllib.request.Request(url, headers={"User-Agent": "PointRobertsOceanView/1.0"})
    with urllib.request.urlopen(request, timeout=300) as response:
        body = response.read()
    got = hashlib.sha256(body).hexdigest()
    if got != want:
        raise SystemExit(
            f"{url} returned {len(body)} bytes with sha256 {got}, expected {want}. "
            f"The file at that URL has changed; check what it is now before pinning it.")
    target.write_bytes(body)
    print(f"{name}: {len(body)} bytes, sha256 verified")


if __name__ == "__main__":
    for name, url, want in FILES:
        fetch(name, url, want)
    print("marina detector model ready in", MODELS)
    sys.exit(0)
