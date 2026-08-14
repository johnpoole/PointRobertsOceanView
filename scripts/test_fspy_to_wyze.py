"""Checks the axis handling in fspy_to_wyze.py.

Run:
    python scripts/test_fspy_to_wyze.py

Plain asserts and a non-zero exit, the same as server/test_*.py, because the
project has no test runner and this does not need one.

Axis conversions are the thing that goes wrong without saying so. A camera put
in with its up and its north swapped still produces a lat, a lon and a height,
all of them well formed and all of them somewhere else. So a camera is built at
a place that is known, wound backwards into an fSpy solve, and the script is
asked to find it again.
"""

from __future__ import annotations

import json
import math
import struct
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fspy_to_wyze import (  # noqa: E402
    FSPY_MAGIC, M_PER_DEG_LAT, from_world, read_cabin, read_fspy, read_origin,
    rotate_y, solve, z_up_to_y_up,
)

# The front door camera as src/main.js carries it, which is the answer the
# round trip has to come back with.
FRONT_DOOR_EYE = {"lat": 48.989046, "lon": -123.085735, "y": 12.9}
FRONT_DOOR_AIM = {"lat": 48.989870, "lon": -123.081825, "y": 17.14}


def to_world(lat: float, lon: float, y: float, lat0: float, lon0: float):
    cos_lat = math.cos(math.radians(lat0))
    return [(lon - lon0) * M_PER_DEG_LAT * cos_lat, y,
            -(lat - lat0) * M_PER_DEG_LAT]


def unrotate_y(v, yaw):
    """rotate_y backwards, so a world vector can be wound into the cabin's frame."""
    return rotate_y(v, -yaw)


def y_up_to_z_up(v):
    """The inverse of z_up_to_y_up, for building a solve to feed back in."""
    return [v[0], -v[2], v[1]]


def fake_project(pos_zup, fwd_zup, fov_rad, unit="Meters") -> bytes:
    """An fSpy file holding one camera. Row major, translation down the last
    column, and the camera looking along its own -z."""
    right = [1.0, 0.0, 0.0]
    zaxis = [-c for c in fwd_zup]          # the camera's +z is behind it
    up = [
        zaxis[1] * right[2] - zaxis[2] * right[1],
        zaxis[2] * right[0] - zaxis[0] * right[2],
        zaxis[0] * right[1] - zaxis[1] * right[0],
    ]
    rows = [
        [right[0], up[0], zaxis[0], pos_zup[0]],
        [right[1], up[1], zaxis[1], pos_zup[1]],
        [right[2], up[2], zaxis[2], pos_zup[2]],
        [0.0, 0.0, 0.0, 1.0],
    ]
    state = {
        "cameraParameters": {
            "cameraTransform": {"rows": rows},
            "horizontalFieldOfView": fov_rad,
            "imageWidth": 1920, "imageHeight": 1080,
        },
        "calibrationSettingsBase": {"referenceDistanceUnit": unit},
    }
    blob = json.dumps(state).encode("utf-8")
    return struct.pack("<IIII", FSPY_MAGIC, 1, len(blob), 0) + blob


def test_the_two_axis_conversions_undo_each_other() -> None:
    for v in ([1.0, 2.0, 3.0], [-4.5, 0.0, 7.25], [0.0, 0.0, 1.0]):
        back = y_up_to_z_up(z_up_to_y_up(v))
        assert all(abs(a - b) < 1e-12 for a, b in zip(v, back)), (v, back)


def test_up_in_blender_comes_out_up_here() -> None:
    """Blender's +z is this page's +y, and nothing else may move."""
    assert z_up_to_y_up([0.0, 0.0, 1.0]) == [0.0, 1.0, 0.0]
    # Blender's +y, its forward, is north here, and the page counts +z south.
    assert z_up_to_y_up([0.0, 1.0, 0.0]) == [0.0, 0.0, -1.0]
    # East is east in both.
    assert z_up_to_y_up([1.0, 0.0, 0.0]) == [1.0, 0.0, 0.0]


def test_a_camera_wound_in_comes_back_out_where_it_started() -> None:
    """The whole pipeline, against the front door camera main.js carries."""
    lat0, lon0 = read_origin()
    at_x, at_z, yaw = read_cabin()

    eye_w = to_world(FRONT_DOOR_EYE["lat"], FRONT_DOOR_EYE["lon"],
                     FRONT_DOOR_EYE["y"], lat0, lon0)
    aim_w = to_world(FRONT_DOOR_AIM["lat"], FRONT_DOOR_AIM["lon"],
                     FRONT_DOOR_AIM["y"], lat0, lon0)
    d = [aim_w[i] - eye_w[i] for i in range(3)]
    n = math.sqrt(sum(c * c for c in d))
    d = [c / n for c in d]

    # Wind it back into the cabin's frame, with fSpy's origin at the cabin's own
    # origin so --origin is 0,0,0 and the test is about the axes and nothing else.
    local_pos = unrotate_y([eye_w[0] - at_x, eye_w[1], eye_w[2] - at_z], yaw)
    local_fwd = unrotate_y(d, yaw)
    blob = fake_project(y_up_to_z_up(local_pos), y_up_to_z_up(local_fwd),
                        math.radians(80.0))

    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "round-trip.fspy"
        p.write_bytes(blob)
        state = read_fspy(p)
        (eye, eye_lat, eye_lon, aim_lat, aim_lon, aim_y,
         heading, pitch, fov) = solve(state, p, [0.0, 0.0, 0.0], "z")

    assert abs(eye[1] - FRONT_DOOR_EYE["y"]) < 1e-6, eye
    assert abs(eye_lat - FRONT_DOOR_EYE["lat"]) < 1e-9, (eye_lat, FRONT_DOOR_EYE)
    assert abs(eye_lon - FRONT_DOOR_EYE["lon"]) < 1e-9, (eye_lon, FRONT_DOOR_EYE)
    # main.js's own comment for this camera: 72.19 from north, 0.81 up.
    assert abs(heading - 72.19) < 0.05, heading
    assert abs(pitch - 0.81) < 0.05, pitch
    # The aim lands 300 m down the line of sight, on the same bearing.
    a_lat, a_lon = aim_lat, aim_lon
    aim_back = to_world(a_lat, a_lon, aim_y, lat0, lon0)
    run = math.dist([eye[0], eye[1], eye[2]], aim_back)
    assert abs(run - 300.0) < 1e-3, run


def test_a_solve_with_no_scale_is_refused() -> None:
    """fSpy without a reference distance gives a shape, not a place."""
    blob = fake_project([0.0, 0.0, 0.0], [0.0, 1.0, 0.0], math.radians(80.0),
                        unit="No unit")
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "no-scale.fspy"
        p.write_bytes(blob)
        state = read_fspy(p)
        unit = (state.get("calibrationSettingsBase") or {}).get("referenceDistanceUnit")
        assert str(unit).lower() == "no unit", unit


def test_a_file_that_is_not_fspy_is_refused() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "not.fspy"
        p.write_bytes(struct.pack("<IIII", 12345, 1, 0, 0))
        try:
            read_fspy(p)
        except SystemExit as exc:
            assert "not an fSpy project" in str(exc), exc
        else:
            raise AssertionError("a file with the wrong magic was read as a project")


def test_the_numbers_are_read_out_of_the_source_and_not_copied() -> None:
    at_x, at_z, yaw = read_cabin()
    assert abs(at_x - -34.17) < 1e-9 and abs(at_z - -7.03) < 1e-9, (at_x, at_z)
    assert abs(yaw - 0.318) < 1e-9, yaw
    lat0, lon0 = read_origin()
    assert abs(lat0 - 48.989009) < 1e-9 and abs(lon0 - -123.085318) < 1e-9, (lat0, lon0)
    # And from_world undoes to_world.
    lat, lon = from_world(*[to_world(48.99, -123.08, 0, lat0, lon0)[i] for i in (0, 2)],
                          lat0, lon0)
    assert abs(lat - 48.99) < 1e-9 and abs(lon - -123.08) < 1e-9, (lat, lon)


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
