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

export function mesh(geoms, color, opts = {}) {
  return new THREE.Mesh(mergeGeometries(geoms, false), new THREE.MeshStandardMaterial({
    color, roughness: opts.roughness != null ? opts.roughness : 0.8,
    metalness: opts.metalness != null ? opts.metalness : 0.1,
  }));
}

// A colour carried in the geometry instead of in a material. Merging painted
// parts gives one mesh with many colours in it, which is how a figure gets
// boots, trousers, a coat and a face without four draw calls and four
// materials — and why every figure on the peninsula can share the one material
// below. The cost is three floats a vertex, against a figure that is a few
// hundred of them.
const PAINT = new THREE.Color();
export function paint(g, hex) {
  PAINT.setHex(hex);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = PAINT.r; c[i * 3 + 1] = PAINT.g; c[i * 3 + 2] = PAINT.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
}

// Cloth, skin and paintwork all sit in about the same place on the dial, and
// nothing here is a mirror. One material, shared, for every painted thing.
const PAINTED = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.72, metalness: 0.06,
});

export function painted(geoms) {
  return new THREE.Mesh(mergeGeometries(geoms, false), PAINTED);
}

export function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

export function cyl(r, len, x, y, z, axis = "y") {
  const g = new THREE.CylinderGeometry(r, r, len, 10);
  if (axis === "x") g.rotateZ(Math.PI / 2);
  if (axis === "z") g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

// A limb: a cylinder that tapers, with fewer sides than a wheel needs. Six is
// enough on something eleven centimetres across.
function limb(top, bottom, len, x, y, z, tilt = 0, roll = 0) {
  const g = new THREE.CylinderGeometry(top, bottom, len, 6);
  if (tilt) g.rotateX(tilt);
  if (roll) g.rotateZ(roll);
  g.translate(x, y, z);
  return g;
}

function ball(r, x, y, z, wide = 8, tall = 6) {
  const g = new THREE.SphereGeometry(r, wide, tall);
  g.translate(x, y, z);
  return g;
}

// What a person is made of. Coats vary because people do; the rest does not.
const SKIN = 0xd9b79a;
const HAIR = 0x3a2f2a;
const TROUSERS = 0x2f3742;
const BOOTS = 0x1d1f22;
const COAT = 0x3f5468;

// A figure, 1.75 m standing, in one painted mesh: boots, legs, hips, a torso
// that narrows at the waist, shoulders, arms, hands and a head. The old one was
// a cylinder, a box and a ball, which read as a bollard from any distance a
// person is usually seen at.
//
// Seated, y is the saddle or the seat: the thighs go forward, the shins drop off
// the front of them, and the arms come up to whatever is being held.
export function personGeoms(y = 0, seated = false, coat = COAT) {
  const g = [];
  let hip, shoulder;
  if (seated) {
    hip = y + 0.10;
    g.push(paint(limb(0.10, 0.10, 0.46, -0.11, y + 0.10, -0.20, Math.PI / 2), TROUSERS));
    g.push(paint(limb(0.10, 0.10, 0.46, 0.11, y + 0.10, -0.20, Math.PI / 2), TROUSERS));
    g.push(paint(limb(0.075, 0.065, 0.40, -0.11, y - 0.12, -0.40), TROUSERS));
    g.push(paint(limb(0.075, 0.065, 0.40, 0.11, y - 0.12, -0.40), TROUSERS));
    g.push(paint(box(0.11, 0.07, 0.25, -0.11, y - 0.35, -0.48), BOOTS));
    g.push(paint(box(0.11, 0.07, 0.25, 0.11, y - 0.35, -0.48), BOOTS));
    shoulder = hip + 0.52;
  } else {
    hip = y + 0.92;
    g.push(paint(box(0.115, 0.065, 0.27, -0.10, y + 0.033, -0.03), BOOTS));
    g.push(paint(box(0.115, 0.065, 0.27, 0.10, y + 0.033, -0.03), BOOTS));
    g.push(paint(limb(0.070, 0.055, 0.42, -0.10, y + 0.27, 0), TROUSERS));
    g.push(paint(limb(0.070, 0.055, 0.42, 0.10, y + 0.27, 0), TROUSERS));
    g.push(paint(limb(0.090, 0.072, 0.44, -0.10, y + 0.70, 0), TROUSERS));
    g.push(paint(limb(0.090, 0.072, 0.44, 0.10, y + 0.70, 0), TROUSERS));
    shoulder = hip + 0.51;
  }
  g.push(paint(box(0.33, 0.17, 0.22, 0, hip + 0.02, 0), TROUSERS));      // hips
  g.push(paint(box(0.31, 0.22, 0.21, 0, hip + 0.20, 0), coat));          // waist
  g.push(paint(box(0.40, 0.28, 0.24, 0, hip + 0.42, 0), coat));          // chest
  g.push(paint(cyl(0.085, 0.40, 0, shoulder, 0, "x"), coat));            // shoulders
  // Arms, forward a little when seated because there is a wheel or a tiller in
  // front of them, and down at the side when there is not.
  const reach = seated ? -0.22 : 0;
  const drop = seated ? 0.10 : 0;
  for (const side of [-1, 1]) {
    g.push(paint(limb(0.058, 0.050, 0.32, side * 0.235, shoulder - 0.17,
      reach * 0.4), coat));
    g.push(paint(limb(0.050, 0.044, 0.30, side * 0.245, shoulder - 0.44 + drop,
      reach), coat));
    g.push(paint(ball(0.052, side * 0.25, shoulder - 0.60 + drop * 1.6,
      reach * 1.35, 6, 5), SKIN));
  }
  g.push(paint(cyl(0.052, 0.09, 0, shoulder + 0.10, 0), SKIN));          // neck
  g.push(paint(ball(0.105, 0, shoulder + 0.24, 0.005, 9, 7), SKIN));     // head
  g.push(paint(ball(0.108, 0, shoulder + 0.27, -0.015, 8, 5), HAIR));    // hair
  return g;
}

// A pace, and how far a leg and an arm swing at one. Measured off a walk: a
// 1.75 m person covers about three quarters of a metre a step and the thigh
// comes forward twenty-five degrees or so.
const STRIDE_M = 0.76;
const SWING_LEG = 0.44;
const SWING_ARM = 0.30;
const BOB_M = 0.022;       // the body rises on each pace and drops between
// The knee folds on the leg that is coming forward, so the foot clears the
// ground, and is straight again by the time the heel lands. It does nothing on
// the leg that is behind you, which is carrying your weight.
const KNEE = 0.95;
const KNEE_SHAPE = 1.4;    // how sharply the fold builds and lets go

// A walking figure. The core is one mesh and each leg and arm is its own, hung
// at the hip or the shoulder so it swings about that point: five meshes for
// something that would otherwise slide along the ground with its feet together.
//
// Call stride() with how far it has walked in total. The cycle runs off the
// ground covered and not off a clock, so a figure that stops has its feet still
// and one that is being watched from a slow machine does not moonwalk.
export function buildWalker(coat = COAT) {
  const group = new THREE.Group();
  const hip = 0.92, shoulder = 1.43;
  group.add(painted([
    paint(box(0.33, 0.17, 0.22, 0, hip + 0.02, 0), TROUSERS),
    paint(box(0.31, 0.22, 0.21, 0, hip + 0.20, 0), coat),
    paint(box(0.40, 0.28, 0.24, 0, hip + 0.42, 0), coat),
    paint(cyl(0.085, 0.40, 0, shoulder, 0, "x"), coat),
    paint(cyl(0.052, 0.09, 0, shoulder + 0.10, 0), SKIN),
    paint(ball(0.105, 0, shoulder + 0.24, 0.005, 9, 7), SKIN),
    paint(ball(0.108, 0, shoulder + 0.27, -0.015, 8, 5), HAIR),
  ]));

  // Each limb is built about its own joint, so rotating the mesh swings it, and
  // the shin hangs off the thigh at the knee so it swings with the thigh and
  // folds under it as well.
  const thighs = [], shins = [], arms = [];
  for (const side of [-1, 1]) {
    const thigh = painted([
      paint(limb(0.090, 0.072, 0.44, 0, -0.22, 0), TROUSERS),
    ]);
    thigh.position.set(side * 0.10, hip, 0);
    const shin = painted([
      paint(limb(0.070, 0.055, 0.42, 0, -0.21, 0), TROUSERS),
      paint(box(0.115, 0.065, 0.27, 0, -0.447, -0.03), BOOTS),
    ]);
    shin.position.set(0, -0.44, 0);       // the knee
    thigh.add(shin);
    group.add(thigh);
    thighs.push(thigh);
    shins.push(shin);

    const arm = painted([
      paint(limb(0.058, 0.050, 0.32, 0, -0.17, 0), coat),
      paint(limb(0.050, 0.044, 0.30, 0, -0.44, 0), coat),
      paint(ball(0.052, 0, -0.60, 0, 6, 5), SKIN),
    ]);
    arm.position.set(side * 0.235, shoulder, 0);
    group.add(arm);
    arms.push(arm);
  }

  group.stride = (metres) => {
    // Half a cycle is one pace, so the legs trade places every stride.
    const phase = (metres / STRIDE_M) * Math.PI;
    const swing = Math.sin(phase);
    const rate = Math.cos(phase);          // which way the leg is going
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      // The leg is coming forward while its own angle is rising, and that is
      // the half of the cycle the knee folds in. It was the other way round,
      // which folded the knee on the leg carrying the weight and walked like a
      // limp.
      thighs[i].rotation.x = side * swing * SWING_LEG;
      const coming = Math.max(0, side * rate);
      shins[i].rotation.x = KNEE * Math.pow(coming, KNEE_SHAPE);
      // Arms go the other way to the leg on their own side, which is what a
      // body does and what stops a walk looking like a march.
      arms[i].rotation.x = -side * swing * SWING_ARM;
    }
    group.position.y = Math.abs(swing) * BOB_M;
  };
  return group;
}

// Tyres, glass and the chrome-ish bits, shared by everything with wheels.
const RUBBER = 0x1d1f22;
const RIM = 0x9aa1a6;
const GLASS = 0x2b3a42;
const TRIM = 0x40464b;

// A wheel: a tyre with a rim showing in the middle of it, which is most of what
// tells a wheel from a black cylinder.
function wheel(r, width, x, y, z) {
  return [
    paint(cyl(r, width, x, y, z, "x"), RUBBER),
    paint(cyl(r * 0.56, width * 1.04, x, y, z, "x"), RIM),
  ];
}

export function buildBicycle(coat = COAT) {
  const group = new THREE.Group();
  const R = 0.34;
  const g = [];
  for (const t of [
    cyl(0.032, 0.62, 0, R + 0.34, -0.12, "z"),     // top tube
    cyl(0.032, 0.66, 0, R + 0.16, -0.10, "z"),     // down tube, under it
    cyl(0.028, 0.46, 0, R + 0.30, -0.40),          // head tube
    cyl(0.028, 0.50, 0, R + 0.20, 0.22),           // seat tube
    cyl(0.022, 0.52, 0, R + 0.06, 0.38, "z"),      // chain stays
    cyl(0.022, 0.48, 0, R + 0.26, 0.40),           // seat stays
  ]) g.push(paint(t, 0x8d3b3b));
  g.push(paint(cyl(0.022, 0.44, 0, R + 0.54, -0.44, "x"), TRIM));   // bars
  g.push(paint(box(0.06, 0.05, 0.24, 0, R + 0.46, 0.28), TRIM));    // saddle
  g.push(paint(cyl(0.09, 0.03, 0, R - 0.02, 0.02, "x"), TRIM));     // chainring
  for (const z of [-0.52, 0.52]) {
    const t = new THREE.TorusGeometry(R, 0.026, 5, 16);
    t.translate(0, R, z);
    g.push(paint(t, RUBBER));
    // Spokes, as a disc too thin to see edge on and enough to fill a wheel.
    const d = new THREE.CylinderGeometry(R - 0.04, R - 0.04, 0.006, 12);
    d.rotateZ(Math.PI / 2);
    d.translate(0, R, z);
    g.push(paint(d, 0xb9bfc4));
  }
  g.push(...personGeoms(R + 0.34, true, coat));
  group.add(painted(g));
  return group;
}

export function buildGolfCart(coat = COAT, shell = 0xdfe3e0) {
  const group = new THREE.Group();
  const g = [];
  for (const b of [
    box(1.22, 0.30, 1.05, 0, 0.46, 0.45),          // tub, behind the seat
    box(1.22, 0.22, 1.10, 0, 0.40, -0.62),         // floor pan and nose
    box(1.18, 0.10, 0.62, 0, 0.64, -0.08),         // seat base
    box(1.18, 0.44, 0.12, 0, 0.90, 0.26),          // seat back
    box(1.16, 0.05, 1.34, 0, 1.82, -0.12),         // roof
    box(1.10, 0.26, 0.06, 0, 0.86, -1.12),         // dash
    box(1.14, 0.34, 0.05, 0, 1.45, -0.78),         // windscreen frame, top rail
  ]) g.push(paint(b, shell));
  g.push(paint(box(1.06, 0.52, 0.02, 0, 1.16, -0.78), GLASS));      // screen
  for (const x of [-0.54, 0.54]) for (const z of [-0.76, 0.74]) {
    g.push(paint(cyl(0.028, 1.26, x, 1.19, z), TRIM));              // roof posts
  }
  // A wheel and a tiller are what say this is driven rather than parked.
  const w = new THREE.TorusGeometry(0.16, 0.018, 4, 12);
  w.rotateX(-1.15);
  w.translate(0, 1.06, -0.92);
  g.push(paint(w, TRIM));
  g.push(paint(box(0.86, 0.05, 0.44, 0, 1.18, 0.72), TRIM));        // bag rack
  for (const x of [-0.58, 0.58]) for (const z of [-0.78, 0.76]) {
    g.push(...wheel(0.28, 0.16, x, 0.28, z));
  }
  g.push(...personGeoms(0.68, true, coat));
  group.add(painted(g));
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
  group.add(painted(personGeoms(0.55, true)));
  return group;
}

// medium: where it can be. land keeps to dry ground, air goes anywhere above it,
// water is the boat's, handled separately because it has real hydrodynamics.
//
// eye is the driver's head in the vehicle's own frame, +Z aft.
// turn is degrees a second at full lock; pivot means it can turn standing still.
// reverse is how fast it will go backwards, absent where the real thing cannot:
// a cart has a reverse gear and you can back up on your feet, a bicycle and an
// aircraft have neither.
// start is where you get in, off OpenStreetMap: the golf club, the community
// centre, the border, the apron at 1RL.
export const VEHICLES = [
  {
    id: "walk", label: "walking", medium: "land", build: buildWalker,
    maxSpeed: 1.4, accelTau: 0.5, decelTau: 0.4,     // 5 km/h
    turn: 150, pivot: true, reverse: 0.9, eye: { y: 1.63, z: 0 },
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
    turn: 55, pivot: false, reverse: 8 * KMH, eye: { y: 1.40, z: -0.05 },
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
//
// The house on the bluff, not the marina. _launchSpot searches outward from here
// for water deep enough to float in, which puts the boat at the foot of the
// bluff about 60 m off, where it used to launch from before the modes existed.
export const BOAT_START = { lat: 48.989009, lon: -123.085318 };

export function vehicleById(id) {
  return VEHICLES.find((v) => v.id === id) || null;
}
