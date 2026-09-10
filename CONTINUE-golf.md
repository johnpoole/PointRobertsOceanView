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

## Who is out on the course

The club books through foreUP, and foreUP answers a plain JSON request with
every slot still **open**, each carrying how many of its four spots are left.
What is booked is what is missing: a slot absent from the ten-minute grid is
four players out, a slot showing one spot left is three.

```
https://foreupsoftware.com/index.php/api/booking/times?time=all&date=MM-DD-YYYY
  &holes=all&players=0&schedule_id=2544&schedule_ids[]=2544&specials_only=0&api_key=no_limits
```

Pace of play is John's figure and the whole of the model: fifteen minutes a
hole, so a group that went off at T is on hole `(now − T) / 15 + 1` and comes
off the eighteenth four and a half hours later. Each group stands that far down
the centre line of the hole the arithmetic puts them on, and the centre lines are
the map's.

**Two things this cannot know**, and neither is papered over:

A gap in the grid is not proof of golfers. A block held for a tournament, a
maintenance window or a shotgun start looks exactly like a foursome from here,
and no field separates them.

The sheet only lists times from now forward. To know who is on the course at
eleven you need what was booked at half past seven, and by eleven those slots
are gone from it. So the server samples while somebody is looking and remembers
what it saw; `known_from` says the earliest it can speak for, and a server that
first looked at noon reports an unknown morning rather than an empty one.

### When it is read, and when it is drawn

**Read** at six in the morning, before the course opens at half past, and then
once an hour. Not gated on anybody looking: the sheet stops listing a time the
moment it is past, so a read missed is a booking that can never be recovered,
and a server that only read while somebody watched would have holes in its day
it could not fill. The six o'clock read is what makes `known_from` say six
rather than whenever the first visitor happened to arrive.

**Drawn** only while the course is in front of the camera and near enough to
make out — `areaView` over the whole course, the same test the detailed areas
use.

The server says who teed off and when. How far round they are by now is worked
out in the page, every frame, off the same clock the cast runs on. Taking the
server's own hole and fraction moved a group once a minute, which is a step
rather than a walk.

The cast on `P` keeps the same rule: a figure is drawn only when it is inside
the frustum and within 1.4 km, so somebody four kilometres behind you costs
nothing.

```bash
python server/test_tee.py
```
