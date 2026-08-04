"""Bake the Point Roberts terrain heightmap.

Source: GMRT (Global Multi-Resolution Topography) GridServer, which serves one
seamless topobathymetric grid — land elevation and sea-floor depth merged from
multibeam, lidar, and SRTM — over a bounding box, as an ESRI-ASCII grid. That
single source removes the land/sea datum seam a two-source (topo + bathy) bake
would create.

Vertical datum: GMRT is referenced to sea level (~local mean sea level). The app
and the tide feed work in MLLW, so we shift every elevation up by the station's
MSL-above-MLLW offset (Cherry Point 9449424: MSL 11.62 ft, MLLW 6.34 ft ->
1.61 m). After the shift a value of 0 means the MLLW line, matching the tide
feed's water_level_m. The offset is uniform and taken at Cherry Point ~14 km
south, so it is good to a few decimetres, not centimetres.

Output (committed as static assets, so the app needs no geo libraries at runtime):
  assets/terrain/heightmap.bin   float32, row-major, north row first, MLLW metres
  assets/terrain/meta.json       grid geography + elevation range + provenance

Run once:
  .venv/Scripts/python scripts/build_terrain.py
"""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path

import numpy as np

# Terrain box around the bluff. Wider to the west, the view direction.
BOX = {"min_lon": -123.13, "max_lon": -123.05, "min_lat": 48.97, "max_lat": 49.01}
ORIGIN = {"lat": 48.989009, "lon": -123.085318}

# GMRT sea-level -> MLLW, from NOAA CO-OPS station 9449424 datums (feet):
# MSL 11.62, MLLW 6.34 -> (11.62 - 6.34) ft = 1.609 m.
MLLW_OFFSET_M = 1.609

UPSAMPLE = 3        # bilinear densify so the mesh is not blocky at ~61 m cells
SMOOTH_PASSES = 1   # light 3x3 box smoothing after upsampling

GMRT_URL = (
    "https://www.gmrt.org/services/GridServer"
    "?minlongitude={min_lon}&maxlongitude={max_lon}"
    "&minlatitude={min_lat}&maxlatitude={max_lat}"
    "&format=esriascii&resolution=max"
)


def fetch_grid() -> str:
    url = GMRT_URL.format(**BOX)
    print(f"GET {url}")
    with urllib.request.urlopen(url, timeout=120) as response:
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
    count = int(np.isnan(grid).sum())
    print(f"filling {count} nodata cells by iterative neighbour mean")
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


def bilinear_upsample(grid: np.ndarray, factor: int) -> np.ndarray:
    if factor <= 1:
        return grid
    rows, cols = grid.shape
    new_rows, new_cols = (rows - 1) * factor + 1, (cols - 1) * factor + 1
    ys = np.linspace(0, rows - 1, new_rows)
    xs = np.linspace(0, cols - 1, new_cols)
    y0 = np.floor(ys).astype(int).clip(0, rows - 2)
    x0 = np.floor(xs).astype(int).clip(0, cols - 2)
    ty = (ys - y0)[:, None]
    tx = (xs - x0)[None, :]
    g = grid
    top = g[y0][:, x0] * (1 - tx) + g[y0][:, x0 + 1] * tx
    bot = g[y0 + 1][:, x0] * (1 - tx) + g[y0 + 1][:, x0 + 1] * tx
    return top * (1 - ty) + bot * ty


def box_smooth(grid: np.ndarray, passes: int) -> np.ndarray:
    out = grid
    for _ in range(passes):
        acc = out.copy()
        weight = np.ones_like(out)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                shifted = np.roll(out, shift=(dy, dx), axis=(0, 1))
                acc += shifted
                weight += 1
        out = acc / weight
    return out


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    out_dir = root / "assets" / "terrain"
    out_dir.mkdir(parents=True, exist_ok=True)

    header, grid = parse_esriascii(fetch_grid())
    grid = fill_nan(grid)

    cellsize = header["cellsize"]
    xll, yll = header["xllcorner"], header["yllcorner"]
    nrows, ncols = grid.shape

    grid = bilinear_upsample(grid, UPSAMPLE)
    grid = box_smooth(grid, SMOOTH_PASSES)
    up_rows, up_cols = grid.shape
    up_cell = cellsize * (ncols - 1) / (up_cols - 1)

    grid_mllw = (grid + MLLW_OFFSET_M).astype(np.float32)

    # Cell-centre geographic extents after upsampling. ESRI row 0 is the north
    # row; store north_lat and step south so the client can place each node.
    north_lat = yll + (nrows - 0.5) * cellsize
    west_lon = xll + 0.5 * cellsize

    heightmap = out_dir / "heightmap.bin"
    grid_mllw.tofile(heightmap)

    meta = {
        "source": "GMRT GridServer, format=esriascii, resolution=max",
        "source_url": GMRT_URL.format(**BOX),
        "vertical_datum": "MLLW",
        "vertical_note": (
            "GMRT sea-level elevations shifted up by MLLW_OFFSET_M so 0 = MLLW, "
            "matching the tide feed water_level_m."
        ),
        "mllw_offset_m": MLLW_OFFSET_M,
        "origin": ORIGIN,
        "box": BOX,
        "grid": {
            "nrows": up_rows,
            "ncols": up_cols,
            "cellsize_deg": up_cell,
            "north_lat": north_lat,
            "west_lon": west_lon,
            "dtype": "float32",
            "order": "row-major, north row first",
        },
        "elevation_m_mllw": {
            "min": float(grid_mllw.min()),
            "max": float(grid_mllw.max()),
        },
        "raw_gmrt": {"nrows": nrows, "ncols": ncols, "cellsize_deg": cellsize},
        "upsample": UPSAMPLE,
        "smooth_passes": SMOOTH_PASSES,
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    print(f"wrote {heightmap} ({grid_mllw.nbytes} bytes, {up_rows}x{up_cols})")
    print(f"elevation MLLW: {meta['elevation_m_mllw']['min']:.1f} .. "
          f"{meta['elevation_m_mllw']['max']:.1f} m")
    print(f"upsampled cell ~{up_cell * 111320:.0f} m lat")


if __name__ == "__main__":
    main()
