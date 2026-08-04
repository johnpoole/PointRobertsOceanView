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
| Tide      | NOAA CO-OPS station 9449424 (Cherry Point)          | MLLW, metres; sets the water height and shoreline |
| Weather   | Open-Meteo forecast + marine at the exact coordinates | sky tint, fog, wind vane, and sea state from real wave height |
| Terrain   | GMRT topobathy, baked to `assets/terrain/`          | real bluff, beach, and sea floor; MLLW datum |

The browser talks only to a local proxy (`server/proxy.py`), which holds the
AISStream key and merges the three feeds into one WebSocket. There is no CORS and
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

## Tide and the shoreline

The tide feed reports water level in metres above MLLW. The terrain heightmap is
baked in the same MLLW datum, so the water plane height equals the tide reading and
the waterline sits where it really sits. Raising the tide floods the beach; lowering
it exposes more foreshore.

GMRT's native resolution here is ~61 m, so the beach is a smooth ramp rather than a
crisp profile — the shoreline moves with the tide, but gently.

## Rebaking the terrain

The heightmap under `assets/terrain/` is committed, so the app needs no geo
libraries at runtime. To rebuild it (e.g. to change the box or resolution):

```bash
.venv/Scripts/python -m pip install -r scripts/requirements-terrain.txt
.venv/Scripts/python scripts/build_terrain.py
```

The vertical shift from GMRT sea level to MLLW uses NOAA station 9449424's datums
(MSL 1.61 m above MLLW), applied uniformly. Good to a few decimetres.

## Hardware

Tuned for an Intel Iris Xe laptop: vertex-shader swell, no reflections, no heavy
post-processing, capped pixel ratio.
