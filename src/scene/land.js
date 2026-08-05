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

// A screen-constant dot marking a landmark. The name shows on hover (main.js),
// not as an always-on label.
function makeDot() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext("2d");
  ctx.beginPath(); ctx.arc(16, 16, 9, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,206,84,0.95)"; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = "rgba(8,16,24,0.85)"; ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: true });
  const s = new THREE.Sprite(mat);
  s.scale.set(0.014, 0.014, 1);
  return s;
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
  // Roads: light ribbons, lifted clear of the terrain and widened so they read
  // against the land.
  const roadMat = new THREE.MeshStandardMaterial({ color: 0xe8dfc8, roughness: 1, side: THREE.DoubleSide });
  for (const [width, lines] of byWidth) {
    const mesh = new THREE.Mesh(ribbon(lines, sample, Math.max(width * 2.4, 9), 2.0), roadMat);
    mesh.renderOrder = 1;
    scene.add(mesh);
  }

  // Coastline.
  if (data.coastline.length) {
    const mesh = new THREE.Mesh(
      ribbon(data.coastline.map((c) => c.coords), sample, 6, 1.0),
      new THREE.MeshStandardMaterial({ color: 0xcbb98f, roughness: 1, side: THREE.DoubleSide }));
    scene.add(mesh);
  }

  // Buildings.
  const bgeom = buildings(data.buildings, sample);
  if (bgeom) {
    scene.add(new THREE.Mesh(bgeom, new THREE.MeshStandardMaterial({
      color: 0xa7a396, roughness: 0.9, metalness: 0 })));
  }

  // Landmarks: a screen-constant dot; the name shows on hover.
  const markers = [];
  for (const lm of data.landmarks) {
    const w = toWorld(lm.lat, lm.lon, 0);
    // Landmarks off the near tile carry their own height; sampling would clamp
    // them to the tile edge and sink them.
    const base = lm.elev != null ? lm.elev : sample(lm.lat, lm.lon);
    const group = new THREE.Group();
    const dot = makeDot();
    dot.position.set(0, 10, 0);
    group.add(dot);
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(70, 90, 70),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    proxy.position.y = 25;
    group.add(proxy);
    group.userData.landmark = { name: lm.name, kind: lm.kind };
    group.position.set(w.x, base, w.z);
    scene.add(group);
    markers.push(group);
  }
  return { landmarks: markers };
}
