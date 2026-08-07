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
src/scene/                 terrain, trees, ocean, land, beach, boat, vehicles, vessels, aircraft, sky
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

## The datum, which everything depends on

Heights and the tide are both metres above MLLW, so the water plane height equals the tide
reading and the waterline sits where it really sits. The near tile is NOAA CUDEM at about 3 m,
shifted NAVD88 to MLLW by +0.411 m. Verified against USGS 3DEP to 0.15 m and against the OSM
coastline to 0.01 m. If you rebake, check it again.

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

On a touch screen a thumb on the left half raises a stick where it lands: away is go, across is
turn, and being a stick it is analog. In the air its fore-and-aft is the climb instead, which is
the one place it means something different. Look is a drag anywhere else, or the mouse on a
desktop. Looking around from the bluff is OrbitControls' own and the stick stands down there.

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
- #10 orca sightings
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

## Standing instructions from John

- Do not delete files. Give him the command instead.
- Do not start audio in the browser pane.
- Make the change asked for and nothing adjacent. No invented vocabulary, no filler copy.
- The boat is "it", never "her".
- Answer the question asked. Do not append a survey of options he did not ask for.
