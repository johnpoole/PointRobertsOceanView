# US border station, Point Roberts

Tyee Drive at the 49th parallel, the US side of the Point Roberts–Boundary Bay
crossing. The baseline was OSM building 5 in the bake: one grey three-metre
flat-roofed slab covering the whole site. The area replaces exactly that
footprint and keeps a pickable name on it.

## Inspected references

- **OSM way 256670344**, `building=yes`, `name=US Customs and Border Protection
  - Point Roberts`, `operator=United States Customs and Border Protection`.
  Thirty-five corners, 924 m². Used exactly as it stands in the bake, corner for
  corner, and the test asserts that.
- [County 2022 aerial](https://gis.whatcomcounty.us/arcgis/rest/services/Imagery/2022_WhatcomAerialImagery_SPN/MapServer/export?bbox=-13700008.04723508,6274974.094193439,-13699798.04723508,6275184.094193439&bboxSR=3857&imageSR=3857&size=1200,1200&format=png&f=image),
  inspected 9 September 2026. 1200 px over a 210 m web-mercator box, which is
  137.9 m of ground and 8.7 px per metre. The traced outline was drawn over this
  image to work out which part of the ring is which; that is where the four
  parts below come from. It also shows the lanes, the queue north of the canopy,
  the parking along the highway and the ribbed roof on the south wing.
- [US port of entry at Point Roberts, brightened](https://commons.wikimedia.org/wiki/File:US_port_of_entry_at_Point_Roberts,_brightened_(August_6,_2026).jpg),
  CC BY-SA 4.0, dated 6 August 2026, looking south from the Canadian side. The
  elevation comes from this: board-formed concrete with POINT ROBERTS, USA in
  raised letters, vertical wood slats above and east of it, the glazed band on
  the set-back wall and round the west face, the steel canopy on paired posts
  over the lanes, the yellow gate arms with their stop plates, the signal heads
  hanging under the canopy, the booths, the light mast, the flag, and the sign
  in the grass reading BE PREPARED TO SHOW IDENTIFICATION / DECLARE ALL ARTICLES
  ACQUIRED OUTSIDE USA.
- A Google aerial oblique looking north over the station, supplied by John. It
  is the only view of the roofs from above at an angle, and it corrected three
  things: the walls are tan metal panel over a concrete plinth rather than
  concrete throughout; the office roof is seamed grey with a white membrane over
  its north end only, and the plant stands on that white end; and the lane
  islands between the canopy and the line are lined with yellow posts, which is
  most of what there is to see there.
- [Point Roberts poe](https://commons.wikimedia.org/wiki/File:Point_Roberts_poe.jpg),
  CC BY-SA 3.0, dated 2002. Not used for the current elevation — it is
  twenty-four years older than the model — and listed only so the next person
  knows it was looked at and set aside.

No reference image is bundled and none is used as a texture. Both signs are
drawn locally in a canvas. The wording is the wording on them; the lettering is
not a reproduction of any particular type, and no agency seal is drawn.

## The four parts

The site is skewed 9.37° off the compass, so the frame is set to the site's own
axes off the edge between corners 9 and 10, and everything below is in those
metres. The parts are named by their corners in the traced ring and they tile it
exactly — 203 + 380 + 120 + 221 = 924 m², which the test checks against the
whole rather than trusting the arithmetic here.

| part | size | what it is |
| --- | --- | --- |
| canopy | 19.2 × 10.6 m | the roof over the inspection lanes, on six posts |
| office | 16.8 × 27.9 m | the block along the highway, the tall one |
| middle | — | the low flat-roofed section behind the office |
| wing | 10 × 21 m | the long ribbed-roof wing running south |

The canopy is a roof and nothing else: a deck on posts with the lanes running
under it. The other three are extruded as building.

Heights are visual estimates off the August 2026 photograph:

| estimate | value |
| --- | --- |
| office to its roof | 6.6 m |
| middle section | 4.6 m |
| south wing to its eave | 5.0 m, ridge 0.8 m over that |
| canopy deck | 5.4 m, 0.55 m of fascia |

The wing sits a few degrees off the frame's own axes, so its roof is built from
its four corners rather than as a turned box: `slopedRoof` takes the corners in
order and runs the ridge between the middles of the two end walls. A box turned
by eye would have missed the walls.

## What is not known

- The office roof is drawn flat with a lip. The August photograph shows its top
  edge falling from front to back, which could be a shallow mono-pitch rather
  than a flat roof with a parapet; the oblique does not settle it either.
- The south and east elevations have no reference coverage. They carry the mass
  and nothing else. No window on a hidden wall was invented.
- The lane markings, the queue islands and the northbound Canadian side are not
  modelled. The apron is a single paved area.
- The booths are placed where the photograph shows them under the canopy, not
  surveyed. OSM has one small 11 m² structure nearby (way 1009210199) which is
  left as the bake draws it.
- Vehicles, people and the overhead wires are left out.

## Checking it

```bash
node src/scene/test-border-plan.mjs
```

Footprint against the bake corner for corner, the frame's inverse and its skew,
the four parts asserted to tile the traced area, the canopy measured, and every
post, booth and gate asserted to stand under the canopy it belongs to.
