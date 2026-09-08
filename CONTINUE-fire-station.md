# Station 58 - issue #64

[Issue #64](https://github.com/johnpoole/PointRobertsOceanView/issues/64) enhances
Whatcom County Fire District 5 at 2030 Benson Road, priority 4 in roadmap #56.
John requested this after approving the Saltwater Café pass. The prior station
was unnamed generic building 133, a five-metre flat-roofed block, with generated
forest trees obscuring both the structure and its paved apron.

## Inspected evidence

- [District official website](https://wcfd5.specialdistrict.org/) confirms the
  department and 2030 Benson Road address. The old 2023 capital-plan PDF URL
  could not be opened during this pass; no measurements are attributed to it.
- [County 2022 aerial](https://gis.whatcomcounty.us/arcgis/rest/services/Imagery/2022_WhatcomAerialImagery_Web/MapServer/export?bbox=-13697300.425167553,6272859.594786848,-13697090.425167553,6273069.594786848&bboxSR=3857&imageSR=3857&size=1200,1200&format=png&f=image):
  supports the roof sections, central south-projecting gable, paved apron,
  concrete door approaches and separate small structure to the northeast.
  The service labels the imagery 2022; the exact frame date is unconfirmed.
  The crop is 210 m square in EPSG:3857, displayed at 720 px with left x=280.
- [Google Maps station gallery](https://www.google.com/maps/place/Whatcom+County+Fire+District+5/@48.9888211,-123.0440047,17z/data=!3m1!4b1!4m6!3m5!1s0x5485e8a9b42b5877:0xa5bd3c7dc0aa94f2!8m2!3d48.9888211!4d-123.0440047!16s%2Fg%2F11nnwf_b0l):
  Street View & 360 gallery, **Kate Gray, January 2026**, panorama
  `CIABIhB7ymCqZTXgtq7XvBNcN4pT`, inspected at heading 320°, tilt 90°, FOV
  75° and 90°. This close exterior confirms pale horizontal siding, low west
  wing, central apparatus gable, tall east wing, four red doors with three
  small panes each, four upper south windows, entrances, vents, bollards,
  white pole and roof antenna. The place geotag is not a calibrated camera
  origin. Temporary burn-ban placards are not rendered as permanent signs.
- Same gallery, Google Street View **May 2023**, panorama
  `Ua6ztJsgH9svGNKoAwcHHA`, viewed north from Benson Road. Corroborates the
  whole frontage, paved setting and roof hierarchy. January 2026 is used for
  the close exterior details where clearer. No readable permanent façade
  lettering was established; request a close sign reference before adding it.

References were inspected on 8 September 2026. No images or textures are
bundled. Parked vehicles, people and temporary notices are not fixed scenery.
The small separate northeast footprint 2131 remains unchanged, as do the
school/Baker Field buildings and the surrounding forest outside the site.

## Model and estimates

`fire-station-plan.js` retains the exact twelve-corner OSM wall outline:
**42.38 x 23.71 m**, approximately **876.8 m²**. Clipping at the mapped east
wing boundary preserves the total footprint area. The lower west roof runs
east-west; the central projecting gable and tall east roof run north-south.
The shallow roof over the small rear projection is a coarse interpretation;
hidden rear façades and roof connections need closer references.

All vertical dimensions are visual estimates: low eaves 4.1 m with 2.2 m rise;
high eaves 7.6 m with 1.9 m rise; low doors 5.5 x 3.65 m, east doors 4.8 x
3.8 m. Upper window and personnel-door dimensions, parking-mark spacing,
bollards, pole and antenna heights are approximate. Entrance floor is
65.287 m MLLW from the existing terrain at the door approaches; wall bottoms
extend to 64.997 m. Ground over the mapped footprint ranges roughly 65.10 to
65.51 m. This verifies model contact, not a surveyed floor elevation.

The apron and 2.5 m-deep west entrance walkway are subdivided and draped over the baked terrain. Their boundaries and
the building polygon also exclude scattered trees: the coarse forest layer
had incorrectly planted tall trees through the station and paving. The tree
generator's optional exclusion is applied after consuming the original random
draws, so trees outside the site retain their positions, dimensions and colors.
Measured cabin trees are not filtered. The predicate has a bounding-box reject
before polygon tests and affects only the verified building/paved area.

The base retains all roof masses and four red bay doors. Close detail adds
door frames/panels/panes, windows, personnel doors, siding lines, vents, poles,
bollards and a few western parking marks. The pickable name is
`Station 58 / Point Roberts Fire Department`. AreaDetail uses current-view
loading, 200/320 m hysteresis and a 30-second cache, disposing owned geometry.

- Base: **3 meshes, 5,186 triangles, no textures**.
- Close detail: **4 meshes, 7,814 triangles, no textures**.
- `node src/scene/test-fire-station-plan.mjs`: exact footprint replacement,
  wing-area conservation, four bay positions and clearing boundary checks.
- Existing area-detail lifecycle tests pass. Real Three.js tests with the
  baked heightmap check finite geometry, terrain/eave relationships, fixed
  tide behavior and complete geometry disposal.
- A synthetic local forest test removed trees within the site; every
  retained instance had exactly the same transformation and color as before.
- Inspected the full-scene baseline and isolated overview and street views.
  Final deployment checks and full-scene review are recorded in issue #64.

[Direct station view](https://oceanview.johnpoole.ca/#eye=48.98835,-123.04430,83&aim=48.98885,-123.0440,68&fov=45)
looks north from Benson Road. The terrain here is about 65 m MLLW, so a camera
height copied from the marina or waterfront would be underground.
