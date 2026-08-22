# Point Roberts — West Bluff ocean view

A three.js view from the West Bluff at Point Roberts, WA, looking due west over the
Salish Sea. Live vessels, weather, and tide are drawn on the water from public feeds.
Nothing is invented: when a feed is down the HUD says so and the water renders empty.

The camera stands at 389 W Bluff Rd (48.989009, -123.085318), eye ~20 m above sea
level, heading 270°.

## What drives the scene

| Layer     | Source                                              | Notes |
|-----------|-----------------------------------------------------|-------|
| Vessels   | [AISStream.io](https://aisstream.io) WebSocket      | free API key; bbox-filtered to Point Roberts |
| Tide      | NOAA CO-OPS 9449639 (Point Roberts) + 9449424 (Cherry Point) gauge | MLLW, metres; sets the water height and shoreline |
| Weather   | Open-Meteo forecast + marine at the exact coordinates | cloud by layer, fog, wind vane, and sea state from real wave height |
| Air       | Open-Meteo air quality at the same coordinates      | aerosol optical depth, which sets the sky's turbidity and how red a sunset gets |
| Terrain   | NOAA NCEI CUDEM 1/9 arc-second, baked to `assets/terrain/` | bluff, beach, and sea floor at ~3 m; MLLW datum |
| Skyline   | GMRT topobathy, baked to `assets/terrain/`          | Gulf Islands and Vancouver Island, 10–90 km out |

The browser talks only to a local proxy (`server/proxy.py`), which holds the
AISStream key and merges the feeds into one WebSocket. There is no CORS and
the key never reaches the browser.

## Run it

Python 3.10+ is required. Node/npm is not.

1. Install the proxy dependencies (once):

   ```bash
   python -m venv .venv
   .venv/Scripts/python -m pip install -r requirements.txt
   ```

2. Add your AISStream key (free from https://aisstream.io):

   ```bash
   cp .env.example .env
   # edit .env, set AISSTREAM_API_KEY=...
   ```

   Without a key, weather and tide still run; vessels report `offline` in the HUD.

3. Start the proxy (it also serves the page):

   ```bash
   .venv/Scripts/python -m uvicorn server.proxy:app --port 8080
   ```

4. Open http://localhost:8080.

## Live

Pick `live` in the mode chooser on a phone and the view goes where the phone goes.
Position comes from the browser's geolocation, direction from the phone's compass,
and the lens is the phone's own — 69.4° across the long side of the frame, a 26 mm
equivalent — so the screen frames what the camera on the back of it would frame.
Walk and the view walks with you.

It needs https. A browser hands out neither location nor compass to a page served
over plain http; localhost counts as secure, so development works. Both sensors are
asked for on entry, and if either is refused or stays silent the mode does not
start — it says which one failed and leaves you where you were.

The height is not the phone's. GPS altitude is good to ten or thirty metres, which
against a twenty-metre bluff would stand you under the water or in the air, so only
the latitude and longitude are taken and the eye is set 1.6 m above the baked
terrain under them.

Which north the compass means depends on which reading arrives. iOS puts a heading
on the event that CoreLocation has already turned onto true north. Android gives an
absolute orientation referenced to magnetic north, so the declination — 15.3° east
at the house, NOAA WMM-2025 — is taken off that one.

What is left after that is the phone's own compass error: iron nearby, a magnetic
case, a magnetometer wanting a figure eight. Ten degrees of it is ordinary and no
constant can be written down for it, so the bearing has a slider. Slide `aim` until
the shoreline on the glass sits on the shoreline out the window. It is not saved —
reload and it is 0 again.

## Who is connected

`/admin/visitors` lists every address that has connected and marks the ones
connected now. It is for the operator, not for visitors: no one using the site
ever sees another visitor's address.

Set a password to open it, in the same `.env`:

```bash
OCEANVIEW_ADMIN_PASSWORD=...
```

The browser asks for it. Any user name will do. Without the variable the page
returns 503 and says so — it does not open unguarded.

The list lives in memory, so restarting the proxy forgets everyone, and it holds
the 500 most recent addresses.

Check it with:

```bash
python server/test_visitors.py
```

## Tide and the shoreline

The tide feed reports water level in metres above MLLW. The terrain heightmap is
baked in the same MLLW datum, so the water plane height equals the tide reading and
the waterline sits where it really sits. Raising the tide floods the beach; lowering
it exposes more foreshore.

Point Roberts (9449639) is a reference station with its own harmonics but no gauge.
The nearest live gauge is Cherry Point (9449424), 27 km southeast, where the tide
runs about 0.1 m lower and arrives at a different time. So the proxy measures the
non-tidal residual at Cherry Point — weather-driven surge, coherent over that
distance — and carries it onto Point Roberts' own prediction:

```
level = predicted_PR(t) + (observed_CP(t) - predicted_CP(t))
```

Live surge, astronomical tide in the right place.

Swell is capped by the water it stands in. A rigid wave sheet over the tidal flat
west of the bluff — 106 m wide at 1:48 — walks the waterline across 20 m of beach
for a half-metre swell and 100 m in a storm. Real waves break instead, at a height
of roughly 0.78 of the depth, so the shader reads the baked bed under each vertex
and clamps amplitude to that. The waves shrink to nothing as they shoal and the
waterline holds at the still-water line.

## The lot

`assets/site/389-w-bluff.json` holds the parcel boundary at the origin — four
corners in WGS84, from Whatcom County's own parcel mapping. It is cartography,
not a survey, and runs a foot or two off the deed's calls.

It is baked from the property records, which live in a separate private
repository along with the deed, the lidar of the lot, the geotechnical work and
the permits. That repository is the source; this one holds only the baked asset
and reads no source data. Rebake it from there with:

```bash
.venv/Scripts/python site/bake-oceanview.py
```

Nothing in the scene draws it yet.

## Rebaking the terrain

The heightmaps under `assets/terrain/` are committed, so the app needs no geo
libraries at runtime. To rebuild them (e.g. to change the box or resolution):

```bash
.venv/Scripts/python -m pip install -r scripts/requirements-terrain.txt
.venv/Scripts/python scripts/build_terrain.py
```

Two tiles, two sources. The near tile is NOAA NCEI CUDEM 1/9 arc-second
topobathymetry (~3 m), which resolves a bluff face that drops 16 m in 35 m of
ground. CUDEM is US-only and ends at the 49th parallel, so the near tile ends
there too — the seam falls in open water on both sides, under the ocean plane.
The far tile is GMRT, decimated to ~180 m, for the skyline only.

Vertical datums come from NOAA VDatum at the origin: CUDEM is NAVD88, and NAVD88
0.0 m sits at MLLW +0.411 m (uncertainty 0.094 m). GMRT is referenced to sea
level, so the far tile shifts by 1.731 m instead. Cross-check: station 9449639
publishes MSL 1.718 m above MLLW, agreeing with VDatum to 13 mm.

## Hardware

Tuned for an Intel Iris Xe laptop: vertex-shader swell, no reflections, no heavy
post-processing, capped pixel ratio.
