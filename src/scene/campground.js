// The Nielson Campground, drawn. Where any of it goes is campground-plan.js;
// this file only turns that plan into geometry and lays it on the ground.
//
// Not built, so it is off until asked for on G, the way the Brademy is off until
// asked for on T. The switch is the whole of how it is kept apart from the
// peninsula.
//
// It stands 1.9 km east-northeast of the house on ground 50 m above the sea, so
// nothing on the bluff will ever see it. It is there for the modes that drive
// about, and for the overview map.
//
// The trees are not drawn here and they are not cleared here either. The lot is
// forest in the land cover and trees.js has already scattered it, and the
// decision keeps 66% of the canopy and says the campsite area keeps canopy too.
// So the firs standing among the sites are the retained canopy, and that is what
// is proposed.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { fromWorld } from "../geo.js";
import {
  BUILDINGS, PLINTH_M, ROAD_ONE_WAY_M, planCampground,
} from "./campground-plan.js";
import { BANDS, noiseField } from "./campground-noise.js";
import { box, gableRoof, tint } from "./parts.js";

const LIFT_M = 0.06;       // how far a made surface stands over the ground
const STATION_M = 8.0;     // how finely a road is cut before it is laid on the ground

const ROAD_COLOR = 0x7d7669;
const PAD_COLOR = 0x8e8474;
const TENT_PAD_COLOR = 0x6b5f4c;
const STALL_COLOR = 0x8e8474;
const REC_COLOR = 0x53703c;
const PLINTH_COLOR = 0x6d6e6a;
const CLAD = 0x6d5a45;
const CLAD_CABIN = 0x9c8f7a;
const ROOF = 0x53585b;
const TRIM = 0xd6d0c2;
const GLASS = 0x1b2b35;
const HYDRANT_COLOR = 0xb03027;
const HYDRANT_H = 0.9;

// A rectangle draped on the terrain, cut fine enough that seven metres of relief
// across the block does not show as a plate floating over a hollow.
function slab(r, sample, color, step = 10.0) {
  const nx = Math.max(1, Math.round((r.x1 - r.x0) / step));
  const nz = Math.max(1, Math.round((r.z1 - r.z0) / step));
  const at = (x, z) => {
    const { lat, lon } = fromWorld(x, z);
    return sample(lat, lon) + LIFT_M;
  };
  const pos = [];
  for (let i = 0; i < nz; i++) {
    for (let j = 0; j < nx; j++) {
      const ax = r.x0 + ((r.x1 - r.x0) * j) / nx, bx = r.x0 + ((r.x1 - r.x0) * (j + 1)) / nx;
      const az = r.z0 + ((r.z1 - r.z0) * i) / nz, bz = r.z0 + ((r.z1 - r.z0) * (i + 1)) / nz;
      const ya = at(ax, az), yb = at(bx, az), yc = at(bx, bz), yd = at(ax, bz);
      pos.push(ax, ya, az, bx, yb, az, bx, yc, bz);
      pos.push(ax, ya, az, bx, yc, bz, ax, yd, bz);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return tint(g, color);
}

// A straight road, draped, cut into stations along its length.
function road(r, sample, color) {
  const len = Math.hypot(r.bx - r.ax, r.bz - r.az);
  const n = Math.max(1, Math.round(len / STATION_M));
  const px = (-(r.bz - r.az) / len) * (r.w / 2), pz = ((r.bx - r.ax) / len) * (r.w / 2);
  const at = (x, z) => {
    const { lat, lon } = fromWorld(x, z);
    return sample(lat, lon) + LIFT_M;
  };
  const pos = [];
  for (let k = 0; k < n; k++) {
    const t0 = k / n, t1 = (k + 1) / n;
    const sx = r.ax + (r.bx - r.ax) * t0, sz = r.az + (r.bz - r.az) * t0;
    const ex = r.ax + (r.bx - r.ax) * t1, ez = r.az + (r.bz - r.az) * t1;
    const p = [
      [sx + px, sz + pz], [sx - px, sz - pz], [ex + px, ez + pz], [ex - px, ez - pz],
    ].map(([x, z]) => [x, at(x, z), z]);
    pos.push(...p[0], ...p[1], ...p[3]);
    pos.push(...p[0], ...p[3], ...p[2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return tint(g, color);
}

// A plain building: plinth, walls, a gable with an eave, and a band of glass on
// the long walls so it does not read as an extruded box.
function building(spec, w, d, cx, cz, ground, clad) {
  const parts = [];
  const eave = 0.6, sill = 1.0, glassH = 1.4;
  const base = ground + PLINTH_M;
  parts.push(box(w + 0.5, d + 0.5, PLINTH_M, cx, ground, cz, PLINTH_COLOR));
  parts.push(box(w, d, spec.wall, cx, base, cz, clad));
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(Math.max(w - 1.6, w * 0.4), glassH, 0.08);
    g.translate(cx, base + sill + glassH / 2, cz + (s * d) / 2);
    parts.push(tint(g, GLASS));
    parts.push(box(w + 0.3, 0.1, 0.18, cx, base + spec.wall - 0.18, cz + (s * d) / 2, TRIM));
  }
  // rotateY swaps the two spans, so the roof is asked for the other way round:
  // its halfW becomes the depth and its halfL the width. Backwards puts a roof
  // across a building instead of along it.
  const roof = gableRoof(d / 2, w / 2, base + spec.wall, spec.rise, eave, ROOF);
  roof.rotateY(Math.PI / 2);   // ridge along the width, so the long walls carry the glass
  roof.translate(cx, 0, cz);
  parts.push(roof);
  return parts;
}

// How far the campground carries, laid on the ground itself rather than only on
// the map.
//
// The bands are a texture and not a colour per vertex. The mesh has to be coarse
// enough to be affordable over a kilometre of ground, and a coarse mesh
// carrying the colour in its corners would blend one band into the next and turn
// four thresholds into a smear. In a nearest-filtered texture the edge between
// 45 and 35 dB stays where the arithmetic put it however few triangles are
// under it.
//
// Clipped to the near tile, because the sampler has no ground outside it and
// clamps to the edge — over water that would hang a coloured sheet in the air.
const NOISE_LIFT_M = 0.35;   // clear of the ground, under everything built on it
const NOISE_STEP_M = 25;     // how finely the sheet is cut to follow the ground
// How much of the ground the bands cover. Not a taste: at 0.55 and below the
// composite of the two quietest bands over mid terrain closes to under the 0.06
// lightness gap the data-viz validator wants and they stop being two bands. 0.6
// is the lightest that still holds them apart on dark forest, mid grass and pale
// pasture alike. A ramp on the alpha as well as the lightness was tried and is
// worse: it fades the quiet band so far into the ground that it changes hue.
const NOISE_ALPHA = 0.6;

function buildNoiseLayer(sites, sample, box) {
  const field = noiseField(sites);
  if (!field) return null;

  const tex = new THREE.DataTexture(
    new Uint8Array(field.cells * field.cells * 4), field.cells, field.cells);
  const rgb = BANDS.map((b) => [
    parseInt(b.color.slice(1, 3), 16),
    parseInt(b.color.slice(3, 5), 16),
    parseInt(b.color.slice(5, 7), 16),
  ]);
  for (let k = 0; k < field.bands.length; k++) {
    const b = field.bands[k];
    if (b < 0) continue;
    tex.image.data[k * 4] = rgb[b][0];
    tex.image.data[k * 4 + 1] = rgb[b][1];
    tex.image.data[k * 4 + 2] = rgb[b][2];
    tex.image.data[k * 4 + 3] = 255;
  }
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  // The sheet, cut into steps and hung on the terrain. Cells whose ground the
  // near tile does not hold are dropped rather than clamped.
  const n = Math.max(1, Math.round(field.span / NOISE_STEP_M));
  const at = (x, z) => {
    const { lat, lon } = fromWorld(x, z);
    if (lat < box.min_lat || lat > box.max_lat || lon < box.min_lon || lon > box.max_lon) {
      return null;
    }
    return sample(lat, lon) + NOISE_LIFT_M;
  };
  const pos = [], uv = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x0 = field.x0 + (field.span * j) / n, x1 = field.x0 + (field.span * (j + 1)) / n;
      const z0 = field.z0 + (field.span * i) / n, z1 = field.z0 + (field.span * (i + 1)) / n;
      const y = [at(x0, z0), at(x1, z0), at(x1, z1), at(x0, z1)];
      if (y.some((v) => v === null)) continue;
      const u0 = j / n, u1 = (j + 1) / n, v0 = i / n, v1 = (i + 1) / n;
      pos.push(x0, y[0], z0, x1, y[1], z0, x1, y[2], z1);
      pos.push(x0, y[0], z0, x1, y[2], z1, x0, y[3], z1);
      uv.push(u0, v0, u1, v0, u1, v1);
      uv.push(u0, v0, u1, v1, u0, v1);
    }
  }
  if (!pos.length) {
    throw new Error(
      "campground: the sound layer came out empty. Every cell of the field fell " +
      "outside the near terrain tile, which means the campground is not on it.");
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: NOISE_ALPHA,
    // Over the ground and under everything standing on it, and it must not stop
    // what is behind it being drawn: a three-kilometre sheet writing depth would
    // cut the horizon out of the view.
    depthWrite: false, side: THREE.DoubleSide, fog: true,
  }));
  mesh.renderOrder = 1;
  return { mesh, field };
}

// parcel is the baked asset. sample(lat, lon) -> metres above MLLW.
// box is the near tile's lat/lon box, which is as far as the ground reaches.
export function buildCampground(scene, parcel, sample, box) {
  const plan = planCampground(parcel);
  const groundAt = (x, z) => {
    const { lat, lon } = fromWorld(x, z);
    return sample(lat, lon);
  };

  const surfaces = plan.roads.map((r) => road(r, sample, ROAD_COLOR));
  for (const s of plan.stalls) surfaces.push(slab(s, sample, STALL_COLOR, 4));
  for (const r of plan.rec) surfaces.push(slab(r, sample, REC_COLOR));

  const built = [];
  for (const s of plan.sites) {
    if (s.kind === "cabin") {
      // The park model is the site. Nothing is laid under it but its own footing.
      // Its long axis runs east and west, across the rank, so that is the width
      // the building is given and the ridge follows it.
      const cx = (s.pad.x0 + s.pad.x1) / 2, cz = (s.pad.z0 + s.pad.z1) / 2;
      built.push(...building(BUILDINGS.cabin, s.pad.x1 - s.pad.x0, s.pad.z1 - s.pad.z0,
                             cx, cz, groundAt(cx, cz), CLAD_CABIN));
    } else {
      surfaces.push(slab(s.pad, sample,
                         s.kind === "tent" ? TENT_PAD_COLOR : PAD_COLOR, 5));
    }
  }
  for (const b of plan.buildings) {
    built.push(...building(b.spec, b.w, b.d, b.x, b.z, groundAt(b.x, b.z), CLAD));
  }

  // Beside the rung it stands on, which runs north and south, so it steps aside
  // in x.
  const hydrants = plan.hydrants.map((h) => {
    const x = h.x + ROAD_ONE_WAY_M / 2 + 1.2;
    const g = new THREE.CylinderGeometry(0.13, 0.15, HYDRANT_H, 8, 1, true);
    g.translate(x, groundAt(x, h.z) + HYDRANT_H / 2, h.z);
    return tint(g, HYDRANT_COLOR);
  });

  const group = new THREE.Group();
  group.visible = false;
  const laid = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(mergeGeometries(surfaces, false), laid));
  group.add(new THREE.Mesh(mergeGeometries(built, false),
    new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide })));
  group.add(new THREE.Mesh(mergeGeometries(hydrants, false),
    new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.6, metalness: 0.2 })));
  scene.add(group);

  // The sound layer goes in its own group. It reaches four hundred metres past
  // the camp, so aiming the camera at one must not be made to frame the other.
  const noise = buildNoiseLayer(plan.sites, sample, box);
  const noiseGroup = new THREE.Group();
  noiseGroup.visible = false;
  noiseGroup.add(noise.mesh);
  scene.add(noiseGroup);

  const centre = new THREE.Vector3(
    plan.centre.x, groundAt(plan.centre.x, plan.centre.z), plan.centre.z);

  return {
    group,
    plan,
    centre,
    span: plan.span,
    reach: noise.field.reach,
    get visible() { return group.visible; },
    setVisible(on) { group.visible = on; noiseGroup.visible = on; },
  };
}
