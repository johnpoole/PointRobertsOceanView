# Point Roberts Post Office

1582 Gulf Road. The baseline was OSM building 1 in the bake: a plain grey,
five-metre, flat-roofed block. The area replaces exactly that footprint and
keeps a pickable name on it.

## Inspected references

- **OSM way 206535743**, `amenity=post_office`, `operator=United States Postal
  Service`, `check_date=2026-05-31`. The ten-corner outline is used exactly as
  it stands in the bake, corner for corner, and the test asserts that.
- [County 2022 aerial](https://gis.whatcomcounty.us/arcgis/rest/services/Imagery/2022_WhatcomAerialImagery_SPN/MapServer/export?bbox=-13699980.9421446,6272272.200787939,-13699890.9421446,6272362.200787939&bboxSR=3857&imageSR=3857&size=1200,1200&format=png&f=image),
  inspected 9 September 2026. The `_Web` service the café notes used is gone
  from the server; `_SPN` reprojects on request and answers the same picture.
  1200 px over a 90 m web-mercator box, which is 59.1 m of ground and about
  20.3 px per metre. Supports the roof form, the projecting entrance bay and
  its gable, the paved lot, the concrete apron at the door, the lavender bed
  along Gulf Road, the flagpole and the lamp standard. The service identifies
  2022; the capture day was not established.
- [Point Roberts United States Post Office](https://commons.wikimedia.org/wiki/File:Point_Roberts_United_States_Post_Office.jpg),
  Quentin Melson, CC BY-SA 4.0, dated 2018-10-25. The south elevation head on.
- [Point Roberts Post Office](https://commons.wikimedia.org/wiki/File:Point_Roberts_Post_Office.png),
  Quentin Melson, CC BY-SA 4.0, dated 2018-09-20. The same front from further
  back, with the flagpole, the lamp standard, the fence and shed to the west,
  and a mail van standing at that end.
- A photograph of the front supplied by John, in sun and from the parking lot.
  It is what settled the entrance: the gable and the deep eave stand forward on
  posts with the glazed front set back under them, so the entrance is a porch
  and not a wall. It also carries the trim line along the lower wall with the
  paler panel under it, the dark barge boards down the gable, the run of glass
  rather than punched windows, the blue plate by the door and the rail off the
  east end of the walk.

No reference image is bundled and none is used as a texture. The sign is drawn
locally in a canvas — the wording is the wording on the building, the lettering
is not a reproduction of the Postal Service's own type. The eagle plaque is a
white square with a mark on it and is not the USPS logo. Cars, people and the
neighbouring lot's trailers are left out.

## Geometry

The outline measures 23.67 by 15.46 m and squares to the compass within a
degree. Two steps in it carry the whole shape of the building and both are
surveyed rather than guessed:

| what the outline does | what it is |
| --- | --- |
| the eastern 9.47 m of the front stands 1.81 m proud | the porch, and its gable end carries the sign |
| a 3.81 m bay hangs off the west end over 5.00 m | the lower west wing |

The traced outline is the **roof**, not the walls. Over the entrance the roof
stands on two posts with nothing under it but the walk, so `postOfficeWallRing`
runs the front straight across on the main wall line and the 1.81 m the outline
steps forward is the porch. `postOfficeWings()` then cuts that wall ring in two
at the west step so the west wing can be extruded to its own lower height.

Everything else about the elevation is a visual estimate off the photographs
and is listed here as such:

| estimate | value |
| --- | --- |
| wall to the underside of the eave | 3.1 m |
| main ridge over the eave | 1.8 m |
| entrance gable over the eave | 2.5 m |
| west wing wall | 2.6 m |
| eave overhang | 0.7 m, 0.45 m on the wing |
| batten spacing | 0.34 m |

The roofs are hipped, which is what the photographs show at both ends, so
`hipRoof` in `post-office-base.js` builds them: two slopes to a ridge along the
length and a hip off each end, one pitch throughout. The porch is the
one gable and it uses the shared `gableRoof`, turned across, with its two end
triangles repainted as siding — the face is a wall, not a roof.

The floor is set at the door under the porch, 15.15 m MLLW off the baked
heightmap, and the walls run down to the lowest ground under the outline.

## What is not known

- The aerial shows the north slope dark and the south slope light. That is read
  here as sun and shade on one roof rather than two materials, because the ridge
  runs straight through and every photograph shows one tile roof. If it turns out
  to be a shingled rear addition, the north slope is the thing to change.
- The rear and both side elevations have no reference coverage at all. They
  carry siding, trim and the eave band and nothing else. No window on a hidden
  wall was invented.
- Interior, roof vents and the gutters are not modelled.
- The lavender is placed in rows across the bed the aerial shows, which is the
  character of the planting rather than a count of the bushes.
- The mail van, the fence and the metal shed at the west end belong to that end
  of the site and are not modelled. The neighbouring buildings keep the geometry
  the bake gives them.

## Checking it

```bash
node src/scene/test-post-office-plan.mjs
```

Footprint against the bake, the frame's inverse, the two steps measured, and
every fitting under the porch asserted to sit inside the span it hangs on, and
the wall ring asserted to stop short of the porch line.
