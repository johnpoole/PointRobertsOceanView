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
import { buildWalker, buildBicycle, buildGolfCart, mesh, box, cyl, personGeoms }
  from "./vehicles.js";

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

// Minutes since midnight where the peninsula is, not where the reader is.
export function minutesInZone(date, zone = ZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find(p => p.type === "hour").value);
  const minute = Number(parts.find(p => p.type === "minute").value);
  return hour * 60 + minute;
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
  if (mode === "walk") model.add(buildWalker());
  else if (mode === "bike") model.add(buildBicycle());
  else if (mode === "cart") model.add(buildGolfCart());
  else model.add(mode === "van" ? buildVan(colour) : buildCar(colour));
  model.name = `cast-${mode}`;
  return model;
}

// Four and a half metres of estate car: body, a cabin set into it with glass, a
// bonnet and boot, wheels on their axles, and somebody driving.
function buildCar(colour) {
  const group = new THREE.Group();
  const body = [
    box(1.78, 0.62, 4.42, 0, 0.72, 0),             // sides, sill to waist
    box(1.66, 0.30, 2.46, 0, 1.16, -0.05),         // roof band over the cabin
    box(1.72, 0.22, 1.30, 0, 0.92, -1.55),         // bonnet
    box(1.72, 0.26, 0.90, 0, 0.94, 1.75),          // boot
  ];
  const glass = [
    box(1.60, 0.44, 2.30, 0, 1.14, -0.05),         // the cabin, seen through
    box(1.52, 0.40, 0.10, 0, 1.10, -1.24),         // windscreen
    box(1.52, 0.40, 0.10, 0, 1.10, 1.16),          // rear screen
  ];
  const wheels = [];
  for (const x of [-0.80, 0.80]) for (const z of [-1.42, 1.36]) {
    wheels.push(cyl(0.33, 0.20, x, 0.33, z, "x"));
  }
  const lamps = [box(0.34, 0.16, 0.08, -0.62, 0.92, -2.18),
                 box(0.34, 0.16, 0.08, 0.62, 0.92, -2.18)];
  group.add(mesh(body, colour, { roughness: 0.55, metalness: 0.25 }));
  group.add(mesh(glass, 0x2b3a42, { roughness: 0.25, metalness: 0.1 }));
  group.add(mesh(wheels, 0x1d1f22, { roughness: 0.9 }));
  group.add(mesh(lamps, 0xe8e4d6, { roughness: 0.4 }));
  group.add(mesh(personGeoms(0.62, true), 0x3f5468));
  return group;
}

// A parcel van: a tall box behind a cab, which is what one is.
function buildVan(colour) {
  const group = new THREE.Group();
  const body = [
    box(1.94, 1.62, 3.30, 0, 1.28, 0.75),          // the box behind the cab
    box(1.86, 0.86, 1.70, 0, 0.90, -1.30),         // the cab
    box(1.90, 0.30, 0.60, 0, 0.62, -2.20),         // the nose
  ];
  const glass = [
    box(1.70, 0.52, 0.10, 0, 1.16, -2.12),         // windscreen
    box(0.10, 0.46, 0.90, -0.94, 1.14, -1.30),     // cab windows
    box(0.10, 0.46, 0.90, 0.94, 1.14, -1.30),
  ];
  const wheels = [];
  for (const x of [-0.88, 0.88]) for (const z of [-1.42, 1.62]) {
    wheels.push(cyl(0.38, 0.22, x, 0.38, z, "x"));
  }
  group.add(mesh(body, colour, { roughness: 0.7, metalness: 0.1 }));
  group.add(mesh(glass, 0x2b3a42, { roughness: 0.25 }));
  group.add(mesh(wheels, 0x1d1f22, { roughness: 0.9 }));
  group.add(mesh(personGeoms(0.86, true), 0x3f5468));
  return group;
}

