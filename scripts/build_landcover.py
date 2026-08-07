"""Bake NLCD land cover for the near terrain tile.

The terrain used to be coloured by height alone: sand, then grass, then forest
above 14 m. That is why the whole point is the same green whatever is actually
standing on it. This fetches what is really there — trees, grass, pasture,
pavement — and the terrain reads it per vertex.

Source is the National Land Cover Database 2021, served by MRLC as WMS. It is
30 m and it is the United States only, so Point Roberts is covered wall to wall
and the Canadian side of the tile comes back empty. Cells with no answer are
written as 0 and the terrain falls back to colouring those by height.

WMS renders to a PNG rather than serving the class numbers, so the legend
colours are mapped back to the class they stand for. The mapping is exact: NLCD
renders one flat colour per class.

Run:
    python scripts/build_landcover.py
"""

from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

# The near terrain tile, matching BOX_NEAR in build_terrain.py.
BOX = {"min_lon": -123.13, "max_lon": -123.02, "min_lat": 48.97, "max_lat": 49.00}

WMS = "https://www.mrlc.gov/geoserver/mrlc_display/wms"
LAYER = "NLCD_2021_Land_Cover_Science_Product_L48"
CELL_M = 30.0
NODATA = 0

# NLCD's own legend, colour to class number. Anything not here — white outside
# the United States, or a colour they change one day — becomes NODATA rather
# than being guessed at.
LEGEND = {
    (70, 107, 159): 11,    # open water
    (209, 222, 248): 12,   # perennial ice and snow
    (222, 197, 197): 21,   # developed, open space
    (217, 146, 130): 22,   # developed, low intensity
    (235, 0, 0): 23,       # developed, medium intensity
    (171, 0, 0): 24,       # developed, high intensity
    (179, 172, 159): 31,   # barren land
    (104, 171, 95): 41,    # deciduous forest
    (28, 95, 44): 42,      # evergreen forest
    (181, 197, 143): 43,   # mixed forest
    (204, 184, 121): 52,   # shrub and scrub
    (223, 223, 194): 71,   # grassland and herbaceous
    (220, 217, 57): 81,    # hay and pasture
    (171, 108, 40): 82,    # cultivated crops
    (184, 217, 235): 90,   # woody wetlands
    (108, 159, 184): 95,   # emergent herbaceous wetlands
}

NAMES = {
    0: "no data", 11: "open water", 12: "ice", 21: "developed, open",
    22: "developed, low", 23: "developed, medium", 24: "developed, high",
    31: "barren", 41: "deciduous forest", 42: "evergreen forest",
    43: "mixed forest", 52: "shrub", 71: "grassland", 81: "hay/pasture",
    82: "crops", 90: "woody wetland", 95: "emergent wetland",
}


def fetch(width: int, height: int) -> Image.Image:
    url = WMS + "?" + urllib.parse.urlencode({
        "service": "WMS", "version": "1.1.1", "request": "GetMap",
        "layers": LAYER,
        "bbox": f"{BOX['min_lon']},{BOX['min_lat']},{BOX['max_lon']},{BOX['max_lat']}",
        "srs": "EPSG:4326", "width": width, "height": height,
        "format": "image/png",
    })
    req = urllib.request.Request(url, headers={"User-Agent": "PointRobertsOceanView/1.0"})
    with urllib.request.urlopen(req, timeout=180) as response:
        if response.status != 200:
            raise SystemExit(f"MRLC returned HTTP {response.status} for {LAYER}")
        data = response.read()
    if data[:4] != b"\x89PNG":
        raise SystemExit(
            f"MRLC did not return a PNG for {LAYER}. First bytes: {data[:80]!r}"
        )
    import io
    return Image.open(io.BytesIO(data)).convert("RGB")


def main() -> None:
    mid_lat = (BOX["min_lat"] + BOX["max_lat"]) / 2
    wide_m = (BOX["max_lon"] - BOX["min_lon"]) * 111320 * math.cos(math.radians(mid_lat))
    tall_m = (BOX["max_lat"] - BOX["min_lat"]) * 111320
    width = round(wide_m / CELL_M)
    height = round(tall_m / CELL_M)
    print(f"tile {wide_m / 1000:.1f} x {tall_m / 1000:.1f} km "
          f"-> {width} x {height} cells at {CELL_M:.0f} m")

    image = fetch(width, height)
    if image.size != (width, height):
        raise SystemExit(
            f"MRLC returned {image.size[0]}x{image.size[1]}, asked for {width}x{height}"
        )

    pixels = list(image.getdata())
    codes = bytearray(len(pixels))
    unknown: dict[tuple[int, int, int], int] = {}
    for i, rgb in enumerate(pixels):
        code = LEGEND.get(rgb)
        if code is None:
            unknown[rgb] = unknown.get(rgb, 0) + 1
            codes[i] = NODATA
        else:
            codes[i] = code

    out_dir = Path(__file__).resolve().parents[1] / "assets" / "landcover"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "cover.bin").write_bytes(bytes(codes))
    meta = {
        "source": f"MRLC {LAYER}",
        "box": BOX,
        "grid": {"nrows": height, "ncols": width, "dtype": "uint8"},
        "cell_m": CELL_M,
        "nodata": NODATA,
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")

    counts: dict[int, int] = {}
    for c in codes:
        counts[c] = counts.get(c, 0) + 1
    total = len(codes)
    print(f"wrote {len(codes)} cells, {len(codes) / 1024:.1f} kB")
    for code, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"   {NAMES.get(code, code):<22} {100 * n / total:5.1f}%")
    if unknown:
        top = sorted(unknown.items(), key=lambda kv: -kv[1])[:3]
        print("   colours not in the legend, written as no data: "
              + ", ".join(f"{rgb} x{n}" for rgb, n in top))


if __name__ == "__main__":
    main()
