// The people in the novel's scenes, and what they do while the camera holds.
//
// The staging is in low-water.js. This builds a figure for every actor in every
// chapter and puts it where that chapter's clock says it is. Nothing here knows
// the story; it knows seconds and coordinates.
//
// The models are the ones the page already has. Nobody has a face and nobody is
// named, the same rule the cast keeps: these are invented people acting out an
// invented story, and the peninsula underneath them is the real one.

import * as THREE from "three";
import { toWorld } from "../geo.js";
import { buildWalker, mesh, box, cyl } from "./vehicles.js";
import { buildCar } from "./cast.js";
import { buildBoat } from "./boat.js";
import { DOCK_PLAN } from "./marina-dock-plan.js";
import { CHAPTERS } from "./low-water.js";

// A torch in the dark. Both night scenes turn on this: two figures on a black
// flat are nothing at all, and one moving light is the whole picture.
// It has to carry across a flat at night from a long way off, so it is brighter
// than a hand torch really is. A torch lit to life size is one dark pixel.
const LAMP_RANGE_M = 70;
const LAMP_INTENSITY = 140;
const LAMP_COLOUR = 0xffe2a8;

export function buildNovel(scene, sample) {
  const group = new THREE.Group();
  group.name = "novel";
  group.visible = false;

  const scenes = CHAPTERS.map((chapter, c) => {
    const actors = chapter.actors.map((actor, a) => {
      const figure = new THREE.Group();
      figure.name = `novel-${c + 1}-${actor.mode}-${a}`;
      figure.visible = false;
      const model = new THREE.Group();
      // Every model in this project faces -Z and every heading points along
      // travel, so each one is turned half round inside its own group.
      model.rotation.y = Math.PI;
      model.add(shape(actor.mode));
      figure.add(model);
      if (actor.lamp) figure.add(lamp());
      group.add(figure);
      // Distance along the path at each key, so a figure covers ground at the
      // pace the keys set rather than jumping between them.
      const keys = actor.keys.map(([t, lat, lon]) => {
        const w = toWorld(lat, lon);
        return { t, lat, lon, x: w.x, z: w.z };
      });
      return { figure, on: actor.on, keys, heading: 0 };
    });
    return { chapter, actors };
  });

  scene.add(group);

  return {
    group,
    get shown() { return group.visible; },
    setVisible(on) {
      group.visible = on;
      if (!on) for (const s of scenes) for (const a of s.actors) a.figure.visible = false;
    },
    // at is seconds into the chapter, water the sea level the page is drawing,
    // and dwell how long the chapter runs. An actor whose last key lands on the
    // dwell stays put to the end of it; one that ends sooner has gone inside.
    place(index, at, water, dwell) {
      if (!group.visible) return;
      for (let i = 0; i < scenes.length; i++) {
        const live = i === index;
        for (const actor of scenes[i].actors) {
          if (!live) { actor.figure.visible = false; continue; }
          const spot = along(actor.keys, at, dwell);
          if (!spot) { actor.figure.visible = false; continue; }
          actor.figure.position.set(spot.x, hold(actor.on, spot, water, sample), spot.z);
          // Standing still keeps whichever way they were last facing, or a
          // figure spins to face north the moment it stops walking.
          if (spot.heading !== null) actor.heading = spot.heading;
          actor.figure.rotation.y = actor.heading;
          actor.figure.visible = true;
        }
      }
    },
    dispose() {
      group.removeFromParent();
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      group.clear();
    },
  };
}

// What holds a figure up: the ground under it, the floating dock, or the sea.
function hold(on, spot, water, sample) {
  if (on === "float") return water + DOCK_PLAN.freeboard;
  if (on === "water") return water;
  return sample(spot.lat, spot.lon);
}

// Where an actor is at this second, or null when the scene has not reached them
// or has finished with them.
function along(keys, at, dwell) {
  const last = keys[keys.length - 1];
  if (at < keys[0].t) return null;
  if (at > last.t) {
    // Their last key is the end of the chapter, so they are still standing
    // there. Anything that stopped earlier went in through a door.
    if (last.t < dwell - 0.001) return null;
    return { x: last.x, z: last.z, lat: last.lat, lon: last.lon, heading: null };
  }
  for (let i = 1; i < keys.length; i++) {
    if (at > keys[i].t) continue;
    const a = keys[i - 1], b = keys[i];
    const span = Math.max(b.t - a.t, 1e-6);
    const k = Math.min(Math.max((at - a.t) / span, 0), 1);
    const moved = Math.hypot(b.x - a.x, b.z - a.z);
    return {
      x: a.x + (b.x - a.x) * k,
      z: a.z + (b.z - a.z) * k,
      lat: a.lat + (b.lat - a.lat) * k,
      lon: a.lon + (b.lon - a.lon) * k,
      // A leg that goes nowhere says nothing about which way they face.
      heading: moved < 0.5 ? null : Math.atan2(b.x - a.x, b.z - a.z),
    };
  }
  return null;
}

function shape(mode) {
  if (mode === "walk") return buildWalker();
  if (mode === "car") return buildCar(0x6a6f76);
  if (mode === "boat") return working();
  if (mode === "sloop") return sloop();
  throw new Error(`novel.js: there is no model for a ${mode}. `
    + `low-water.js asked for one in a chapter's actors.`);
}

// The skiff the page already has, with two aboard and a head on a tripod over
// the transom, which is what a boat running a line looks like.
function working() {
  const group = new THREE.Group();
  const boat = buildBoat();
  boat.visible = true;
  group.add(boat);
  group.add(mesh([
    box(0.34, 0.62, 0.30, -0.30, 0.50, 0.55),    // one of them at the helm
    box(0.34, 0.62, 0.30, 0.28, 0.55, -0.30),    // one of them at the rail
  ], 0x3f5468, { roughness: 0.8 }));
  group.add(mesh([
    cyl(0.05, 0.95, 0, 0.65, 1.55),              // the pole over the transom
    box(0.22, 0.18, 0.26, 0, 1.16, 1.55),        // the head on the end of it
  ], 0x40464b, { roughness: 0.6, metalness: 0.3 }));
  return group;
}

// The same hull with a stick in it. It is a boat somebody lives on, seen across
// a basin at eight in the morning, and the mast is what makes it one.
function sloop() {
  const group = new THREE.Group();
  const boat = buildBoat();
  boat.visible = true;
  group.add(boat);
  group.add(mesh([
    cyl(0.07, 9.2, 0, 4.6, -0.20),               // the mast
    box(0.09, 0.09, 3.0, 0, 1.35, 0.85),         // the boom
    box(1.30, 0.42, 1.15, 0, 0.30, -0.75),       // the coachroof
  ], 0xb9bfc4, { roughness: 0.5, metalness: 0.3 }));
  return group;
}

// A hand torch: something that glows and something that lights the ground.
function lamp() {
  const group = new THREE.Group();
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 10, 8),
    new THREE.MeshBasicMaterial({ color: LAMP_COLOUR }));
  bulb.position.set(0.32, 1.05, -0.25);
  group.add(bulb);
  const light = new THREE.PointLight(LAMP_COLOUR, LAMP_INTENSITY, LAMP_RANGE_M, 2);
  light.position.copy(bulb.position);
  group.add(light);
  return group;
}
