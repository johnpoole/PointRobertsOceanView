// Anyone else who has the page open, as a lightweight avatar where they are.
//
// The server gives each open socket a random name and sends the list of
// positions round once a second. It never sends an address, and this never asks
// for one: a marker here is a stranger and stays a stranger.
//
// A second between updates is a long time on a screen running at sixty frames,
// so nothing is drawn where the last message put it. Each avatar is eased toward
// where it was last said to be, which turns one position a second into a mark
// that slides rather than one that jumps. The easing is the only thing in here
// that is not a fact off the wire, and it can only ever be behind the truth,
// never ahead of it — nothing is extrapolated, so an avatar never runs on past
// somebody who has stopped.
//
// Drawn in one instanced mesh per travel model, because the visitor count is not
// known and re-making geometry every time somebody opens the page would be a
// leak with extra steps.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toWorld } from "../geo.js";
import { box, tint } from "./parts.js";
import { VEHICLES } from "./vehicles.js";
import { buildBoat } from "./boat.js";

// A generic 1.8 m figure. Presence reports the camera eye, not the feet.
const AVATAR_EYE_M = 1.62;

// The most that will ever be drawn at once. It is a hard cap on the instanced
// mesh rather than a guess at how busy the site gets: past this the extras are
// dropped and the count says so, which is better than the mesh silently
// overflowing.
const MAX_PEOPLE = 64;

// How fast an avatar closes on where it was last said to be. Per second, as a
// fraction of the gap left.
const EASE_PER_S = 6.0;
// Further than this and it is not the same person moving, it is a page that
// reloaded somewhere else or a mode change across the peninsula. Jump.
const JUMP_M = 400;

const COLOUR = 0xffb454;

function personGeometry(seated = false) {
  // 92 triangles standing, 116 seated; no textures or skeleton animation.
  const parts=[box(0.48,0.26,seated ? 0.50 : 0.66,0,seated ? 0.28 : 0.68,0,COLOUR)];
  for(const sign of [-1,1]) {
    if (seated) {
      parts.push(box(0.16,0.46,0.16,sign*0.14,0.22,-0.15,0x3f5263));
      parts.push(box(0.16,0.16,0.25,sign*0.14,-0.03,-0.30,0x3f5263));
    } else parts.push(box(0.16,0.22,0.68,sign*0.14,0,0,0x3f5263));
    parts.push(box(0.12,0.18,seated ? 0.45 : 0.58,sign*0.34,seated ? 0.30 : 0.72,0,COLOUR));
  }
  const head=new THREE.IcosahedronGeometry(seated ? 0.20 : 0.23,0);
  head.translate(0,seated ? 1.00 : 1.57,0);parts.push(tint(head,0xf4ce9a));
  // Small dark face strip makes the forward direction (-Z) readable.
  parts.push(box(0.24,0.03,0.045,0,seated ? 1.02 : 1.59,seated ? -0.19 : -0.215,0x334956));
  const geo=mergeGeometries(parts,false);
  for(const part of parts)part.dispose();
  return geo;
}

// Bake each existing model once, including its material colours and local
// transforms. Remote copies share geometry; no per-visitor Groups or materials.
function vehicleGeometry(group) {
  group.updateMatrixWorld(true);
  const parts = [];
  group.traverse(child => {
    if (!child.isMesh) return;
    // The ultralight's translucent propeller disk has no useful distant detail.
    if (!child.material.transparent) {
      const geo = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
      geo.applyMatrix4(child.matrixWorld);
      for (const name of Object.keys(geo.attributes)) {
        if (name !== "position" && name !== "normal") geo.deleteAttribute(name);
      }
      parts.push(tint(geo, child.material.color));
    }
    child.geometry.dispose();
    child.material.dispose();
  });
  const geo = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return geo;
}

export function buildPeople(scene, sample) {
  const geometries = new Map([["person", personGeometry()]]);
  for (const spec of VEHICLES) {
    if (spec.id !== "walk") geometries.set(spec.id, vehicleGeometry(spec.build()));
  }
  const boat = vehicleGeometry(buildBoat());
  // A seated driver at the helm, kept simple like the standing figure.
  const driver = personGeometry(true);
  driver.translate(0, 0, 1.25);
  geometries.set("boat", mergeGeometries([boat, driver], false));
  boat.dispose(); driver.dispose();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.75, metalness: 0,
    emissive: COLOUR, emissiveIntensity: 0.12, side: THREE.DoubleSide,
  });
  const meshes = new Map();
  for (const [mode, geo] of geometries) {
    const mesh = new THREE.InstancedMesh(geo, mat, MAX_PEOPLE);
    mesh.name = mode === "person" ? "visitor-avatars" : `visitor-${mode}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    scene.add(mesh);
    meshes.set(mode, mesh);
  }
  const mesh = meshes.get("person");

  // Where each avatar is now, and where it is trying to get to. Keyed by the name
  // the server gave that socket.
  const avatars = new Map();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const targetQ = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  const one = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();

  let dropped = 0;

  // presence is feed.presence: id -> { lat, lon, y, heading }.
  function update(presence, dt) {
    // Anyone who has gone since the last list.
    for (const id of avatars.keys()) if (!presence.has(id)) avatars.delete(id);

    for (const [id, at] of presence) {
      const mode = at.body && meshes.has(at.mode) ? at.mode : "person";
      const pose = at.body && (mode !== "person" || at.mode === "walk") ? at.body : null;
      const w = pose ? toWorld(pose.lat, pose.lon, pose.y) : toWorld(at.lat, at.lon);
      const ground = sample(at.lat, at.lon);
      const y = pose ? w.y : Math.max((at.y ?? ground + AVATAR_EYE_M) - AVATAR_EYE_M, ground);
      const yaw = (pose?.heading ?? at.heading ?? 0) * Math.PI / 180;
      euler.set((pose?.pitch ?? 0) * Math.PI / 180, yaw, (pose?.roll ?? 0) * Math.PI / 180);
      targetQ.setFromEuler(euler);
      let avatar = avatars.get(id);
      if (!avatar) {
        avatar = { x: w.x, y, z: w.z, mode, body: !!pose, q: targetQ.clone() };
        avatars.set(id, avatar);
      }
      const gap = Math.hypot(w.x - avatar.x, w.z - avatar.z);
      if (gap > JUMP_M || avatar.mode !== mode || avatar.body !== !!pose) {
        avatar.x = w.x; avatar.y = y; avatar.z = w.z;
        avatar.q.copy(targetQ);
      } else {
        const k = 1 - Math.exp(-EASE_PER_S * dt);
        avatar.x += (w.x - avatar.x) * k;
        avatar.y += (y - avatar.y) * k;
        avatar.z += (w.z - avatar.z) * k;
        avatar.q.slerp(targetQ, k);
      }
      avatar.mode = mode;
      avatar.body = !!pose;
    }

    let n = 0;
    dropped = 0;
    for (const model of meshes.values()) model.count = 0;
    for (const avatar of avatars.values()) {
      if (n >= MAX_PEOPLE) { dropped++; continue; }
      pos.set(avatar.x, avatar.y, avatar.z);
      q.copy(avatar.q);
      m.compose(pos, q, one);
      const model = meshes.get(avatar.mode);
      model.setMatrixAt(model.count++, m);
      n++;
    }
    for (const model of meshes.values()) {
      if (model.count) model.instanceMatrix.needsUpdate = true;
    }
  }

  return {
    mesh, meshes,
    update,
    get count() { return [...meshes.values()].reduce((n, model) => n + model.count, 0); },
    // How many were on the list and had nowhere to go. Read by nothing yet; here
    // so the cap is visible rather than silent if the site ever gets busy.
    get dropped() { return dropped; },
    setVisible(on) { for (const model of meshes.values()) model.visible = on; },
  };
}
