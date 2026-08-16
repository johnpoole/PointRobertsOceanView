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

// parcel is the baked asset. sample(lat, lon) -> metres above MLLW.
export function buildCampground(scene, parcel, sample) {
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

  const centre = new THREE.Vector3(
    plan.centre.x, groundAt(plan.centre.x, plan.centre.z), plan.centre.z);

  return {
    group,
    plan,
    centre,
    span: plan.span,
    get visible() { return group.visible; },
    setVisible(on) { group.visible = on; },
  };
}
