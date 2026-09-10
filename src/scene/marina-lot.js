// The marina's public car park, and what the marina camera says is standing in
// it. See CONTINUE-marina-camera.md.
//
// The counts are real and the positions are not. The camera has never been
// calibrated, so nothing here knows which stall a car is in — it knows how many
// were found. The cars are drawn in the first stalls in order, which is a way of
// showing a number in the place the number came from and nothing more than that.
//
// The lot itself is traced off the county 2022 aerial: the long axis between the
// two corners below and the width across both rows and their aisle. It is read
// off a photograph, not surveyed.

import * as THREE from "three";
import { fromWorld, toWorld } from "../geo.js";
import { box, tint } from "./parts.js";
import { DOCK_PLAN } from "./marina-dock-plan.js";

export const LOT = {
  southWest: [48.9767771, -123.0632802],
  northEast: [48.9770000, -123.0625759],
  width: 18.4,
  stall: 2.7,
  depth: 5.4,
};

// Beyond this the lot is full and the rest are not drawn. The count still says
// what was found; the readout is the truth, this is the picture of it.
const MAX_CARS = 20;
const MAX_PEOPLE = 8;

const BODY = [0x8f9298, 0x6d7580, 0x9c9a94, 0x545a62, 0xa8a29b, 0x77706c];

export function buildMarinaLot(scene, sample) {
  const group = new THREE.Group();
  group.name = "marina-lot";

  const a = toWorld(...LOT.southWest), b = toWorld(...LOT.northEast);
  const run = Math.hypot(b.x - a.x, b.z - a.z);
  const along = { x: (b.x - a.x) / run, z: (b.z - a.z) / run };
  // Across the lot, to the south-east side.
  const across = { x: -along.z, z: along.x };

  const at = (down, over, y = 0) => new THREE.Vector3(
    a.x + along.x * down + across.x * over, y,
    a.z + along.z * down + across.z * over);

  // The paving, laid on the ground under it rather than on one flat number.
  {
    const pos = [], step = 6;
    for (let d = 0; d < run; d += step) {
      for (let o = 0; o < LOT.width; o += step) {
        const d1 = Math.min(d + step, run), o1 = Math.min(o + step, LOT.width);
        const corners = [[d, o], [d1, o], [d1, o1], [d, o1]].map(([dd, oo]) => {
          const p = at(dd, oo);
          return { p, y: sample(...worldToLatLon(p)) };
        });
        for (const [i, j, k] of [[0, 1, 2], [0, 2, 3]]) {
          for (const c of [corners[i], corners[j], corners[k]]) pos.push(c.p.x, c.y + 0.04, c.p.z);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const paving = new THREE.Mesh(tint(geo, 0x63656a),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
    paving.name = "marina-lot-paving";
    group.add(paving);
  }

  // Where each stall is: two rows facing the aisle, down the length of the lot.
  const stalls = [];
  for (let row = 0; row < 2; row++) {
    const over = row === 0 ? LOT.depth / 2 : LOT.width - LOT.depth / 2;
    for (let d = LOT.stall / 2; d + LOT.stall / 2 < run; d += LOT.stall) {
      stalls.push({ down: d, over, row });
    }
  }

  // The painted lines, one between each pair of stalls.
  {
    const parts = [];
    for (const row of [0, 1]) {
      const o0 = row === 0 ? 0.2 : LOT.width - LOT.depth - 0.2;
      for (let d = 0; d <= run - LOT.stall; d += LOT.stall) {
        const p = at(d, o0 + LOT.depth / 2), y = sample(...worldToLatLon(p));
        const line = box(0.12, LOT.depth, 0.02, 0, 0, 0, 0xcfcdc4);
        line.rotateY(Math.atan2(along.x, along.z) + Math.PI / 2);
        line.translate(p.x, y + 0.06, p.z);
        parts.push(line);
      }
    }
    const lines = new THREE.Mesh(mergeAll(parts),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
    lines.name = "marina-lot-lines";
    group.add(lines);
  }

  // The cars, made once and shown or hidden as the count changes.
  const heading = Math.atan2(along.x, along.z);
  const cars = [];
  for (let i = 0; i < MAX_CARS && i < stalls.length; i++) {
    const stall = stalls[i], p = at(stall.down, stall.over), y = sample(...worldToLatLon(p));
    const colour = BODY[i % BODY.length];
    const parts = [
      box(1.82, 4.36, 0.72, 0, 0.28, 0, colour),
      box(1.66, 2.42, 0.62, 0, 1.0, -0.1, colour),
      box(1.72, 0.16, 0.30, 0, 0.42, 2.12, 0x2b2f33),
      box(1.72, 0.16, 0.30, 0, 0.42, -2.12, 0x2b2f33),
    ];
    const car = new THREE.Mesh(mergeAll(parts),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
    car.name = `marina-car-${i}`;
    car.position.set(p.x, y + 0.05, p.z);
    car.rotation.y = heading + (stall.row === 0 ? 0 : Math.PI);
    car.visible = false;
    group.add(car);
    cars.push(car);
  }

  // People, at the head of the ramp where the camera can see the dock.
  const shore = toWorld(...DOCK_PLAN.points.shore);
  const people = [];
  for (let i = 0; i < MAX_PEOPLE; i++) {
    const angle = i * 1.4, radius = 2 + (i % 3) * 1.6;
    const x = shore.x + Math.cos(angle) * radius, z = shore.z + Math.sin(angle) * radius;
    const y = sample(...worldToLatLon(new THREE.Vector3(x, 0, z)));
    const parts = [
      box(0.40, 0.26, 0.92, 0, 0.78, 0, 0x40506a),
      box(0.34, 0.24, 0.72, 0, 0.06, 0, 0x2f3540),
      box(0.24, 0.22, 0.24, 0, 1.70, 0, 0xb08c72),
    ];
    const figure = new THREE.Mesh(mergeAll(parts),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    figure.name = `marina-person-${i}`;
    figure.position.set(x, y, z);
    figure.rotation.y = angle;
    figure.visible = false;
    group.add(figure);
    people.push(figure);
  }

  scene.add(group);

  return {
    group,
    stalls: cars.length,
    // marina is feed.marina: the envelope, or null when the server is not
    // reading the camera. Nothing is drawn unless it is live.
    update(marina) {
      const live = marina && marina.data && marina.data.watching && !marina.data.error;
      const vehicles = live ? (marina.data.vehicles || 0) : 0;
      const walking = live ? (marina.data.people || 0) : 0;
      cars.forEach((car, i) => { car.visible = i < vehicles; });
      people.forEach((figure, i) => { figure.visible = i < walking; });
    },
    dispose() {
      group.removeFromParent();
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      group.clear();
    },
  };
}

// parts.js hands back geometries; this is the one place here that needs them
// merged, and importing the utils for one call is not worth it.
function mergeAll(list) {
  const total = list.reduce((n, g) => n + g.attributes.position.count, 0);
  const position = new Float32Array(total * 3), color = new Float32Array(total * 3);
  let at = 0;
  for (const g of list) {
    position.set(g.attributes.position.array, at * 3);
    color.set(g.attributes.color.array, at * 3);
    at += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(position, 3));
  out.setAttribute("color", new THREE.BufferAttribute(color, 3));
  out.computeVertexNormals();
  return out;
}

function worldToLatLon(p) {
  const { lat, lon } = fromWorld(p.x, p.z);
  return [lat, lon];
}
