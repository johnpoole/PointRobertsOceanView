# CONTINUE — Point Roberts ocean view

A three.js page that stands on the West Bluff at Point Roberts and looks west over the Salish
Sea, with a FastAPI proxy behind it bridging live feeds. It is built and deployed. This file is
for picking it up cold.

Deployed at https://oceanview.johnpoole.ca, on the Basement server (`ssh basement`),
from a git checkout at `~/pointroberts-oceanview`.

## The rule that matters most

Nothing is invented. Every feed carries a health value and a source, and a feed that fails says
so on screen rather than showing stale or made-up numbers. The scraped vessels are labelled
scraped, in the HUD and on every position. Keep it that way.

That rule is about the feeds. The Brademy, six tennis courts on the old Breakers parking lot, is
not built yet, and the switch on `T` is the whole of how it is kept apart from the peninsula: off
unless asked for. Issue #14. It carries no caption saying so, and nothing else here should either —
a line describing the status of a feature is not something the person looking out of the window
needs.

A clubhouse stands where the Breakers building stands, so one of the two is up at a time: with the
courts off you get the block that is really there. OSM does not name that building, so it is found
by what it is — the largest footprint for 200 m, 1,501 m² at 38 by 58, tagged as trading premises,
between the parking lot and the water. `buildLand` takes an `isolate` predicate to give one
footprint its own mesh instead of merging it with the other four thousand, which is what lets a
single building be hidden without rebuilding them all.

The hedge round that lot is not behind the switch. It is there now, so it is drawn now, in its own
group. With the courts off you get a hedge round an empty lot, which is what is there. Its height
of 3 m is assumed rather than measured, and it is drawn unbroken because nobody has said where the
way in is.

## The campground

The Nielson Campground, 166 sites on 16.5 acres of a 46.31-acre wooded lot off
Dogwood Way, granted by the Whatcom County Hearing Examiner on 7 July 2026 as
CUP2024-00005. Not built, so it is off until asked for on `G`, the same way the
courts are off until asked for on `T`. It stands 1.9 km east-northeast of the
house on ground 50 m above the sea, so nothing on the bluff will ever see it —
it is there for the modes that drive about.

Two kinds of number live in it and they must not be confused. **The lot is
surveyed.** It comes out of Whatcom County's own parcel layer and its largest
ring measures 46.53 acres against the 46.31 the decision states. **The
applicant's drawing is not here.** The site plan set is Exhibit 22 and Exhibit 22
is not in the decision, so nobody here has seen where their roads run.

But the staff report describes the layout in prose, on pages 14 and 15, and
every word of it is obeyed rather than invented around: clustered in the eastern
third of the lot; the store, the manager's residence and the community building
on the south side by the entrance off Johnson Road; the park models on the
western side, the RVs central, the tents through the remainder; a gated
secondary access off Mill Road. So the rule takes the eastern 16.5 acres of the
lot, runs four rows north and south across it, and gives the westmost rank to
the park models, the rank nearest the middle to the RVs, and the six others to
the tents.

The report also states three distances, and they are the check on the rule
rather than inputs to it. Only the tightest is used — sites stand 40 ft off the
boundary, which is the report's tent-to-east-boundary figure and more than the
code's 30 ft. The other two fall out and are read back:

| the report says | this comes out at |
| --- | --- |
| about 800 ft from the camp sites to the nearest residence west | 820 ft |
| RV sites over 200 ft off the eastern boundary | 316 ft |
| the store 57 ft off the southern boundary | 57 ft, by construction |

Nothing was tuned to make the first two land. The 820 is what you get by taking
the eastern 16.5 acres and nothing else, and it is the strongest evidence that
the eastern-third reading is the right one.

Two numbers the rule cannot honour, both because a rule cannot see a drawing.
Five hydrants no more than 600 ft apart: this run is 1,416 m, so five come out
283 m apart. Five is the decision's number and it is kept. And the nearest site
lands further than 40 ft off the eastern boundary, because that boundary steps
nine metres west partway up the lot and one straight row cannot follow a step.
Both are handed back on the plan rather than quietly fixed.

The trees on the lot are neither drawn nor cleared here. It is forest in the land
cover and `trees.js` has already scattered it, and the decision keeps 66% of the
canopy and says the campsite area keeps canopy too. The firs standing among the
sites are the retained canopy.

`node src/scene/test-campground.mjs` walks the layout: every site and stall inside
the setback, no two on the same ground, the counts against the permit, the three
distances above, a rank carrying one kind of site and no other, and no building
over the 25 ft the Special District allows. None of that shows on screen at any
range this is seen from, which is why it is a test.

### How far it carries

Both the ground itself and the overview map shade by sound level while the
campground is up. Three bands: 55 dB, which is what WAC 173-60 allows at a
residence by day; 45, which is what it allows between ten at night and seven in
the morning, condition 49; and 35, where the camp starts to stand out of a quiet
rural night.

Nothing is drawn below 35. There was a 25 dB band and it was wrong to paint: a
quiet rural night is 25 to 35 dB on its own, so that band meant "you cannot pick
this out of the background" and it covered three kilometres of ground saying so.
A region where the camp is inaudible is not an impact and must not be coloured
like one.

**It is the worst night, not an average one**, and it follows ISO 9613-2:1996
rather than being made up. That standard is not an afternoon model needing a
night added: its own scope says it predicts levels under conditions favourable to
propagation, and names those as downwind or, equivalently, under a
well-developed moderate ground-based temperature inversion, such as commonly
occurs on clear, calm nights. That is the night in question.

Every term is the standard's and every source is checked, not remembered:

| term | value | where from |
| --- | --- | --- |
| spreading | 6 dB a doubling, spherical, at every distance | ISO 9613-2 eq. (7) |
| air | 1.9 dB/km | ISO 9613-2 table 2, 500 Hz, 10 °C, 70% |
| ground | 4.8 − (2·1.5/d)(17 + 300/d), floored at 0 | ISO 9613-2 eq. (10) |
| 55 and 45 dBA | Class A to Class A, less 10 at night | WAC 173-60-040 |
| 70 dB a site | raised voice, cross-checked below | speech tables + USBR |

**The source level is the only figure with nothing measured behind it, and it is
the one that decides the answer.** It is a speech table: ordinary conversation is
about 60 dB at a metre, a raised voice about 70. It is per site, not per person,
and that cuts both ways — four people at one site is 6 dB over one, so 70 is low;
all 166 sites sounding at once is an evening that never happens, so 70 is high.
Neither has been measured and they are not known to cancel.

What being wrong costs:

| source | 45 dB reaches | 35 dB reaches |
| --- | --- | --- |
| 64 dB | 20 m | 130 m |
| **70 dB** | **60 m** | **310 m** |
| 76 dB | 175 m | 640 m |
| 82 dB | 395 m | 1180 m |

Six decibels roughly triples how far the night limit carries. Nothing else here
is close to that sensitive. The test prints that table on every run so nobody
reads the 60 m as a finding.

No published measurement inside an occupied campground was found. The nearest
thing, the US Bureau of Reclamation's Navajo Reservoir noise appendix, will not
do the job: it likens heavy recreation areas to residential areas at an Ldn of 50
to 65 dBA, which is an analogy rather than a measurement, and Ldn is a 24-hour
average carrying a 10 dB penalty after ten at night, so it cannot be set against
an instantaneous worst case. An earlier version of this file used it as a
calibration. It was not one.

| | worst night |
| --- | --- |
| 40 ft east, over the boundary | 52.1 dB |
| 800 ft west, nearest house | 36.4 dB |
| how far the 45 dBA night limit reaches | 60 m off the camp's east edge |
| back into the night by | 390 m |

**An earlier version of this was wrong and the way it was wrong is worth
keeping.** It carried a home-made surface duct — spherical spreading to 200 m
and cylindrical after, 6 dB a doubling becoming 3 — on the reasoning that a night
inversion bends sound back down. The reasoning is sound, the arithmetic was
right, and the conclusion was still wrong: ISO 9613-2 already *is* the inversion
case, and its divergence term is spherical at every distance. The duct was the
inversion counted twice. It put the 35 dB contour at 1170 m where the standard
puts it at 390. The same version had the ground losing 3 dB a kilometre; the
standard has it climbing fast to just under 4.8 dB and then staying there.

Still left out: the trees. ISO 9613-2 table A.1 gives 1 dB for a 10 to 20 m path
through dense foliage at speech frequencies and 0.05 dB/m from 20 to 200 m. The
30 ft perimeter buffer is 9 m, shorter than the shortest path in the table, so it
is worth about a decibel. It gets argued as noise mitigation and it is not.
Barriers and housing are left out too, which is the right way round for a worst
case, and the terrain shields nothing on this plateau.

It is an upper bound — the level ISO calls one that is seldom exceeded. It is not
a typical night and it is not a measurement. A real assessment measures the
background at the houses over several nights and runs the full octave-band method
with the real source spectrum. Nothing read off it belongs in a comment to the
county.

The colours are one hue stepped, quietest deepest, run through the data-viz
validator on both surfaces they are drawn on: full opacity on the map panel,
where all four checks pass and the quietest band clears the background at 2.24:1;
and composited over the ground at 0.6, where monotone lightness, visible gaps and
one hue hold on dark forest, mid grass and pale pasture alike. 0.6 is the
lightest that does — at 0.55 the two quiet bands close to under the 0.06
lightness gap and stop being two bands. The quietest step does not clear the 2:1
floor against mid ground, and that is meant: this is a sequential field whose low
end means barely anything, and a low end is allowed to recede.

On the ground the bands are a nearest-filtered texture on a coarse draped sheet,
not a colour per vertex. Three kilometres of ground has to be cut coarsely to be
affordable, and a coarse mesh carrying the colour in its corners would blend one
band into the next and turn four thresholds into a smear. The sheet is clipped to
the near tile, because outside it the sampler clamps to the edge and the sheet
would hang in the air over the water.

`node src/scene/test-campground-noise.mjs` checks the model against the closed
forms it must obey: 6 dB per doubling inside the duct, 3 outside, the two halves
meeting at the seam, 10 log10(n) for n sources at one range, finite standing on a
site, and the two staff-report distances landing where the prose says.

## Deploy

```
git push origin main
ssh basement 'cd ~/pointroberts-oceanview && git pull --ff-only && docker compose build && docker compose up -d'
```

`basement` is the alias in `~/.ssh/config` and points at 192.168.1.90 on the LAN.
Use it. `yarbo-server` is the same machine's Tailscale name and it resolves only
while Tailscale is logged in, which is not a thing to find out mid-deploy.

The server holds two files git does not: `.env` (the AISStream key and
`OCEANVIEW_ADMIN_PASSWORD`) and `docker-compose.override.yml`. Never overwrite them. Port 8091,
not 8090 — that one is taken by `yarbo-emulator-timefold`. nginx, in the
`yarbo-aerator-tow-nginx-1` container, fronts it and passes `X-Real-IP` through on both the page
and the WebSocket.

## Layout

```
server/proxy.py            serves the page and merges four feeds into one WebSocket
server/shipfinder.py       drives a headless browser to read vessels off shipfinder.com
server/test_*.py           plain asserts, no runner: python server/test_shipfinder.py
scripts/build_terrain.py   bakes the two heightmaps from NOAA CUDEM and GMRT
scripts/build_osm.py       bakes roads, buildings, coastline, landmarks from Overpass
scripts/build_landcover.py bakes NLCD 2021 land cover for the near tile
scripts/build_parcel.py    bakes the campground's lot from Whatcom County's parcel layer
src/main.js                wires the scene, the camera, the modes
src/nav.js                 the modes themselves, and the boat's hydrodynamics
src/touch.js               the on-screen stick, and the drag that looks about
src/gyro.js                how far the phone has turned, for the modes that look
src/share.js               puts the view in the address bar, and reads it back
src/scene/                 terrain, trees, ocean, land, beach, boat, vehicles, vessels, aircraft, sky
src/scene/brademy.js       the tennis courts, off unless asked for, and the hedge, which is not
src/scene/campground-plan.js  where the proposed campground goes, in metres. No three, no meshes
src/scene/campground.js    that plan drawn. Off unless asked for
src/scene/campground-noise.js  how far it carries, by distance alone. Shades the map
src/scene/cabin.js         389 W Bluff Rd, modelled off photographs rather than extruded
src/scene/parts.js         tint, box and gableRoof, shared by the cabin and the clubhouse
src/scene/drift.js         kelp, sticks and foam on the water, so the current can be seen
src/scene/orcas.js         a group running the west shore, at the rate the month says. Not a feed.
src/scene/lights.js        points that hold their size in pixels, for lights seen a long way off
src/scene/lighthouse.js    Point Roberts Light on the point, and its two flashes
assets/                    everything baked. Do not edit by hand.
```

## Feeds

| feed | source | state |
| --- | --- | --- |
| tide | NOAA CO-OPS 9449639, surge from 9449424 | live |
| currents | NOAA CO-OPS PUG1726 bin 35, predictions | live, labelled predicted |
| weather | Open-Meteo | live |
| aircraft | adsb.lol, 30 nm, no key | live |
| vessels | shipfinder.com, scraped | live, labelled scraped |
| vessels | AISStream | dead, see issue #1 |
| crossings | BTS, from US CBP | live, monthly, nothing drawn from it yet |

The tidal stream is PUG1726, 4.5 nm southwest of the point, 8.1 km off the bluff. Bin 35 is
9.4 m down and the shallowest of the three the station publishes, so it is the one a boat is in;
bin 11 is 57 m down and is what the API returns when no bin is asked for. A whole day of
predictions comes in one call and is interpolated locally, so it is fetched about twice a day and
not once a poll. It is one point offshore standing for the whole tile, which is wrong along the
West Bluff and at Lighthouse Park — issue #13.

AISStream went silent with the socket open and stayed that way. It is not our key and not our
bounding box: the proxy proves it with a worldwide probe and an outside monitor, and the service
looks abandoned — its owner last spoke on their tracker in April 2025. Issue #1 has the options.

The shipfinder scrape only runs while a browser is connected, and then every 600 seconds. Their
own map polls the same endpoint every ten seconds, so one ordinary visitor to their site is worth
about sixty of these. It stands down entirely if AIS ever comes back. Nothing outside a browser
gets past their Unauthorized, so a headless Chromium loads their map and the answer is read off
the wire. Ship names come from clicking a ship and reading the panel; the answer is cached on a
volume because a name does not change.

## The whales

Nobody publishes where the orcas are right now. Ocean Wise holds the live alerts for commercial
mariners and delays the public a day. Orca Network's reports are prose on a blog and a Facebook
page. What is published is how often they are seen, month by month, so that is what is drawn: a
season and a rate, and a group put on the water at that rate. It is not a feed, it carries no
label, and it makes no claim about today. Issue #10.

The rate is the Orca Behavior Institute's 2025 Salish Sea count of Bigg's killer whales. Four
figures are theirs — 1860 for the year, 96 in February, 190 in September, 252 across December,
January and February — along with the rank order, most in June then August then May and fewest in
December then November then January. The other nine months are fitted to those and are the weakest
thing in the file. Bigg's and not the Southern Residents because Bigg's are what passes now: the
residents were absent from the whole Salish Sea in May, June and August of 2025.

They run the west shore, from the north end of the peninsula down and round the point, holding
between 500 m and 3 km off the beach. The shore comes out of the baked coastline rather than being
typed in: the dozen OSM ways are joined end to end into one chain, walked at 50 m, and kept while
the sea lies to the west. Which side is the sea is not taken from the winding of the trace — each
point asks the sea sampler how deep it is 150 m to either side and believes the deeper one. It has
to be the deeper one by half a metre, because north of the bluff the beach shelves so gently that
there is only a metre of water 150 m out, and a rule that wanted deep water there threw away half
the coast and left the whales in a 2 km stub off the house.

A group's whole run is checked for water before it is placed, not just the spot it starts on. A
fixed distance off a coast that bends cuts the corner, and a group that starts on a corner swims up
the beach for the next half hour.

It was a box centred on the house before this, four kilometres of it, and it was wrong. Lighthouse
Marine Park is where people actually stand to watch for whales and it is 1.8 km south of the house,
so the box put most of the water off to the north of anyone standing there.

`LOCAL_SHARE` is an assumption and nothing else. It is the share of Salish Sea groups that come
along this shore, set at 0.03 because the sightings pile up in Haro Strait and the San Juans and
Point Roberts sits on the edge of that. Nobody has measured it.

The rate is the real one, so a group comes past about once every four days in August and you will
not see one in a sitting. The whales button is how you see them: it puts a group on the water beside
wherever you are standing, they surface within a few seconds instead of waiting out a dive, and it
puts you where you can watch. Pressing it again replaces the group rather than adding to it.

Where it puts you is the whole of whether it works, and two measurements settled it. Only about
1.2 m of an orca is ever out of the water — the back and the fin, no more — so at a kilometre that
is a three pixel notch and at 300 m it is seven. And a group travelling at 2.2 m/s leaves the frame
inside a minute. Standing you abeam of them at 300 m, which is what it did first, showed a speck
that then swam away, which is why John saw nothing at all.

So it gets 170 m ahead of them down their own track and 55 m to the shore side, eye 8 m above the
water, and they come on. They start about 180 m off and pass within 75, growing the whole way.
Measured over two minutes: first one showing inside two seconds, twelve to twenty seconds of whale
actually on the screen, peaking at 21 to 39 px of exposed back and fin.

## After dark

A light seen at three kilometres is a point, and it is the same size on the screen whether the lamp
is a metre across or ten, because what you are looking at is the eye's own blur. So the lights are
points with their size held in pixels rather than in metres, and they add to what is behind them
instead of covering it. `src/scene/lights.js` is that and nothing else. They come up on `1 -
weather.dayFactor`, which is the sun's elevation, so they light at dusk and not at a clock time.

Ships carry the masthead, the two sidelights and the stern light, and then the lights somebody left
on, which is most of what you actually see. A ferry gets 86 of them and a bulker 17, which is the
whole reason the Tsawwassen boats are the thing you can pick out of a dark strait from the bluff. A
vessel whose position has gone stale burns at a quarter, because a track that is not trusted should
not sit out there looking like a ship with its lights on.

Point Roberts Light is on the point at Lighthouse Marine Park. There is no lighthouse: the
government bought the land for a light station in 1908 and never built the tower, so what stands
there is a skeleton tower about 25 ft high. It shows two flashes half a second apart every five
seconds. John timed that from the point. The published light list says fifteen seconds and the
disagreement is recorded in the file, because a number read off the water beats a number copied out
of a table.

The lamp stands on the tower rather than at the published focal height of 9 m. That 9 m is measured
above mean high water and everything on this page is metres above MLLW, so driving the lamp from it
buried the light two metres inside the steelwork. On the tower it comes out at 10.6 m on our datum,
which agrees with the published figure to inside the tide range.

## Border crossings

Point Roberts can only be reached by driving through Canada, so its trade is Canadians coming down
for fuel, parcels, the marina and a meal, and every one of them is counted at the booth. That makes
the crossing count the closest thing there is to a measure of what the place is doing.

US Customs hands the counts to the Bureau of Transportation Statistics about once a quarter and BTS
publishes them by port and by month, back to 1994. Point Roberts is port code 3017. The proxy holds
the last 24 months and re-asks every six hours, which is often enough for a figure that changes four
times a year.

It is monthly and runs a month or two behind, so it carries the month it belongs to rather than an
age in seconds, and it must never be dressed as live. June 2026 was 51,928 personal vehicles, 73,771
people in them, 677 trucks and 561 on foot; March was 42,400 vehicles, so the season is in it.

Nothing on the page draws it. It goes out on the socket and stops there.

## The colour of the water

Matched to a photograph off the deck, on the ratio and not on the number. In that photograph the
strait is silver grey with a little blue in it and sits at about four fifths the brightness of the
cloud above it. The page renders a dimmer sky than the real one, so matching the water's absolute
value would have put the sea brighter than the sky it is reflecting. It now comes out at 113 against
a sky of 145, which is 0.78.

It was `0x2b5566`, a deep slate, which rendered at 46 against that same sky — a third of it. That is
what made an afternoon in August look like the North Atlantic in February.

`WATER_COLOR` is fixed and does not follow the sky, so it is wrong at sunset and wrong under a black
squall. What the weather moves is the light on it, not the colour.

## The datum, which everything depends on

Heights and the tide are both metres above MLLW, so the water plane height equals the tide
reading and the waterline sits where it really sits. The near tile is NOAA CUDEM at about 3 m,
shifted NAVD88 to MLLW by +0.411 m. Verified against USGS 3DEP to 0.15 m and against the OSM
coastline to 0.01 m. If you rebake, check it again.

## The cabin

389 W Bluff Rd is not extruded from its OSM trace like every other building. It is modelled off the
photographs in the stabilisation packet at `../PointRobertsEngineering`: near-black lap siding, a
low standing-seam gable with very deep eaves, a brick chimney above the ridge, white window bands
facing the water, an upper deck on posts with a wire rail, a lower deck with timber rails, a lattice
screen under it and a stair down the north side. `buildLand` takes `skipHome` so the two do not stack.

The ground under it falls from 10.79 m at the east corner to 5.74 m at the west — five metres under
a seven metre building. The east side is dug into the bank and the west stands on posts, which is
the whole reason that packet exists. The address node is 34 m uphill of the cabin, at 18.84 m, up on
Bluff Road; the camera opens there, not on the cabin.

The traced footprint is an irregular seven-node 55 m². What is built is the rectangle that fits it,
7.4 by 6.0 turned 18° east of north, because that is what the photographs show and a photograph
cannot place the notch.

The roof heights are the lidar's. 495 returns over that footprint put the ridge at 13.29 m and
the eave at 12.84, against 15.00 and 13.85 drawn, and the pitch at 1.7 in 12 against 4.6. Two
things fell out of that measurement: the walls less the overhang are 473 sq ft against the
assessor's 496, and the eave sits 4.18 m over the lower floor rather than 5.30, which puts the
upper floor at 10.45 — exactly the lidar ground on the uphill side. You walk in at grade from the
road. So the storeys are no longer two of 2.65 but a low half-buried level under a full one.

**The shape is still wrong.** 487 of 520 returns sit in a band 0.8 m thick: it is not one gable,
it is three low-slope standing-seam planes at different levels, and one gable is what is drawn.
The three levels have not been measured. Note also that the two clips disagree — the 495 returns
above are over the fitted rectangle, and the 520 over the footprint grown a third, which gives
ridge 13.78 and eave 12.58. Settle which clip before fitting the planes. The lidar and the
working are in `../PointRobertsEngineering/CONTINUE.md`.

## Ground colour

Elevation and slope decide the beach, because a 30 m land cover cell cannot see a twenty metre
strip of shingle. Sand on the flats, stone where it tilts. Above 6.5 m NLCD decides: forest,
pasture, pavement, wetland. Height still pales the ground as it climbs, and is the whole story
for the Canadian end of the tile, which a US survey does not cover.

Loose stone is geometry, 1707 cobbles and 48 logs, only where there is slope. Pea gravel is per
pixel in the fragment shader, at 25 mm, faded out past 45 m where an inch is smaller than a pixel.

## Modes

The page opens looking around from the bluff. `M` or the button opens the chooser: walking,
bicycle, golf cart, boat, ultra light, bluff, look around. Each starts where it really would —
the community centre, the border, the golf club, the foot of the bluff, the apron at 1RL.
Controls vary by mode; the boat's tiller is backwards on purpose and nothing else is. `O` toggles
the overview map.

Looking around uses Google Maps' 3D bindings, because that is what people already have in their
hands. Drag to pull the ground about, ctrl-drag or right-drag to swing round and tilt, wheel to
zoom at whatever the pointer is over. One finger drags, two pinch and twist. That is three's
`MapControls` with `zoomToCursor`, not OrbitControls — the difference that matters is that a plain
drag pans instead of orbiting.

It opens where Maps opens: 1200 m out from the house, tilted 55° off straight down, looking at the
ground obliquely from above. At eye height staring across the strait there was nothing a drag could
take hold of — the content was 10 to 80 km off and the whole upper half of the screen was sky.

The plain left drag is not OrbitControls'. It could not be. OrbitControls pans by
`2 * targetDistance * tan(fov/2) / height` per pixel, so the only ground that keeps up with your
hand is the ground at exactly the orbit target's distance; everything nearer runs ahead and
everything further lags. Scaling `panSpeed` by the range to what you grabbed fixes a sideways drag
exactly and still leaves an up-and-down one wrong by up to 89 px in 200, because a tilted camera
foreshortens the ground along one axis and not the other and `panSpeed` is one number for both.

So `main.js` takes the plain drag and does it properly: find the point on the ground under the
cursor when the button goes down, then on every move slide camera and target together so that same
point is under the cursor again. Camera and target move by the same vector, so the orbit is
untouched and `controls.update()` is a no-op. The height never changes, which is what keeps it
feeling like a map rather than like flying. Measured at 0 px of slip over 35 drags, every direction,
every part of the screen, and 0 m of height drift.

Two things it has to get right. The listener sits on the **window in the capture phase**, not on the
canvas: OrbitControls is already listening on the canvas and registered first, and at the target
phase listeners run in the order they were added regardless of the capture flag, so a second canvas
listener cannot cut in front. And a drag that starts on the sky is left alone and falls through to
the controls, because there is nothing out there to hold on to.

Ctrl-drag, right-drag, the wheel and two fingers all still go to the controls untouched.

Turning your head — camera still, view swinging — is a different thing and is not built.

The sun slider is behind the hamburger too. It lies across the middle of the window, the window is
what the page is for, and the hour is a thing you set once and then want out of the way. The aim trim
just above it is not behind the hamburger and must not be: it is the one control live mode cannot do
without.

The readouts start off and the hamburger at the top left brings them back. At every width, not just
on a phone: open, the four corner panels cover 21% of a 1280 x 800 screen and 60% of a phone, and
this page is a window, so the window wins. The keys still work with the panels shut — `M`, `O`, `T`,
`V`. The reveal rule has to skip `.hidden`, because the helm readout is a `.hud` and is hidden
unless you are in the boat. The two failure banners are not `.hud`, so a dead feed or missing
ground still says so with the menu closed.

On a touch screen a thumb on the left half raises a stick where it lands: away is go, across is
turn, and being a stick it is analog. In the air its fore-and-aft is the climb instead, which is
the one place it means something different. Look is a drag anywhere else, or the mouse on a
desktop. Looking around from the bluff is OrbitControls' own and the stick stands down there.

The address bar is the view. It is rewritten as you move, so copying it out of the bar is the whole
of sharing and there is no button. What goes in is the eye and a point 300 m down the line of
sight, in lat/lon, plus whichever switches are on — so it is a viewpoint and not a vehicle, and it
reconstructs as a look-around view whether it was taken from the bluff, the boat or free flight. A
malformed hash is ignored rather than half applied and the page opens as usual.

Where you look is not where the boat points. The hull holds its heading and the head turns on top
of it, 150° across and 78° up and down.

## Who is connected

`/admin/visitors` lists the addresses that have opened the live socket and which still have it
open. It needs `OCEANVIEW_ADMIN_PASSWORD` in `.env` and asks for it as a browser password. No
visitor ever sees another visitor's address. Held in memory, capped at 500, forgotten on restart.

## Open issues

- #1 AIS feed silent, and what to replace it with
- #2 boat mode enhancements
- #4 what running an AIS aggregation service would take
- #5 the shipfinder scrape
- #7 move the tide in time, and say plainly it is a prediction
- #8 flash the navigation lights to their own characters
- #9 let real smoke take the islands away
- #10 orca sightings — drawn, but the rate is multiplied up and LOCAL_SHARE is a guess
- #11 the moon
- #12 name the ferry and where it is bound
- #13 work the currents out from the geography, with NOAA as the far field
- the sun slider run backwards should carry the vessels and the aircraft with it. Moving it into
  the past moves the light and nothing else: the ships and the planes stay where they are now,
  which is wrong for any hour but this one. Both feeds arrive as positions at a time, so what is
  missing is keeping them and reading them back at the hour the slider is standing at.
- the lidar as the ground near 389. The terrain here is 3 m CUDEM everywhere including under the
  house, and against 28,308 lidar ground returns it is good on the flats and out by 0.61 m on the
  bluff face, 4.52 m at worst, over a metre on 3 percent of the area. Two jobs, agreed and not
  started: overwrite the ~1,200 cells of `assets/terrain/heightmap.bin` the clip covers with
  lidar medians, which needs no app code and adds no detail; then a finer half-metre tile over
  the 106 by 87 m patch sampled ahead of the coarse one, which does. The lidar and the working
  live in `../PointRobertsEngineering`.

## Things that have bitten, so they do not again

- The far tile drew over the near one and smeared the bluff 4 m above the beach. The far grid has
  a hole punched under the near box.
- A byte texture is normalised to 0..1 in the shader. Writing 1 instead of 255 for the sea mask
  made every scrap of water vanish.
- A background task that dies takes its feed with it and asyncio says nothing. They report their
  own death now.
- A monotonic clock starts near zero, so comparing against a zeroed `last_run` reads as "just ran".
- Swapping x and z to turn a roof ridge is a mirror, and a mirror reverses winding. Every roof
  came out facing inward.
- Building the near tile calls its noise seven million times and colours three and a half million
  vertices. `Math.sin`, per-vertex object allocation and `offsetHSL` cost 4 seconds between them.
- Overpass refuses full bakes for hours at a time. Every mirror. Wait, or apply the change to the
  baked asset with the baker's own constants imported rather than copied.
- `fetch` resolves for a 404 and a 500 as happily as for a 200. Only a network failure rejects. A
  21-byte error page went into an `Int16Array` and built three and a half million vertices whose
  height was undefined: the tile drew as nothing, the ground sampler answered NaN, the audio was
  handed a non-finite number, and the page reported that it had loaded. Check `res.ok`, and check
  the byte count against what the metadata says the grid is.
- A comment that closes early is not a syntax error. A stray `-->` on line 10 of `index.html` ended
  a comment four lines short and the rest of it was printed over the water on every load for four
  commits. Nothing threw, nothing logged, the page reported that it had loaded. `server/test_index.py`
  reads the file the way a browser does and fails on loose text in the head, on comment punctuation
  standing as page text, and on any comment that does not open and close once.
- A hidden panel has to start hidden in the markup. Hiding it from `main.js` is too late — the
  module fetches three from a CDN first, and the browser has already painted the panel by then.
  That is what flashed the mode chooser on every load.

## Standing instructions from John

- Do not delete files. Give him the command instead.
- Do not start audio in the browser pane.
- Make the change asked for and nothing adjacent. No invented vocabulary, no filler copy.
- The boat is "it", never "her".
- Answer the question asked. Do not append a survey of options he did not ask for.
