// The ways you can be in Point Roberts, besides the boat.
//
// Each one is a world object rather than a first-person prop: it exists where it
// stands so another player can see it, and the camera sits at that vehicle's own
// eye height. Forward is -Z, matching the geo transform and the boat.
//
// Speeds are what the real thing does. A golf cart is governed near 24 km/h and
// half of Point Roberts gets about on them; an ultralight off 1RL cruises near
// 90 km/h and stalls around 47, so it cannot be flown slower than that and stay
// up. Walking and cycling are what they are.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const KMH = 1 / 3.6;

function mesh(geoms, color, opts = {}) {
  return new THREE.Mesh(mergeGeometries(geoms, false), new THREE.MeshStandardMaterial({
    color, roughness: opts.roughness != null ? opts.roughness : 0.8,
    metalness: opts.metalness != null ? opts.metalness : 0.1,
  }));
}

function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function cyl(r, len, x, y, z, axis = "y") {
  const g = new THREE.CylinderGeometry(r, r, len, 10);
  if (axis === "x") g.rotateZ(Math.PI / 2);
  if (axis === "z") g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

// A figure, 1.75 m standing. Seated, y is the saddle or seat and the legs go
// forward out of the way, so the head sits 0.90 m above it rather than a whole
// standing body's worth.
function personGeoms(y = 0, seated = false) {
  const g = [];
  let hip = y;
  if (seated) {
    g.push(cyl(0.14, 0.52, 0, y + 0.02, -0.28, "z"));          // thighs, forward
  } else {
    hip = y + 0.85;
    g.push(cyl(0.15, 0.85, 0, y + 0.425, 0));                  // legs
  }
  g.push(box(0.42, 0.58, 0.24, 0, hip + 0.29, 0));             // torso
  g.push(cyl(0.11, 0.12, 0, hip + 0.64, 0));                   // neck
  const head = new THREE.SphereGeometry(0.115, 10, 8);
  head.translate(0, hip + 0.78, 0);
  g.push(head);
  return g;
}

function buildWalker() {
  const group = new THREE.Group();
  group.add(mesh(personGeoms(0), 0x3f5468));
  return group;
}

function buildBicycle() {
  const group = new THREE.Group();
  const R = 0.34;
  const frame = [
    cyl(0.035, 0.98, 0, R + 0.28, 0, "z"),         // top tube, along the bike
    cyl(0.03, 0.42, 0, R + 0.30, -0.42),           // head tube area
    cyl(0.03, 0.50, 0, R + 0.18, 0.30),            // seat tube
    cyl(0.025, 0.46, 0, R + 0.52, -0.44, "x"),     // handlebars
  ];
  const wheels = [];
  for (const z of [-0.52, 0.52]) {
    const t = new THREE.TorusGeometry(R, 0.028, 6, 20);
    t.translate(0, R, z);
    wheels.push(t);
  }
  group.add(mesh(frame, 0x8d3b3b, { metalness: 0.4, roughness: 0.5 }));
  group.add(mesh(wheels, 0x1d1f22, { roughness: 0.9 }));
  group.add(mesh(personGeoms(R + 0.34, true), 0x3f5468));
  return group;
}

function buildGolfCart() {
  const group = new THREE.Group();
  const body = [
    box(1.20, 0.38, 2.20, 0, 0.42, 0),             // tub
    box(1.16, 0.46, 0.10, 0, 0.85, 0.42),          // seat back
    box(1.10, 0.06, 0.60, 0, 0.62, -0.10),         // seat base
    box(1.16, 0.05, 1.30, 0, 1.86, -0.10),         // roof
  ];
  for (const x of [-0.52, 0.52]) for (const z of [-0.72, 0.72]) {
    body.push(cyl(0.03, 1.30, x, 1.22, z));        // roof posts
  }
  const wheels = [];
  for (const x of [-0.58, 0.58]) for (const z of [-0.76, 0.78]) {
    wheels.push(cyl(0.29, 0.16, x, 0.29, z, "x"));
  }
  group.add(mesh(body, 0xdfe3e0, { roughness: 0.6 }));
  group.add(mesh(wheels, 0x1d1f22, { roughness: 0.9 }));
  group.add(mesh(personGeoms(0.62, true), 0x3f5468));
  return group;
}

function buildUltralight() {
  const group = new THREE.Group();
  const wing = [
    box(9.20, 0.10, 1.45, 0, 1.62, -0.10),         // wing
    box(0.10, 0.55, 0.30, -1.05, 1.35, -0.10),     // struts
    box(0.10, 0.55, 0.30, 1.05, 1.35, -0.10),
  ];
  const airframe = [
    box(0.72, 0.78, 1.70, 0, 0.92, -0.35),         // pod
    cyl(0.07, 3.20, 0, 1.20, 1.45, "z"),           // tail boom
    box(2.60, 0.06, 0.50, 0, 1.20, 2.90),          // tailplane
    box(0.06, 0.85, 0.55, 0, 1.55, 2.95),          // fin
  ];
  const gear = [
    cyl(0.035, 1.30, 0, 0.42, 0.10, "x"),
    cyl(0.20, 0.10, -0.65, 0.20, 0.10, "x"),
    cyl(0.20, 0.10, 0.65, 0.20, 0.10, "x"),
    cyl(0.18, 0.09, 0, 0.18, -1.05, "x"),
  ];
  const prop = new THREE.CircleGeometry(0.62, 16);
  prop.rotateY(Math.PI / 2);
  prop.translate(0, 1.05, 0.62);
  group.add(mesh(wing, 0xe8e2d2, { roughness: 0.7 }));
  group.add(mesh(airframe, 0x6f7d88, { roughness: 0.6, metalness: 0.3 }));
  group.add(mesh(gear, 0x2a2d30, { roughness: 0.9 }));
  group.add(new THREE.Mesh(prop, new THREE.MeshStandardMaterial({
    color: 0x9aa0a6, transparent: true, opacity: 0.25, side: THREE.DoubleSide,
  })));
  group.add(mesh(personGeoms(0.55, true), 0x3f5468));
  return group;
}

// medium: where it can be. land keeps to dry ground, air goes anywhere above it,
// water is the boat's, handled separately because it has real hydrodynamics.
//
// eye is the driver's head in the vehicle's own frame, +Z aft.
// turn is degrees a second at full lock; pivot means it can turn standing still.
// start is where you get in, off OpenStreetMap: the golf club, the community
// centre, the border, the apron at 1RL.
export const VEHICLES = [
  {
    id: "walk", label: "walking", medium: "land", build: buildWalker,
    maxSpeed: 1.4, accelTau: 0.5, decelTau: 0.4,     // 5 km/h
    turn: 150, pivot: true, eye: { y: 1.63, z: 0 },
    start: { lat: 48.984425, lon: -123.076809 },   // the community centre
  },
  {
    id: "bike", label: "bicycle", medium: "land", build: buildBicycle,
    maxSpeed: 5.0, accelTau: 3.0, decelTau: 2.0,     // 18 km/h
    turn: 70, pivot: false, eye: { y: 1.48, z: 0.18 },
    // The port of entry is at 49.00133, past the north edge of the fine terrain,
    // so this sits on the same road 229 m short of the line — as close to the
    // border as there is ground worth standing on.
    start: { lat: 48.999900, lon: -123.068427 },
  },
  {
    id: "cart", label: "golf cart", medium: "land", build: buildGolfCart,
    maxSpeed: 24 * KMH, accelTau: 2.4, decelTau: 1.4,
    turn: 55, pivot: false, eye: { y: 1.40, z: -0.05 },
    start: { lat: 48.996920, lon: -123.078049 },   // Bald Eagle Golf Club
  },
  {
    id: "ultralight", label: "ultra light", medium: "air", build: buildUltralight,
    maxSpeed: 90 * KMH, stallSpeed: 47 * KMH, accelTau: 4.0, decelTau: 5.0,
    turn: 28, pivot: false, bank: 28, climb: 3.5, eye: { y: 1.28, z: -0.55 },
    // Over the apron at 1RL, already up, since there is no ground roll.
    start: { lat: 48.978710, lon: -123.080091 },
  },
];

// The boat is not one of these — it has its own step — but it starts somewhere
// too, and this is where the starting places live.
export const BOAT_START = { lat: 48.978152, lon: -123.066585 };  // Point Roberts Marina

export function vehicleById(id) {
  return VEHICLES.find((v) => v.id === id) || null;
}
