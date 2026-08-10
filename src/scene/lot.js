// The lot line at 389 W Bluff Rd, laid on the ground.
//
// Four corners out of assets/site/389-w-bluff.json, closed into a ring and
// draped the same way the roads are, so the line follows the bluff down instead
// of hanging in the air over it.
//
// It is drawn narrow. A boundary is not a thing you can see on the ground and
// widening it until it reads from a kilometre away would be drawing a fence
// nobody built. Up close, where the question is which side of the line something
// stands, it is there.
//
// What it is not: a survey. The county mapped these corners and they run a foot
// or two off the deed's own calls. The asset says so in its own accuracy field
// and this draws exactly what the asset holds, no more.

import * as THREE from "three";
import { ribbon } from "./land.js";

const LOT = "assets/site/389-w-bluff.json";

const WIDTH_M = 0.5;
// Above the roads' 0.15, so where a driveway crosses the line the line is on top.
const LIFT_M = 0.25;
// Surveyor's flagging. Nothing else in the scene is this colour, which is the
// whole reason for it.
const COLOR = 0xe0559a;

export async function buildLot(scene, sample) {
  const r = await fetch(LOT);
  if (!r.ok) throw new Error(`${LOT} returned ${r.status} ${r.statusText}`);
  const site = await r.json();
  const corners = site.boundary;
  if (!Array.isArray(corners) || corners.length < 3) {
    throw new Error(
      `${LOT} holds ${Array.isArray(corners) ? corners.length : "no"} boundary ` +
      `corners and a lot needs at least 3. Rebake it from the property records.`);
  }

  // The asset lists the corners open, the way a ring is stored. A line has to be
  // told to come back to where it started.
  const ring = corners.concat([corners[0]]);
  const mesh = new THREE.Mesh(
    ribbon([ring], sample, WIDTH_M, LIFT_M),
    new THREE.MeshStandardMaterial({ color: COLOR, roughness: 1, side: THREE.DoubleSide }));
  mesh.renderOrder = 2;
  mesh.userData.landmark = { name: `parcel ${site.parcel}`, kind: site.accuracy };
  scene.add(mesh);
  return mesh;
}
