# Community Center and library grounds — issue #58

Priority 2 of roadmap #56. Two separate buildings share one on-demand area:
the Community Center at 1437 Gulf Road and the library at 1431 Gulf Road.
The original plain, flat-roofed OSM blocks 45 and 184 are replaced once;
neighboring buildings, including building 185, retain their existing renderer.

## Inspected references

- [Park and Recreation District](https://prparkandrec.org/) and its
  [about page](https://prparkandrec.org/about-us/) establish the Community
  Center and shared library/playground grounds.
- [WCLS branch event listing](https://www.wcls.org/wcls-announces-free-summer-events-including-popular-summer-reading-program/)
  gives the library address.
- [Whatcom County 2022 aerial](https://gis.whatcomcounty.us/arcgis/rest/services/Imagery/2022_WhatcomAerialImagery_Web/MapServer/export?bbox=-13700951.138491033,6272147.221409737,-13700731.138491033,6272367.221409737&bboxSR=3857&imageSR=3857&size=1000,1000&format=png&f=image).
  EPSG:3857 bounds: west -13700951.138491033, south 6272147.221409737,
  east -13700731.138491033, north 6272367.221409737. The 1000-square image
  displayed at 720-square, left x=280/top y=0. `community-plan.js` converts
  those screen coordinates through Web Mercator into the application's metres.
- [January 2026 Google Maps drone panorama](https://www.google.com/maps/@48.9844333,-123.0768357,3a,90y,20h,55t/data=!3m3!1e1!3m1!1sCIABIhC2aE4dX4oAcsFd46cD7NrO),
  contributor Kate Gray, ID `CIABIhC2aE4dX4oAcsFd46cD7NrO`. The UI states
  image capture Jan 2026. The tag at 48.9844333, -123.0768357 is a place
  coordinate, not a surveyed camera origin. UI headings are not calibrated
  compass directions: heading 20 shows the grounds looking southwest from
  the northeast. Inspected views: 90-degree FOV / heading 20 / tilt 55 overall;
  55 / 350 / 55 Center frontage; 75 / 315 / 70 east recreation grounds;
  50 / 48 / 58 library frontage and roofs.
- Baked `assets/osm/features.json`: Center first corner 48.9843286,
  -123.0769828; library first corner 48.9845245, -123.0774082. Exact ground
  footprints are retained. Their generic 5 m height/flat-roof tags are replaced
  by image-based estimates. Slight aerial roof/OSM offsets are not treated as
  evidence for moving the ground outlines.

Images were inspected in the browser and are not bundled as textures. The
newer panorama supplies roof and facade appearance. Temporary tents visible
in 2022, stored kayaks and parked vehicles are omitted.

## Geometry and uncertainty

The Center has a roughly 21.8 by 21.5 m main body and a lower polygonal east
annex. Brick walls, pale parapet caps, ten tall divided north windows, double
entrance, raised central sign bay and representative roof equipment follow
the panorama. The library has an orange body, grey hip roof with a front
cross-gable, pale flat extension roofs, two former garage-bay windows on the
north, glazed east entry, canopy, blue book return and a small entrance sign.
The space between buildings remains open. Each building is a separate named
landmark for navigation.

Grounds include mapped paving, sidewalk and paths, parking paint, a hatched
entrance clearance, two pickleball outlines, a basketball hoop, eight raised
garden beds, low planted borders, bicycle rack, two flags and a playground pad.
The slide/platform, swing frame and climber are simple representations of
visible apparatus: exact equipment dimensions and arrangement are not surveyed.
No portable court nets are added. Sign text is drawn locally into one atlas;
the small library plaque layout is approximate. Plant spacing, glazing and
roof equipment dimensions are visual estimates rather than an inventory.

Estimated heights above each floor: Center main walls 5.2 m, annex 3.5 m,
raised entrance bay 5.62 m; library walls 3.2 m, roof eaves 3.25 m and rise
2 m. Floors are 0.08 m above the highest footprint sample: Center 8.330 m
MLLW, library 8.471 m. Wall bottoms extend to 7.822 and 8.046 m respectively.
These avoid floating edges on the existing terrain; they are not surveyed
finished-floor elevations. Terrain and navigation/collision behavior are unchanged.

## Loading and checks

`community-area.js` follows #53: 220/350 m proximity thresholds, shared
projected-size criteria, one pending load, 30-second inactive cache, retry
and owned-resource disposal. Base retains walls, roof forms and draped ground;
facades, fixtures, paint and lettering arrive through `community.js` on demand.

Ground triangles have at most 5 m edges (4 m for sidewalk/playground/path).
Paving is lifted 0.08 m, paths/playground 0.10 m, sidewalk 0.18 m. Paint
samples the actual paving triangles through a temporary spatial index, using
at most 2 m edges and 0.035 m clearance. Base: 4 meshes, 6,236 triangles,
673,488 geometry-array bytes. Full detail: 8 meshes, 13,596 triangles,
1,468,192 geometry-array bytes and one shared 1024 by 512 canvas texture.
Array sizes count attributes, not index buffers; the cached base also remains
allocated while close detail is active. These are area costs, not full-scene
performance benchmarks.

Validation: `node src/scene/test-community-plan.mjs` checks projection, exact
two-building replacement, area-preserving Center partition and separation.
Additional real-Three.js geometry checks used the baked heightmap to verify
finite vertices/normals, roof heights, pitched library roof, open building gap,
terrain lifts, sampled paint clearance, neighboring building retention, sign
directions and exactly-once disposal of the shared texture. Main-module syntax
and `node src/test-area-detail.mjs` passed. Browser previews compared original
OSM blocks with the new model from street, drone and overhead views. Moving
away and expiring the cache reduced textures from 1 to 0 and detail geometries
by 8; returning rebuilt them without accumulating resources.

View link: `#eye=48.98525,-123.0765,49&aim=48.9844,-123.077,14&fov=48`.
