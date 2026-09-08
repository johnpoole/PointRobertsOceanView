# Dark shoreline band at low tide — issue #59, 8 September 2026

Reproduced a clear dark band at the water's edge in the deployed default West
Bluff view, matching the reported appearance. The user's exact camera location
has not been supplied; this is the verified reproduction view:

`#eye=48.989009,-123.085318,20&aim=48.989009,-123.089422,8&fov=25`

The live UI read **-0.36 m MLLW**, falling. In `terrain.js`, `colorForGround`
returned the dark `FLOOR` color for every vertex below 0 m, before applying the
sand/shingle material. A negative tide exposes part of that dark region, making
an abrupt stripe between the ordinary beach and water. Zero MLLW is a vertical
datum, not a boundary between ground materials.

The fix removes that special color branch and its unused constant. The
existing slope-based sand/shingle calculation continues below chart datum.
Only terrain colors change; heights, mesh indices, sea masks, tide, water,
camera, navigation and area-detail loading code are untouched. There is no
new height threshold or invented shoreline geometry.

The Marketplace and Community Center changes did not edit water/terrain or
lighting. Git blame dates the negative-elevation branch to August 4–6, before
those September additions. The current low tide explains its visibility;
there is no evidence that Marketplace introduced this reproduced defect.

## Verification

- Inspected the full deployed West Bluff view and its live tide readout.
- Built a paired browser preview using the same cropped baked West Bluff
  heightmap, the original/current `buildTerrain`, and the unchanged real `Ocean`
  implementation, with identical camera/light/tide and fixed zero swell. It
  omits buildings, proving this band does not require Marketplace geometry.
- At -0.36 m MLLW the baseline has the stripe; the fix removes it. At +0.8 m
  the visible shoreline views match. The crop and fixed lighting isolate this
  cause; this is not a claim that every possible shoreline artifact is fixed.
- `node src/scene/test-shore-color.mjs` checks continuous material across zero,
  exposed sand and shingle, finite colors at -1/-0.36/-0.001 m and distinct
  upland material. The test evaluates the actual color code, not a copy, and
  was also verified to reject the original cutoff.
- ES-module syntax and `git diff --check` passed.

The temporary paired preview is at http://127.0.0.1:18107/ while its local
preview process runs. Its before copy and server/page files are in the Windows
temporary directory (`shore-terrain-before.js`, `shore-preview-server.py`,
`shore-preview.html`). Nothing was added to the deployed site's UI.

## Publication

[Issue #59: Fix dark foreshore stripe exposed by negative tides](https://github.com/johnpoole/PointRobertsOceanView/issues/59)
records publication and server verification.

- [x] Reproduce, identify material cutoff, inspect source history.
- [x] Remove the cutoff locally and verify low/positive-tide before/after views.
- [x] Add the focused regression check.
The user explicitly approved commit, push and deployment of this reviewed
shoreline correction. Its commit includes only the terrain-color fix, focused
regression test and this record. The completed uncommitted load-test files and
unrelated user assets are excluded. No presence optimization is included.
