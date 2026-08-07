// Small pieces for building buildings, shared by the clubhouse and the cabin.
//
// Everything here hands back a geometry carrying its own colour, so a whole
// building of many colours merges into one mesh and one draw call. That is the
// only rule: anything going into a merge comes through tint(), or the attribute
// sets differ and mergeGeometries refuses.

import * as THREE from "three";

// One repeatable stream, so a scatter is the same scatter on every reload.
export function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function pick(list, rand) {
  return list[Math.floor(rand() * list.length)];
}

export function tint(geom, color) {
  geom.deleteAttribute("uv");
  const g = geom.index ? geom.toNonIndexed() : geom;
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}

// A box standing on y, centred on x and z.
export function box(w, d, h, x, y, z, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return tint(g, color);
}

// A gable roof with its ridge along Z, hanging past the walls on all four sides.
// The overhang is the point: a roof stopping flush at the wall reads as an
// extruded box, and a roof with a deep eave and a shadow under it reads as a
// building. Wants a double sided material, so the soffit shows from below.
//
// halfW and halfL are the walls. The slope falls from the ridge to the eave.
export function gableRoof(halfW, halfL, wallTop, rise, eave, color) {
  const slope = rise / halfW;
  const ridgeY = wallTop + rise;
  const outW = halfW + eave;
  const eaveY = wallTop - slope * eave;
  const outL = halfL + eave;
  const pos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  for (const s of [-1, 1]) {
    tri([0, ridgeY, -outL], [s * outW, eaveY, -outL], [s * outW, eaveY, outL]);
    tri([0, ridgeY, -outL], [s * outW, eaveY, outL], [0, ridgeY, outL]);
  }
  for (const z of [-halfL, halfL]) {
    tri([-halfW, wallTop, z], [halfW, wallTop, z], [0, ridgeY, z]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return tint(g, color);
}
