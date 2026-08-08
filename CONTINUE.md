# CONTINUE — Point Roberts ocean view

A three.js page that stands on the West Bluff at Point Roberts and looks west over the Salish
Sea, with a FastAPI proxy behind it bridging live feeds. It is built and deployed. This file is
for picking it up cold.

Deployed at https://oceanview.johnpoole.ca, on the Basement server (Tailscale `yarbo-server`),
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

## Deploy

```
git push origin main
ssh yarbo-server 'cd ~/pointroberts-oceanview && git pull --ff-only && docker compose build && docker compose up -d'
```

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
src/main.js                wires the scene, the camera, the modes
src/nav.js                 the modes themselves, and the boat's hydrodynamics
src/touch.js               the on-screen stick, and the drag that looks about
src/share.js               puts the view in the address bar, and reads it back
src/scene/                 terrain, trees, ocean, land, beach, boat, vehicles, vessels, aircraft, sky
src/scene/brademy.js       the tennis courts, off unless asked for, and the hedge, which is not
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
wherever you are standing, as close in as the depth allows and coming from whichever side lets them
come closer, and they surface within a few seconds instead of waiting out a dive. It swings the view
onto them, and pressing it again replaces the group rather than adding to it.

Off the park that lands them about 750 m out and off the bluff about 1.2 km. Off the border it is
2.8 km and cannot be less, because the shelf up there runs out too far to put a whale any closer.

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
ground obliquely from above. That is not decoration. The drag is a pan, which slides the camera over
the ground, so the thing under your hand keeps up only when the ground is what you are looking at.
At eye height staring across the strait it did not: the content was 10 to 80 km off, the whole upper
half of the screen was sky with nothing to take hold of, and a 400 px drag moved the skyline seven
pixels. From above, the same drag moves the ground between 279 and 485 px anywhere on the screen.

Turning your head — camera still, view swinging — is a different thing and is not built.

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
