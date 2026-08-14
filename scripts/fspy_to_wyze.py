"""Turn an fSpy solve into the two lines WYZE_CAMS wants.

fSpy hands back where a photograph was taken from, in whatever frame you set up
by clicking on the building. This turns that into the pair src/main.js carries
for each camera: an eye at a lat/lon and a height, and an aim 300 m down the line
of sight. The same block the S key writes, off a solve rather than off a drag.

Set fSpy up like this, and the assumptions below are then true:

  1. Put the origin on a corner of the cabin you can name, and tell this script
     where that corner is in the cabin's own metres with --origin. The cabin's
     frame is the one src/scene/cabin.js builds in: x across the ridge, positive
     east; y straight up and already in metres above MLLW; z along the ridge,
     positive south. So the south-west corner of the upper floor is
     -3.235,10.45,3.395 and the script is told exactly that.
  2. Lay the two axes on edges of the cabin, so fSpy's axes are the cabin's.
  3. Give it one real length, in metres. Without a reference distance fSpy
     solves the direction and not the distance, and this refuses to guess.
  4. Say which of fSpy's axes is up with --up. Blender's world is z up and
     fSpy is usually set that way; this page is y up.

Run:
    python scripts/fspy_to_wyze.py front_door.fspy --origin -3.235,10.45,3.395

Reads the cabin's placement out of src/scene/cabin.js and the origin of the world
out of src/config.js, so there is one copy of each.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CABIN_JS = ROOT / "src/scene/cabin.js"
CONFIG_JS = ROOT / "src/config.js"

FSPY_MAGIC = 2037412710
M_PER_DEG_LAT = 111320.0
AIM_M = 300.0            # how far down the line of sight the aim point sits


def _grab(path: Path, pattern: str, what: str) -> re.Match:
    m = re.search(pattern, path.read_text(encoding="utf-8"))
    if not m:
        raise SystemExit(
            f"{path}: could not find {what}. This script reads it rather than "
            f"keeping a second copy that would quietly stop agreeing. If it has "
            f"been renamed or reformatted, fix the pattern in "
            f"{Path(__file__).name}.")
    return m


def read_cabin() -> tuple[float, float, float]:
    """Where the cabin stands and how far it is turned, out of cabin.js."""
    at = _grab(CABIN_JS,
               r"const\s+AT\s*=\s*\{\s*x:\s*(-?[\d.]+)\s*,\s*z:\s*(-?[\d.]+)\s*\}",
               "the cabin's AT")
    yaw = _grab(CABIN_JS, r"const\s+YAW\s*=\s*(-?[\d.]+)", "the cabin's YAW")
    return float(at.group(1)), float(at.group(2)), float(yaw.group(1))


def read_origin() -> tuple[float, float]:
    """Where the world's origin is, out of config.js."""
    m = _grab(CONFIG_JS,
              r"ORIGIN\s*=\s*\{\s*lat:\s*(-?[\d.]+)\s*,\s*lon:\s*(-?[\d.]+)\s*\}",
              "ORIGIN")
    return float(m.group(1)), float(m.group(2))


def from_world(x: float, z: float, lat0: float, lon0: float) -> tuple[float, float]:
    """The inverse of toWorld in src/geo.js."""
    cos_lat = math.cos(math.radians(lat0))
    return lat0 + -z / M_PER_DEG_LAT, lon0 + x / (M_PER_DEG_LAT * cos_lat)


def read_fspy(path: Path) -> dict:
    """The JSON out of a .fspy file. Header is magic, version, json size, image size."""
    raw = path.read_bytes()
    if len(raw) < 16:
        raise SystemExit(f"{path}: {len(raw)} bytes, which is shorter than the header")
    magic, version, state_size, _image_size = struct.unpack("<IIII", raw[:16])
    if magic != FSPY_MAGIC:
        raise SystemExit(
            f"{path}: this is not an fSpy project. Its first four bytes read "
            f"{magic}, and an fSpy file reads {FSPY_MAGIC}.")
    if version != 1:
        raise SystemExit(
            f"{path}: fSpy project version {version}, and this only knows version 1. "
            f"Check the format against fSpy-Blender's fspy.py before trusting it.")
    return json.loads(raw[16:16 + state_size].decode("utf-8"))


def camera_from(state: dict, path: Path) -> tuple[list[float], list[float], float]:
    """Position, forward direction and horizontal field of view, in fSpy's frame."""
    p = state.get("cameraParameters")
    if not p:
        raise SystemExit(f"{path}: no cameraParameters. Has the solve converged in fSpy?")
    rows = (p.get("cameraTransform") or {}).get("rows")
    if not rows or len(rows) != 4:
        raise SystemExit(
            f"{path}: cameraTransform has no 4x4 of rows, so there is no solve in "
            f"this file. In fSpy both vanishing points have to be set before it "
            f"has an answer.")
    # Row major, translation down the last column. The camera looks along its own
    # -z, the same as three.js and Blender.
    pos = [rows[0][3], rows[1][3], rows[2][3]]
    fwd = [-rows[0][2], -rows[1][2], -rows[2][2]]
    fov = p.get("horizontalFieldOfView")
    if fov is None:
        raise SystemExit(f"{path}: no horizontalFieldOfView in the solve.")
    return pos, fwd, float(fov)


def z_up_to_y_up(v: list[float]) -> list[float]:
    """Blender's world onto this page's. Up goes from +z to +y, and +y forward
    becomes -z, which is north here because the page counts +z south."""
    return [v[0], v[2], -v[1]]


def rotate_y(v: list[float], yaw: float) -> list[float]:
    """three.js rotateY, which is what cabin.js's place() does to every part."""
    c, s = math.cos(yaw), math.sin(yaw)
    return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]


def solve(state: dict, path: Path, origin_local: list[float], up: str):
    at_x, at_z, yaw = read_cabin()
    lat0, lon0 = read_origin()
    pos, fwd, fov = camera_from(state, path)

    if up == "z":
        pos = z_up_to_y_up(pos)
        fwd = z_up_to_y_up(fwd)

    # fSpy's origin is a corner of the cabin, named in the cabin's own metres.
    local = [pos[i] + origin_local[i] for i in range(3)]
    # Out of the cabin's frame and into the world, the way place() does it.
    w = rotate_y(local, yaw)
    eye = [w[0] + at_x, w[1], w[2] + at_z]
    d = rotate_y(fwd, yaw)
    n = math.sqrt(sum(c * c for c in d))
    if n < 1e-9:
        raise SystemExit(f"{path}: the solve's forward direction is zero length.")
    d = [c / n for c in d]
    aim = [eye[i] + d[i] * AIM_M for i in range(3)]

    eye_lat, eye_lon = from_world(eye[0], eye[2], lat0, lon0)
    aim_lat, aim_lon = from_world(aim[0], aim[2], lat0, lon0)
    heading = math.degrees(math.atan2(d[0], -d[2])) % 360
    pitch = math.degrees(math.asin(max(-1.0, min(1.0, d[1]))))
    return eye, eye_lat, eye_lon, aim_lat, aim_lon, aim[1], heading, pitch, fov


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project", type=Path, help="the .fspy file")
    ap.add_argument("--name", default="the camera", help="what to label the block")
    ap.add_argument("--origin", default="0,0,0",
                    help="where fSpy's origin sits in the cabin's own metres, "
                         "x,y,z. The south-west corner of the upper floor is "
                         "-3.235,10.45,3.395")
    ap.add_argument("--up", choices=["y", "z"], default="z",
                    help="which of fSpy's axes points up (default z, Blender's)")
    args = ap.parse_args()

    if not args.project.exists():
        raise SystemExit(f"{args.project}: no such file")
    try:
        origin_local = [float(v) for v in args.origin.split(",")]
    except ValueError:
        raise SystemExit(f"--origin {args.origin!r}: wanted three numbers, x,y,z")
    if len(origin_local) != 3:
        raise SystemExit(f"--origin {args.origin!r}: wanted three numbers, x,y,z")

    state = read_fspy(args.project)
    unit = (state.get("calibrationSettingsBase") or {}).get("referenceDistanceUnit")
    if not unit or str(unit).lower() in ("no unit", "none"):
        raise SystemExit(
            f"{args.project}: no reference distance unit is set. Without a real "
            f"length fSpy solves which way the camera points and not how far off "
            f"it stands, and every number below would be a shape rather than a "
            f"place. In fSpy set the reference distance to a length you have "
            f"measured — the cabin's wall is 6.47 m and its upper storey 2.26 — "
            f"and export again.")
    if str(unit).lower() not in ("meters", "metres", "m"):
        raise SystemExit(
            f"{args.project}: the reference distance is in {unit!r}. This page is "
            f"metres throughout. Set metres in fSpy and export again.")

    eye, eye_lat, eye_lon, aim_lat, aim_lon, aim_y, heading, pitch, fov = solve(
        state, args.project, origin_local, args.up)

    print(f"eye      {eye[0]:.2f} east, {eye[2]:.2f} south, {eye[1]:.2f} m MLLW")
    print(f"aim      {heading:.2f} deg from north, "
          f"{'up' if pitch >= 0 else 'down'} {abs(pitch):.2f} deg")
    print(f"lens     {math.degrees(fov):.2f} deg across, as fSpy solved it")
    print("         (that should be the number undistort_wyze.py printed; if it "
          "is not, the frame and the solve disagree about the lens)")
    print()
    print("Paste into WYZE_CAMS in src/main.js:")
    print()
    print(f"    // {args.name}")
    print(f"    eye: {{ lat: {eye_lat:.6f}, lon: {eye_lon:.6f}, y: {eye[1]:.2f} }},")
    print(f"    aim: {{ lat: {aim_lat:.6f}, lon: {aim_lon:.6f}, y: {aim_y:.2f} }},")
    return 0


if __name__ == "__main__":
    sys.exit(main())
