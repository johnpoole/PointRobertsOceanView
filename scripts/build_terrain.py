"""Bake the Point Roberts terrain heightmaps.

Two tiles, two sources, because no single grid is both fine enough for the
shoreline and wide enough for the skyline:

  near - NOAA NCEI CUDEM, 1/9 arc-second (~3 m) seamless topobathymetry, tile
         ncei19_n49x00_w123x25_2024v1. Covers the bluff, the beach and the sea
         floor out to 5 km. This is what the tide line runs over, so it has to
         resolve a bluff face that drops 16 m in 35 m of ground and a tidal
         flat that is 106 m wide at 1:48.
  far  - GMRT, decimated coarse. The Gulf Islands and the Vancouver Island
         mountains, 10 to 90 km out. Skyline only, never touches the water.

CUDEM is US-only and stops at the 49th parallel, so the near tile stops there
too. The seam falls in open water on both the strait side and the Boundary Bay
side, under the ocean plane, and inland it runs along the border well behind
the view west.

Vertical datums. The app and the tide feed work in MLLW.

  CUDEM is NAVD88. NOAA VDatum at 48.989009 -123.085318 (WESTCOAST region,
  NAD83_2011/GEOID18 -> IGS14/MLLW) puts NAVD88 0.0 m at MLLW +0.411 m, with a
  stated uncertainty of 0.094 m. Cross-check: the same query gives LMSL -1.320,
  so MSL sits 1.731 m above MLLW, and NOAA station 9449639 (Point Roberts)
  publishes MSL 6.742 and MLLW 5.024, a difference of 1.718 m. The two agree to
  13 mm.

  GMRT is referenced to sea level, near enough to local mean sea level, so the
  far tile shifts by that 1.731 m instead. The far tile is a distant skyline and
  a decimetre of datum error there is invisible, but the number is free.

After either shift a value of 0 means the MLLW line.

Output (committed as static assets, so the app needs no geo libraries at runtime):
  assets/terrain/heightmap.bin / meta.json          (near, CUDEM)
  assets/terrain/heightmap_far.bin / meta_far.json  (far, GMRT)

Run once:
  .venv/Scripts/python scripts/build_terrain.py
"""

from __future__ import annotations

import json
import struct
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

ORIGIN = {"lat": 48.989009, "lon": -123.085318}

# See the module docstring for how both of these were derived.
NAVD88_TO_MLLW_M = 0.411   # CUDEM (near)
MSL_TO_MLLW_M = 1.731      # GMRT (far)

# CUDEM is published on a 1/9 arc-second grid. Sampling on that exact spacing
# means the server hands back source pixels instead of resampling them.
CUDEM_CELL_DEG = 1.0 / 32400.0

# near: the whole of Point Roberts plus the sea floor west of the bluff. The
# town runs east to -123.0217 — the marina and Maple Beach — so the box has to
# reach past that or the east side falls back on the 183 m skyline grid. The
# north edge is where CUDEM coverage ends. Every edge is an exact multiple of
# CUDEM_CELL_DEG, so the request lands on cell boundaries.
BOX_NEAR = {"min_lon": -123.13, "max_lon": -123.02, "min_lat": 48.97, "max_lat": 49.00}
# far: the strait, the Gulf Islands, and the Vancouver Island mountains behind
# them — the full skyline west, out to ~90 km.
BOX_FAR = {"min_lon": -124.35, "max_lon": -122.92, "min_lat": 48.52, "max_lat": 49.25}
MAX_CELLS_FAR = 500000  # decimate below this so the skyline mesh stays light

GMRT_URL = (
    "https://www.gmrt.org/services/GridServer"
    "?minlongitude={min_lon}&maxlongitude={max_lon}"
    "&minlatitude={min_lat}&maxlatitude={max_lat}"
    "&format=esriascii&resolution=max"
)

NCEI_IMAGESERVER = (
    "https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer"
)
CUDEM_TILE = "ncei19_n49x00_w123x25_2024v1"
NCEI_NODATA = -999999.0

# Elevations are stored as int16 counts of this, not float32. A float32
# heightmap is 13 MB and gzips to only 71 % of that, because the low mantissa
# bits of a metre reading are noise and noise does not compress. Rounding throws
# that noise away and the same file gzips to a tenth.
#
# Five centimetres, not the ten it was. The tide flat west of the house falls
# about a metre in forty, so a step in the stored height is four times that
# along the ground: at ten centimetres the waterline could only ever land on a
# four-metre grid. At five it is two.
#
# It bought less than it looked as though it would. The stretches that read as
# terraces at ten centimetres — sixty through ninety metres out at 0.30, and a
# hundred and forty-five through two hundred at −1.00 — came back at five
# centimetres still flat. That is CUDEM, not the number format. What the step
# was hiding was decimetre relief on the slope between them, and the waterline
# moved one metre.
#
# It costs 0.8 MB gzipped on the near tile, 1.5 to 2.3. Twice as many distinct
# values is more entropy and gzip cannot do anything about that.
#
# Still finer than the data it carries: the NAVD88 to MLLW shift alone has 9.4 cm
# of stated uncertainty. Both tiles have room — the near one spans −122 to 74 m
# and the far one −407 to 1463, and int16 at 5 cm reaches ±1638.
ELEV_SCALE_M = 0.05
I16_MIN, I16_MAX = -32768, 32767

# Marks far-tile cells that the near tile covers. Any triangle touching one is
# dropped at load, leaving a hole for the near tile to show through. Stored as
# the int16 floor so it can never collide with a real elevation.
NODATA_I16 = I16_MIN
NODATA = NODATA_I16 * ELEV_SCALE_M  # -3276.8 m, what the client sees after scaling


def quantise(grid: np.ndarray, what: str) -> np.ndarray:
    """Metres to int16 decimetres, refusing to wrap silently."""
    counts = np.round(grid / ELEV_SCALE_M)
    lo, hi = float(counts.min()), float(counts.max())
    if lo <= NODATA_I16 or hi > I16_MAX:
        raise ValueError(
            f"{what}: elevations {grid.min():.1f}..{grid.max():.1f} m are "
            f"{lo:.0f}..{hi:.0f} in decimetres, outside the int16 range "
            f"({NODATA_I16 + 1}..{I16_MAX}) usable at {ELEV_SCALE_M} m. "
            f"Raise ELEV_SCALE_M or store this tile as float32."
        )
    return counts.astype(np.int16)


# ---- CUDEM (near tile) ------------------------------------------------------

def read_uncompressed_tiff_f32(raw: bytes) -> np.ndarray:
    """Minimal reader for the tiled, uncompressed, single-band float32 TIFF the
    NCEI ImageServer returns. Not a general TIFF decoder — it checks the few
    assumptions it makes and raises if any of them fail."""
    if raw[:2] not in (b"II", b"MM"):
        raise ValueError(
            f"NCEI ImageServer did not return a TIFF: first bytes {raw[:16]!r}. "
            f"Check the exportImage request (a service error comes back as JSON)."
        )
    bo = "<" if raw[:2] == b"II" else ">"
    unpack = lambda fmt, off: struct.unpack(bo + fmt, raw[off:off + struct.calcsize(bo + fmt)])

    ifd = unpack("I", 4)[0]
    tags: dict[int, tuple] = {}
    for i in range(unpack("H", ifd)[0]):
        entry = ifd + 2 + i * 12
        tag, typ, count = unpack("HHI", entry)
        fmt = {1: "B", 3: "H", 4: "I", 11: "f", 12: "d"}.get(typ)
        if fmt is None:
            continue
        size = struct.calcsize(bo + fmt) * count
        offset = entry + 8 if size <= 4 else unpack("I", entry + 8)[0]
        tags[tag] = unpack(f"{count}{fmt}", offset)

    def tag(num: int, name: str) -> tuple:
        if num not in tags:
            raise ValueError(f"TIFF from NCEI ImageServer has no {name} tag ({num})")
        return tags[num]

    width, height = tag(256, "ImageWidth")[0], tag(257, "ImageLength")[0]
    compression = tags.get(259, (1,))[0]
    if compression != 1:
        raise ValueError(
            f"TIFF from NCEI ImageServer is compressed (compression={compression}); "
            f"this reader only handles uncompressed data"
        )
    if tag(258, "BitsPerSample")[0] != 32 or tags.get(339, (1,))[0] != 3:
        raise ValueError(
            f"TIFF from NCEI ImageServer is not float32 "
            f"(BitsPerSample={tags.get(258)}, SampleFormat={tags.get(339)}); "
            f"the exportImage request must set pixelType=F32"
        )
    if tag(277, "SamplesPerPixel")[0] != 1:
        raise ValueError(f"expected 1 band, got {tags[277][0]}")
    if 324 not in tags:
        raise ValueError(
            "TIFF from NCEI ImageServer is strip-organised, not tiled; "
            "this reader only handles tiled data"
        )

    tile_w, tile_h = tag(322, "TileWidth")[0], tag(323, "TileLength")[0]
    offsets, counts = tags[324], tag(325, "TileByteCounts")
    across = (width + tile_w - 1) // tile_w
    out = np.empty((height, width), np.float32)
    for i, (offset, nbytes) in enumerate(zip(offsets, counts)):
        if nbytes < tile_w * tile_h * 4:
            raise ValueError(f"TIFF tile {i} is short: {nbytes} bytes")
        tile = np.frombuffer(raw, np.float32, tile_w * tile_h, offset).reshape(tile_h, tile_w)
        r0, c0 = (i // across) * tile_h, (i % across) * tile_w
        r1, c1 = min(r0 + tile_h, height), min(c0 + tile_w, width)
        out[r0:r1, c0:c1] = tile[:r1 - r0, :c1 - c0]
    return out


def fetch_cudem(box: dict, ncols: int, nrows: int) -> np.ndarray:
    """Pull the CUDEM tile as a float32 raster, north row first."""
    oid_query = NCEI_IMAGESERVER + "/query?" + urllib.parse.urlencode({
        "where": f"Name='{CUDEM_TILE}'", "outFields": "OBJECTID",
        "returnGeometry": "false", "f": "json",
    })
    with urllib.request.urlopen(oid_query, timeout=120) as response:
        features = json.load(response).get("features", [])
    if not features:
        raise RuntimeError(
            f"CUDEM tile {CUDEM_TILE} not found in the NCEI DEM_all mosaic. "
            f"NCEI may have republished it under a new name; list the mosaic at "
            f"{NCEI_IMAGESERVER}/query?where=1=1&outFields=Name&f=json"
        )
    oid = features[0]["attributes"]["OBJECTID"]

    url = NCEI_IMAGESERVER + "/exportImage?" + urllib.parse.urlencode({
        "bbox": f"{box['min_lon']},{box['min_lat']},{box['max_lon']},{box['max_lat']}",
        "bboxSR": "4326", "imageSR": "4326",
        "size": f"{ncols},{nrows}",
        "format": "tiff", "pixelType": "F32", "noData": str(NCEI_NODATA),
        "interpolation": "RSP_NearestNeighbor",
        "mosaicRule": json.dumps({
            "mosaicMethod": "esriMosaicLockRaster", "lockRasterIds": [oid],
        }),
        "f": "image",
    })
    print(f"GET {url}")
    with urllib.request.urlopen(url, timeout=900) as response:
        raw = response.read()
    print(f"  {len(raw)} bytes")

    grid = read_uncompressed_tiff_f32(raw)
    if grid.shape != (nrows, ncols):
        raise ValueError(
            f"CUDEM raster is {grid.shape}, asked for ({nrows}, {ncols})"
        )
    missing = int((grid <= NCEI_NODATA / 2).sum()) + int(np.isnan(grid).sum())
    if missing:
        raise RuntimeError(
            f"CUDEM tile {CUDEM_TILE} has {missing} nodata cells inside "
            f"{box}. The box must lie wholly inside the tile — CUDEM coverage "
            f"ends at the 49th parallel and at longitude -123.25."
        )
    return grid


def bake_near(out_dir: Path) -> None:
    box = BOX_NEAR
    ncols = round((box["max_lon"] - box["min_lon"]) / CUDEM_CELL_DEG)
    nrows = round((box["max_lat"] - box["min_lat"]) / CUDEM_CELL_DEG)
    grid = fetch_cudem(box, ncols, nrows) + NAVD88_TO_MLLW_M
    quantised = quantise(grid, "near tile")

    # exportImage bbox is the outer extent, so cell centres sit half a cell in.
    north_lat = box["max_lat"] - 0.5 * CUDEM_CELL_DEG
    west_lon = box["min_lon"] + 0.5 * CUDEM_CELL_DEG

    (out_dir / "heightmap.bin").write_bytes(quantised.tobytes())
    meta = {
        "source": f"NOAA NCEI CUDEM 1/9 arc-second, {CUDEM_TILE}, via DEM_all ImageServer",
        "vertical_datum": "MLLW",
        "source_datum": "NAVD88",
        "datum_shift_m": NAVD88_TO_MLLW_M,
        "datum_shift_uncertainty_m": 0.094,
        "origin": ORIGIN,
        "box": box,
        "grid": {
            "nrows": nrows, "ncols": ncols, "cellsize_deg": CUDEM_CELL_DEG,
            "north_lat": north_lat, "west_lon": west_lon,
            "dtype": "int16", "scale_m": ELEV_SCALE_M,
            "order": "row-major, north row first",
        },
        "elevation_m_mllw": {
            "min": float(quantised.min()) * ELEV_SCALE_M,
            "max": float(quantised.max()) * ELEV_SCALE_M,
        },
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    lat_m = CUDEM_CELL_DEG * 111320
    lon_m = lat_m * np.cos(np.radians(ORIGIN["lat"]))
    err = np.abs(quantised * ELEV_SCALE_M - grid).max()
    print(f"wrote near: {nrows}x{ncols}, {quantised.nbytes} bytes, "
          f"cell {lon_m:.1f} x {lat_m:.1f} m, "
          f"elev {grid.min():.0f}..{grid.max():.0f} m MLLW, "
          f"quantisation error <= {err:.3f} m")


# ---- GMRT (far tile) --------------------------------------------------------

def fetch_grid(box: dict) -> str:
    url = GMRT_URL.format(**box)
    print(f"GET {url}")
    with urllib.request.urlopen(url, timeout=180) as response:
        return response.read().decode("utf-8")


def parse_esriascii(text: str) -> tuple[dict, np.ndarray]:
    lines = text.splitlines()
    header = {}
    for i in range(6):
        key, value = lines[i].split()
        header[key.lower()] = float(value)
    ncols = int(header["ncols"])
    nrows = int(header["nrows"])
    values = np.fromstring(" ".join(lines[6:]), sep=" ", dtype=np.float64)
    if values.size != ncols * nrows:
        raise ValueError(
            f"GMRT grid size mismatch: header says {ncols}x{nrows}={ncols*nrows}, "
            f"parsed {values.size} values"
        )
    grid = values.reshape(nrows, ncols)  # row 0 = north
    nodata = header.get("nodata_value", -2147483648.0)
    grid[grid == nodata] = np.nan
    return header, grid


def fill_nan(grid: np.ndarray) -> np.ndarray:
    if not np.isnan(grid).any():
        return grid
    print(f"filling {int(np.isnan(grid).sum())} nodata cells")
    out = grid.copy()
    while np.isnan(out).any():
        nan_mask = np.isnan(out)
        acc = np.zeros_like(out)
        weight = np.zeros_like(out)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            shifted = np.roll(np.where(nan_mask, np.nan, out), shift=(dy, dx), axis=(0, 1))
            valid = ~np.isnan(shifted)
            acc[valid] += shifted[valid]
            weight[valid] += 1
        fillable = nan_mask & (weight > 0)
        out[fillable] = acc[fillable] / weight[fillable]
        if not fillable.any():
            out[np.isnan(out)] = np.nanmin(out)
            break
    return out


def box_smooth(grid: np.ndarray, passes: int) -> np.ndarray:
    out = grid
    for _ in range(passes):
        acc = out.copy()
        weight = np.ones_like(out)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                acc += np.roll(out, shift=(dy, dx), axis=(0, 1))
                weight += 1
        out = acc / weight
    return out


def bake_far(out_dir: Path) -> None:
    header, grid = parse_esriascii(fetch_grid(BOX_FAR))
    grid = fill_nan(grid)
    cellsize = header["cellsize"]
    xll, yll = header["xllcorner"], header["yllcorner"]
    nrows, ncols = grid.shape

    stride = 1
    if nrows * ncols > MAX_CELLS_FAR:
        stride = int(np.ceil((nrows * ncols / MAX_CELLS_FAR) ** 0.5))
        grid = grid[::stride, ::stride]
        cellsize *= stride
        nrows, ncols = grid.shape
        print(f"decimated by {stride} -> {nrows}x{ncols}")

    grid = box_smooth(grid, 1)
    grid_mllw = quantise(grid + MSL_TO_MLLW_M, "far tile")

    # ESRI row 0 is the north row; xll/yll are the lower-left corner of the
    # original grid, so cell-centre extents use the original cellsize.
    north_lat = yll + (header["nrows"] - 0.5) * header["cellsize"]
    west_lon = xll + 0.5 * header["cellsize"]

    # Punch out the near tile's footprint. Both tiles are drawn, so wherever they
    # overlap the higher surface wins, and at 183 m the far grid smears the bluff
    # out over the beach — up to 4 m above the real foreshore. That buries the
    # near tile and drags the waterline about 100 m seaward. Shrink the hole by
    # one cell so the far tile still reaches under the near tile's edge rather
    # than leaving a gap; the rim that overlaps sits in deep water on the west
    # and south and inland on the east, so it is never the shoreline you see.
    lats = north_lat - np.arange(nrows) * cellsize
    lons = west_lon + np.arange(ncols) * cellsize
    hole = (
        ((lats >= BOX_NEAR["min_lat"] + cellsize) & (lats <= BOX_NEAR["max_lat"] - cellsize))[:, None]
        & ((lons >= BOX_NEAR["min_lon"] + cellsize) & (lons <= BOX_NEAR["max_lon"] - cellsize))[None, :]
    )
    grid_mllw[hole] = NODATA_I16
    print(f"punched {int(hole.sum())} far cells under the near tile")

    (out_dir / "heightmap_far.bin").write_bytes(grid_mllw.tobytes())
    meta = {
        "source": "GMRT GridServer, format=esriascii, resolution=max",
        "vertical_datum": "MLLW",
        "source_datum": "sea level (~MSL)",
        "datum_shift_m": MSL_TO_MLLW_M,
        "origin": ORIGIN,
        "box": BOX_FAR,
        "grid": {
            "nrows": nrows, "ncols": ncols, "cellsize_deg": cellsize,
            "north_lat": north_lat, "west_lon": west_lon,
            "dtype": "int16", "scale_m": ELEV_SCALE_M,
            "order": "row-major, north row first",
        },
        "nodata": NODATA,
        "hole": BOX_NEAR,
        "elevation_m_mllw": {
            "min": float(grid_mllw[~hole].min()) * ELEV_SCALE_M,
            "max": float(grid_mllw[~hole].max()) * ELEV_SCALE_M,
        },
        "decimate_stride": stride,
    }
    (out_dir / "meta_far.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"wrote far: {nrows}x{ncols}, {grid_mllw.nbytes} bytes, "
          f"cell ~{cellsize * 111320:.0f} m, "
          f"elev {grid_mllw[~hole].min() * ELEV_SCALE_M:.0f}"
          f"..{grid_mllw[~hole].max() * ELEV_SCALE_M:.0f} m MLLW")


def main() -> None:
    out_dir = Path(__file__).resolve().parents[1] / "assets" / "terrain"
    out_dir.mkdir(parents=True, exist_ok=True)
    bake_near(out_dir)
    bake_far(out_dir)


if __name__ == "__main__":
    main()
