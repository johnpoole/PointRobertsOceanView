# International Marketplace — issue #57

Priority 1 of roadmap #56. The model covers the store and its immediate paved
lot at 480 Tyee Drive. It replaces baked OSM building 2 once; neighboring
buildings remain under their existing renderer.

## Inspected references

- [Official store website](https://www.pointrobertsmarketplace.com/) and its
  [exterior photo](https://images.squarespace-cdn.com/content/v1/698f69e942de34714293d7f7/d7770285-6166-4e43-8e81-baa16ae5ead2/point%2Broberts%2B-%2Bstore%2Bimage.png).
  Capture date is not stated. It shows the cream/white frontage, green columns,
  blue metal roof accents, window divisions and central International Marketplace
  sign. Its Banner Bank sign is not reproduced: it differs from the newer view.
- [January 2026 Google Maps drone panorama](https://www.google.com/maps/@48.9854869,-123.0661472,3a,90y,0h,55t/data=!3m3!1e1!3m1!1sCIABIhBsWIIkGufqxdkGMoEPB8Js),
  contributor Kate Gray, panorama ID `CIABIhBsWIIkGufqxdkGMoEPB8Js`.
  The UI states image capture Jan 2026. Its tag is 48.9854869, -123.0661472;
  that is not a surveyed camera centre. The UI heading 0 looks toward the store's
  west frontage (geographically east), so this panorama is not a calibrated
  north reference. Heading 0, tilt 55 and FOV 90 shows the lot; FOV 55 / tilt 63
  shows the frontage and roofs closely. This is the latest inspected roof reference:
  the northern roof is dark grey, whereas the 2022 aerial shows a pale surface.
- [Whatcom County 2022 aerial](https://gis.whatcomcounty.us/arcgis/rest/services/Imagery/2022_WhatcomAerialImagery_Web/MapServer/export?bbox=-13699853.981761321,6272244.886913513,-13699523.981761321,6272574.886913513&bboxSR=3857&imageSR=3857&size=1000,1000&format=png&f=image).
  EPSG:3857 bounds: west -13699853.981761321, south 6272244.886913513,
  east -13699523.981761321, north 6272574.886913513. The 1000-square source
  displayed at 720-square, left x=280/top y=0, in the browser screenshot.
  Centre: 48.98555, -123.0664. `marketplace-plan.js` explicitly converts this
  pixel frame into lat/lon and then the application's metre coordinates.
- [Closer aerial of parking rows](https://gis.whatcomcounty.us/arcgis/rest/services/Imagery/2022_WhatcomAerialImagery_Web/MapServer/export?bbox=-13699766.898427987,6272321.886913513,-13699690.356761321,6272480.92858018&bboxSR=3857&imageSR=3857&size=600,1200&format=png&f=image).
  Confirms four double rows, north/south stall orientation, intervening east/west
  drive aisles, and the paired yellow access-aisle markings.
- `assets/osm/features.json`, unnamed building 2, first corner
  48.9858558, -123.0663436. Its 18 distinct vertices retain the irregular east
  outline. The original height 5 m is a generic baked value, not a measured height.

Images were inspected in the browser, not bundled as textures. The sign uses
locally drawn text and a simple approximation of its roof-shaped emblem.

## Geometry and uncertainty

The body is split at aerial y=376 into a higher north and lower south roof.
Clipping at x=654 sets the enclosed body behind the covered west frontage;
its union with that frontage strip preserves the OSM outline. The seven front
bays comprise two end towers, two sloping blue canopies, two upper window bays
and the tall central sign bay. Walkways remain open beneath their roofs.

The model adds subdivided glazing, recessed entrances, green columns with pale
feet, roof parapets and representative equipment, parking paint, the red
frontage curb, sidewalk and two driveway connections toward Tyee Drive.
Storefront spacing, glazing extents and roof equipment sizes are visual estimates;
this does not claim a complete inventory or an interior floor plan. Parked cars,
seasonal items, unknown pole/sign locations and changing tenant signage are omitted.

All heights are photo estimates: north body 6.9 m, south 5.5 m, upper window
bays 6.8 m, central sign bay 8.2 m plus a 1.4 m hip, end towers 5.8 m plus
1 m hips, and lower canopies rising from 4.1 m at the front to 5.25 m behind.
A level model floor is set 0.08 m above the highest sampled footprint corner
(18.58 m MLLW with this terrain), with walls extending down to 17.16 m MLLW.
This avoids floating wall bases across the terrain's approximately 1.3 m
variation; it is not a survey of the store's finished-floor elevation. Column
feet, sidewalk, curb and paving follow the existing ground. No terrain or
navigation/collision behavior is changed.

## Loading and validation

`marketplace-area.js` uses the #53 lifecycle, independently of Reef and marina:
220/350 m proximity thresholds, shared projected-size criteria, one pending
load, a 30-second inactive cache, retries and disposal. The base retains the
building/roof silhouette and grounds. Windows, lettering and parking markings
load from `marketplace.js`. The sign owns one 1024 x 256 canvas texture.

Paving uses triangles with edges no longer than 8 m. Paint follows the actual
paving triangles through a local spatial index, with at most 2 m segments and
0.035 m clearance, avoiding independent drape meshes fighting at street level.
The index and sampling cache are temporary during construction.
The sidewalk uses a 0.18 m lift and at most 4 m edges to remain above the
coarser paving. Base: 3 meshes, 6,794 triangles, 733,752 geometry-array bytes.
Detail: 6 meshes, 17,824 triangles, 1,924,904 geometry-array bytes plus one
sign texture. Geometry-array counts include attributes but not index buffers.

Validation includes aerial projection and exact one-building matching;
area-preserving outline/body/frontage/roof partitions; finite Three.js geometry;
roof-level and open-walkway raycasts; terrain contact for ground vertices;
west-facing signage; keeping neighboring OSM buildings; and texture disposal.
Sampled parking-paint triangle centres were independently raycast against the
paving and remained above it. Main-module syntax was checked as an ES module.
The existing area-lifecycle tests cover lazy loading, stale loads, retry,
hysteresis, caching and disposal. Isolated browser previews compare the actual
old OSM model with this model from street, drone and aerial views. These checks
are not a full-scene performance benchmark or a survey-accuracy claim.

View link: `#eye=48.9855,-123.0679,60&aim=48.9855,-123.06627,22&fov=48`.
