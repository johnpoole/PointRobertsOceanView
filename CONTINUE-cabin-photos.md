# Cabin photo refinements — 13 September 2026

Tracked in [issue #42](https://github.com/johnpoole/PointRobertsOceanView/issues/42).
The owner requested use of `../PointRobertsEngineering/photos`. Inspected all 43
extracted JPGs as contact sheets, then eight relevant images at larger size.
The two MP4 files were not used. Source files remain in the engineering project;
no photographs or photographic textures are published by this change.

## Evidence used

| Source in `photos/extracted` | Visible feature used |
| --- | --- |
| `PXL_20250513_142906884.jpg` | New metal roof seams run down the slopes; narrow raised ribs |
| `PXL_20250513_142953377.jpg` | Overall new roof appearance; main roof retained, stepped junction still unresolved |
| `PXL_20250517_150947629.MP.jpg` | Exposed timber underside and trim at the deep overhang; north window exists |
| `PXL_20250517_151016664.MP.jpg` | New metal roof, edge trim and standing seams |
| `PXL_20250514_163557098.jpg` | Two paired lower west glazed openings, continuous support posts, beams/braces, open square lattice |
| `PXL_20220612_133244811.jpg` | Southwest deck knee braces; open underside of south return |
| `PXL_20221008_175944928.MP.jpg` | Weathered square west lattice and diagonal screen recessed behind south deck |
| `20190731_103926.jpg` | Small vertical lower south window; concrete stairs leading toward upper entrance |

Older photos establish persistent features; they do not replace the current
metal roof with the former shingle roof. Member dimensions, spacing and opening
sizes remain visual estimates, not photogrammetric measurements. The lidar
ridge/slopes, outer roof plan, owner-confirmed southeast notch, inset entrance,
upper glazing, floor elevations and overall deck plans remain unchanged.

## Changes

- Thirty standing-seam ribs follow both roof slopes, clipped at the notch.
  Ribs are approximately 25 mm wide and 40 mm high, at 550 mm spacing.
- Gable fascia follows the two pitches instead of cutting horizontally across
  their ends. Timber soffit strips sit below the north/south overhangs.
- Four west deck posts extend from the sampled ground (embedded 180 mm) to
  the upper beam underside at 10.09 m MLLW. Longitudinal and transverse beams
  reach the deck underside at 10.31 m; knee braces join posts and beams.
- Two separated paired glazed lower west openings replace three equal bays.
  Added the photographed narrow lower south window.
- The west skirt is open square slats, approximately 26 mm wide on 130 mm
  centres. The south outer skirt is open on its posts, with a diagonal screen
  recessed at the house. That screen is clipped against interpolated terrain
  and the lower deck underside; it is not a measured construction detail.

## Validation and cost

`node --check src/scene/cabin.js` and `node src/scene/test-roof-notch.mjs` pass.
A temporary diagnostic using real Three.js r160 and the baked bilinear terrain
sample checks finite buffers, all 43 roof components clear the notch, all 30
rib bases/heads follow the measured plane, and all four posts meet terrain and
beam elevations. Ray sampling finds 66.7% of the west lattice area open.

Cabin remains one merged mesh and zero textures: 7,768 triangles, compared with
5,726 before (+2,042). This is geometry cost, not a target-device frame-rate
measurement. Depth-buffered diagnostic views of the actual generated geometry
were inspected from southwest, uphill and west, before and after. These use
simple diagnostic lighting without terrain, not the live application's lighting.
Temporary test/render scripts and views are in the local Windows TEMP directory
(`test-cabin-photos.mjs`, `render-cabin-depth.py`, `cabin-photo-depth-comparison.png`).

## Still unresolved in #42

The uphill roof photograph shows a stepped junction and more complex outline.
Do not invent a step height or revise the confirmed notch from an uncalibrated
photo alone. Stair layout also needs reconciliation: the existing speculative
south timber turn does not match the concrete continuation visible in the south
photo, and both old timber flights retain connection gaps. These were left
unchanged rather than claimed as fixed by the current facade/detail refinement.
