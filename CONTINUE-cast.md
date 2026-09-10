# The cast

Thirteen figures that keep the peninsula's own hours, on `P`. Off until asked
for, the same as the courts on `T`.

## They are invented and the page says so

Every card carries the schedule and where it came from. Seven keep hours a
business actually publishes and the card names the source. The other six carry
the word **assumed** in amber, because a golfer's tee time, a cyclist's morning
and a hiker's afternoon are nobody's published hours and pretending otherwise
would be the one thing this project does not do.

`assets/cast.json` declares `"invented": true` at its top, and the test asserts
it.

Nobody has a name. They are the job — the postmaster, the parcel driver, the
librarian, the greenkeeper. Inventing residents of a small town and putting them
on a map of it is not something this project does.

## What is real about them

| the invented part | the real part |
| --- | --- |
| that anybody is there at all | the places: every one is an OSM feature with its own coordinates |
| the exact minute they set off | the hours: seven are published, and the card says where |
| that this is one person rather than many | the route: Dijkstra over the road network in `features.json` |
| their pace | the distance, measured along that route |

A car keeps to roads a car may use, a bike may take the cycleways and paths, a
walker may take anything. Nobody cuts across a field.

## The published hours

| who | hours | where published |
| --- | --- | --- |
| the postmaster | Mo-Fr 08:30-15:30 | OSM `opening_hours`, Point Roberts Post Office |
| the parcel driver | Mo-Fr 09:00-16:00; Sa 09:00-15:00 | OSM, Point To Point Parcel |
| the librarian | Tu 13:00-19:00; We,Sa 10:00-17:00 | OSM, Point Roberts Library |
| the shop hand | Mo-Su 09:00-19:00 | OSM, International Marketplace |
| the greenkeeper | Mo-Su 06:30-20:30 | the club's contact page, pointrobertsgc.com |
| the harbourmaster | Tu-Sa 08:00-17:00 | the marina's own site, pointrobertsmarina.com |
| the dog walker | 08:00-sunset | OSM, Lighthouse Marine Park |

The six assumed are the cook, the cyclist, the school run, the golfer, the hiker
and the fire crew.

## The clock

Point Roberts keeps its own time whoever is looking, so a reader in Berlin sees
the post office open at half past eight in the morning there and not here. The
figures run on the same clock as the sun, so dragging the sun slider moves the
town with it: wind it to three in the morning and there is nobody out but the
road.

Between legs they stand where the last leg left them, which is at work. Before
the first leg and after the last they are not drawn at all.

## Baking it

```bash
python scripts/build_cast.py
node src/scene/test-cast.mjs
```

The bake reads the road network, routes every leg and writes 80 KB. The test
checks that every leg begins and ends on a road in the bake, that a leg takes as
long as its own length at that character's pace, that each leg starts where the
last one finished, that the day runs forwards, that nobody is out at three in
the morning, and that every character marked published names a source.
