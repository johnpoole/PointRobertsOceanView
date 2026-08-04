// Terrain mesh from the baked GMRT heightmap. Each grid node is a real lat/lon
// with an elevation in metres above MLLW; we project it to world coords with the
// shared geo transform, so the bluff, beach, and sea floor sit where they are.
// The waterline is not drawn here — the ocean plane at the tide height covers
// every node below it, so raising the tide floods the beach on its own.

import * as THREE from "three";
import { toWorld } from "../geo.js";
import { TERRAIN } from "../config.js";

// Elevation (m MLLW) -> colour. Below the lowest tide it is sea floor and stays
// hidden under water; above that it climbs beach -> grass -> forest.
function colorForElevation(elev, target) {
  const sand = new THREE.Color(0x9c8f6f);
  const grass = new THREE.Color(0x4f6b3a);
  const forest = new THREE.Color(0x2f4a28);
  const floor = new THREE.Color(0x24322f);
  if (elev < 0) {
    target.copy(floor);
  } else if (elev < 3) {
    target.copy(sand);
  } else if (elev < 14) {
    target.copy(sand).lerp(grass, (elev - 3) / 11);
  } else {
    target.copy(grass).lerp(forest, Math.min((elev - 14) / 40, 1));
  }
  return target;
}

export async function buildTerrain(scene) {
  const meta = await (await fetch(TERRAIN.meta)).json();
  const bin = await (await fetch(TERRAIN.heightmap)).arrayBuffer();
  const Z = new Float32Array(bin);
  const { nrows, ncols, cellsize_deg, north_lat, west_lon } = meta.grid;

  const count = nrows * ncols;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const tmp = new THREE.Color();

  for (let i = 0; i < nrows; i++) {
    const lat = north_lat - i * cellsize_deg;
    for (let j = 0; j < ncols; j++) {
      const lon = west_lon + j * cellsize_deg;
      const elev = Z[i * ncols + j];
      const w = toWorld(lat, lon, elev);
      const idx = (i * ncols + j) * 3;
      positions[idx] = w.x;
      positions[idx + 1] = w.y;
      positions[idx + 2] = w.z;
      colorForElevation(elev, tmp);
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
      indices[k++] = a; indices[k++] = c; indices[k++] = b;
      indices[k++] = b; indices[k++] = c; indices[k++] = d;
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  geom.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.receiveShadow = false;
  scene.add(mesh);
  return { mesh, meta };
}
