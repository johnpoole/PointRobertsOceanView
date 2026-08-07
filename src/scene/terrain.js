// Terrain mesh from a baked GMRT heightmap. Each grid node is a real lat/lon with
// an elevation in metres above MLLW, projected to world coords with the shared geo
// transform. Two tiles are built: a near tile for the tide-driven foreground, and
// a far tile for the Gulf Islands skyline across the strait. The waterline is not
// drawn here — the ocean plane at the tide height covers every node below it.

import * as THREE from "three";
import { toWorld } from "../geo.js";

const SKYLINE_HAZE = new THREE.Color(0x8295a8);

// The flat of the beach is sand. Where it tilts it is shingle: rounded grey and
// brown stone, no two square metres the same colour. Slope is what sorts them —
// the sea takes the fines off anything that leans and leaves the stone behind.
const SAND = new THREE.Color(0x9c8f6f);
const SHINGLE = new THREE.Color(0x767065);

// Rise over run. Flat berm and tide flat below the first, bluff toe and berm lip
// above the second.
const SAND_SLOPE = 0.05;
const STONE_SLOPE = 0.22;
// Above this the grass starts and there is no beach left to gravel.
const BEACH_TOP_M = 6.0;

// Pea gravel, an inch and under. Far too small to be geometry — a beach of it
// is millions of stones — so it is laid on per pixel instead, at the size the
// stones actually are. It fades out with distance because past forty metres an
// inch is smaller than a pixel, and drawing it there only makes it crawl.
const GRAVEL_M = 0.025;
const GRAVEL_COARSE_M = 0.07;
const GRAVEL_DEPTH = 0.16;
const GRAVEL_FADE_NEAR_M = 12.0;
const GRAVEL_FADE_FAR_M = 45.0;

// Value noise off the grid indices. Not smooth, and it does not need to be:
// what is wanted is speckle at about the size of a stone.
//
// Integer mixing rather than the usual sin-and-take-the-fraction. This is
// called some seven million times building the near tile and the trigonometric
// version took seven seconds of it.
function speckle(row, col) {
  let h = Math.imul(row, 73856093) ^ Math.imul(col, 19349663);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// What is on the ground, by NLCD class. Land cover says what grows or is built;
// it says nothing about the beach, because at 30 m a 20 m strip of shingle
// falls inside whichever cell it happens to touch.
const COVER_COLORS = {
  21: 0x8d9077,   // developed, open space — lawns, verges, the golf course
  22: 0x8a8574,   // developed, low — houses among trees
  23: 0x8d8880,   // developed, medium
  24: 0x91908c,   // developed, high — the pavement
  31: 0xa49984,   // barren
  41: 0x4e6b33,   // deciduous forest
  42: 0x2c4526,   // evergreen forest
  43: 0x3d5a2d,   // mixed forest
  52: 0x6a7046,   // shrub
  71: 0x7c8455,   // grassland
  81: 0x7d8a44,   // hay and pasture
  82: 0x8a7f3f,   // cultivated crops
  90: 0x435339,   // woody wetland
  95: 0x5b6a47,   // emergent wetland
};
const COVER_WATER = new Set([11, 12]);

// The beach runs from the water to about here. Below it elevation and slope
// decide; above it the land cover does; between, they cross over.
const BEACH_ONLY_M = 3.0;
export const COVER_ONLY_M = 6.5;

// Ground dries and pales as it climbs away from the sea, whatever is growing on
// it. This is the elevation still speaking after the class has had its say.
const EXPOSURE_TOP_M = 60.0;
const EXPOSURE_LIGHTEN = 0.06;

// Made once. This runs per vertex and the near tile has three and a half
// million of them; five colours built on every call cost seconds.
const GRASS = new THREE.Color(0x4f6b3a);
const FOREST = new THREE.Color(0x2f4a28);
const FLOOR = new THREE.Color(0x24322f);
const scratchBeach = new THREE.Color();
const scratchLand = new THREE.Color();

// Lighten or darken in place. offsetHSL converts to HSL and back on every call,
// which for a nudge this small is a lot of arithmetic to arrive at a multiply.
function shade(color, amount) {
  const k = 1 + amount * 2;
  color.r = Math.min(Math.max(color.r * k, 0), 1);
  color.g = Math.min(Math.max(color.g * k, 0), 1);
  color.b = Math.min(Math.max(color.b * k, 0), 1);
}

function colorForGround(elev, target, row, col, slope, cover) {
  const grass = GRASS;
  const forest = FOREST;
  const floor = FLOOR;
  const beach = scratchBeach;
  const land = scratchLand;
  if (elev < 0) {
    target.copy(floor);
    return target;
  }
  const stony = Math.min(Math.max((slope - SAND_SLOPE) / (STONE_SLOPE - SAND_SLOPE), 0), 1);
  beach.copy(SAND).lerp(SHINGLE, stony);
  // Only the stone is mottled. Sand is even, which is what makes it read as sand.
  if (stony > 0) {
    shade(beach, (speckle(row, col) - 0.5) * 0.16 * stony);
  }
  if (elev < BEACH_ONLY_M) {
    target.copy(beach);
    return target;
  }

  // Above the beach the class decides, and height alone is the fallback for
  // cells the survey does not cover — the Canadian end of the tile.
  const known = COVER_COLORS[cover];
  if (known != null && !COVER_WATER.has(cover)) {
    land.setHex(known);
    // A patch of one class is not one colour. Break it up at the vertex.
    shade(land, (speckle(row + 7919, col + 104729) - 0.5) * 0.07);
  } else {
    land.copy(grass).lerp(forest, Math.min(Math.max((elev - 14) / 40, 0), 1));
  }
  // Then elevation modulates whatever it turned out to be.
  const exposure = Math.min(Math.max(elev / EXPOSURE_TOP_M, 0), 1);
  shade(land, EXPOSURE_LIGHTEN * exposure);

  if (elev < COVER_ONLY_M) {
    target.copy(beach).lerp(land, (elev - BEACH_ONLY_M) / (COVER_ONLY_M - BEACH_ONLY_M));
  } else {
    target.copy(land);
  }
  return target;
}

// Lays gravel on whatever the stony attribute says is stony. Two octaves of
// value noise in world metres, one at the size of a pea and one at the size of
// the patches they gather in, darkening and lightening the ground rather than
// tinting it — wet stone and dry stone next to each other, not a colour wash.
function addGravel(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.gravelSize = { value: GRAVEL_M };
    shader.uniforms.gravelCoarse = { value: GRAVEL_COARSE_M };
    shader.uniforms.gravelDepth = { value: GRAVEL_DEPTH };
    shader.uniforms.gravelFade = {
      value: new THREE.Vector2(GRAVEL_FADE_NEAR_M, GRAVEL_FADE_FAR_M),
    };

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `
        #include <common>
        attribute float stony;
        varying float vStony;
        varying vec3 vGroundPos;
      `)
      .replace("#include <begin_vertex>", `
        #include <begin_vertex>
        vStony = stony;
        vGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `
        #include <common>
        varying float vStony;
        varying vec3 vGroundPos;
        uniform float gravelSize;
        uniform float gravelCoarse;
        uniform float gravelDepth;
        uniform vec2 gravelFade;

        float hash21(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float valueNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
      `)
      .replace("#include <color_fragment>", `
        #include <color_fragment>
        if (vStony > 0.001) {
          // Wrapped to a kilometre first: world coordinates run to thousands of
          // metres and a float cannot hold both that and a 25 mm stone.
          vec2 ground = mod(vGroundPos.xz, 1000.0);
          float stones = valueNoise(ground / gravelSize) - 0.5;
          float patches = valueNoise(ground / gravelCoarse) - 0.5;
          float dist = length(vGroundPos - cameraPosition);
          float near = 1.0 - smoothstep(gravelFade.x, gravelFade.y, dist);
          float grit = (stones * 0.7 + patches * 0.3) * gravelDepth * vStony * near;
          diffuseColor.rgb = clamp(diffuseColor.rgb * (1.0 + grit * 2.0), 0.0, 1.0);
        }
      `);
  };
  // A material whose shader is rewritten needs its own program.
  material.customProgramCacheKey = () => "terrain-gravel";
}

// fetch resolves for a 404 and a 500 as happily as for a 200 — only a network
// failure rejects. Left unchecked, an error page came back as twenty-one bytes,
// went into an Int16Array, and built three and a half million vertices whose
// height was undefined. The tile drew as nothing, the ground sampler answered
// NaN, the audio was handed a non-finite number, and the page reported that it
// had loaded.
async function grab(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `${url}: HTTP ${res.status} ${res.statusText}. The baked assets are served ` +
      `from the same origin as the page, so this is a deploy or a build problem ` +
      `and not a network one.`);
  }
  return res;
}

// asset: { heightmap, meta }. opts: { haze 0..1, hazeGrade [nearM,farM,nearHaze,
// farHaze], fog, yOffset }. hazeGrade ramps haze with distance for atmospheric
// perspective, so nearer islands read crisp and far mountains fade.
export async function buildTerrain(scene, asset, opts = {}) {
  const haze = opts.haze || 0;
  const grade = opts.hazeGrade || null;
  const fog = opts.fog !== false;
  const yOffset = opts.yOffset || 0;

  const meta = await (await grab(asset.meta)).json();
  const bin = await (await grab(asset.heightmap)).arrayBuffer();

  // What is on the ground, if this tile has it. Its grid is its own: 30 m cells
  // over the same box, so a vertex is looked up by where it is, not by index.
  let cover = null;
  if (opts.landcover) {
    const cMeta = await (await fetch(opts.landcover.meta)).json();
    const cBin = new Uint8Array(await (await fetch(opts.landcover.cover)).arrayBuffer());
    const want = cMeta.grid.nrows * cMeta.grid.ncols;
    if (cBin.length !== want) {
      throw new Error(
        `${opts.landcover.cover}: ${cBin.length} bytes, but the meta says ` +
        `${cMeta.grid.nrows} x ${cMeta.grid.ncols} = ${want}. Re-run build_landcover.py.`);
    }
    cover = { meta: cMeta, codes: cBin };
  }
  // Nearest cell, with the lookup nudged by up to half a cell so a 30 m grid
  // does not draw the peninsula as squares. The nudge is the vertex's own
  // speckle, so it is the same every time rather than shimmering.
  const coverAt = (lat, lon, row, col) => {
    if (!cover) return 0;
    const { nrows, ncols } = cover.meta.grid;
    const b = cover.meta.box;
    const fx = (lon - b.min_lon) / (b.max_lon - b.min_lon) * ncols
      + (speckle(row * 3, col * 3) - 0.5);
    const fy = (b.max_lat - lat) / (b.max_lat - b.min_lat) * nrows
      + (speckle(col * 5, row * 5) - 0.5);
    const j = Math.min(Math.max(Math.floor(fx), 0), ncols - 1);
    const i = Math.min(Math.max(Math.floor(fy), 0), nrows - 1);
    return cover.codes[i * ncols + j];
  };
  const { nrows, ncols, cellsize_deg, north_lat, west_lon, dtype, scale_m } = meta.grid;
  // The heightmap has to be the size the metadata says it is. A short file does
  // not fail, it reads as undefined past its end, and undefined heights become
  // NaN positions that three will happily draw.
  const sampleBytes = dtype === "int16" ? 2 : 4;
  const wantBytes = nrows * ncols * sampleBytes;
  if (bin.byteLength !== wantBytes) {
    throw new Error(
      `${asset.heightmap}: ${bin.byteLength} bytes, but ${asset.meta} says ` +
      `${nrows} x ${ncols} of ${dtype} = ${wantBytes}. Re-run ` +
      `scripts/build_terrain.py, or check what the server actually served.`);
  }
  // Stored as int16 decimetres to keep the file small; everything downstream
  // works in metres, so scale once here and hand on a Float32Array.
  let Z;
  if (dtype === "int16") {
    const counts = new Int16Array(bin);
    Z = new Float32Array(counts.length);
    for (let i = 0; i < counts.length; i++) Z[i] = counts[i] * scale_m;
  } else if (dtype === "float32") {
    Z = new Float32Array(bin);
  } else {
    throw new Error(`${asset.heightmap}: grid dtype is ${dtype}, expected int16 or float32`);
  }
  // Cells the tile does not cover, e.g. the far tile's hole under the near tile.
  const nodata = meta.nodata != null ? meta.nodata : null;
  const isHole = (v) => nodata != null && v <= nodata / 2;

  const count = nrows * ncols;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  // How stony this vertex is, 0 on the sand and 1 on the steep. The fragment
  // shader reads it to know where to lay the gravel.
  const stony = new Float32Array(count);
  const tmp = new THREE.Color();

  // One cell on the ground, for the slope. A degree of latitude is 111320 m and
  // a degree of longitude is that times the cosine of where you are standing.
  const cellNorthM = cellsize_deg * 111320;
  const cellEastM = cellNorthM * Math.cos((north_lat * Math.PI) / 180);

  for (let i = 0; i < nrows; i++) {
    const lat = north_lat - i * cellsize_deg;
    for (let j = 0; j < ncols; j++) {
      const lon = west_lon + j * cellsize_deg;
      const raw = Z[i * ncols + j];
      // Hole vertices are never indexed, but they still sit in the position
      // buffer, so give them a finite height or the bounding sphere goes bad
      // and three culls the whole mesh.
      const elev = isHole(raw) ? 0 : raw;
      const w = toWorld(lat, lon, elev);
      const idx = (i * ncols + j) * 3;
      positions[idx] = w.x;
      positions[idx + 1] = w.y;
      positions[idx + 2] = w.z;
      // Slope from the cells either side. The edges have no neighbour, and the
      // edge of the tile is nowhere near the beach, so they take zero.
      let slope = 0;
      if (i > 0 && i < nrows - 1 && j > 0 && j < ncols - 1) {
        const up = Z[(i - 1) * ncols + j];
        const down = Z[(i + 1) * ncols + j];
        const left = Z[i * ncols + j - 1];
        const right = Z[i * ncols + j + 1];
        if (!isHole(up) && !isHole(down) && !isHole(left) && !isHole(right)) {
          slope = Math.hypot((up - down) / (2 * cellNorthM),
                             (right - left) / (2 * cellEastM));
        }
      }
      colorForGround(elev, tmp, i, j, slope, coverAt(lat, lon, i, j));
      stony[i * ncols + j] = elev < BEACH_TOP_M
        ? Math.min(Math.max((slope - SAND_SLOPE) / (STONE_SLOPE - SAND_SLOPE), 0), 1)
        : 0;
      let h = haze;
      if (grade) {
        const d = Math.hypot(w.x, w.z);
        const tg = Math.min(Math.max((d - grade[0]) / (grade[1] - grade[0]), 0), 1);
        h = grade[2] + (grade[3] - grade[2]) * tg;
      }
      if (h > 0) tmp.lerp(SKYLINE_HAZE, h); // atmospheric perspective for distance
      colors[idx] = tmp.r;
      colors[idx + 1] = tmp.g;
      colors[idx + 2] = tmp.b;
    }
  }

  const indices = new Uint32Array((nrows - 1) * (ncols - 1) * 6);
  let k = 0;
  for (let i = 0; i < nrows - 1; i++) {
    for (let j = 0; j < ncols - 1; j++) {
      const a = i * ncols + j;
      const b = a + 1;
      const c = a + ncols;
      const d = c + 1;
      if (isHole(Z[a]) || isHole(Z[b]) || isHole(Z[c]) || isHole(Z[d])) continue;
      indices[k++] = a; indices[k++] = c; indices[k++] = b;
      indices[k++] = b; indices[k++] = c; indices[k++] = d;
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geom.setAttribute("stony", new THREE.BufferAttribute(stony, 1));
  geom.setIndex(new THREE.BufferAttribute(indices.subarray(0, k), 1));
  geom.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 0, fog,
  });
  if (opts.gravel !== false) addGravel(mat);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.y = yOffset;
  scene.add(mesh);

  // Bilinear height lookup (metres MLLW) for draping map features on the ground.
  // Out-of-tile lat/lon clamp to the nearest edge.
  const sample = (lat, lon) => {
    let fi = Math.min(Math.max((north_lat - lat) / cellsize_deg, 0), nrows - 1);
    let fj = Math.min(Math.max((lon - west_lon) / cellsize_deg, 0), ncols - 1);
    const i0 = Math.floor(fi), j0 = Math.floor(fj);
    const i1 = Math.min(i0 + 1, nrows - 1), j1 = Math.min(j0 + 1, ncols - 1);
    const ti = fi - i0, tj = fj - j0;
    const top = Z[i0 * ncols + j0] * (1 - tj) + Z[i0 * ncols + j1] * tj;
    const bot = Z[i1 * ncols + j0] * (1 - tj) + Z[i1 * ncols + j1] * tj;
    return top * (1 - ti) + bot * ti;
  };
  return { mesh, meta, sample, heights: Z, cover };
}
