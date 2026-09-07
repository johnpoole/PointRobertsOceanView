# Point Roberts Marina webcam reference

Source supplied by John and inspected on 6 September 2026:
[Point Roberts Marina webcams](https://www.pointrobertsmarina.com/webcams/).
Documented for possible use; no integration has been selected or implemented.
The future-use decision is tracked in [issue #46](https://github.com/johnpoole/PointRobertsOceanView/issues/46).

## What is available

The marina page contains two HDOnTap players, in this order:

| Player | Stream identifier | Provider embed |
| --- | --- | --- |
| First | `point-roberts_sw-view-CUST` | [Open player](https://portal.hdontap.com/s/embed/?stream=point-roberts_sw-view-CUST&ratio=16%3A9&fluid=true) |
| Second | `point-roberts_prm-CUST` | [Open player](https://portal.hdontap.com/s/embed/?stream=point-roberts_prm-CUST&ratio=16%3A9&fluid=true) |

Browser inspection showed moving video in the first player and a preview with a
play button in the second. The views showed docks, marina water, nearby buildings
and sky. Both displayed time and weather overlays. Second-stream playback,
capture latency and overlay provenance were not verified. The `sw-view` name
is not a calibrated camera bearing; use John's westward-aim observation below.

Use the marina page as the source link. The embed URLs identify the players;
they are not documented snapshot APIs or stable raw-video endpoints.

## Calibration inputs supplied by John — 7 September 2026

Both cameras share the same origin:

| Input | Value | Status |
| --- | --- | --- |
| Latitude | 48.97709213776401 | Owner supplied |
| Longitude | -123.06334200875824 | Owner supplied |
| Height above local ground | 12 ft = 3.6576 m | Owner supplied; not an absolute elevation |
| Approximate aim | Almost directly west (near 270°) | Initial estimate, not a solved heading |

For this project's MLLW coordinates, camera elevation is the ground elevation
at that origin plus 3.6576 m. Validate the ground sample and its datum before
using it; do not mistake the mounting height for elevation above sea level.
Retain these as supplied values, not a claim of survey precision.

Direction and effective lens parameters can be estimated from images with
enough identifiable, well-distributed landmarks whose 3D positions are known.
An arbitrary image alone does not uniquely determine them or identify a physical
lens make/model. Treat each camera independently even though they share an origin.

Proposed calibration work, not yet performed:

1. Establish a representative frame's actual pixel dimensions, crop and aspect
   ratio, and whether the camera pans, tilts or zooms. Save its timestamp when
   a frame is acquired for calibration; the player overlay alone does not prove
   capture time.
2. Match fixed landmarks across the width, height and depth of each view to
   mapped coordinates and elevations. Prefer fixed shore structures and terrain;
   floating docks and boats are not fixed-height controls.
3. Hold the supplied origin as the initial constraint. Fit heading, tilt and roll,
   and effective horizontal/vertical field of view for each image. Start with a
   pinhole model; fit distortion only if edge coverage and residuals support it.
   Field of view is enough for rendering; focal length in millimetres also
   requires sensor dimensions.
4. Check landmarks withheld from fitting, report pixel residuals and uncertainty,
   and inspect systematic errors before accepting the result. A shared position
   does not imply shared lens settings, crop or aim. Changing zoom or aim requires
   another calibration.

The [OpenCV camera calibration documentation](https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html)
describes the camera intrinsics, pose and distortion model underlying this approach.
No heading, tilt, roll, field of view or distortion has been solved yet.

## Possible uses for this project

- **Manual visual comparison:** compare cloud appearance, visibility and lighting
  with the rendered scene at a matching time. Exposure and white balance can
  change the picture, and conditions at the marina can differ from West Bluff.
- **Marina geometry reference:** inspect dock layout and building silhouettes
  visible in a frame. Use the supplied origin and height, validate ground elevation,
  and solve heading and lens parameters before treating pixels as measurements.
- **Optional source link or viewer:** a future interface could open the source
  page, or use a supported provider embed if that is useful and permitted.

These are candidate uses, not a commitment to build them. Start with manual
comparison if a specific question arises. This is a different viewpoint from
the cabin's two calibrated Wyze cameras in [CONTINUE-cameras.md](CONTINUE-cameras.md).

## Before any automated use

Establish which view answers the question, whether its framing stays fixed, and
how capture time and freshness can be verified. Position and mounting height are
recorded above; absolute elevation, precise orientation, field of view, distortion,
image dimensions, update cadence and latency remain unverified. No snapshot
API, archive, download interface or reuse terms were established during this review.
Check the provider's supported access and embedding/reuse terms for the intended
use before implementing capture or redistribution.

If integrated later, carry attribution and an explicit unavailable/stale state.
Keep visual inference separate from measured weather, tide and AIS feeds. A
marina image alone does not measure wind speed, wave height or tide elevation.

No polling, recording, image downloads or application controls were added.
