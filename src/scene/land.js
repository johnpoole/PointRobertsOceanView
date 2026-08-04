// Point Roberts land reference from OpenStreetMap (baked to assets/osm). Roads and
// the coastline drape on the terrain as thin ribbons, buildings stand as extruded
// blocks, and a few landmarks (lighthouse park, marinas, monument) get labeled
// markers. Everything is projected with the shared geo transform and sampled onto
// the near-terrain height, so it sits where it really is.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toWorld } from "../geo.js";
import { OSM } from "../config.js";

const ROAD_WIDTH = { motorway: 10, trunk: 9, primary: 8, secondary: 7, tertiary: 6,
                     residential: 5, unclassified: 5, service: 3.5, track: 3, path: 2.5,
                     footway: 2, cycleway: 2.5 };

function ribbon(coordsList, sample, width, lift) {
  // Build a flat draped ribbon (two triangles per segment) for each polyline.
  const pos = [];
  for (const line of coordsList) {
    const pts = line.map(([lat, lon]) => {
      const w = toWorld(lat, lon, 0);
      return new THREE.Vector3(w.x, sample(lat, lon) + lift, w.z);
    });
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const px = (-dz / len) * (width / 2), pz = (dx / len) * (width / 2);
      const a1 = [a.x + px, a.y, a.z + pz], a2 = [a.x - px, a.y, a.z - pz];
      const b1 = [b.x + px, b.y, b.z + pz], b2 = [b.x - px, b.y, b.z - pz];
      pos.push(...a1, ...a2, ...b1, ...b1, ...a2, ...b2);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  geom.computeVertexNormals();
  return geom;
}

function buildings(list, sample) {
  // Axis-aligned block per footprint: cheap, and from the bluff the massing reads.
  const geoms = [];
  for (const b of list) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let latSum = 0, lonSum = 0;
    for (const [lat, lon] of b.coords) {
      const w = toWorld(lat, lon, 0);
      minX = Math.min(minX, w.x); maxX = Math.max(maxX, w.x);
      minZ = Math.min(minZ, w.z); maxZ = Math.max(maxZ, w.z);
      latSum += lat; lonSum += lon;
    }
    const width = maxX - minX, depth = maxZ - minZ;
    if (width < 2 || depth < 2 || width > 400 || depth > 400) continue;
    const n = b.coords.length;
    const base = sample(latSum / n, lonSum / n);
    const h = Math.max(3, Math.min(b.height || 5, 60));
    const g = new THREE.BoxGeometry(width, h, depth);
    g.translate((minX + maxX) / 2, base + h / 2, (minZ + maxZ) / 2);
    geoms.push(g);
  }
  return geoms.length ? mergeGeometries(geoms, false) : null;
}

function makeLabel(text) {
  const font = "500 26px ui-monospace, Menlo, Consolas, monospace";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 14;
  canvas.width = w; canvas.height = 38;
  ctx.font = font;
  ctx.fillStyle = "rgba(8,16,24,0.72)"; ctx.fillRect(0, 0, w, 38);
  ctx.strokeStyle = "rgba(255,206,84,0.6)"; ctx.strokeRect(0.5, 0.5, w - 1, 37);
  ctx.fillStyle = "#ffe6a8"; ctx.textBaseline = "middle";
  ctx.fillText(text, 7, 20);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: true });
  const sprite = new THREE.Sprite(mat);
  const screenH = 0.04;
  sprite.scale.set(screenH * (w / 38), screenH, 1);
  return sprite;
}

export async function buildLand(scene, sample) {
  const data = await (await fetch(OSM)).json();

  // Roads, grouped by width class so major roads are wider.
  const byWidth = new Map();
  for (const r of data.roads) {
    const width = ROAD_WIDTH[r.kind] || 4;
    if (!byWidth.has(width)) byWidth.set(width, []);
    byWidth.get(width).push(r.coords);
  }
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x3c3f44, roughness: 1 });
  for (const [width, lines] of byWidth) {
    const mesh = new THREE.Mesh(ribbon(lines, sample, width, 0.4), roadMat);
    scene.add(mesh);
  }

  // Coastline.
  if (data.coastline.length) {
    const mesh = new THREE.Mesh(
      ribbon(data.coastline.map((c) => c.coords), sample, 5, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xb0a488, roughness: 1 }));
    scene.add(mesh);
  }

  // Buildings.
  const bgeom = buildings(data.buildings, sample);
  if (bgeom) {
    scene.add(new THREE.Mesh(bgeom, new THREE.MeshStandardMaterial({
      color: 0xa7a396, roughness: 0.9, metalness: 0 })));
  }

  // Landmarks: a pole plus a screen-constant label.
  const poleMat = new THREE.LineBasicMaterial({ color: 0xffce54 });
  for (const lm of data.landmarks) {
    const w = toWorld(lm.lat, lm.lon, 0);
    const base = sample(lm.lat, lm.lon);
    const group = new THREE.Group();
    const pole = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 22, 0)]);
    group.add(new THREE.Line(pole, poleMat));
    const label = makeLabel(lm.name);
    label.position.set(0, 28, 0);
    group.add(label);
    group.position.set(w.x, base, w.z);
    scene.add(group);
  }
}
