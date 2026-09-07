# Kiniski's Reef detail — issue #54

1334 Gulf Road, Point Roberts. This is a source-based interpretation of the
building and immediate waterfront/forecourt, using historical imagery. It is
not a survey or a claim that furniture and finishes are unchanged in 2026.

## Sources inspected

- [County 2022 orthophoto export](https://gis.whatcomcounty.us/arcgis/rest/services/Imagery/2022_WhatcomAerialImagery_Web/MapServer/export?bbox=-13701668.092274254,6272165.347541674,-13701508.092274254,6272325.347541674&bboxSR=3857&imageSR=3857&size=900,900&format=png&f=image).
  EPSG:3857 bounds: west -13701668.092274254, south 6272165.347541674,
  east -13701508.092274254, north 6272325.347541674. The 900-square source
  displayed at 720-square in the browser, with its left edge at x=280 and top
  at y=0. `reef-plan.js` records those observed screen coordinates and converts
  them through Web Mercator back to latitude/longitude and application metres.
  The image centre is 48.98458, -123.08346. Roof edges, patio, lawn, paved lot,
  shoreline edge and equipment positions were digitized from this view.
- [Google Maps panorama near the Reef](https://www.google.com/maps/@?api=1&map_action=pano&pano=CIHM0ogKEICAgIDFkILr8QE).
  Contributor Matanumi; Maps showed **Image capture: Dec 2022**, with **Nov 2023**
  in the contributor panel. Panorama ID `CIHM0ogKEICAgIDFkILr8QE`. The geographic
  tag was 48.9845945, -123.0835186. Its visible camera orientation does not agree
  with geographic north, and the tag is not treated as a surveyed optical centre.
  Headings 270 / tilt 20–35 in the Maps UI show the Reef from the south; heading
  180 / tilt 40 shows the waterfront. The snow makes some ground detail unclear.
- A second Maps entry, `CIHM0ogKEICAgICByvT40wE`, tagged at
  48.9842006, -123.0835938, showed the same winter drone scene. It is not counted
  as an independent measurement. A standard Street View result at Gulf Road
  returned a black image and was not used as evidence.
- [Sidewalking Victoria's April 2022 visit](https://www.sidewalkingvictoria.com/blog/2022/4/10/finally-open-for-business-point-roberts-washington)
  and its [exterior photograph DSCF9564](https://images.squarespace-cdn.com/content/v1/593196625016e16bb40f6f78/1650083455045-ZM6QQI60QBL7CLROBHA2/DSCF9564.jpg).
  This independently shows pale brick, narrow framed windows, two street doors,
  the broad red name band and the sloping white canopy above it. The model's
  sign uses plain locally drawn lettering, not a copied photograph or logo.
- Existing `assets/osm/features.json`, building 47, named **Kiniski's Reef**.
  Its eight distinct outline corners cover approximately 878.294 m². The first
  corner is 48.9846873, -123.0836764. The exact outline is retained, including
  the southwest step, and split at the roof join visible near aerial x=578.

Images were inspected in the browser. No source imagery was downloaded or
bundled into the scene. Roof, ground and street details were cross-checked
between views rather than using panorama perspective as a scale ruler.

## What is modelled

The main flat roof and lower west wing; sloping white street canopy and red
name band; narrow windows and glazed street entries; west-side patio windows
and entry canopy; roof parapets, capped vents, a dogleg duct and an equipment
box; open patio, adjoining lawn, forecourt paving, orange-brown patio fence,
northern timber rail, low concrete shoreline edge, wheel stops and simple
outdoor tables/seats. The courtyard remains open to the sky.

The original OSM building is replaced once through `skipBuilding`, which now
also applies to named buildings. The retained base wall mesh provides the
hover landmark. No other named buildings, Breakers/Brademy geometry, ruined
pier posts, terrain or navigation/collision behavior are replaced.

The floor is the highest sampled footprint corner plus 0.08 m (5.73 m MLLW
with the current terrain). Main wall height 4.15 m, west wing height 3.30 m,
0.10 m roof caps, canopy and fence heights, window dimensions, equipment
heights and furniture dimensions are **visual estimates**. The canopy's red
band is 2.80–3.48 m above the floor, with the white slope rising toward 4.18 m.
Window/door spacing is estimated from the exterior photograph. Seven vent
positions represent the legible round fittings in the aerial, not a complete
mechanical inventory. Four tables represent the clustered patio seating in
the winter panorama, not permanent surveyed furniture positions. Cars, snow,
temporary bins and signs, and unverified interior detail are omitted.

Ground surfaces are subdivided and draped on the existing terrain with a
0.055 m lift. They change appearance, not elevation or vehicle collision.

## Loading and checks

`reef-area.js` uses the #53 area lifecycle: one pending load, one cached detail
model, a 30-second inactive cache, current-view evaluation and resource
disposal. Proximity thresholds are 220 / 350 m; projected-size thresholds are
the shared 180 / 120 CSS pixels. Main startup loads `reef-base.js`, while
`reef.js` is dynamically imported. The marina retains its own independent slot.
The detailed model owns one small sign texture, disposed when it is evicted.

Base: 4 meshes, 2,168 triangles, 234,144 geometry-array bytes. Detail: 6 meshes,
5,846 triangles, 631,280 geometry-array bytes, plus the sign texture. Most base
triangles are the subdivided ground paving needed to follow the terrain.

- `node src/scene/test-reef-plan.mjs`: georeferencing, footprint-area
  conservation, open patio, furniture bounds and exact one-building match.
- `node src/scene/test-land.mjs` and `python server/test_index.py`: pass.
- Actual Three.js checks against the baked terrain: finite geometry, roof
  levels, open-patio raycast, every draped ground vertex, sign-texture disposal,
  and named-building exclusion while another named building remains rendered.
- Isolated browser preview: actual area lazy loader, real terrain sampling,
  street and waterfront views inspected. This does not benchmark full-scene
  performance or establish survey accuracy.

View from Gulf Road:
`#eye=48.983963,-123.083346,18&aim=48.984547,-123.083510,8.5&fov=48`.
