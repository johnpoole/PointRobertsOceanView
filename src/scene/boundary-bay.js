// The Canadian side of the crossing, which is what you look at from the US
// booths: a red-roofed canopy over the inbound lanes, the office beside it, and
// a second canopy over the staff parking behind.
//
// None of it is in the OSM bake this project uses — that stops at the line — so
// all three were measured off the county 2022 aerial by colour: the two red
// roofs and the office's grey one were found as blobs, and each one's centre,
// size and the bearing of its long axis came out of the pixels rather than off
// a ruler held to the screen.
//
// The fine terrain also stops at the line, and a sample north of it clamps to
// the last row. The ground there is flat and the error is small, but it is an
// error and it is worth knowing about: everything here stands on the height of
// the 49th parallel rather than on its own ground.

import * as THREE from "three";
import { toWorld } from "../geo.js";
import { box, tint } from "./parts.js";

const RED = 0x8d4f3a;       // the standing-seam roofs over both canopies
const OFFICE_WALL = 0xb9ae9c;
const OFFICE_ROOF = 0x8e9195;
const POST = 0x4a4a46;
const GLASS = 0x2e3a3e;
const BOOTH = 0xd8d5cc;

// Measured: centre, length along its own axis, width across it, and the bearing
// of that axis. Heights are estimates off the Street View frame looking north.
export const BOUNDARY_BAY = {
  laneCanopy: {
    at: [49.0022403, -123.0681209], long: 19.8, across: 7.9, bearing: 89.4,
    deck: 5.0, rise: 1.1, eave: 0.8,
  },
  parkCanopy: {
    at: [49.0023293, -123.0682773], long: 27.9, across: 8.4, bearing: 94.2,
    deck: 4.4, rise: 1.0, eave: 0.7,
  },
  office: {
    // Nearly square, so its own principal axis means nothing; it takes the
    // bearing of the canopies it stands beside.
    at: [49.0021744, -123.0682732], long: 16.2, across: 17.3, bearing: 94.0,
    height: 4.6,
  },
  // Two of them in the lanes under the canopy, where the aerial shows them.
  booths: [[-4.0, 1.2], [3.2, 1.2]],
  boothSize: [2.2, 1.7, 2.7],
};

export function buildBoundaryBay(scene, sample) {
  const group = new THREE.Group();
  group.name = "boundary-bay";
  const parts = [];
  const P = BOUNDARY_BAY;

  // A frame for one structure: its centre in world metres, and the turn that
  // puts its long axis along the bearing measured off the aerial.
  const frameOf = (spec) => {
    const c = toWorld(spec.at[0], spec.at[1]);
    return { x: c.x, z: c.z, angle: -(spec.bearing - 90) * Math.PI / 180 };
  };
  const ground = (lat, lon) => sample(lat, lon);
  const floor = ground(P.office.at[0], P.office.at[1]);

  const place = (geom, frame) => {
    geom.rotateY(frame.angle);
    geom.translate(frame.x, 0, frame.z);
    parts.push(geom);
  };

  // The two canopies: a hipped roof on posts with nothing under it but lanes.
  for (const spec of [P.laneCanopy, P.parkCanopy]) {
    const frame = frameOf(spec);
    place(hipRoof(spec.long / 2, spec.across / 2, floor + spec.deck, spec.rise,
      spec.eave, RED), frame);
    // A dark band under the eave, which is what reads from the far side.
    place(box(spec.long + spec.eave * 2, spec.across + spec.eave * 2, 0.34,
      0, floor + spec.deck - 0.34, 0, POST), frame);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      place(box(0.26, 0.26, spec.deck - 0.34,
        sx * (spec.long / 2 - 1.2), floor, sz * (spec.across / 2 - 1.0), POST), frame);
    }
    place(box(0.26, 0.26, spec.deck - 0.34, 0, floor, spec.across / 2 - 1.0, POST), frame);
    place(box(0.26, 0.26, spec.deck - 0.34, 0, floor, -(spec.across / 2 - 1.0), POST), frame);
  }

  // The office, flat-roofed with a band of glass on the side facing the lanes.
  {
    const o = P.office, frame = frameOf(o);
    place(box(o.long, o.across, o.height, 0, floor, 0, OFFICE_WALL), frame);
    place(box(o.long + 0.5, o.across + 0.5, 0.3, 0, floor + o.height, 0, OFFICE_ROOF), frame);
    place(box(o.long - 2.4, 0.12, 1.9, 0, floor + 1.1, o.across / 2, GLASS), frame);
    place(box(0.12, o.across - 3.0, 1.9, o.long / 2, floor + 1.1, 0, GLASS), frame);
  }

  // The booths standing in the lanes under the canopy.
  {
    const frame = frameOf(P.laneCanopy), [w, d, h] = P.boothSize;
    for (const [x, z] of P.booths) {
      place(box(w, d, 0.9, x, floor, z, BOOTH), frame);
      place(box(w, d, h - 1.2, x, floor + 0.9, z, GLASS), frame);
      place(box(w + 0.3, d + 0.3, 0.18, x, floor + h - 0.3, z, POST), frame);
    }
  }

  const merged = mergeAll(parts);
  const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
  mesh.name = "boundary-bay-station";
  group.add(mesh);
  scene.add(group);
  return {
    group,
    dispose() {
      group.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
      group.clear();
    },
  };
}

// A hipped roof over a rectangle, at one pitch all round.
function hipRoof(halfLong, halfAcross, top, rise, eave, colour) {
  const L = halfLong + eave, A = halfAcross + eave;
  const slope = rise / halfAcross;
  const ridgeY = top + rise, eaveY = ridgeY - slope * A;
  const run = Math.max(L - A, 0);
  const pos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  const p1 = [-run, ridgeY, 0], p2 = [run, ridgeY, 0];
  const c1 = [-L, eaveY, -A], c2 = [L, eaveY, -A], c3 = [L, eaveY, A], c4 = [-L, eaveY, A];
  tri(p1, p2, c2); tri(p1, c2, c1);
  tri(p2, p1, c4); tri(p2, c4, c3);
  tri(p1, c1, c4); tri(p2, c3, c2);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return tint(g, colour);
}

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
