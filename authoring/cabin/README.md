# Cabin authoring in Blender

`cabin.blend` is the editable source for 389 West Bluff. Issue #89 continues #42.
The web app loads `assets/site/389-cabin.glb`, exported from this file. The original
procedural builders remain only as a fallback when the GLB cannot load.

Open the source with Blender 4.5 LTS. This machine has a verified portable copy:

```powershell
& 'data/tools/blender-4.5.10-windows-x64/blender.exe' 'authoring/cabin/cabin.blend'
```

The **MODEL** collection has 22 named editable meshes: walls, upper/lower glazing,
notch doors, roof shell, standing seams, fascia/soffits, chimney, decks, framing,
retaining blocks and access structures. Mesh positions are welded for vertex/edge
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
files; neither the .blend nor the GLB packs their pixels. `START HERE` in the
Blender Text Editor explains the collections. This reference setup does not mean
that every frame has already been used to change geometry.

**CAMERAS** has three inspection views and the owner's three saved comparison
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
approach treads. Its comparison against the legacy bounding box is a migration
check; deliberately extending the model requires updating that expectation.

Initial export: 11,904 triangles, three material batches, 972,396 bytes. The
north-side change provides a 0.91 m boarded landing along the wall, nine timber
steps westward and a 0.91 m lower landing meeting the lower deck. The outer rails
reach both landing boundaries. Lengths and count are estimates from the May 2025
photo, constrained by the existing storey heights; they are not surveyed values.

The complete upper road/shed approach and remaining photo/model reconciliation
remain in #42. This conversion establishes the editable source and corrects the
north connection; it does not claim the entire walkthrough reconstruction is done.

## One-time migration

`bootstrap.mjs` and `create_blend.py` made the initial source from the legacy
geometry, terrain and local references. They are retained for provenance, not
the normal edit/export workflow. **Do not rerun them over an edited .blend.**
`create_blend.py` refuses to overwrite an existing source file. The initial
capture used local Three.js r160 and its matching BufferGeometryUtils; the final
GLB and runtime were tested using the app's pinned r186.
