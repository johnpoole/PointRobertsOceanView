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

## Terrain clearance — 13 September 2026, issue #87

The owner's report of ground penetrating the deck/stairs reproduces on the
**active fine lidar tile**, not the 3 m CUDEM tile: the source grid is about
0.752 x 1.145 m (DNR 2023, ground returns). The earlier photo-detail diagnostic
used the coarse heightmap for terrain arithmetic; this check supersedes that
with the actual fine tile and the existing uphill-stair cut.

Before this correction, sampled ground was above the lower south deck by up to
1.85 m, the cabin concrete stairs by 0.44 m, the south timber flight by 1.51 m,
and the lower landing by 1.91 m. Those are model discrepancies, not measured
excavation depths. The model's estimated stair layout still needs photographs.

The cabin now supplies clearance polygons from its existing deck, tread and
landing constants. `ground-clearance.js` cuts only downward, below the modeled
undersides with an 80 mm gap. A full triangle diagonal of clearance plus a
600 mm outer transition keeps terrain interpolation out of those surfaces.
The existing uphill-stair carve also extends one refined triangle past its ends
and sides; its owner-specified location, count, rise and going are unchanged.

The small fine tile is subdivided four times per cell edge before cutting:
317 x 585 nodes, roughly 0.188 x 0.286 m spacing. This preserves the existing
survey triangle planes and adds **no measured elevation information**. It makes
the local cut margins about 342 mm instead of 1.37 m. The coarse near/far tiles,
source elevation files and the coarse-overlap margin remain unchanged. Fine
terrain now draws 275,328 triangles instead of 17,208, still in its existing
single mesh. This is a mesh cost measurement, not a device frame-rate claim.

`node src/scene/test-ground-clearance.mjs` checks cut-only/local bounds and 930
samples on narrow rotated surfaces. A temporary real-Three integration test
(`test-cabin-terrain.mjs` in Windows TEMP) builds the actual terrain and cabin:

- 54,130 deck/tread/landing samples are below their clearance ceilings in both
  the bilinear sampler and actual mesh triangle interpolation.
- The mesh and sampler use the same carved height array.
- Native survey values/nodata and 34,416 triangle-plane samples are unchanged by
  subdivision alone; the valid survey face count increases exactly sixteenfold.
- Cabin cuts change 952 refined nodes, all within 10.77 m of the cabin centre;
  they never fill terrain. Maximum cut below the existing uphill-carved surface
  is 2.76 m. Ground outside the local clearance region is unchanged.
- All sampled owner-positioned uphill treads are clear too, with at least about
  104 mm between the sampled terrain and tread top.
- Cabin geometry remains finite when built on the corrected fine sampler.

Depth-buffered before/after views include the actual cabin and nearby terrain,
inspected from west, southwest and uphill. Exact excavation profiles and stair
connections remain estimates until additional photographs resolve #42.

## New stair photographs — 13 September 2026, issue #42

Owner supplied `images/Photos-1-001`, containing 12 photos. These remain local
source files, outside the deployed application assets. The August 2026 images
are the current stair references:

- `PXL_20260808_202820423.jpg`: upper south flight is concrete with timber rails.
- `PXL_20260808_202833076.jpg`: concrete entrance beside the retaining wall meets
  the lower deck at its walking level, rather than 140 mm below it.
- `PXL_20260808_202908454.jpg` and `PXL_20260808_202910826.jpg`: concrete lower
  flight, an outer timber handrail, and the deck/bank relationship.
- `PXL_20260808_202937782.MP.jpg`: overall southwest arrangement.
- The 2021 approach images and May 2025 north-side image provide context, but do
  not settle the north timber stair's two end connections.

`southStairPlan` shares flight/landing constraints between the rendered cabin
and terrain-clearance footprints. Both south flights are concrete. The lower
landing now meets the lower deck at 8.55 m MLLW, with an L-shaped connection into
its open east end. The upper flight reaches a full-width landing at 10.45 m and
enters the upper deck through its east end; the blocking wire rail is removed.
Weathered timber rails meet the landing rails, and the lower flight has the
photographed outer rail rather than an extra rail against the retaining bank.

The existing turned arrangement is retained **provisionally**, not presented as
a measured orientation: the owner was asked whether the stair continues straight
or turns at the lower landing. The photos appear consistent with a turn, but
that question was unanswered when this refinement was made. The new plan has
estimated 18 lower rises of 165 mm and 10 upper rises of 190 mm, with 300 mm and
275 mm treads respectively. The lower foot shifts about 150 mm west so its final
tread meets the landing without coplanar overlap. These are constraints fitted
to existing model levels, not measurements extracted from uncalibrated images.

Validation: `test-cabin-stairs-plan.mjs`, `test-ground-clearance.mjs` and the
roof-notch regression pass. Real Three.js checks the actual merged lower access
path, every upper tread and upper deck transition with vertical rays; a
horizontal ray confirms the upper entrance has no blocking rail. 55,806 points
across modeled surfaces remain clear of both the terrain mesh and its sampler.
The separate owner-positioned uphill stair remains unchanged and clear.
Diagnostic geometry views with the nearby terrain were inspected from west,
southwest and uphill. Cabin remains one mesh, no textures, 7,600 triangles.

The north timber stair gaps, exact south stair measurements/orientation, and
stepped roof dimensions remain open in #42. This section supersedes the earlier
south timber-flight material and missing-landing findings; it does not claim
that every stair on the property is now surveyed or corrected.

## Paired entrance view — issue #88

On 13 September the owner identified this saved viewpoint as close to
`PXL_20211108_175012789.jpg`:

http://192.168.1.90:8091/#eye=48.989003,-123.085690,13.3&aim=48.991448,-123.087118,-57.9&fov=25.000

The photo is in `images/Photos-1-001` (also present in the engineering photo
collection). This is an approximate owner-supplied pairing, not a solved camera
calibration. Diagnostics use the URL eye/aim/25-degree vertical FOV and the
photo's 4:3 aspect. Cabin-local eye is approximately (4.238, 13.3, 9.499).

The comparison shows a narrow boarded passage along the east wall, a block
retaining bank, and no rail crossing the approach from the landing. Added those
features and removed the top-landing north cross-rail. The passage and confirmed
entrance recess now have local terrain clearance. The old shingle roof, meter,
loose furniture and stored items in the reference do not change the current roof
or become permanent model features.

Estimated passage: 1.165 m clear width, 6.39 m long, at the 10.45 m upper-floor
level, with narrow crosswise boards. Its far termination and wall alignment are
not surveyed. The retaining blocks use 200 mm courses, approximately 400 mm
lengths, staggered joints and a 40 mm setback per course. Bank height is guided
by the **uncut** fine terrain two metres behind the wall foot (that horizontal
sampling offset is itself an estimate), limited to 1.4–3.8 m above the passage.
This avoids using the lowered approach/stair cut as the retained bank top. It
is still a rendering approximation of a wall smoothed out by the elevation grid.
The modeled source-bank samples are about 12.5–12.9 m MLLW along this wall.

`buildTerrain` optionally preserves its pre-carve height array and exposes a
survey sampler for this purpose; walking and all usual ground-dependent objects
continue using the carved sampler. Only the small fine tile opts into that
additional copy (~0.74 MB). Near/far terrain paths keep their existing sampling.

Validation: 61,767 modeled-surface samples clear both mesh and terrain sampler;
actual geometry rays find passage boards and a retaining wall face, with no
cross-rail along the passage. The bank sampler matches the uncut refined survey.
Existing stair, roof-notch and local ground-clearance checks pass. Compared the
actual generated cabin/terrain at the paired eye/aim/FOV, using diagnostic light;
this is not a capture of the application's complete live scene. Cabin is one
mesh, no textures, 10,552 triangles; terrain mesh cost is unchanged. Source photos
remain local and are not deployed.

## Paired uphill overview — issue #42

On 13 September the owner paired `PXL_20211108_174949325.MP.jpg` in
`images/Photos-1-001` with this similar view:

http://192.168.1.90:8091/#eye=48.989090,-123.085536,19.0&aim=48.988271,-123.089047,-107.1&fov=25.000

The source is 4080 x 3072, orientation 1, captured 8 November 2021 at 09:49:49
according to its EXIF (no timezone established). EXIF identifies a Google Pixel 6
back camera, 6.81 mm f/1.85, with a 24 mm full-frame-equivalent focal length.
Assuming that equivalence describes the image diagonal, a nominal 4:3 frame gives
about 56.8 degrees vertical FOV: `2 atan(hypot(36,24) * 3/5 / (2*24))`.
This is a starting lens estimate, not an intrinsic calibration; processing,
cropping and distortion have not been fitted.

The URL gives a cabin-local eye of approximately (17.952, 19.0, 3.817), looking
24.857 degrees down. At 25 degrees vertical FOV the geometric horizon lies
outside the frame; at approximately 57 degrees it enters near the top, consistent
with the photo's broad ocean context. Changing FOV alone does not align the
roof corners, entrance, chimney or deck. Neither the eye nor the camera roll
has been solved from this photo. A starting comparison with the same eye/aim is:

http://192.168.1.90:8091/#eye=48.989090,-123.085536,19.0&aim=48.988271,-123.089047,-107.1&fov=57.000

Photo evidence: concrete uphill treads descend toward the upper entrance,
with a weathered timber handrail on the left when descending; the roof notch,
entry, upper deck and chimney provide possible alignment landmarks. The near
stair flight is partly hidden by the dog and vegetation. `buildStair` currently
renders concrete treads/risers without that handrail. Its owner-positioned
foot, bearing, count and tread dimensions remain the controlling constraints
in `assets/site/389-stair.json`. This image does not settle the separate lower
south landing turn or the north timber stair connections.

Next work in #42 (superseded by the owner clarification below): resolve known
missing or disconnected access geometry first, using all paired photographs.
The saved views are approximate comparison positions constrained by model errors,
not measured photo origins. Camera fitting may help assess the corrected model,
but is not a prerequisite for fixing independently established defects. Keep the
original saved URLs as evidence and retain the owner-positioned uphill flight.
The 2021 roof covering is historical; current metal roof remains the target.

Inspected the source photo and actual cabin/local terrain geometry using the
saved eye/aim at both 25 and approximately 57 degrees, in a nominal 4:3 diagnostic
render. The diagnostic omits the separate uphill stair mesh, distant scenery,
neighbours and vegetation; their absence in that diagnostic is not a finding
about the application. The missing uphill handrail was confirmed in source.
No geometry or application camera defaults changed in this evidence-recording
step. Source photographs remain local and are not deployed.


## North-side photo and inaccessible photo origins � issue #42

Owner clarification, 13 September: errors in the model prevent placing the camera
at the photographs' actual origins. This saved view is **higher than** the origin
of `PXL_20250517_150947629.MP.jpg`:

http://192.168.1.90:8091/#eye=48.989143,-123.085693,15.7&aim=48.988391,-123.088990,-142.3&fov=25.000

Treat the link as a comparison view, not a surveyed photo station or a camera pose
to which the model must be fitted. The 15.7 m eye elevation is not the photograph's
height, and the difference in height is unknown. The earlier recommendation to
solve camera framing before access geometry was too restrictive: model defects
can prevent that fit in the first place. Lens metadata remains useful, but does
not explain away missing structures or erroneous ground.

The source photo directly shows a boarded landing against the north wall, an
outer timber handrail, a small window, deep exposed timber eaves, and a stair
continuing downhill. The frame does not reveal the entire landing length or the
stair's ultimate lower connection. A diagnostic of the actual current cabin and
local terrain at the saved 25-degree view confirms that the model has no such
landing along the north wall. In code, the north flight is entirely west of the
wall: tread centres run from local X -4.195 to -6.435, while the wall starts at
X -3.235. Its wallward edge is Z -3.840, leaving 0.445 m to the deck's north edge
at Z -3.395. Those independently established layout defects do not require a
solved photo camera. The missing landing also has no clearance footprint in
`cabinGroundSurfaces()`.

Checked current terrain mesh and sampler at local Z -3.85, X 3 through -3 in
one-metre increments. Terrain drops from roughly 10.48 to 7.94 m MLLW along
that route. At its uphill end it is slightly above the modeled upper floor
(10.45 m); at its downhill end a landing would require supports. This is a
sampled model profile, not a surveyed landing elevation or proof that the saved
camera eye is inside terrain. Adding a floating board or lowering the whole bank
would not establish the correct access arrangement.

Work priority in #42 is now the missing north landing, its supported relationship
to the wall/stair/decks, and local terrain clearance. Preserve the stated higher
comparison view and use the photo as structural evidence; do not require the
owner to obtain an exact photo origin through incorrect geometry. Exact landing
extents and the stair's complete route remain unresolved. No model geometry was
changed in this inspection. The diagnostic excludes surrounding buildings,
vegetation and distant scenery; it is not a live application screenshot.

## Road-to-cabin walkthrough extracted — issue #42

Owner supplied `images/VID_20170718_072727~2.mp4` after the Google Photos link
required sign-in. The local copy has been viewed through extracted frames:
34.097911 seconds, 1920 x 1080, 1023 video frames, creation metadata dated
18 July 2017. SHA-256:
`93db776f7630102bc32a4822ba09d199d468e3c4a09bb5f8ebc8c68daf3ed827`.

`images/cabin-walkthrough-20170718/` contains 69 full-resolution JPEGs at roughly
half-second intervals, four timestamped contact sheets, a six-frame `keyframes.jpg`,
and a README explaining the route evidence. `manifest.json` preserves exact
source presentation timestamps/frame indices and metadata; `extract-frames.py`
reproduces the extraction from the project root. The video's 180-degree display
rotation is applied, with no enhancement or geometry warping. All 69 dimensions,
frame count and increasing timestamps were checked; sheets and key frames were
visually inspected. Video and derived images remain untracked local references.

The demonstrated sequence is: upper approach (owner identifies the start as the
road), paved route beside the shed (5–16 s), wider paved junction/turn against a
retaining wall (21.5–25 s), then the concrete descent toward the recessed entrance
and upper deck (25–34 s). A pan at 16–18 s reveals a separate stepped area beside
the shed; the camera does not traverse that branch. At 32.5–33.5 s, the stair foot,
entrance/upper deck and separate lower stair are visible together. The final
concrete descent has an outer timber rail on the left when descending.

This improves evidence for the order and relative connection of the access
structures. Reconcile that main final flight with `assets/site/389-stair.json`
and the additional provisional upper south flight in `cabin-stairs-plan.js`,
rather than assuming each independently modeled flight has a separate photo
counterpart. It does not by itself prove a replacement plan or exact turn angle.
The upper paved junction is not the lower-deck landing. The video ends above
the entrance, without traversing all landing transitions or the lower route.
It does not resolve the north stair connections or establish surveyed lengths,
heights, bearings or tread counts. No model geometry changes in this extraction
step. Historical roof covering and vegetation do not override current photos.

## Walkthrough-based entrance connection implemented — issue #42

The 25–34 second sequence establishes the final concrete flight reaching a level
entrance/deck junction with an outer timber handrail. At the existing owner controls,
the flight foot is cabin-local (6.311, 4.838), while the entrance landing's open east
edge is at X 4.385. The missing approximately 1.9 m connection is now a 2.054 m²
concrete plate at 10.45 m MLLW, meeting the full 1.20 m stair width and the 0.91 m
entrance edge. The rail and post formerly across that entrance edge are removed.
The outer landing boundary carries a timber rail that continues up the flight,
on the left when descending, as photographed.

A 1.30 m deep by 1.20 m wide paved head landing meets the far edge of the last
tread at 13.4632 m MLLW. Its shallow joints and the weathered timber rail are
geometry, with no new textures. Landing depth, plate thickness (200 mm), taper
and timber dimensions are estimates anchored to the current stair/deck controls.
The owner-positioned foot, bearing, 19 treads, going and rise are unchanged.
The 2026 south photographs corroborate the separate between-deck flight, which
remains rather than being incorrectly removed as a duplicate of the road stair.

`cabinApproachEdge()` supplies the shared entrance boundary. `stairAccessPlan`
derives both landing polygons from that boundary and the owner stair data.
`buildStair` and `stairCarve` receive the same boundary from main, so drawn
landing plates and terrain clearance agree. The landing cuts lower terrain
only, with 80 mm beneath the plate underside and the existing grid-diagonal
margin/fade. Relative to the preceding terrain, 210 refined nodes are lowered,
at most 1.769 m; the fine grid density and all source elevation data are unchanged.

Validation: stair-access plan, south-stair plan, ground-clearance and roof-notch
checks pass, plus JS syntax. Real Three.js checks 5,786 points beneath the new
landing meshes against both actual terrain triangles and the walking sampler;
upward-facing plates are present at the intended heights. A 0.50 m wide body
corridor across the old gap and former blocking rail is unobstructed and supported.
All 19 owner treads remain present. Existing 61,767 cabin-surface clearance samples,
lower/upper deck access rays, passage checks and 34,416 survey-plane comparisons
still pass. Inspected actual cabin/stair/terrain geometry from the supplied uphill
view and two diagnostic angles. These use diagnostic lighting, not live browser
captures. Stair geometry is 3 meshes / 696 triangles (previously 2 / 456), cabin
remains 1 mesh / 10,516 triangles; no new textures or terrain triangles.

This completes the supported final-flight connection, handrail and head-landing
correction. The full road/shed path and retaining junction need geographic/level
anchors before extending the model uphill. The north-side landing/stair defects
are not shown by this video and remain open in #42, as do exact dimensions.

## Blender source and north access - issues #89 and #42

The editable source is now authoring/cabin/cabin.blend (Blender 4.5 LTS), with
22 named model meshes, original/cleared terrain references, 12 local photos,
69 walkthrough frames, four contact sheets and six comparison/inspection cameras.
See authoring/cabin/README.md for axes, controls and the edit/export workflow.
The saved comparison cameras are not solved photo origins.

The north landing now runs against the north wall at 10.45 m MLLW, with nine
estimated timber steps descending west to a 0.91 m landing at 8.55 m that meets
the lower deck. Rails connect to both landings. New clearances cover both plates
and the relocated treads. Dimensions remain photo estimates.

The web loads assets/site/389-cabin.glb: 11,904 triangles in three material
batches, 972,396 bytes. Its 49 terrain-ceiling polygons, approach controls and
source hash travel inside the same file as the geometry. Original JS geometry
is a load-failure fallback only. Export merges copies; the .blend stays editable.

Validation uses the app's actual Three r186 GLTFLoader, checks source/export
hashes, colours and geographic placement, 50,048 actual terrain-triangle/sampler
clearances, the north landing/stair/deck connection and all 19 approach treads.
Existing roof-notch, south-stair, approach-landing and clearance checks pass.
Blender inspection renders were reviewed from southeast, north and southwest.
All 85 external reference images resolve locally and are excluded from the GLB.

This completes the Blender conversion and north connection correction, not the
entire road-to-cabin reconstruction. The upper road/shed path and remaining
photo reconciliation stay open in #42. Having all frames available in Blender
must not be reported as having used every frame to correct geometry.

## Video evidence applied to rendered geometry - issue #90

The earlier Blender conversion did not apply the full walkthrough evidence.
The model now includes the shed-side paved approach, downhill border/upper rail,
gabled timber shed and doors, separate seven-step branch and retaining wall,
widened turn, bench alcove, planting edges, continuous connection to the existing
19-step descent, and simple round deck table/chairs. Fifty named Blender meshes
export to 18,580 triangles in five batches (2,717,180 bytes).

Actual video pixels are now used too: frame 034 at 17.03 seconds supplies the
shed's weathered wood, and frame 047 at 23.53 seconds supplies paving. UV regions
exclude foreground plants. Those two full JPEGs are embedded in the GLB; other
reference images remain excluded. All 69 frames were reviewed in contact sheets;
walkthrough-evidence.json records the ranges, uses and the two texture frames.
This is photo-guided geometry, not a camera solve or metric photogrammetry.

Roadward path levels use the lidar bank; the lower turn meets the owner-controlled
head landing at 13.4632 m MLLW. Path width is estimated at 1.1 m. Shed footprint,
height, separate branch count and support piers are estimates; the support
arrangement is not visible in the video. Current roof planes/material and the
mapped entrance notch are preserved. Remaining exact geometry reconciliation
continues in #42 rather than claiming the source is now survey accurate.

Exported terrain constraints increase from 49 to 201 polygons, including each
paving foundation and branch tread. The app terrain and walking sampler clear
63,984 sampled points; 727 route/headroom samples cover the new path, turn and
branch. Measured trunks avoid these corridors. The existing north connection
and all 19 owner treads still pass. The two embedded textures decode and load
through the actual Three r186 GLTFLoader. Final textured Blender comparisons of
the shed and bench junction were inspected; authoring/cabin/compare.html exposes
them beside frames 034/047 through the local preview.

The stopped localhost:8097 preview was restored with the project app server.
Its Windows virtual environment needed tzdata and the already-declared
pycryptodome dependency. These were installed locally; server code was unchanged.
The preview serves the current GLB bytes. Export.py includes geometry, UVs, two
selected textures, clearance controls and source hash in one asset.

## Photo refinement - issue #93 (13 September 2026)

Edited the existing Blender source against the still photographs: shed door
coverage and board courses, shingle/rake detail and Pooles plaque; staggered,
weathered retaining blocks; small approach planting; pale cabin fascia and
weathered timber; green storage door/enclosure and stepped retaining beside
beach stairs. Added a terrain ceiling at the storage apron to expose its door.
Six stills informed changes; the remaining six were reviewed and unresolved
features are listed in authoring/cabin/photo-review.json. Four approximate
inspection views are on authoring/cabin/compare.html. No camera solve is claimed.
The broader bank, stair/deck fit and upper route profile remain in #42.

## Camera-pan route correction - 14 September 2026, issue #93

John corrected the 22-25 second interpretation: the camera turns right/north
and then continues west; the path does not make two right-angle turns. Removed
the false dogleg from the Blender export and its terrain clearances, keeping
both in a hidden non-exported archive. A continuous gently bending westward
approach now joins the unchanged final stair head, with a side pad for the bench.
The corrected route is checked against measured trunks and real GLB walking
surfaces. Frame 047 supplies surface pixels only, never route direction.
Comparison shows frames 040/052, a westward view and an overhead route view.
Authoring edit: authoring/cabin/correct_route.py. Exact curve and elevations
remain estimates; the owner's direction correction overrides earlier notes.


## Green door and lower enclosure correction - issue #95

The owner paired PXL_20260808_202937782.MP with the south-side eye
48.988889,-123.085828,4.2 and aim 48.991573,-123.086080,23.0, FOV 57.
The green door belongs in the first seaward bay underneath the lower south
deck, not near the middle of the return. The saved Blender source places it
there along the raked rim, with connected enclosure boards, recessed lattice,
a supported apron and a small rock shelf. Its terrain clearance moves with it.
Storey/deck levels, the mapped roof and owner-controlled approach are retained.
Exact dimensions, rock profile and camera/photo registration remain estimates.
See authoring/cabin/correct_green_door.py, green-door-layout.json and
render_green_door.py. The local comparison now uses the owner camera.


## Upper deck taper and tree notch - issue #96

Owner selected images/PXL_20211108_174949325.MP.jpg to establish the
upper south return widening toward the water. The November 15 photograph
shows the three-sided rail around an open tree notch. The saved Blender
source now has a tapered return (estimated 0.91m east, 2.40m west), open
notch around the existing site tree, matching rail/rim/framing and terrain
clearance. Actual GLB tests check the notch void, clear passage beside the
cabin, and widened floor. Source: refine_upper_deck.py and upper-deck-layout.json;
local comparisons: render_upper_deck.py. Exact dimensions remain estimates.


## Shallow deck notch and photo-corrected tree - issue #97

Owner photo images/PXL_20220615_171325558.jpg shows the tree barely inside
the west edge. The earlier site-tree anchor was wrong for this fit; it must
not drive a 3.15m slot through the deck. The corrected tree centre is 0.15m
inside the edge, and the notch is 0.83m deep (estimated). Runtime site-tree
data and Blender inspection trunk share the new position. Original coordinates
are retained in position_override on the cabin-deck-tree row; preserve them
and the override when refreshing the lidar bake. Deck, rail, framing and
clearance restore the former oversized opening. See correct_deck_tree.py.


## Deck width and sparse leaning tree - issue #98

Owner reference: images/20190112_130800.jpg. Upper westward projection is now
2.40 m (was 3.90), lower 2.10 m (was 3.20). Rails, framing, lower lattice,
terrain clearance and the full-width green-door bay follow the narrower rim.
The southward taper and anchored stair flights remain. The front tree now
leans an estimated 6 degrees seaward with irregular forked limbs and 16 small
foliage clusters. Its trunk centre at deck height remains 0.15 m inside the
rim, so the notch is still shallow (0.83 m). Root ground uses the original fine tile; support footings use the cleared
terrain reference. Both use the corrected world-to-latitude offset.

389-trees.json stores the shape; src/scene/deck-tree.js renders it in two
merged meshes and trees.js excludes its generic dense crown. The Blender
context tree uses the same shape but is excluded from the cabin GLB.
refine_deck_width_tree.py is a one-time migration from the #97 source.
Exact dimensions, lean and branch layout remain visual estimates.

Verification: Three r186 geometry and visibility, 58,917 terrain checks,
846 complete-route walking/headroom samples, shallow notch and deck rays,
full-width door rays. Export: 44,789 triangles, five batches, 5,657,588 bytes,
173 terrain ceilings. Local compare.html has updated deck/notch, sparse-tree
and owner south-camera renders. No raw photo or video added to git.


## East retaining wall and hillside - issue #99

Owner confirms images/PXL_20211108_175012789.jpg is current for the wall and
hill, but not the cabin. refine_east_wall.py replaces the uneven lidar-derived
wall top with complete staggered courses and 25mm-per-course setback. Estimated
block/course sizes 0.40/0.20m; 8/9/10 courses from north to south. Passage, cabin,
roof, decks and stair meshes remain unchanged. Adds a local scenic bank skin,
brush/grass, surface weathering and pale split stump/root mass above the wall.
The bank is visual geometry, not a new elevation survey or fitted walking surface.
112 clearance triangles keep existing terrain below the skin.

Source: cabin.blend, layout: east-wall-layout.json; web: 389-cabin.glb.
65 named meshes; 43,393 export triangles, five batches, 5,434,488 bytes,
285 ceilings. Tests include complete wall courses, board-centre rays, passage
headroom and bank surface/terrain checks, alongside the full stair route and
prior deck/tree/door checks. Local compare.html and render_east_wall.py show
the photo and two approximate inspection views. Reference media remain local.


## East-facing stair-base photo - issue #100

images/20190731_104156.jpg clarifies a broad decayed stump with exposed core,
wall return, leafy growth and lower left/north handrail. refine_stair_east.py
replaces the prior log-shaped stump, fills the over-cut bank lip, adds the
short wall return and north rail, and weathers the concrete/timber finishes.
Estimated stump 1.16 x 1.55 x 1.13m; exact shape/location not surveyed.
Concrete face subdivision only changes colour detail, not tread/riser planes.
Controls and 59 other existing mesh geometries remain unchanged. Verification
checks three walking lines/headroom across all 19 treads and the prior full
route, wall, bank, tree, deck and door constraints. 69 source meshes; export
52,402 triangles, five batches, 6,674,696 bytes, 285 terrain ceilings.
stair-east-layout.json records evidence; render_stair_east.py and refreshed
wall renders appear on local compare.html. Raw images/videos stay out of git.
