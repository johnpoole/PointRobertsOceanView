# Saltwater Café - issue #63

[Issue #63](https://github.com/johnpoole/PointRobertsOceanView/issues/63) covers
1345 Gulf Road, selected by John as the next landmark under roadmap #56.
The baseline was OSM building 46: a plain teal, five-metre, flat-roofed block.
The new area replaces exactly that footprint and retains a pickable café name.

## Inspected references

- [County 2022 aerial crop](https://gis.whatcomcounty.us/arcgis/rest/services/Imagery/2022_WhatcomAerialImagery_Web/MapServer/export?bbox=-13701467.75469917,6272092.053444385,-13701347.75469917,6272212.053444385&bboxSR=3857&imageSR=3857&size=1200,1200&format=png&f=image),
  inspected 8 September 2026. Supports the north-facing frontage, narrow rear
  portion and west step, forecourt and patio on the Marine Drive side. The
  service identifies 2022; the precise capture day was not established.
- [Google Maps café gallery](https://www.google.com/maps/place/Saltwater+Caf%C3%A9/@48.9840489,-123.081863,17z/data=!3m1!4b1!4m6!3m5!1s0x5485e5f155a2d5c3:0x346779414b56512a!8m2!3d48.9840489!4d-123.081863!16s%2Fg%2F11c54n3071),
  Street View & 360 gallery, second image: Google Street View **May 2023**,
  panorama `Q7gTatqR0ju8DNpsXccXwQ`. The panorama heading card says 1318 Gulf
  Road, the camera's street context; the café being modeled is 1345. Inspected
  facing south at the café. Clearly shows low gable, orange horizontal siding,
  blue verge/vertical trim, white-framed windows around the central entrance,
  oval SALTWATER CAFE sign, freestanding patio sign and turquoise parasols.
  The gallery's first panorama is a shoreline view labeled April 2026 and is
  not used as evidence of the café's current façade. No current remodeling or
  unchanged 2026 furniture layout is claimed from this historical reference.
- [Local Chamber dining directory](https://www.pointrobertschamberofcommerce.com/dine/)
  and [Point Roberts Now listing](https://pointrobertsnow.com/saltwater-cafe/)
  corroborate the business name/address. The directory alone is not the roof
  or site geometry source.

No reference images are bundled or used as textures. Sign lettering and a
simple wave motif are drawn locally; these approximate the observed branding,
not an exact reproduction of its small logo. Temporary hours/messages, cars
and people are omitted. Three table/umbrella groups represent the observed
patio character, not a live inventory or surveyed furniture positions.

## Geometry and loading

The exact six-corner OSM wall outline is retained: about **9.43 x 16.03 m**,
with a west-side step about 6.70 m behind the north frontage. The roof is
interpreted as a broad front gable and narrower rear section. Eaves at 3 m
above the floor, front rise 1.45 m, rear rise 1.2 m and 0.28 m overhangs are
visual estimates. The rear roof join and hidden rear/side elevations have
less reference coverage and remain coarse. Hidden windows were not invented.

The modeled entrance floor is 7.981 m MLLW from the north-front terrain samples.
The existing terrain falls behind the building to about 5.69 m; wall bottoms
extend to 5.607 m to meet it. This is model ground contact, not a surveyed
finished floor or basement reconstruction. Forecourt and patio objects follow
the existing sampled terrain. Neighboring buildings, including the large pale
building east of the café and the small rear shelter, retain their geometry.

`saltwater-plan.js`, `saltwater-base.js`, `saltwater.js` and `saltwater-area.js`
provide the footprint/layout, base silhouette, close detail and AreaDetail
lifecycle. The base retains the orange walls, gabled roof and forecourt;
close detail adds frontage/signs and patio objects. Uses current-view loading,
200/320 m hysteresis, a bounded 30-second cache, and owned-resource disposal.

- Base: **3 meshes, 673 triangles, no textures**.
- Detail: **7 meshes, 1,411 triangles, two 512 x 256 sign textures**.
- `node src/scene/test-saltwater-plan.mjs`: only footprint 46 replaced, exact
  geographic outline, local/world round trips, mapped step, west patio and
  north entrance orientation.
- Existing area-detail lifecycle tests pass. Real Three.js geometry checks
  using the baked terrain verify finite attributes, ground/eave relationships,
  fixed tide behavior and complete geometry/sign texture disposal.
- Inspected the deployed baseline and isolated improved overview/street views.
  Sign faces are placed ahead of their support, and door glass ahead of the
  door backing, to avoid hidden glazing/lettering.

[Direct café view](https://oceanview.johnpoole.ca/#eye=48.98434,-123.08201,12&aim=48.98404,-123.08185,4&fov=45)
looks toward the entrance from Gulf Road. Deployment evidence is in issue #63.
