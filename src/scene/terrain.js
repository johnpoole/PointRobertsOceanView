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

// Cheap value noise off the grid indices. Not smooth, and it does not need to
// be: what is wanted is speckle at about the size of a stone.
function speckle(row, col) {
  const n = Math.sin(row * 127.1 + col * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function colorForElevation(elev, target, row = 0, col = 0, slope = 0) {
  const grass = new THREE.Color(0x4f6b3a);
  const forest = new THREE.Color(0x2f4a28);
  const floor = new THREE.Color(0x24322f);
  const beach = new THREE.Color();
  if (elev < 0) {
    target.copy(floor);
    return target;
  }
  const stony = Math.min(Math.max((slope - SAND_SLOPE) / (STONE_SLOPE - SAND_SLOPE), 0), 1);
  beach.copy(SAND).lerp(SHINGLE, stony);
  // Only the stone is mottled. Sand is even, which is what makes it read as sand.
  if (stony > 0) {
    beach.offsetHSL(0, 0, (speckle(row, col) - 0.5) * 0.16 * stony);
  }
  if (elev < 3) {
    target.copy(beach);
  } else if (elev < 14) {
    target.copy(beach).lerp(grass, (elev - 3) / 11);
  } else {
    target.copy(grass).lerp(forest, Math.min((elev - 14) / 40, 1));
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

// asset: { heightmap, meta }. opts: { haze 0..1, hazeGrade [nearM,farM,nearHaze,
// farHaze], fog, yOffset }. hazeGrade ramps haze with distance for atmospheric
// perspective, so nearer islands read crisp and far mountains fade.
export async function buildTerrain(scene, asset, opts = {}) {
  const haze = opts.haze || 0;
  const grade = opts.hazeGrade || null;
  const fog = opts.fog !== false;
  const yOffset = opts.yOffset || 0;

  const meta = await (await fetch(asset.meta)).json();
  const bin = await (await fetch(asset.heightmap)).arrayBuffer();
  const { nrows, ncols, cellsize_deg, north_lat, west_lon, dtype, scale_m } = meta.grid;
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
      colorForElevation(elev, tmp, i, j, slope);
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
  return { mesh, meta, sample, heights: Z };
}
