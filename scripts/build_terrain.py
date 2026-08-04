"""Bake the Point Roberts terrain heightmaps.

Two tiles are baked from GMRT (Global Multi-Resolution Topography), one seamless
topobathymetric grid (land + sea floor) per box:

  near - a small box around the bluff, upsampled fine. Drives the tide-driven
         shoreline in the foreground.
  far  - a wide box across the Strait of Georgia, decimated coarse. Gives the
         Gulf Islands and the far shore as the skyline you actually see west.

Vertical datum: GMRT is referenced to sea level (~local mean sea level). The app
and the tide feed work in MLLW, so every elevation is shifted up by the station's
MSL-above-MLLW offset (Cherry Point 9449424: MSL 11.62 ft, MLLW 6.34 ft ->
1.61 m). After the shift a value of 0 means the MLLW line.

Output (committed as static assets, so the app needs no geo libraries at runtime):
  assets/terrain/heightmap.bin / meta.json          (near)
  assets/terrain/heightmap_far.bin / meta_far.json  (far)

Run once:
  .venv/Scripts/python scripts/build_terrain.py
"""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path

import numpy as np

ORIGIN = {"lat": 48.989009, "lon": -123.085318}

# GMRT sea-level -> MLLW, from NOAA CO-OPS station 9449424 datums (feet):
# MSL 11.62, MLLW 6.34 -> (11.62 - 6.34) ft = 1.609 m.
MLLW_OFFSET_M = 1.609

# near: fine shoreline around the bluff.
BOX_NEAR = {"min_lon": -123.13, "max_lon": -123.05, "min_lat": 48.97, "max_lat": 49.01}
# far: the strait and the Gulf Islands across it, looking west.
BOX_FAR = {"min_lon": -123.62, "max_lon": -122.92, "min_lat": 48.66, "max_lat": 49.22}
MAX_CELLS_FAR = 420000  # decimate below this so the skyline mesh stays light

GMRT_URL = (
    "https://www.gmrt.org/services/GridServer"
    "?minlongitude={min_lon}&maxlongitude={max_lon}"
    "&minlatitude={min_lat}&maxlatitude={max_lat}"
    "&format=esriascii&resolution=max"
)


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
                acc += np.roll(out, shift=(dy, dx), axis=(0, 1))
                weight += 1
        out = acc / weight
    return out


def bake(box: dict, upsample: int, smooth_passes: int, max_cells: int | None,
         out_dir: Path, prefix: str) -> None:
    header, grid = parse_esriascii(fetch_grid(box))
    grid = fill_nan(grid)
    cellsize = header["cellsize"]
    xll, yll = header["xllcorner"], header["yllcorner"]
    nrows, ncols = grid.shape

    # Decimate large tiles so the mesh stays light.
    stride = 1
    if max_cells and nrows * ncols > max_cells:
        stride = int(np.ceil((nrows * ncols / max_cells) ** 0.5))
        grid = grid[::stride, ::stride]
        cellsize *= stride
        nrows, ncols = grid.shape
        print(f"decimated by {stride} -> {nrows}x{ncols}")

    grid = bilinear_upsample(grid, upsample)
    grid = box_smooth(grid, smooth_passes)
    up_rows, up_cols = grid.shape
    up_cell = cellsize * (ncols - 1) / (up_cols - 1) if up_cols > 1 else cellsize

    grid_mllw = (grid + MLLW_OFFSET_M).astype(np.float32)

    # ESRI row 0 is the north row; xll/yll are the lower-left corner of the
    # original grid, so cell-centre extents use the original cellsize.
    north_lat = yll + (header["nrows"] - 0.5) * header["cellsize"]
    west_lon = xll + 0.5 * header["cellsize"]

    (out_dir / f"heightmap{prefix}.bin").write_bytes(grid_mllw.tobytes())
    meta = {
        "source": "GMRT GridServer, format=esriascii, resolution=max",
        "vertical_datum": "MLLW",
        "mllw_offset_m": MLLW_OFFSET_M,
        "origin": ORIGIN,
        "box": box,
        "grid": {
            "nrows": up_rows, "ncols": up_cols, "cellsize_deg": up_cell,
            "north_lat": north_lat, "west_lon": west_lon,
            "dtype": "float32", "order": "row-major, north row first",
        },
        "elevation_m_mllw": {"min": float(grid_mllw.min()), "max": float(grid_mllw.max())},
        "decimate_stride": stride, "upsample": upsample,
    }
    (out_dir / f"meta{prefix}.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"wrote {prefix or 'near'}: {up_rows}x{up_cols}, {grid_mllw.nbytes} bytes, "
          f"cell ~{up_cell * 111320:.0f} m, elev {meta['elevation_m_mllw']['min']:.0f}"
          f"..{meta['elevation_m_mllw']['max']:.0f} m MLLW")


def main() -> None:
    out_dir = Path(__file__).resolve().parents[1] / "assets" / "terrain"
    out_dir.mkdir(parents=True, exist_ok=True)
    bake(BOX_NEAR, upsample=3, smooth_passes=1, max_cells=None, out_dir=out_dir, prefix="")
    bake(BOX_FAR, upsample=1, smooth_passes=1, max_cells=MAX_CELLS_FAR, out_dir=out_dir, prefix="_far")


if __name__ == "__main__":
    main()
