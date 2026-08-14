"""Straighten a Wyze frame, so fSpy can be pointed at it.

fSpy solves a pinhole camera: it finds where a photograph was taken from by
running the parallel edges of a building out to their vanishing points, and that
only works if straight lines in the world are straight lines in the picture. On
a Wyze V3 they are not. It is a fisheye, and the page reads it as one — angle off
the axis carried straight to radius in the frame, which is the equidistant model.
See the projector in src/scene/terrain.js.

So the frame is remapped to what a straight lens would have taken from the same
place, and fSpy is given that.

It costs the edges. The lens covers 102.2 degrees across and a rectilinear frame
of that width runs to infinity at its corners, so the output is cut to a middle
field: 80 degrees by default, which keeps the stair and the shed and throws away
the trees at the sides. Nothing is invented to fill the corners — a ray that
falls outside the lens comes back black, and the count is printed.

Run:
    python scripts/undistort_wyze.py assets/reference/front_door-20260812T203304Z.png out.png

Then in fSpy, load out.png, set the horizontal field of view to the same number
this printed, and set the two axes on edges you know are square.

Needs numpy and pillow: pip install -r scripts/requirements-terrain.txt
"""

from __future__ import annotations

import argparse
import math
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MAIN_JS = ROOT / "src/main.js"


def read_lens() -> tuple[float, float]:
    """The lens the page carries, out of src/main.js, so there is one of it.

    Fitted by hand on the ocean view frame and it holds on the front door one,
    which is what says it describes the glass. If it moves in main.js it moves
    here, and a copy of it in this file would quietly stop agreeing.
    """
    src = MAIN_JS.read_text(encoding="utf-8")
    m = re.search(
        r"WYZE_LENS\s*=\s*\{\s*corner:\s*\(\s*(-?[\d.]+)\s*\*\s*Math\.PI\s*\)\s*/\s*180\s*,"
        r"\s*aspect:\s*([\d.]+)",
        src)
    if not m:
        raise SystemExit(
            f"{MAIN_JS}: could not find WYZE_LENS. It is the one place the lens is "
            f"written down and this script reads it rather than keeping a second "
            f"copy. If it has been renamed or reformatted, fix the pattern in "
            f"read_lens() in {Path(__file__).name} rather than hard-coding the "
            f"numbers here.")
    return math.radians(float(m.group(1))), float(m.group(2))


def undistort(src: np.ndarray, corner: float, aspect: float,
              hfov: float, out_w: int, out_h: int) -> tuple[np.ndarray, int]:
    """Remap an equidistant frame onto a straight lens. Returns the image and
    how many output pixels fell outside what the lens covers."""
    h_src, w_src = src.shape[:2]
    # A straight lens: the focal length in output pixels that gives hfov across.
    f = (out_w / 2.0) / math.tan(hfov / 2.0)
    px, py = np.meshgrid(np.arange(out_w) + 0.5, np.arange(out_h) + 0.5)
    x = px - out_w / 2.0
    y = -(py - out_h / 2.0)          # image rows run down, the camera's y runs up

    # Direction of each output pixel, as an angle off the axis.
    off = np.hypot(x, y)
    theta = np.arctan2(off, f)
    with np.errstate(invalid="ignore", divide="ignore"):
        dx = np.where(off > 1e-9, x / off, 0.0)
        dy = np.where(off > 1e-9, y / off, 0.0)

    # The same angle, laid back down on the fisheye frame. This is the forward
    # model in PROJECTOR_GLSL_FRAGMENT, read the other way round.
    r = (theta / corner) * 0.5 * math.hypot(aspect, 1.0)
    u = 0.5 + r * dx / aspect
    v = 0.5 + r * dy
    inside = (theta < corner) & (u >= 0) & (u <= 1) & (v >= 0) & (v <= 1)

    col = np.clip(u * w_src - 0.5, 0, w_src - 1)
    row = np.clip((1.0 - v) * h_src - 0.5, 0, h_src - 1)
    c0 = np.floor(col).astype(int); r0 = np.floor(row).astype(int)
    c1 = np.minimum(c0 + 1, w_src - 1); r1 = np.minimum(r0 + 1, h_src - 1)
    tc = (col - c0)[..., None]; tr = (row - r0)[..., None]
    s = src.astype(np.float64)
    top = s[r0, c0] * (1 - tc) + s[r0, c1] * tc
    bot = s[r1, c0] * (1 - tc) + s[r1, c1] * tc
    out = top * (1 - tr) + bot * tr
    out[~inside] = 0
    return out.astype(np.uint8), int((~inside).sum())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("frame", type=Path, help="a frame off either Wyze camera")
    ap.add_argument("out", type=Path, help="where to write the straightened one")
    ap.add_argument("--hfov", type=float, default=80.0,
                    help="degrees across the output. Wider keeps more of the "
                         "frame and stretches its edges harder (default 80)")
    ap.add_argument("--width", type=int, default=0, help="output width, default the frame's")
    ap.add_argument("--height", type=int, default=0, help="output height, default the frame's")
    ap.add_argument("--corner", type=float, default=0.0,
                    help="degrees off axis to the corner of the frame, if not main.js's")
    ap.add_argument("--aspect", type=float, default=0.0,
                    help="how much wider the lens works than it does tall, if not main.js's")
    args = ap.parse_args()

    if not args.frame.exists():
        raise SystemExit(f"{args.frame}: no such frame")
    if not 10.0 < args.hfov < 175.0:
        raise SystemExit(f"--hfov {args.hfov}: a straight lens has to be under 180 "
                         f"degrees and is useless near it. Try 60 to 100.")

    corner, aspect = read_lens()
    if args.corner:
        corner = math.radians(args.corner)
    if args.aspect:
        aspect = args.aspect

    im = Image.open(args.frame).convert("RGB")
    src = np.asarray(im)
    out_w = args.width or im.width
    out_h = args.height or im.height

    across = 2 * math.degrees(math.atan(math.tan(math.radians(args.hfov) / 2)))
    up = 2 * math.degrees(math.atan(math.tan(math.radians(args.hfov) / 2) * out_h / out_w))
    # What the lens itself covers. Equidistant, so the angle goes with the
    # radius and not with its tangent: the corner sits at half the diagonal and
    # the middle of an edge at half that edge, in the same proportion.
    diag = math.hypot(aspect, 1.0)
    lens_across = 2 * math.degrees(corner) * aspect / diag
    lens_up = 2 * math.degrees(corner) / diag

    out, dropped = undistort(src, corner, aspect,
                             math.radians(args.hfov), out_w, out_h)
    Image.fromarray(out).save(args.out)

    print(f"lens        {math.degrees(corner):.2f} deg to the corner, aspect {aspect:.4f}")
    print(f"            covering {lens_across:.1f} deg across and {lens_up:.1f} up")
    print(f"wrote       {args.out}  {out_w} x {out_h}")
    print(f"straight    {across:.1f} deg across, {up:.1f} deg up")
    print(f"black       {dropped} px of {out_w * out_h} fell outside the lens "
          f"({100 * dropped / (out_w * out_h):.1f}%)")
    print()
    print(f"In fSpy, set the horizontal field of view to {across:.2f} degrees.")
    print("Then set the origin on a corner of the cabin, put the two axes on "
          "edges you know are square, and give it one real length.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
