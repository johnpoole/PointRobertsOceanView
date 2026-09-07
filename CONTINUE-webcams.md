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
suggests southwest, but is not a calibrated camera bearing.

Use the marina page as the source link. The embed URLs identify the players;
they are not documented snapshot APIs or stable raw-video endpoints.

## Possible uses for this project

- **Manual visual comparison:** compare cloud appearance, visibility and lighting
  with the rendered scene at a matching time. Exposure and white balance can
  change the picture, and conditions at the marina can differ from West Bluff.
- **Marina geometry reference:** inspect dock layout and building silhouettes
  visible in a frame. Identify fixed landmarks and solve camera location, height,
  heading and lens parameters before treating pixel positions as measurements.
- **Optional source link or viewer:** a future interface could open the source
  page, or use a supported provider embed if that is useful and permitted.

These are candidate uses, not a commitment to build them. Start with manual
comparison if a specific question arises. This is a different viewpoint from
the cabin's two calibrated Wyze cameras in [CONTINUE-cameras.md](CONTINUE-cameras.md).

## Before any automated use

Establish which view answers the question, whether its framing stays fixed, and
how capture time and freshness can be verified. Camera position, field of view,
image dimensions, update cadence and latency are currently unknown. No snapshot
API, archive, download interface or reuse terms were established during this review.
Check the provider's supported access and embedding/reuse terms for the intended
use before implementing capture or redistribution.

If integrated later, carry attribution and an explicit unavailable/stale state.
Keep visual inference separate from measured weather, tide and AIS feeds. A
marina image alone does not measure wind speed, wave height or tide elevation.

No polling, recording, image downloads or application controls were added.
