# The golf clubhouse

1350 Pelican Place. The baseline was OSM building 84 in the bake: a grey
five-metre flat-roofed block. The area replaces exactly that footprint and keeps
a pickable name on it.

## Inspected references

- **OSM way 441719219**, `building=yes`, `golf=clubhouse`, addressed 1350
  Pelican Place. Four corners, 13.44 × 12.26 m, 165 m², standing 58.29° off the
  frame's own axes. Used exactly as it stands in the bake and the test asserts
  that. The golf bake carries the same building and the test checks the two
  agree on where it is.
- [County 2022 aerial](https://gis.whatcomcounty.us/arcgis/rest/services/Imagery/2022_WhatcomAerialImagery_SPN/MapServer/export?bbox=-13701531.961874202,6274131.475783948,-13701411.961874202,6274251.475783948&bboxSR=3857&imageSR=3857&size=1000,1000&format=png&f=image),
  inspected 10 September 2026. The traced outline was drawn over it with the
  frame's axes marked, which is what settled the orientation: the main ridge
  runs north-east, the gable end faces the course, the entry is on the
  north-east end and the wing and its deck run off the south-west.
- The club's own photograph of the clubhouse, from
  [their gallery](https://www.pointrobertsgc.com/gallery). Everything about the
  elevation comes from it: stacked log walls stained dark red-brown, a steep
  shingled gable, the balcony across that gable on its brackets, the heavy
  timber entry porch, the railed deck, the glazed room at the far end and the
  chimney standing well clear of the ridge.

No reference image is bundled and none is used as a texture.

## What is traced and what is estimated

**The core is surveyed.** It is the OSM outline, corner for corner.

**Everything hanging off it is not.** The wing, the deck, the porch, the glazed
room and the chimney are read off the aerial and the photograph, in the frame's
own metres:

| estimate | value |
| --- | --- |
| log wall to the eave | 5.4 m, two storeys |
| ridge over the eave | 5.6 m, which is a pitch of 0.91 against the half-depth |
| wing | 6.4 m out, 3.3 m tall |
| deck | 7.6 × 4.15 m off the course side, 1.05 m up on posts |
| porch | 3.2 m out on the north-east end |
| chimney | 1.25 m square to 11.9 m, clear of the 11.0 m ridge |
| log course | 0.34 m |

Anything that sits on a traced wall takes its line from the trace rather than
repeating the number: the balcony, the porch, the wing and the deck all read
their wall out of the frame. Typing 12.26 twice is how the balcony first ended
up two millimetres inside the wall it hangs on, and the test caught it.

## What is not known

- The roof over the core is drawn as one straight gable. The aerial shows cross
  gables off it that are not modelled; the mass and the ridge line are right and
  the roof is simpler than the real one.
- The OSM outline is 13.44 × 12.26 m and the roof in the aerial covers more
  ground than that, so OSM traced the core and not the whole building. The wing
  and porch here are an attempt at the rest, not a survey of it.
- The north-west and north-east elevations have no reference. They carry log
  courses and nothing else. No window on a hidden wall was invented.
- The marquee standing beside the building in both the aerial and the
  photograph is not modelled: it is a tent, not a building.

## Checking it

```bash
node src/scene/test-clubhouse-plan.mjs
```

Footprint against the bake corner for corner, the frame's inverse and its turn,
the two bakes agreed on where it stands, the roof asserted steep rather than
hipped, and the porch, wing, deck and chimney each asserted to be on the side of
the core they belong to rather than standing in one another.
