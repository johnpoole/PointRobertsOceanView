// What a call looked like, as far as the record actually says.
//
// The Sheriff's log gives a street, a time to the second, what the call was
// called, who took it and how it was closed. It does not say what happened. So
// this plays the part every row supports and no more: a car comes down the road
// at the hour it came, stops, a deputy gets out and attends, gets back in, and
// the car goes. Nothing here acts out the nature of the call, because the
// record does not carry it.
//
// The camera swings round the stop the way the chase does, because a car
// arriving somewhere is a thing you watch from the side.

import * as THREE from "three";
import { fromWorld } from "../geo.js";
import { painted, paint, buildWalker, box } from "./vehicles.js";
import { buildCar } from "./cast.js";

// The beats, in seconds from the start. The whole thing is BEATS.done long.
const BEATS = {
  approach: 0,      // the car is a long way down the road
  arrive: 9,        // it stops
  out: 12,          // the deputy is beside it
  at: 18,           // standing where the call came from
  back: 26,         // walking to the car
  in: 30,           // in it
  away: 33,         // pulling out
  done: 38,
};
const APPROACH_M = 120;     // how far back down the road it comes from
const ARC_RADIUS = 24;
const ARC_HEIGHT = 7.5;
const ARC_FROM = 215;
const ARC_SWEEP = 130;

export function buildRecreation(scene, sample) {
  const group = new THREE.Group();
  group.name = "recreation";
  group.visible = false;
  scene.add(group);

  const car = new THREE.Group();
  car.rotation.y = Math.PI;          // the models face -Z and headings point along travel
  car.add(patrolCar());
  const carAt = new THREE.Group();
  carAt.add(car);
  carAt.visible = false;
  group.add(carAt);

  const walker = buildWalker(0x2b3a52);
  const figure = new THREE.Group();
  figure.rotation.y = Math.PI;
  figure.add(walker);
  const figureAt = new THREE.Group();
  figureAt.add(figure);
  figureAt.visible = false;
  group.add(figureAt);

  let scene_ = null;     // the call being played, and its marks
  let walked = 0, was = null;

  return {
    group,
    get playing() { return scene_ !== null; },
    get call() { return scene_ ? scene_.call : null; },
    get length() { return BEATS.done; },

    // spot is where the marker stands: x, z, and the heading of its road.
    play(call, spot) {
      const road = spot.heading;
      // Down the road, out of sight, to the kerb beside the call.
      const from = {
        x: spot.x - Math.sin(road) * APPROACH_M,
        z: spot.z - Math.cos(road) * APPROACH_M,
      };
      const past = {
        x: spot.x + Math.sin(road) * APPROACH_M,
        z: spot.z + Math.cos(road) * APPROACH_M,
      };
      // The car stops on the carriageway, which is off the verge the marker is
      // standing in.
      const kerb = {
        x: spot.x - Math.cos(road) * 3.0,
        z: spot.z + Math.sin(road) * 3.0,
      };
      scene_ = { call, spot, road, from, past, kerb };
      walked = 0;
      was = null;
      group.visible = true;
      return BEATS.done;
    },

    stop() {
      scene_ = null;
      group.visible = false;
      carAt.visible = false;
      figureAt.visible = false;
    },

    // at is seconds into the recreation. Returns where the camera should be.
    update(at) {
      if (!scene_) return null;
      const { spot, road, from, past, kerb } = scene_;

      // ---- the car ----------------------------------------------------------
      let where = null;
      if (at < BEATS.arrive) {
        where = lerp(from, kerb, ease(at / BEATS.arrive));
      } else if (at < BEATS.away) {
        where = kerb;
      } else if (at < BEATS.done) {
        where = lerp(kerb, past, ease((at - BEATS.away) / (BEATS.done - BEATS.away)));
      }
      if (where) {
        carAt.visible = true;
        carAt.position.set(where.x, sample(...at2(where)), where.z);
        carAt.rotation.y = road;
      } else {
        carAt.visible = false;
      }

      // ---- the deputy -------------------------------------------------------
      let stand = null;
      if (at >= BEATS.out && at < BEATS.in) {
        if (at < BEATS.at) {
          stand = lerp(kerb, spot, (at - BEATS.out) / (BEATS.at - BEATS.out));
        } else if (at < BEATS.back) {
          stand = spot;
        } else {
          stand = lerp(spot, kerb, (at - BEATS.back) / (BEATS.in - BEATS.back));
        }
      }
      if (stand) {
        figureAt.visible = true;
        const prev = was;
        const step = prev ? Math.hypot(stand.x - prev.x, stand.z - prev.z) : 0;
        // The walk cycle runs off ground covered, the same as everybody else's.
        if (step < 4) walked += step;
        if (prev && step > 0.01) {
          figureAt.rotation.y = Math.atan2(stand.x - prev.x, stand.z - prev.z);
        }
        was = { x: stand.x, z: stand.z };
        figureAt.position.set(stand.x, sample(...at2(stand)), stand.z);
        if (walker.stride) walker.stride(walked);
      } else {
        figureAt.visible = false;
        was = null;
      }

      // ---- the camera -------------------------------------------------------
      const turn = (ARC_FROM + ARC_SWEEP * (at / BEATS.done)) * Math.PI / 180;
      const ground = sample(...at2(spot));
      return {
        eye: {
          x: spot.x + Math.cos(turn) * ARC_RADIUS,
          y: ground + ARC_HEIGHT,
          z: spot.z + Math.sin(turn) * ARC_RADIUS,
        },
        aim: { x: spot.x, y: ground + 1.2, z: spot.z },
      };
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

function at2(p) {
  const g = fromWorld(p.x, p.z);
  return [g.lat, g.lon];
}

function lerp(a, b, k) {
  const t = Math.min(Math.max(k, 0), 1);
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

function ease(k) {
  const t = Math.min(Math.max(k, 0), 1);
  return t * t * (3 - 2 * t);
}

// The county's cars are white with a green stripe and a bar on the roof.
function patrolCar() {
  const group = new THREE.Group();
  group.add(buildCar(0xe9ecee));
  group.add(painted([
    paint(box(1.82, 0.16, 2.60, 0, 0.84, 0.10), 0x2f6b46),     // the stripe
    paint(box(1.00, 0.10, 0.26, 0, 1.49, 0.10), 0x1d1f22),     // the light bar
    paint(box(0.40, 0.12, 0.22, -0.28, 1.55, 0.10), 0x8c2f2f),
    paint(box(0.40, 0.12, 0.22, 0.28, 1.55, 0.10), 0x2f4f8c),
  ]));
  return group;
}
