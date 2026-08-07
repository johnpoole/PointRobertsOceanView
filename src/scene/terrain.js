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
  geom.setIndex(new THREE.BufferAttribute(indices.subarray(0, k), 1));
  geom.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 0, fog,
  });
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
