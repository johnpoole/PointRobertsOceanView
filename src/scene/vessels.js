// Vessel meshes from the feed. Each vessel is a parametric 3D hull shaped by its
// AIS ship type and sized by its reported dimensions, oriented by heading, bobbing
// on the swell. There is no always-on label; the hovered vessel is picked by
// raycast (see main.js) and its details shown in a DOM tooltip. Stale tracks dim
// but never drop.

import * as THREE from "three";
import { toWorld, headingToYaw } from "../geo.js";

const DEFAULT = { length: 30, beam: 8 };

// Ships are drawn larger than life so they read from the bluff, the way they do
// to the eye. Relative sizes still follow the AIS dimensions. Size grows with
// distance so ferries kilometres out stay prominent instead of shrinking to dots.
const VESSEL_SCALE = 4.5;
const SIZE_REF_M = 2500;

// AIS ship type (0-99) -> silhouette class + colours.
function classify(type) {
  const t = type == null ? -1 : type;
  if (t >= 60 && t <= 69) return "passenger";
  if (t >= 70 && t <= 79) return "cargo";
  if (t >= 80 && t <= 89) return "tanker";
  if (t === 30) return "fishing";
  if (t === 36 || t === 37) return "small";
  if ([31, 32, 50, 51, 52, 53, 54, 55].includes(t)) return "service";
  return "default";
}

const PALETTE = {
  passenger: { hull: 0x264b6b, house: 0xe6ecf0 },
  cargo:     { hull: 0x6a4a3a, house: 0xccc4b2 },
  tanker:    { hull: 0x26262c, house: 0xccc4b2 },
  service:   { hull: 0x7a3230, house: 0xe0e0e0 },
  fishing:   { hull: 0x4f5f6f, house: 0xcfd6da },
  small:     { hull: 0x5a6b74, house: 0xd8dee2 },
  default:   { hull: 0x6b7480, house: 0xc8ced2 },
};

const NAV_STATUS = {
  0: "under way", 1: "at anchor", 2: "not under command",
  3: "restricted manoeuvrability", 4: "constrained by draught",
  5: "moored", 6: "aground", 7: "fishing", 8: "under way sailing",
};

function hullShape(length, beam) {
  // Plan view in (x=beam, y=fore-aft), bow at +y.
  const b = beam / 2, L = length / 2;
  const s = new THREE.Shape();
  s.moveTo(-b, -L);
  s.lineTo(b, -L);
  s.lineTo(b, L * 0.35);
  s.lineTo(b * 0.4, L * 0.9);
  s.lineTo(0, L);
  s.lineTo(-b * 0.4, L * 0.9);
  s.lineTo(-b, L * 0.35);
  s.closePath();
  return s;
}

// Build a hull group in local frame: bow at -Z, up +Y, deck near y=0, hull below.
function buildVessel(state) {
  const dim = state.dimensions_m || {};
  const length = Math.max(6, dim.length || DEFAULT.length);
  const beam = Math.max(2, dim.beam || DEFAULT.beam);
  const cls = classify(state.vessel_type);
  const color = PALETTE[cls];

  const depth = Math.max(4, beam * 0.5);
  const freeboard = depth * 0.5; // hull band showing above water, with the bow taper

  const group = new THREE.Group();
  const mats = [];

  const hullGeom = new THREE.ExtrudeGeometry(hullShape(length, beam), {
    depth, bevelEnabled: false,
  });
  hullGeom.rotateX(-Math.PI / 2);          // footprint into XZ, extrude up in Y
  hullGeom.translate(0, freeboard - depth, 0); // deck at +freeboard, hull below
  const hullMat = new THREE.MeshStandardMaterial({ color: color.hull, roughness: 0.75, metalness: 0.1 });
  mats.push(hullMat);
  group.add(new THREE.Mesh(hullGeom, hullMat));

  // Superstructure, placed by class. Local +Z is aft (stern), -Z is bow.
  const houseMat = new THREE.MeshStandardMaterial({ color: color.house, roughness: 0.6, metalness: 0.05 });
  mats.push(houseMat);
  function house(len, wide, tall, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(beam * wide, tall, length * len), houseMat);
    m.position.set(0, freeboard + tall / 2, z);
    group.add(m);
  }
  if (cls === "passenger") {
    house(0.5, 0.72, beam * 0.42, length * 0.02); // main deck, inset from hull sides
    house(0.16, 0.46, beam * 0.28, -length * 0.22); // bridge forward
  } else if (cls === "cargo") {
    house(0.15, 0.78, beam * 0.7, length * 0.34); // house aft, open deck forward
  } else if (cls === "tanker") {
    house(0.12, 0.76, beam * 0.55, length * 0.37);
  } else if (cls === "service") {
    house(0.4, 0.7, beam * 0.75, -length * 0.02);
  } else if (cls === "fishing" || cls === "small") {
    house(0.28, 0.6, beam * 0.55, length * 0.06);
  } else {
    house(0.24, 0.72, beam * 0.55, length * 0.1);
  }

  // Invisible but raycastable proxy, enlarged so distant hulls are hoverable.
  const proxy = new THREE.Mesh(
    new THREE.BoxGeometry(beam * 1.6, depth + beam, length * 1.15),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  proxy.position.y = freeboard;
  group.add(proxy);

  group.userData.vessel = state;
  group.userData.mats = mats;
  group.userData.hullColor = color.hull;
  group.userData.placed = false;
  group.userData.target = new THREE.Vector3();
  return group;
}

export class Vessels {
  constructor(scene) {
    this.scene = scene;
    this.groups = new Map(); // mmsi -> group
  }

  pickList() {
    return Array.from(this.groups.values());
  }

  update(feed, tideLevel, t, camera) {
    for (const [mmsi, entry] of feed.vessels) {
      const state = entry.data;
      if (state.latitude == null || state.longitude == null) continue;
      let group = this.groups.get(mmsi);
      if (!group) {
        group = buildVessel(state);
        this.scene.add(group);
        this.groups.set(mmsi, group);
      }
      group.userData.vessel = state;

      const heading = state.true_heading_degrees ?? state.course_over_ground_degrees;
      if (heading != null) group.rotation.y = headingToYaw(heading);

      const w = toWorld(state.latitude, state.longitude, 0);
      group.userData.target.set(w.x, tideLevel, w.z);
      if (!group.userData.placed) {
        group.position.copy(group.userData.target);
        group.userData.placed = true;
      } else {
        group.position.lerp(group.userData.target, 0.08);
      }
      const bob = Math.sin(t * 0.8 + w.x * 0.01) * 0.4;
      group.position.y = tideLevel + bob;

      const dist = camera ? group.position.distanceTo(camera.position) : group.position.length();
      const grow = Math.min(Math.max(1, dist / SIZE_REF_M), 3); // cap so far ships don't balloon
      group.scale.setScalar(VESSEL_SCALE * grow);

      const stale = feed.isStale(entry);
      for (const m of group.userData.mats) {
        if (stale) {
          m.transparent = true;
          m.opacity = 0.5;
          m.color.setHex(0x6b7480);
        } else {
          m.opacity = 1;
          m.transparent = false;
        }
      }
      group.userData.stale = stale;
    }

    for (const mmsi of this.groups.keys()) {
      if (!feed.vessels.has(mmsi)) {
        const group = this.groups.get(mmsi);
        this.scene.remove(group);
        group.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
        this.groups.delete(mmsi);
      }
    }
  }

  static describe(state) {
    const cls = classify(state.vessel_type);
    const dim = state.dimensions_m || {};
    const rows = [];
    rows.push(["name", (state.name && state.name.trim()) || "—"]);
    rows.push(["mmsi", state.mmsi]);
    rows.push(["type", cls + (state.vessel_type != null ? ` (${state.vessel_type})` : "")]);
    if (state.speed_over_ground_knots != null) rows.push(["speed", `${state.speed_over_ground_knots.toFixed(1)} kn`]);
    const hdg = state.true_heading_degrees ?? state.course_over_ground_degrees;
    if (hdg != null) rows.push(["heading", `${Math.round(hdg)}°`]);
    if (dim.length && dim.beam) rows.push(["size", `${Math.round(dim.length)} × ${Math.round(dim.beam)} m`]);
    if (state.navigation_status != null) {
      rows.push(["status", NAV_STATUS[state.navigation_status] || `code ${state.navigation_status}`]);
    }
    return rows;
  }
}
