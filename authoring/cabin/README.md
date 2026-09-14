# Cabin authoring in Blender

`cabin.blend` is the editable source for 389 West Bluff. Issues #89, #90 and #93 continue #42.
The web app loads `assets/site/389-cabin.glb`, exported from this file. The original
procedural builders remain only as a fallback when the GLB cannot load.

Open the source with Blender 4.5 LTS. This machine has a verified portable copy:

```powershell
& 'data/tools/blender-4.5.10-windows-x64/blender.exe' 'authoring/cabin/cabin.blend'
```

The **MODEL** collection has 63 named editable meshes: walls, upper/lower glazing,
notch doors, roof shell, standing seams, fascia/soffits, chimney, decks, framing,
retaining blocks, access structures and the video-derived shed, paving, branch
steps, retaining walls, bench, planting and deck furniture, plus shed hardware,
the Pooles plaque and underdeck storage details. Original mesh
positions are welded for vertex/edge
editing; colours are a `Color` corner attribute. These are editable meshes, not a
parametric architectural/BIM model. Further subdivision into objects can be done
in Blender without changing the exporter.

Use metres. Blender X is east, Y north, Z up. Horizontal zero is the fitted roof
centre, Three world X -34.17 / Z -7.03. Heights are metres above MLLW, not relative
to the ground. The building's 0.318-radian rotation is already in the geometry.
The GLB exporter handles Z-up to Y-up; the web loader adds the horizontal origin.

**CONTEXT** holds two cropped terrain meshes: the cleared terrain is visible;
the original survey is hidden. Both are reference geometry and excluded from the
GLB. The app still renders and samples its existing terrain tiles.

**REFERENCES** contains all 12 photos from `images/Photos-1-001`, all 69 extracted
walkthrough frames, and four contact sheets. Enable the collection's viewport
monitor in the Outliner to view its image boards. Paths are relative to the
project, and all 85 files were verified present. Images remain external local
files; the .blend does not pack them. The GLB now embeds **two selected frames**:
034 (17.03 s) supplies weathered wood to the shed, and 047 (23.53 s) supplies the
paving surface. UV coordinates select those surfaces, excluding foreground plants.
The other reference images are excluded. `START HERE` explains the collections.
`walkthrough-evidence.json` maps all 69 reviewed frames to their evidence ranges;
only the two named frames supply texture pixels. No camera/photogrammetry solve
is claimed.

**CAMERAS** has six inspection views and the owner's three saved comparison
views at 25-degree vertical FOV. The comparison views are not solved camera
poses; the supplied north view is explicitly higher than its photo. Historical
2017/2021 roof covering does not replace the current standing-seam roof.

## Edit and publish

1. Edit named meshes in **MODEL**. Preserve the mapped roof/upper-storey notch,
   measured roof slopes and levels, and owner-positioned 19-step approach unless
   new evidence supports changing those controls.
2. When changing walking surfaces, enable **CLEARANCE** and edit the matching
   horizontal ceiling polygons with them. These represent the underside minus
   clearance, rather than the surface people stand on. Deck/tread mesh edits do
   not automatically move these helpers. The exported polygons drive both the
   terrain mesh and its walking sampler.
3. If editing the 19-step approach flight, also update the five **CONTROLS**
   empties: foot, last riser, half width, and entrance edge endpoints. The exporter
   derives location, bearing, going, rise and width from them; step count is in
   the scene's `approach_stair` property. Terrain's surrounding approach cut keeps
   its existing margin and fade. Keep controls, treads, landings and clearance
   helpers together; the verification below catches displaced treads.
4. Save the .blend, then export and verify from the repository root:

```powershell
& 'data/tools/blender-4.5.10-windows-x64/blender.exe' --background authoring/cabin/cabin.blend --python-exit-code 1 --python authoring/cabin/export.py
node authoring/cabin/verify.mjs
```

`render_walkthrough.py` produces five textured comparison renders under
`data/cabin-blender` (roughly half a minute per view on this machine). Open
`authoring/cabin/compare.html` through the local preview to compare them with the
source frames. The video/reference files and inspection PNGs remain local.

`export.py` merges evaluated copies for the web; it does not save or merge the
editable source. It exports model geometry and terrain/control metadata in the
same GLB, excludes references/terrain/cameras, and writes `export-report.json`
with source and asset hashes. Commit the .blend, GLB and report together.

The Node verifier uses the app's actual Three.js r186 GLTFLoader. Its local
dependencies live under ignored `data/cabin-blender/three`: `three.module.js` and
`three.core.js` from `https://unpkg.com/three@0.186.0/build/`, plus
`loaders/GLTFLoader.js`, `utils/BufferGeometryUtils.js` and `utils/SkeletonUtils.js`
from `https://unpkg.com/three@0.186.0/examples/jsm/`. An alternate directory can be
passed as the first argument. It checks export hashes, materials, coordinates,
actual terrain triangles and sampler, the north stair connection, and all 19
approach treads. It also decodes the two embedded images through Pillow, checks
846 samples along the complete new route for support and headroom, and checks
the route against measured trunk positions. Node's texture upload is not a GPU
render; textured Blender renders supply the visual check.

After changing geometry, run `verify.mjs`, then run `refresh_context.py` in
Blender to update its cleared terrain reference from the actual app height grid.
Save/export again to update the source hash. This keeps the authoring view and
web terrain consistent without deploying a second terrain mesh.

Initial export: 11,904 triangles, three material batches, 972,396 bytes. The
north-side change provides a 0.91 m boarded landing along the wall, nine timber
steps westward and a 0.91 m lower landing meeting the lower deck. The outer rails
reach both landing boundaries. Lengths and count are estimates from the May 2025
photo, constrained by the existing storey heights; they are not surveyed values.

Issue #90 adds the road-side approach, a 1.1 m paved path beside a timber shed,
separate shed-side steps, widened paved turn, bench alcove and retaining wall,
connection to the existing 19-step descent, garden edges and simple deck furniture.
That version exported 18,580 triangles in five batches, 2,717,180 bytes,
with 201 terrain-ceiling polygons. Source terrain is unchanged; the cuts and
walking sampler use the exported constraints. The route, shed size, branch step
count and support piers are estimates anchored to the road, lidar and stair
controls. The pier arrangement is not visible in the video. The modeled route
is continuous but is not a measured reconstruction of the camera trajectory.

`apply_walkthrough.py` records this one-time Blender edit and refuses to duplicate
the new objects. Subsequent adjustments belong in the saved .blend. Remaining
dimensional/photo reconciliation stays in #42.

Issue #93 refines the saved model against the still photos. The shed has twelve
board courses, full-width doors, small hinges/latch, a shallow shingled roof with
rake fascia, and the photographed Pooles plaque. Retaining walls have staggered
joints and worn edges. The original passage wall keeps its footprint with varied
block tones. The newer cabin photos establish pale fascia and gray weathered
deck timber. The August south views add the green six-panel storage door,
threshold, flanking enclosure boards and stepped retaining tiers beside the
beach stairs. A separate terrain ceiling clears its apron so the bank cannot
bury the door. Upper planting uses smaller leaf/grass clusters and white daisies.

`refine_photos.py` records this one-time edit on the post-#90 source and refuses
to apply twice. That export was 43,956 triangles, five material batches,
5,558,292 bytes and 202 clearance polygons. The two embedded video images remain
the only textures; the stills guide geometry and colours. `photo-review.json`
distinguishes six photos used in this pass from six reviewed views with remaining
work. Camera positions, bank profile, stair dimensions, shed placement and
supports remain estimates. The Blender comparison page now includes shed,
junction, east passage and south/beach views; these are inspection views, not
calibrated camera matches.

Owner correction, 14 September 2026 (#93): the camera pans north around 22-25
seconds, then continues west. This interval does not establish two physical
right-angle turns. `correct_route.py` replaces the false dogleg with a smooth
westward approach joining the exact existing stair-head edge. The bench sits
on a side pad; the retaining edge and path-side planting follow the corrected
layout. The rejected corridor and its old terrain ceilings are kept in hidden
**ARCHIVE - rejected camera-pan dogleg**, outside the exported MODEL/CLEARANCE
collections. Do not re-enable them for export or terrain carving.

The current asset is 43,577 triangles, five batches, 5,547,232 bytes and 171
terrain ceilings. `walkthrough-layout.json` records the route cross-sections;
the verifier checks real walking surfaces, continuous westward progress, gradual
heading changes, measured trunk clearance and the retained stair-head join.
The comparison now pairs frames 040 and 052 across the excluded pan, with a
westward inspection view and an overhead route view. Frame 047 remains a paving
texture source only. Connecting curve, bench position and elevations remain
estimates between the existing anchors; no camera trajectory solve is claimed.

## Green door correction

Issue #95: the owner paired `PXL_20260808_202937782.MP.jpg` with a south-side
camera. The former green door sat about three metres too far uphill, detached
from the seaward enclosure. `correct_green_door.py` moves the existing door and
frame to the first bay below the lower south deck, turns it along the raked rim,
and adds the short enclosure return, recessed side lattice, apron and supporting
rock shelf. The terrain clearance moves with it; the obsolete uphill cut is gone.
The rock shelf joins the actual terrain around the threshold. It is model geometry,
not a change to the elevation source. Door dimensions, enclosure and rock profile
remain visual estimates; established deck levels, roof and stair controls stay fixed.

`green-door-layout.json` records the evidence, estimates and owner's saved camera.
`render_green_door.py` renders that camera at 57° vertical FOV on a 4:3 canvas
in roughly twenty seconds. The local comparison uses this image alongside the
August still; it is not a solved camera match. The current export has 43,997
triangles, five material batches, 5,590,416 bytes and 171 terrain ceilings.
The verifier checks the relocated doorway with rays through the GLB, the solid
apron surface, terrain below it, and absence of the rejected uphill door.

## One-time migration

Issue #101 corrects the disconnected scenic bank treatment from #99/#100.
`reconcile_entrance.py` archives the separate soil skins, their planting,
the diagonal wall return and 112 bank clearance triangles. The cabin, stair
controls, walking surfaces, original retaining wall, stump and lower left rail
remain. Existing ground photographs were reconciled together; late walkthrough
frames establish the descent but do not show the entire landing. No overhead
image or new sketch was needed. `entrance-layout.json` records the evidence,
retired objects, estimated bank profile and connected verification routes.

The source's `entrance_grade` is exported in the GLB. `terrain-grade.js` blends
its triangles into the actual terrain; `cabin-asset.js` applies this after the
broad approach cut and before walking-surface ceilings. The rendered terrain
and its walking sampler therefore share the same surface. Grade dimensions
remain visual estimates tied to the retained wall and original survey uphill.
This replaces the previous visual-only bank mesh approach. Older GLBs without
grade metadata retain their previous behavior.

Verification adds 318 connected entrance floor/headroom/terrain samples between
road-stair foot, doorway recess, deck, beach-side upper stair and east passage.
It also checks terrain interpolation against the bank grade and confirms the
rejected objects are not exported. Existing 19-tread, full-route, wall, deck,
door and tree checks remain. Current export: 46,717 triangles, five batches,
6,079,552 bytes and 173 ceilings. `render_entrance.py` adds connected overview
and descending inspection views; these are not solved photo cameras.

Issue #100 uses `images/20190731_104156.jpg`, looking east from the stair base.
This complementary view replaces the #99 log-like stump with a broad decayed
remnant: exposed brown core and peeling grey wood, estimated 1.16 x 1.55 m and
1.13 m high, closer to the stair-side wall end. `refine_stair_east.py` also joins
the wall end toward the north edge of the flight, fills the over-cut bank lip,
adds leafy growth and the lower north handrail, and varies the concrete/timber
finish. It runs once on #99; `stair-east-layout.json` records the estimates.

Concrete faces are subdivided for mottled vertex colour, preserving every tread
and riser plane. All stair controls and 59 other existing mesh geometries are
unchanged. The new rail is outside the 1.2 m flight, approximately 0.93 m above
its pitch. Tests cover three walking lines and headroom across all 19 treads,
the revised stump location, prior wall/deck/door/tree tests and the full route.
The existing scenic-bank limitations apply; this is not a survey or camera solve.
Export: 52,402 triangles, five batches, 6,674,696 bytes and 285 terrain ceilings.
`render_stair_east.py` and refreshed wall views accompany the new local comparison.
No new image textures or reference media are embedded or committed.

Issue #99 uses the owner-confirmed wall/hillside evidence in
`images/PXL_20211108_175012789.jpg`, excluding its historical cabin appearance.
`refine_east_wall.py` replaces the independent lidar-height block columns with
complete staggered courses: estimated 0.40 m blocks, 0.20 m courses, 0.025 m
setback per course, and 8/9/10-course runs north to south. Passage bounds stay
fixed. Local soil geometry joins the wall to the existing terrain, with brush,
grass, weathering and a pale split stump/root mass above the wall. All dimensions
and individual plant/root shapes are visual estimates. The bank is scenic
geometry, not a replacement elevation survey or a calibrated walking surface.

The 112 bank ceiling triangles keep coarse terrain below the visible skin.
`east-wall-layout.json` records the profile and provenance. Tests ray-check the
wall courses, board-centre surfaces, passage headroom and bank skin, alongside
the existing full-route, door, deck, tree and terrain checks. Geometry snapshots
confirm all 59 pre-existing meshes besides the retaining blocks are unchanged.
Export: 43,393 triangles, five batches, 5,434,488 bytes and 285 terrain ceilings.
`render_east_wall.py` refreshes two local inspection views in roughly 20-40 seconds
each; these are not solved camera matches. Photo media remain local.

Issue #98 uses `images/20190112_130800.jpg` to narrow the east-west deck
projection and replace the front tree's dense generic crown. Estimated upper
projection is 2.40 m from the west wall (formerly 3.90 m); lower projection is
2.10 m (formerly 3.20 m). The upper southward taper remains. Rails, posts, lower
lattice, terrain ceilings and the full-width green-door bay follow the new rims.

`refine_deck_width_tree.py` applies once to the #97 source, then calls the upper
deck generator. The tree root is fitted to the original fine elevation tile;
its estimated 6-degree seaward lean puts the trunk centre 0.15 m inside the
rim at deck height, retaining the 0.83 m notch. Latitude conversion for support
ground sampling now matches the runtime world origin. `389-trees.json` stores
the root, trunk nodes, irregular forked limbs and 16 separated foliage clusters.
`src/scene/deck-tree.js` renders these as two merged meshes instead of adding
a generic crown. It follows existing home-tree visibility and view culling.
The Blender inspection tree uses this same shape and stays outside the GLB.

Branch arrangement, lean and deck dimensions are photo-guided estimates, not
a survey. The existing lidar tree height is retained. Verification covers actual
Three r186 geometry, tree/notch alignment, bounded sparse-tree geometry, visibility,
deck and doorway rays, terrain clearance and the complete approach. Current
export: 44,789 triangles, five batches, 5,657,588 bytes and 173 terrain ceilings.
`render_upper_deck.py` now also produces a wider tree/deck view; `compare.html`
pairs it with the January 2019 photo. Reference media and renders remain local.

Issue #97 supersedes the fixed-tree assumption in #96. The owner-selected
`images/PXL_20220615_171325558.jpg` shows the trunk barely inside the deck edge.
`correct_deck_tree.py` moves that one site-tree row about 2.32 m west in cabin
axes, preserving the rejected coordinates in its `position_override`. Its
estimated centre is 0.15 m inside the rim; notch depth is now 0.83 m instead
of 3.15 m. Ground is resampled from the original fine elevation tile at the
new position; crown dimensions stay unchanged. Preserve this explicit photo
override when regenerating the site-tree bake.

The same correction rebuilds the upper deck/rail/framing and clearance on the
current Blender source, and moves its inspection-only trunk. The large lost
deck area is restored. Tests assert that the live tree data and authored notch
agree, the notch is shallow, and floor is present in the rejected deep slot.
Current export: 45,149 triangles, five batches, 5,685,284 bytes and 173 ceilings.
Tree placement and notch dimensions remain photo-guided estimates, not a survey.

Issue #96 refines the upper deck using the owner's selected
`images/PXL_20211108_174949325.MP.jpg`: the south return widens westward from
the entrance. Its estimated projection grows from 0.91 m to 2.40 m. The
November 15 photograph establishes the open tree notch and three-sided railing.
`refine_upper_deck.py` replaces the upper deck/rails and matching support framing
in the saved source. `upper-deck-layout.json` records the plan and evidence.
The notch follows the existing site-tree anchor, with estimated trunk clearance;
the tree, wall, roof and entrance have not been repositioned. Actual GLB ray tests
check the open notch, framing clearance, passage behind it and added tapered floor.
Clearance helpers follow the new polygons. An inspection-only trunk is excluded
from the exported MODEL collection so it cannot duplicate the app's site tree.

`render_upper_deck.py` produces the two local comparisons in approximately
20-40 seconds each. These are inspection cameras, not solved photo poses.
Current export: 45,677 triangles, five material batches, 5,736,880 bytes and
173 terrain ceilings. Further photos from on the deck looking down into the
notch, or measured edge lengths, can refine dimensions without delaying this
photo-supported outline correction. The raw reference images remain local.

`bootstrap.mjs` and `create_blend.py` made the initial source from the legacy
geometry, terrain and local references. They are retained for provenance, not
the normal edit/export workflow. **Do not rerun them over an edited .blend.**
`create_blend.py` refuses to overwrite an existing source file. The initial
capture used local Three.js r160 and its matching BufferGeometryUtils; the final
GLB and runtime were tested using the app's pinned r186.
