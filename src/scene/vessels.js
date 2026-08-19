// Vessel meshes from the feed. Each vessel is a parametric silhouette shaped by
// its AIS ship type and sized by dimensions_m: a pointed hull with a raised bow,
// and class-specific topsides — container stacks, tanker manifold, tiered ferry
// decks, a tug wheelhouse, funnels and masts. All parts are merged into one
// vertex-coloured mesh so a strait full of ships stays cheap. Oriented by heading,
// bobbing on the swell; the hovered vessel shows a DOM tooltip (see main.js).
// Ships too far off to make out are drawn larger than life so they read from
// the bluff; the ones near enough to see are drawn at the size they are.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toWorld, headingToYaw } from "../geo.js";
import { buildLamps, setLampLevel } from "./lights.js";

const DEFAULT = { length: 30, beam: 8 };

// Lights. A ship at night is a handful of points on black, and a ferry is a
// great deal more of them than a freighter is — that is the whole of why you can
// pick the Tsawwassen boats out of the strait from the bluff and cannot always
// pick out a bulker on the same water.
//
// Sizes are in pixels. The sidelights and the masthead are the ones the Rules
// care about; the rest is somebody having left the lights on, which is most of
// what you actually see.
const LAMP = {
  masthead: { color: 0xfff6e2, size: 7 },
  side: { port: 0xff3b30, starboard: 0x2fd45e, size: 5 },
  stern: { color: 0xfff6e2, size: 5 },
  deck: { color: 0xffe9bd, size: 4 },
  window: { color: 0xfff2cf, size: 3 },
};

// How big a vessel is drawn depends on how far away it is and on nothing else.
// Near to it is its real size. With range it grows, so a ship across the strait
// is still a ship and not two pixels.
//
// The growth is the square root of the range: four times further off looks half
// the size rather than a quarter. The falloff is flattened, not removed, so a
// nearer ship still reads as nearer.
//
// The important part is what it does not depend on. Because the factor is a
// function of range alone, two vessels at the same range keep the ratio they
// really have, at every range. Nothing here can ever make a small boat look
// bigger than a big ship.
//
// Both of the ways this has been got wrong were floors and caps measured in
// metres of hull. A 140 m minimum drew a 9 m runabout in the marina larger on
// screen than a container ship. Replacing it with a floor in screen size fixed
// that and took all the magnification off the big ships with it, so a tanker
// you could nearly read the name of came out at a couple of pixels. There is no
// floor and no cap in metres here. That is deliberate: any of them flattens two
// different vessels onto the same size.
const ZOOM_REF_M = 1200;   // closer than this, real size
const ZOOM_POWER = 0.5;    // the square root
const ZOOM_MAX = 4;        // and it stops growing here

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

const HULL = {
  passenger: 0x2a3d55, cargo: 0x6a4a3a, tanker: 0x2a2a30,
  service: 0x7a3230, fishing: 0x445264, small: 0x50606c, default: 0x5c6570,
};
const HOUSE = 0xe6e6de;
const DECK = 0x4a4f55;
const ACCENT = {
  passenger: 0xb23838, cargo: 0x8a3b2f, tanker: 0x1a1a1e,
  service: 0x8a3b2f, fishing: 0x33506a, small: 0x8090a0, default: 0x556070,
};
const CONTAINERS = [0x9c4a3a, 0x2f6ea0, 0x4a7a45, 0x9c8a3a, 0x7a4a7a, 0x8a8a8a];
const DARK = 0x2a2d33;

const NAV_STATUS = {
  0: "under way", 1: "at anchor", 2: "not under command",
  3: "restricted manoeuvrability", 4: "constrained by draught",
  5: "moored", 6: "aground", 7: "fishing", 8: "under way sailing",
};

function hullShape(length, beam) {
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

// Tag a part geometry with a solid colour and place it (bow at -Z, up +Y). All
// parts are made non-indexed with the same attribute set (position, normal,
// color) so mergeGeometries can combine the extruded hull with the box/cylinder
// topsides.
function part(geom, color, { x = 0, y = 0, z = 0, rx = 0 } = {}) {
  if (rx) geom.rotateX(rx);
  geom.translate(x, y, z);
  geom.deleteAttribute("uv");
  const g = geom.index ? geom.toNonIndexed() : geom;
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}

function box(w, h, l) { return new THREE.BoxGeometry(w, h, l); }
function cyl(r, h) { return new THREE.CylinderGeometry(r, r * 1.1, h, 10); }

function buildParts(state) {
  const dim = state.dimensions_m || {};
  const length = Math.max(6, dim.length || DEFAULT.length);
  const beam = Math.max(2, dim.beam || DEFAULT.beam);
  const cls = classify(state.vessel_type);
  const B = beam, L = length;
  const depth = Math.max(4, beam * 0.5);
  const fb = depth * 0.5; // freeboard: deck sits at +fb, hull below
  const parts = [];
  const hullColor = HULL[cls];

  const hull = new THREE.ExtrudeGeometry(hullShape(L, B), { depth, bevelEnabled: false });
  hull.rotateX(-Math.PI / 2);
  hull.translate(0, fb - depth, 0);
  parts.push(part(hull, hullColor));

  // Raised bow (forecastle).
  parts.push(part(box(B * 0.55, depth * 0.5, L * 0.12), hullColor, { z: -L * 0.42, y: fb + depth * 0.2 }));

  const funnel = (z, r, h, color) =>
    parts.push(part(cyl(B * r, B * h), color, { z, y: fb + B * 0.9 }));
  const mast = (z) =>
    parts.push(part(cyl(B * 0.03, B * 0.9), DARK, { z, y: fb + B * 0.45 }));

  if (cls === "cargo") {
    parts.push(part(box(B * 0.8, B, L * 0.14), HOUSE, { z: L * 0.35, y: fb + B * 0.5 }));
    funnel(L * 0.42, 0.11, 0.5, ACCENT.cargo);
    // Container stacks over the foredeck: three bays, two tiers, mixed colours.
    const bays = [-0.32, -0.12, 0.08];
    let ci = 0;
    for (const bz of bays) {
      for (let tier = 0; tier < 2; tier++) {
        parts.push(part(box(B * 0.72, B * 0.42, L * 0.17), CONTAINERS[ci++ % CONTAINERS.length],
          { z: bz * L, y: fb + B * 0.21 + tier * B * 0.42 }));
      }
    }
    mast(-L * 0.3);
  } else if (cls === "tanker") {
    parts.push(part(box(B * 0.78, B * 0.9, L * 0.13), HOUSE, { z: L * 0.37, y: fb + B * 0.45 }));
    funnel(L * 0.43, 0.1, 0.45, ACCENT.tanker);
    parts.push(part(box(B * 0.07, B * 0.12, L * 0.7), DECK, { y: fb + B * 0.06 })); // manifold catwalk
    parts.push(part(cyl(B * 0.06, B * 0.2), DECK, { z: -L * 0.12, y: fb + B * 0.1 }));
    parts.push(part(cyl(B * 0.06, B * 0.2), DECK, { z: L * 0.12, y: fb + B * 0.1 }));
    mast(-L * 0.32);
  } else if (cls === "passenger") {
    parts.push(part(box(B * 0.86, B * 0.5, L * 0.62), HOUSE, { z: L * 0.03, y: fb + B * 0.25 }));
    parts.push(part(box(B * 0.7, B * 0.35, L * 0.42), HOUSE, { z: L * 0.03, y: fb + B * 0.5 + B * 0.175 }));
    parts.push(part(box(B * 0.5, B * 0.22, L * 0.12), HOUSE, { z: -L * 0.22, y: fb + B * 0.85 })); // bridge
    funnel(L * 0.14, 0.1, 0.4, ACCENT.passenger);
  } else if (cls === "service") {
    parts.push(part(box(B * 0.7, B * 0.8, L * 0.35), HOUSE, { z: -L * 0.06, y: fb + B * 0.4 }));
    parts.push(part(box(B * 0.82, B * 0.15, L * 0.34), hullColor, { z: L * 0.3, y: fb + B * 0.075 }));
    funnel(L * 0.06, 0.09, 0.35, ACCENT.service);
    mast(-L * 0.12);
  } else if (cls === "fishing" || cls === "small") {
    parts.push(part(box(B * 0.62, B * 0.55, L * 0.28), HOUSE, { z: L * 0.16, y: fb + B * 0.28 }));
    mast(-L * 0.1);
  } else {
    parts.push(part(box(B * 0.74, B * 0.6, L * 0.25), HOUSE, { z: L * 0.2, y: fb + B * 0.3 }));
    funnel(L * 0.28, 0.09, 0.4, ACCENT.default);
    mast(-L * 0.25);
  }

  return { parts, length, beam, depth, fb };
}

// Where the lights sit on a hull of this class and size. Everything is off L, B
// and the freeboard, the same as the parts are, so the lights land on the ship
// rather than near it.
function lampsFor(cls, L, B, fb) {
  const lamps = [];
  const add = (x, y, z, color, size) => lamps.push({ x, y, z, color, size });

  // Masthead forward and high, sidelights abreast the bridge, stern light aft.
  add(0, fb + B * 1.15, -L * 0.24, LAMP.masthead.color, LAMP.masthead.size);
  add(-B * 0.52, fb + B * 0.55, -L * 0.06, LAMP.side.port, LAMP.side.size);
  add(B * 0.52, fb + B * 0.55, -L * 0.06, LAMP.side.starboard, LAMP.side.size);
  add(0, fb + B * 0.3, L * 0.47, LAMP.stern.color, LAMP.stern.size);

  if (cls === "passenger") {
    // A ferry is lit like a building. Two decks of windows down both sides, and
    // the car deck throwing light out of the openings under them.
    for (let deck = 0; deck < 2; deck++) {
      const y = fb + B * (deck === 0 ? 0.34 : 0.62);
      for (let i = 0; i < 16; i++) {
        const z = L * (-0.27 + (i / 15) * 0.58);
        add(-B * 0.44, y, z, LAMP.window.color, LAMP.window.size);
        add(B * 0.44, y, z, LAMP.window.color, LAMP.window.size);
      }
    }
    for (let i = 0; i < 8; i++) {
      const z = L * (-0.24 + (i / 7) * 0.52);
      add(-B * 0.46, fb + B * 0.12, z, LAMP.deck.color, LAMP.deck.size);
      add(B * 0.46, fb + B * 0.12, z, LAMP.deck.color, LAMP.deck.size);
    }
    // Bridge wings.
    add(-B * 0.44, fb + B * 0.93, -L * 0.22, LAMP.deck.color, LAMP.deck.size);
    add(B * 0.44, fb + B * 0.93, -L * 0.22, LAMP.deck.color, LAMP.deck.size);
    return lamps;
  }

  // Everyone else: the accommodation block aft, and deck lights along the working
  // part of the ship.
  const houseZ = cls === "cargo" ? L * 0.35 : cls === "tanker" ? L * 0.37 : L * 0.1;
  for (let i = 0; i < 4; i++) {
    const y = fb + B * (0.3 + i * 0.16);
    add(-B * 0.36, y, houseZ, LAMP.window.color, LAMP.window.size);
    add(B * 0.36, y, houseZ, LAMP.window.color, LAMP.window.size);
  }
  if (cls === "cargo" || cls === "tanker") {
    for (let i = 0; i < 5; i++) {
      add(0, fb + B * 0.25, L * (-0.35 + (i / 4) * 0.55), LAMP.deck.color, LAMP.deck.size);
    }
  }
  return lamps;
}

function buildVessel(state) {
  const group = new THREE.Group();
  const { parts, length, beam, depth, fb } = buildParts(state);

  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 });
  group.add(new THREE.Mesh(merged, mat));

  const proxy = new THREE.Mesh(
    new THREE.BoxGeometry(beam * 1.6, depth + beam, length * 1.15),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  proxy.position.y = fb;
  group.add(proxy);

  const lamps = buildLamps(lampsFor(classify(state.vessel_type), length, beam, fb));
  group.add(lamps);

  group.userData.vessel = state;
  group.userData.material = mat;
  group.userData.lamps = lamps;
  group.userData.placed = false;
  group.userData.target = new THREE.Vector3();
  return group;
}

export class Vessels {
  constructor(scene) {
    this.scene = scene;
    this.groups = new Map();
  }

  pickList() {
    return Array.from(this.groups.values());
  }

  // Circles a small boat cannot drive through, at the size the ship is drawn
  // rather than its real size, so what blocks you is what you can see. Three
  // down the hull approximates it far better than one circle round the whole
  // length, which would wall off open water either side of a tanker.
  obstacles() {
    const out = [];
    for (const g of this.groups.values()) {
      const dim = (g.userData.vessel && g.userData.vessel.dimensions_m) || {};
      const s = g.scale.x || 1;
      const length = Math.max(6, dim.length || DEFAULT.length) * s;
      const r = (Math.max(2, dim.beam || DEFAULT.beam) * s) / 2;
      const fx = -Math.sin(g.rotation.y), fz = -Math.cos(g.rotation.y);
      for (const t of [-0.34, 0, 0.34]) {
        out.push({ x: g.position.x + fx * length * t, z: g.position.z + fz * length * t, r });
      }
    }
    return out;
  }

  // night: 0 in full daylight, 1 once the sun is well down.
  update(feed, tideLevel, t, camera, night = 0) {
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
      const zoom = Math.min(
        Math.max(Math.pow(dist / ZOOM_REF_M, ZOOM_POWER), 1), ZOOM_MAX);
      group.scale.setScalar(zoom);

      // Stale: grey and fade via the material (vertex colours are multiplied).
      const stale = feed.isStale(entry, "vessels");
      const mat = group.userData.material;
      if (stale !== group.userData.stale) {
        mat.color.setHex(stale ? 0x5a626c : 0xffffff);
        mat.transparent = stale;
        mat.opacity = stale ? 0.5 : 1;
        group.userData.stale = stale;
      }

      // The lights come up with the dark. A position we no longer trust does not
      // get to sit out there looking like a ship with its lights on.
      setLampLevel(group.userData.lamps, night, stale ? 0.25 : 1);
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

  // Everything the feed carries about one ship, for the card that opens when you
  // click it. The named fields are laid out and given their units, and then
  // whatever is left in the record is printed as it arrived, so a field the
  // server starts sending shows up here without anyone touching this file.
  // Position is left out: the card puts it up itself, with the range and the
  // bearing from where you are standing.
  static detail(state) {
    const rows = [];
    const seen = new Set(["latitude", "longitude"]);
    const take = (key, label, fmt) => {
      seen.add(key);
      const v = state[key];
      if (v == null || v === "") return;
      rows.push([label, fmt ? fmt(v) : String(v)]);
    };

    take("name", "name", (v) => String(v).trim() || "—");
    take("mmsi", "mmsi");
    take("imo", "imo");
    take("call_sign", "call sign");
    take("vessel_type_name", "type");
    take("vessel_type", "ais type", (v) => `${v}`);
    rows.push(["drawn as", classify(state.vessel_type)]);

    seen.add("dimensions_m");
    const dim = state.dimensions_m || {};
    const beam = dim.beam ?? dim.width;
    if (dim.length != null) rows.push(["length", `${Math.round(dim.length)} m`]);
    if (beam != null) rows.push(["beam", `${Math.round(beam)} m`]);
    if (dim.to_bow != null) rows.push(["to bow", `${Math.round(dim.to_bow)} m`]);
    if (dim.to_stern != null) rows.push(["to stern", `${Math.round(dim.to_stern)} m`]);

    take("speed_over_ground_knots", "speed", (v) => `${v.toFixed(1)} kn`);
    take("course_over_ground_degrees", "course", (v) => `${Math.round(v)}°`);
    take("true_heading_degrees", "heading", (v) => `${Math.round(v)}°`);
    take("navigation_status", "status",
      (v) => NAV_STATUS[v] || `code ${v}`);

    for (const key of Object.keys(state)) {
      if (seen.has(key)) continue;
      const v = state[key];
      if (v == null || v === "") continue;
      rows.push([key.replace(/_/g, " "), typeof v === "object" ? JSON.stringify(v) : String(v)]);
    }
    return rows;
  }
}
