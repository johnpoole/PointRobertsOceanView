# The golf course

Point Roberts Golf Course, in the middle of the peninsula. The surfaces are on
the ground all the time; the hole cards stand over them on `F`.

## Nothing here is traced

The whole course is already in OpenStreetMap and `scripts/build_golf.py` bakes
it to `assets/osm/golf.json`: eighteen holes, greens, tees and pins, seventeen
fairways, sixty-three bunkers, thirteen cart paths, the clubhouse footprint and
the driving range. 111 KB.

It is deliberately **not** in `features.json`. That file is baked by
`build_osm.py`, and re-running that to add golf would renumber every building in
it — two landmark tests name their footprint by index. This is its own file,
fetched on its own, and nothing else moves.

## What the map does not carry

Five holes have no par: 4, 7, 8, 13, 14. No hole has a length at all. Both are
written out as `null` and the card says **par not mapped** rather than showing a
number nobody has. A photograph of the scorecard is thirty-six numbers and they
go straight into the bake.

Every hole is named, and the names are the course's own: Eagle View, Wildflower,
Water Lily, Far & Away, Up & Around, Wind & Wetland, Straight & Narrow, Lone
Fir, Roost Tree, Up & Away, Traditional, The Divide, Fir Tree, Oh Canada, The
Turtle, Down Home, Coyote's Vista, Bulrush.

## How it is drawn

Each ring is laid on the terrain rather than on one flat height, broken up until
no edge is longer than its own step — six metres for a green, twenty-five for a
fairway, because a green is read close and a fairway is two hundred metres of
grass. The split is also capped at four levels: the triangulator gives long thin
triangles that halve on their longest edge forever, and without the cap the
course came to 767,000 vertices. With it, 156,000 for the whole course.

Cart paths come as lines rather than rings, so they are drawn as ribbons 2.4 m
wide.

The colours are chosen to read from the air — the green greener than the
fairway, the bunkers sand, the paths grey. Nothing about them is surveyed.

A ring that will not triangulate says so on the console with its OSM id rather
than quietly leaving a hole's worth of missing grass.

## The cards

One at each pin, seven and a half metres up, carrying the number, the name and
the par when there is one. They face whoever is looking, so they read from the
bluff and from straight above alike. Off until `F` is pressed, the same as the
courts on `T` and the campground on `G`.

## Checking it

```bash
node src/scene/test-golf.mjs
```

Eighteen holes numbered once each and named, thirteen with a par and five
without, every shape inside the box it was pulled for, every pin within forty
metres of a green so a card stands over the hole it names.

## Not done

The clubhouse is a bare footprint in OSM with no height and no detail. Building
it properly is a landmark job like the post office and it needs a photograph of
the building.
