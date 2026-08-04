# CONTINUE — Point Roberts ocean view (three.js)

You are a fresh Claude Code session in a new, nearly empty repo. Build a three.js web view that
stands on the West Bluff at Point Roberts and looks west out over the Salish Sea, drawing the live
shipping traffic and weather from the existing backend feed. No Unreal. No boat gameplay. This repo
is only the web view. The data model already exists in a sibling repo; this file carries everything
you need so you do not have to read it.

## What exists right now

- Repo path: `C:\Users\jdpoo\Documents\GitHub\PointRobertsOceanView`
- `git init` done, branch `main`, no commits yet.
- Only `src/` and `src/scene/` exist. Everything else is unwritten.
- The data feed lives in the sibling repo `C:\Users\jdpoo\Documents\GitHub\PTRobDigitalTwin`
  (a FastAPI backend). You do not edit that repo. You consume its WebSocket.

## The goal in one paragraph

A camera on the bluff (the fixed origin below), eye ~20 m above sea level, looking due west (heading
270°) over an ocean that reaches the horizon. Vessels from the feed appear on the water at their real
positions, oriented by heading, labelled, bobbing on the swell. Weather from the feed drives the sky,
the fog (from visibility), a wind vane, and the water ripple direction; tide sets the water height. A
HUD shows the current weather, the provider health, the connection state, and the required notice.
It must never invent data. If the feed is down, say so on screen.

## The data model (self-contained — you should not need the backend source)

Everything is JSON. Schema version `1.0`. Origin and view are fixed constants:

```
origin:   latitude 48.989009, longitude -123.085318   (389 W Bluff Rd, Point Roberts, WA)
view:     heading 270° true (due west), cardinal "west"
bbox:     min_lat 48.94, min_lon -123.25, max_lat 49.015, max_lon -123.00
stale_seconds: vessels 300, aircraft 120
notice:   "Visualization only; not for navigation or air-traffic use."
```

Local frame is East-North-Up metres relative to the origin: +X east, +Y north, +Z up.

### How to get the data — WebSocket only

Connect to `ws://localhost:8000/ws/live`. Use the WebSocket for everything. Do **not** use the REST
endpoints (`/api/v1/snapshot`, `/api/v1/config/public`): the backend has no CORS middleware, so a
page served from another origin/port is blocked on REST but **not** on the WebSocket. The WS carries
the full world on connect, so REST is unnecessary. Hardcode the origin/heading/bbox constants above
(they are fixed and documented); do not fetch them.

On connect the server sends one framed snapshot:
```json
{ "schema_version":"1.0", "message_type":"initial.snapshot", "server_time":"...", "data": { Snapshot } }
```
`Snapshot` = `{ schema_version, server_time, weather: Envelope, tide: Envelope,
vessels: [Envelope], aircraft: [Envelope], provider_health: {weather,tide,vessels,aircraft} }`.

Then every ~10 s the server sends a heartbeat followed by one bare envelope for weather, tide, each
vessel, and each aircraft:
```json
{ "schema_version":"1.0", "message_type":"heartbeat", "server_time":"..." }
{ "message_type":"vessel.position", "source":"...", "source_time":"...", "received_time":"...",
  "quality": { "stale": false, "age_seconds": 20.0, "warnings": [] }, "data": { VesselState } }
```

Distinguish messages by `message_type`:
- `initial.snapshot` — `data` is a whole `Snapshot`. Apply it, replacing world state.
- `heartbeat` — no `data`. Optional: use it to detect a live connection.
- `weather.state` — `data` is `WeatherState`, key `station_id`.
- `tide.state` — `data` is `TideState`, key `station_id`.
- `vessel.position` — `data` is `VesselState`, key `mmsi`. Update in place, do not respawn.
- `aircraft.state` — `data` is `AircraftState`, key `icao24`. (Optional for this view — the ask is
  shipping + weather. Aircraft data is present if you want it, but it is not required.)

### Payload fields (`?` = may be null; null means "not supplied", never zero — leave prior value)

- **VesselState**: `mmsi`, `name?`, `latitude`, `longitude`, `speed_over_ground_knots?`,
  `course_over_ground_degrees?`, `true_heading_degrees?`, `navigation_status?`, `vessel_type?`,
  `dimensions_m?` (object). Orient the hull by `true_heading_degrees` if present, else
  `course_over_ground_degrees`. Size by `dimensions_m` / `vessel_type` if present, else a default.
- **WeatherState**: `station_id`, `temperature_c?`, `wind_speed_mps?`, `wind_direction_degrees?`
  (direction the wind comes FROM, degrees true), `relative_humidity_percent?`, `visibility_m?`,
  `cloud_cover_percent?`, `precipitation_probability_percent?`, `description?`.
- **TideState**: `station_id`, `water_level_m?`, `prediction_m?`, `datum`, `trend?`.

### Client rules (from the contract)

1. On WS open, apply `initial.snapshot`. On reconnect, the next open re-sends it — just reapply.
2. Key vessels by `data.mmsi`. Update in place; smoothly lerp position between reports; do not respawn.
3. A track is stale when `quality.stale` is true, or its `age_seconds` exceeds the `stale_seconds`
   for its kind. Show it dimmed/flagged. Do not silently drop it.
4. Trust `provider_health`: `live` real, `mock` simulated, `fallback` a live source failed. Surface
   it in the HUD. Do not hide it.

### What the mock feed actually contains (so you are not surprised)

By default the backend runs mock providers (live weather/tides are off unless enabled in its `.env`).
The mock is **static**: one vessel `mmsi 123456789` at `48.984, -123.14`, SOG 12.4 kn, COG 274.2°;
weather `MOCK-WX` wind 7.1 m/s from 240°, visibility 16000 m, "Mostly cloudy"; tide 1.42 m MLLW,
rising; one aircraft. Positions do not change between reports. So do not dead-reckon vessels forward
(they would drift off with no correction and jump on each report). Place them at the reported
position, orient by heading, and bob them on the waves — honest and calm. Motion will appear only
with a live AIS feed.

## Running the backend feed (do this first, in the sibling repo)

```bash
cd C:\Users\jdpoo\Documents\GitHub\PTRobDigitalTwin
python -m uvicorn backend.app.main:app --reload
```
Virtualenv at `.venv`, Python 3.11. Serves on `http://localhost:8000`, WebSocket `/ws/live`.
Confirm with `curl http://localhost:8000/health`. Live weather/tides need `use_live_weather=true` /
`use_live_tides=true` and station config in that repo's `.env`; AIS/aircraft need API keys. Default
is mock.

## Build plan — zero-build three.js

Do **not** assume Node/npm is installed. Use plain ES modules with an importmap and a pinned three.js
from a CDN. Serve the folder with Python, which is already installed.

Pin three (pick the current stable, e.g. `0.160.0`) in `index.html`:
```html
<script type="importmap">
{ "imports": {
  "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
  "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
} }
</script>
```
Run with: `python -m http.server 8080` in the repo, then open `http://localhost:8080`. (Pin the exact
version — do not use a floating tag. If you later prefer offline/no-CDN, vendor `three.module.js` into
the repo instead.)

### Suggested file layout

```
index.html            importmap + canvas + HUD markup
styles.css            HUD styling
src/config.js         ORIGIN, VIEW_HEADING_DEG, BBOX, STALE_SECONDS, BACKEND_WS, EYE_HEIGHT_M, NOTICE
src/geo.js            lat/lon -> ENU metres -> three world coords
src/feed.js           WS client: connect, parse by message_type, keep vessel/weather/tide state,
                      reconnect with backoff, expose connection + provider_health status
src/main.js           scene bootstrap, camera on bluff, OrbitControls, render loop
src/scene/ocean.js    large water plane, cheap vertex-wave shader, ripple dir from wind
src/scene/sky.js      gradient sky + sun; grey/dim by cloud cover
src/scene/vessels.js  spawn/update/lerp vessel meshes, heading orient, label sprite, stale dimming
src/scene/weather.js  fog from visibility, wind vane, apply cloud/tide, HUD text
src/hud.js            DOM HUD: weather readout, provider health, connection state, notice
```

### Coordinate projection (put in `src/geo.js`)

```
M_PER_DEG_LAT = 111320
cosLat = cos(ORIGIN.lat * PI/180)              // ~0.6565 at 48.989°
east_m  = (lon - ORIGIN.lon) * M_PER_DEG_LAT * cosLat
north_m = (lat - ORIGIN.lat) * M_PER_DEG_LAT
// three.js world (Y up): x = east_m, y = 0 (sea), z = -north_m
```
Camera at `(0, EYE_HEIGHT_M≈20, 0)` looking toward `-X` (west). The mock vessel lands ~4 km west and
~0.5 km south — a small but visible ship out in the strait. Give each vessel a thin vertical marker
line and a billboarded label so distant traffic is findable. Far plane large (≥ 50 km); fog hides the
far edge of the ocean plane.

### Weather → scene mapping

- `visibility_m` → fog far distance (clamp; 16000 m ≈ clear-ish, low values close the fog in).
- `cloud_cover_percent` → sky greyness + ambient/sun dimming.
- `wind_speed_mps` + `wind_direction_degrees` → water ripple direction/strength and the HUD wind vane
  (remember the direction is where wind comes FROM).
- `precipitation_probability_percent` → optional light rain when high.
- `temperature_c`, `relative_humidity_percent`, `description` → HUD text only.
- `tide.water_level_m` → water plane Y offset (small; metres).

### Hardware note

This runs on an Intel Iris Xe laptop. Keep it cheap: vertex-shader sine/gerstner waves, no planar
reflections, no heavy post-processing, modest geometry, capped pixel ratio. Prioritise a steady frame
over fancy water.

## Rules

- Fail loud. No fake data. If the WS is not connected, the HUD shows "feed offline / connecting", and
  the scene renders empty water — it never shows invented vessels or weather.
- Show `provider_health` and staleness honestly (dim stale tracks, label mock vs live).
- Keep the notice on screen: "Visualization only; not for navigation or air-traffic use."
- Pin the three.js version. If you add any npm tooling later, pin those too.
- The origin/heading/bbox are fixed constants — hardcode them, do not fetch (REST is CORS-blocked).

## First steps for the new session

1. Start the backend (command above) and `curl http://localhost:8000/health`.
2. Write `index.html` (importmap + canvas + HUD), `src/config.js`, `src/geo.js`.
3. Write `src/feed.js` and log parsed messages to the console — confirm you see `initial.snapshot`
   then heartbeats + a `vessel.position` for `mmsi 123456789`.
4. Build the scene: camera on the bluff, ocean plane, sky, one vessel from the feed.
5. Layer in weather (fog, wind vane, sky tint), tide height, the HUD, and stale/health handling.
6. `python -m http.server 8080`, open it, verify against the running feed. Commit.
