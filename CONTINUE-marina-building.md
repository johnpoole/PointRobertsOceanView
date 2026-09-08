# Main marina building — issue #61

[Issue #61](https://github.com/johnpoole/PointRobertsOceanView/issues/61) refines
the main shore building at 713 Simundson Drive, under roadmap #56. This is the
building beside the calibrated cameras, containing the marina office, club,
restaurant and marine services. It was the five-metre-high generic teal OSM
block named `Pier Restaurant` (building 0 in the baked asset).

John approved commit, push and deployment after reviewing this implementation
on 8 September 2026. The published revision and deployment checks are recorded
in issue #61. The separately approved presence-performance change #60 was
published as dc72b69 and is unchanged by this building refinement.

## Inspected evidence

- [Whatcom County 2022 aerial](https://gis.whatcomcounty.us/arcgis/rest/services/Imagery/2022_WhatcomAerialImagery_Web/MapServer/export?bbox=-13699442.759390783,6270886.988185442,-13699222.759390783,6271106.988185442&bboxSR=3857&imageSR=3857&size=1000,1000&format=png&f=image):
  inspected 8 September 2026. The service identifies the imagery year; this
  inspection did not establish this individual frame's exact acquisition day.
  EPSG:3857 crop is 220 m square, displayed at 720 × 720, left x=280/top y=0.
  Supports the long rectangle, north/south roof division, six southern rooftop
  equipment groups, waterside canopy/deck and immediate workshop apron.
- [Google Maps marina photos](https://www.google.com/maps/place/Point+Roberts+Marina+Resort/@48.9772754,-123.0631496,17z/data=!3m1!4b1!4m6!3m5!1s0x5485ef5748acf44f:0x9a1b3fb694d42363!8m2!3d48.9772754!4d-123.0631496!16s%2Fg%2F11f57kkzqd):
  Street View & 360 gallery, KS B, **March 2023**, panorama
  `CIHM0ogKEICAgIDhlqqNGQ`. Inspected at heading 75°, tilt 65°, FOV 25°.
  This is an elevated user panorama. Its place geotag is not a calibrated
  camera origin and its UI orientation is not a survey measurement. The image
  shows the gray northern workshop roof, white southern roof, large west
  workshop door, upper window bands, long dark canopy and two-storey glazed
  southwest corner, plus the reddish terrace and pale railings. The earlier
  short panorama URL failed; opening the marina's actual photo gallery worked.
  A street-level lookup resolved back to this aerial panorama, so it did not
  provide an independent ground-level survey.
- [Jeffrey McDonald listing, 28 July 2021](https://www.jeffreymcdonaldfinehomes.com/featured-properties-1/point-roberts-marina):
  the aerial exterior images `Point+Roberts+Marina+WA+(2).jpg` and
  `Point+Roberts+Marina+WA+(10) (1).jpg` corroborate the main flat-roofed building
  and southern frontage. Publication date is known; exact photo capture date
  is not. The south elevation is small in these views, so its window/door sizes
  and arrangement are less certain than the west elevation.
- [Marina official slip map](https://www.pointrobertsmarina.com/wp-content/uploads/2022/03/PRM-slip-map-11x17-7.pdf)
  identifies the harbor office, café, club and marine services; the main marina
  website supplies the address. The official club photo gallery mainly shows
  interiors and was not used to infer hidden exterior elevations.
- [The Pier official site](https://www.thepier.restaurant/) confirms its address
  and says the restaurant opened in 2024. The older photographs are therefore
  evidence of building form, not proof of current restaurant branding.

Reference imagery is neither bundled nor used as model textures. The baked
OSM footprint remains the geographic anchor. Its four transformed corners and
the rectangular model agree within 5 cm. County roof edges appear a few metres
west/south of this outline; rooftop displacement, overhangs, registration and
trace accuracy have not been separated. Do not move the building or cameras
solely to erase that unresolved discrepancy.

## Model and estimates

`marina-building-plan.js` holds the footprint, oriented frame and photo-derived
layout; `marina-building-base.js`, `marina-building.js` and
`marina-building-area.js` build the base, close detail and loading lifecycle.
The main scene excludes only OSM building 0 and retains a pickable
`Point Roberts Marina / The Pier` landmark.

- Footprint: **24.10 × 57.40 m**, calculated from the existing OSM corners.
- Shared wall top: **6.4 m above the modeled floor**, a visual estimate. The
  original generic height was 5 m. Floor is 5.03 m MLLW from the existing
  terrain sampler, not surveyed finished-floor elevation; wall bottoms extend
  to 4.737 m MLLW. Sampled ground throughout the footprint is 4.800–4.950 m.
- Workshop/club roof division: 30 m from the north edge, estimated from aerials.
  Northern roof is gray in the 2023 panorama and much paler in the 2022 aerial.
  The later inspected view supplies its modeled color; no reroofing date is
  claimed. Southern roof remains pale.
- Roof overhangs: 0.65–0.8 m; corner bay projects 1.35 m west; canopy projects
  about 3.35 m west across a 16 m run. These are visual estimates.
- West workshop door is about 8.3 m wide and 5.6 m high. Glazing, mullion counts,
  canopy posts, terrace rail spacing and rooftop equipment dimensions are
  approximate. No construction drawings, measured heights or calibrated
  photogrammetric reconstruction were used.
- South windows and entrance are a coarse interpretation of the historical
  exterior view. Northern/eastern hidden façade details remain plain. Exact
  current sign lettering/placement was not readable, so no fixed sign was
  invented; obtain a close exterior reference for that follow-up.

The base retains the building volumes, both roofs, canopy, terrace and a small
terrain-draped workshop apron. Close detail adds glazing/frames, the workshop
door, canopy posts, storey bands, parapet caps, terrace railing and six rooftop
equipment groups. The existing docks, gangways, huts, flagpole, floating/tide
updates and owner-confirmed single-slope shelter are untouched. No boats or
broader marina district have been added.

## Verification and review

- `node src/scene/test-marina-building-plan.mjs`: exact one-building exclusion,
  geographic corner alignment, local/world round trips, aerial registration,
  waterside canopy and rooftop equipment containment.
- `node src/test-area-detail.mjs`: lazy load, hysteresis, stale results,
  cache eviction/rebuild, disposal and retry. The new area uses this existing
  lifecycle with near/far distances of 200/320 m, projected-size loading and a
  30-second cache. It is independent of the dock area's tide lifecycle.
- Real Three.js r160 geometry checks with the actual baked heightmap: finite
  positions/normals/colors, ground contact sampled at 0.5 m across the footprint,
  unchanged fixed building bounds at different tide levels, and disposal of
  every owned geometry. Main/detail module syntax and diff checks pass.
- Base: **3 meshes, 2,156 triangles, no textures**. Close model: **4 meshes,
  3,920 triangles, no textures**. These include the subdivided draped apron.
  Glazing is opaque colored geometry. Base and detail replace each other.
- Browser comparison inspected original versus improved waterside views, a
  ground view, south entrance and aerial view. Switching to the base, leaving
  beyond the cache interval and returning released/rebuilt the four detail
  geometries without increasing the retained count. No browser error was
  reported during these checks. This is an isolated building/terrain preview,
  not a new full-scene performance benchmark.

[Local comparison](http://127.0.0.1:18108/) has Waterside, Ground view, South
entrance, Aerial and Original / improved buttons. The temporary preview server
serves the current local source and is not deployed. The full-app
[marina building view](https://oceanview.johnpoole.ca/#eye=48.97712,-123.0643,40&aim=48.97722,-123.0632,8&fov=45)
opens from the water looking toward the building and neighboring docks.
