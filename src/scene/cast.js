// The cast: figures that keep the peninsula's own opening hours.
//
// These people are invented. What is not invented is what they are hung on: the
// places are the peninsula's own, the routes are Dijkstra over the road network,
// and the hours are the published ones wherever a business publishes them. Which
// of them keep published hours and which are assumed is recorded in the bake and
// in CONTINUE-cast.md, not written over their heads.
//
// Nobody has a name. They are the job: the postmaster, the parcel driver, the
// librarian. Inventing residents of a small town and putting them on a map of it
// is not something this project does.
//
// Off until it is asked for, the same as the courts on T.

import * as THREE from "three";
import { CAST } from "../config.js";
import { toWorld } from "../geo.js";
import { buildWalker, buildBicycle, buildGolfCart, painted, paint, box, cyl,
  personGeoms } from "./vehicles.js";

// Point Roberts keeps its own clock whoever is looking, so a visitor in Berlin
// sees the post office open at half eight in the morning there, not here.
const ZONE = "America/Vancouver";

const COLOURS = [0x4a6fa5, 0x8c5a3c, 0x4f7a55, 0x8a4f6d, 0x5c6b8a, 0x7d6a3f,
                 0x53707d, 0x8a5a4a, 0x46655c, 0x6a5b7d, 0xa0512f];

// Past this a figure is two pixels and not worth the draw.
const SEEN_M = 1400;

let castPromise = null;
export function castData() {
  if (!castPromise) castPromise = fetch(CAST).then((r) => {
    if (!r.ok) throw new Error(`${CAST} returned ${r.status} ${r.statusText}`);
    return r.json();
  });
  return castPromise;
}

export async function buildCast(scene, sample) {
  const data = await castData();
  const group = new THREE.Group();
  group.name = "cast";
  group.visible = false;

  const ground = (lat, lon) => sample(lat, lon);
  // Made once and reused every frame rather than thirteen times a frame.
  const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4(),
    sphere = new THREE.Sphere(new THREE.Vector3(), 2.4);
  const people = data.cast.map((person, i) => {
    const colour = COLOURS[i % COLOURS.length];
    const figure = new THREE.Group();
    figure.name = `cast-${person.role.replace(/\s+/g, "-")}`;
    figure.add(shape(person.mode, colour));
    figure.visible = false;
    group.add(figure);
    // Where each leg starts in the day, and how long it takes at their pace.
    const legs = person.legs.map(leg => ({
      start: minutesOf(leg.depart),
      end: minutesOf(leg.depart) + leg.minutes,
      path: leg.path.map(([lat, lon]) => {
        const w = toWorld(lat, lon);
        return { x: w.x, z: w.z, lat, lon };
      }),
      lengths: null,
    }));
    for (const leg of legs) {
      let run = 0;
      leg.lengths = leg.path.map((p, j) => {
        if (j > 0) run += Math.hypot(p.x - leg.path[j - 1].x, p.z - leg.path[j - 1].z);
        return run;
      });
      leg.total = run;
    }
    return { figure, legs };
  });

  scene.add(group);

  return {
    group,
    count: people.length,
    get shown() { return group.visible; },
    toggle() { group.visible = !group.visible; return group.visible; },
    // now is a Date; the page hands in the clock it is standing at, so moving
    // the sun moves the town with it.
    //
    // Somebody four kilometres behind you costs a draw for nothing, so a figure
    // is only put on the screen when it is in front of whoever is looking and
    // near enough to see.
    update(now, camera) {
      if (!group.visible) return;
      const minutes = minutesInZone(now);
      if (camera) {
        camera.updateMatrixWorld();
        matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(matrix);
      }
      for (const { figure, legs } of people) {
        const at = placeAt(legs, minutes);
        if (!at) { figure.visible = false; continue; }
        const y = ground(at.lat, at.lon);
        figure.position.set(at.x, y, at.z);
        if (at.heading !== null) figure.rotation.y = at.heading;
        if (camera) {
          sphere.center.set(at.x, y + 1, at.z);
          const range = camera.position.distanceTo(sphere.center);
          figure.visible = range <= SEEN_M && frustum.intersectsSphere(sphere);
        } else {
          figure.visible = true;
        }
      }
    },
    dispose() {
      group.removeFromParent();
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.map) o.material.map.dispose();
        if (o.material) o.material.dispose();
      });
      group.clear();
    },
  };
}

// Where somebody is at this minute of the day, or null when their day has not
// started or is over. Standing still between legs is where they work.
function placeAt(legs, minutes) {
  if (!legs.length || minutes < legs[0].start) return null;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (minutes < leg.start) {
      // Between legs: standing where the last one put them.
      const before = legs[i - 1];
      const last = before.path[before.path.length - 1];
      return { x: last.x, z: last.z, lat: last.lat, lon: last.lon, heading: null };
    }
    if (minutes <= leg.end) {
      const along = leg.total * (minutes - leg.start) / Math.max(leg.end - leg.start, 1e-6);
      return walk(leg, along);
    }
  }
  return null;
}

function walk(leg, along) {
  const { path, lengths } = leg;
  let i = 1;
  while (i < lengths.length - 1 && lengths[i] < along) i++;
  const a = path[i - 1], b = path[i];
  const span = Math.max(lengths[i] - lengths[i - 1], 1e-6);
  const t = Math.min(Math.max((along - lengths[i - 1]) / span, 0), 1);
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t,
    heading: Math.atan2(b.x - a.x, b.z - a.z),
  };
}

// Minutes since midnight where the peninsula is, not where the reader is, and
// carrying the seconds. Whole minutes held a cart still for sixty seconds and
// then moved it three hundred metres, which reads as a thing that does not move
// rather than a thing that does.
export function minutesInZone(date, zone = ZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(date);
  const at = (type) => Number(parts.find(p => p.type === type).value);
  return at("hour") * 60 + at("minute") + at("second") / 60
    + (date.getMilliseconds() % 1000) / 60000;
}

export function minutesOf(clock) {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

// The models the rest of the page already uses: a walker with legs and a head, a
// bicycle with wheels, a golf cart with a roof and somebody sitting in it. Only
// the car and the van are new, because neither is something you can drive here.
//
// Those models face -Z, which is forward everywhere else in this project, and
// the cast's heading points along travel, so each one is turned half round
// inside its own group and the heading is left alone.
function shape(mode, colour) {
  const model = new THREE.Group();
  model.rotation.y = Math.PI;
  if (mode === "walk") model.add(buildWalker(colour));
  else if (mode === "bike") model.add(buildBicycle(colour));
  else if (mode === "cart") model.add(buildGolfCart(colour));
  else model.add(mode === "van" ? buildVan(colour) : buildCar(colour));
  model.name = `cast-${mode}`;
  return model;
}
const RUBBER = 0x1d1f22;
const RIM = 0x9aa1a6;
const GLASS = 0x2b3a42;
const LAMP = 0xe8e4d6;
const DARK = 0x2a2d30;

// A wheel in an arch. The arch is most of what stops a car reading as a brick
// with discs stuck to the side of it.
function road(colour, r, width, x, y, z) {
  return [
    paint(cyl(r, width, x, y, z, "x"), RUBBER),
    paint(cyl(r * 0.55, width * 1.04, x, y, z, "x"), RIM),
    paint(box(0.10, r * 1.1, r * 2.3, x + Math.sign(x) * 0.03, y + 0.16, z), colour),
  ];
}

// Four and a half metres of estate car, in one mesh: a sill and a body side, a
// roof set in narrower than the body with glass under it, a bonnet and a boot
// stepping down off it, wheels in arches, bumpers, lamps, a grille and mirrors.
// The old one was four boxes and a windscreen and read as a brick.
export function buildCar(colour) {
  const group = new THREE.Group();
  const g = [];
  for (const b of [
    box(1.80, 0.34, 4.30, 0, 0.50, 0),             // sill and lower body
    box(1.76, 0.34, 4.10, 0, 0.82, 0),             // body side, up to the waist
    box(1.60, 0.30, 2.10, 0, 1.18, 0.10),          // roof, narrower than the body
    box(1.70, 0.16, 1.34, 0, 0.96, -1.52),         // bonnet
    box(1.70, 0.18, 0.86, 0, 0.99, 1.74),          // boot lid
    box(1.66, 0.14, 0.22, 0, 1.06, -1.02),         // scuttle under the screen
  ]) g.push(paint(b, colour));
  for (const b of [
    box(1.62, 0.36, 1.96, 0, 1.16, 0.10),          // side glass
    box(1.54, 0.40, 0.34, 0, 1.12, -1.02),         // windscreen
    box(1.52, 0.36, 0.24, 0, 1.14, 1.26),          // rear screen
  ]) g.push(paint(b, GLASS));
  for (const b of [
    box(1.78, 0.16, 0.22, 0, 0.46, -2.16),         // bumpers
    box(1.78, 0.16, 0.22, 0, 0.48, 2.10),
    box(1.10, 0.18, 0.10, 0, 0.78, -2.16),         // grille
  ]) g.push(paint(b, DARK));
  for (const x of [-0.62, 0.62]) {
    g.push(paint(box(0.36, 0.14, 0.10, x, 0.92, -2.14), LAMP));
    g.push(paint(box(0.30, 0.14, 0.10, x, 0.94, 2.08), 0x8c2f2f));
    g.push(paint(box(0.16, 0.10, 0.06, x * 1.55, 1.04, -0.92), colour));
  }
  for (const x of [-0.82, 0.82]) for (const z of [-1.40, 1.36]) {
    g.push(...road(colour, 0.32, 0.20, x, 0.34, z));
  }
  g.push(...personGeoms(0.66, true));
  group.add(painted(g));
  return group;
}

// A parcel van: a tall box behind a cab, which is what one is, with the roll-up
// door at the back and the step under it.
function buildVan(colour) {
  const group = new THREE.Group();
  const g = [];
  for (const b of [
    box(1.96, 1.70, 3.20, 0, 1.32, 0.80),          // the box behind the cab
    box(1.88, 0.94, 1.74, 0, 0.94, -1.28),         // the cab
    box(1.90, 0.26, 0.66, 0, 0.66, -2.18),         // the nose
    box(1.92, 0.06, 3.26, 0, 2.20, 0.80),          // roof cap
  ]) g.push(paint(b, colour));
  for (const b of [
    box(1.72, 0.56, 0.16, 0, 1.24, -2.08),         // windscreen
    box(0.10, 0.48, 0.92, -0.95, 1.22, -1.28),     // cab windows
    box(0.10, 0.48, 0.92, 0.95, 1.22, -1.28),
  ]) g.push(paint(b, GLASS));
  for (const b of [
    box(1.84, 1.46, 0.06, 0, 1.28, 2.42),          // the door at the back
    box(1.60, 0.14, 0.30, 0, 0.44, 2.46),          // the step under it
    box(1.86, 0.16, 0.20, 0, 0.50, -2.42),         // front bumper
  ]) g.push(paint(b, DARK));
  for (const x of [-0.64, 0.64]) {
    g.push(paint(box(0.30, 0.16, 0.10, x, 0.90, -2.44), LAMP));
  }
  for (const x of [-0.90, 0.90]) for (const z of [-1.40, 1.60]) {
    g.push(...road(colour, 0.37, 0.22, x, 0.38, z));
  }
  g.push(...personGeoms(0.90, true));
  group.add(painted(g));
  return group;
}
