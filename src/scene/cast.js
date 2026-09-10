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
import { box } from "./parts.js";

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

function shape(mode, colour) {
  const parts = [];
  if (mode === "walk" || mode === "bike") {
    parts.push(box(0.40, 0.26, 0.92, 0, 0.78, 0, colour),
               box(0.34, 0.24, 0.74, 0, 0.04, 0, 0x2f3540),
               box(0.24, 0.22, 0.24, 0, 1.70, 0, 0xb08c72));
    if (mode === "bike") {
      parts.push(box(0.10, 1.65, 0.10, 0, 0.52, 0, 0x30343a),
                 box(0.08, 0.70, 0.70, 0, 0.02, 0.62, 0x22262b),
                 box(0.08, 0.70, 0.70, 0, 0.02, -0.62, 0x22262b));
    }
  } else {
    const long = mode === "van" ? 5.3 : mode === "cart" ? 2.6 : 4.4;
    const tall = mode === "van" ? 1.9 : mode === "cart" ? 1.1 : 0.72;
    parts.push(box(1.85, long, tall, 0, 0.28, 0, colour));
    if (mode !== "van") parts.push(box(1.66, long * 0.5, 0.62, 0, 0.28 + tall, -0.1, colour));
    parts.push(box(1.74, 0.18, 0.32, 0, 0.42, long / 2 - 0.2, 0x2b2f33),
               box(1.74, 0.18, 0.32, 0, 0.42, -long / 2 + 0.2, 0x2b2f33));
  }
  const total = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const position = new Float32Array(total * 3), color = new Float32Array(total * 3);
  let at = 0;
  for (const g of parts) {
    position.set(g.attributes.position.array, at * 3);
    color.set(g.attributes.color.array, at * 3);
    at += g.attributes.position.count;
    g.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(color, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  mesh.name = `cast-${mode}`;
  return mesh;
}

