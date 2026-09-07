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
// Drawn in one instanced mesh, because the number of visitors is not
// known and re-making geometry every time somebody opens the page would be a
// leak with extra steps.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toWorld } from "../geo.js";
import { box, tint } from "./parts.js";

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

export function buildPeople(scene, sample) {
  // 92 triangles total; no textures, skeleton, per-limb objects or animation.
  const parts=[box(0.48,0.26,0.66,0,0.68,0,COLOUR)];
  for(const sign of [-1,1]) {
    parts.push(box(0.16,0.22,0.68,sign*0.14,0,0,0x3f5263));
    parts.push(box(0.12,0.18,0.58,sign*0.34,0.72,0,COLOUR));
  }
  const head=new THREE.IcosahedronGeometry(0.23,0);
  head.translate(0,1.57,0);parts.push(tint(head,0xf4ce9a));
  // Small dark face strip makes the forward direction (-Z) readable.
  parts.push(box(0.24,0.03,0.045,0,1.59,-0.215,0x334956));
  const geo=mergeGeometries(parts,false);
  for(const part of parts)part.dispose();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.75, metalness: 0,
    emissive: COLOUR, emissiveIntensity: 0.25,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX_PEOPLE);
  mesh.name = 'visitor-avatars';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;   // the matrices move without the bounds knowing
  scene.add(mesh);

  // Where each avatar is now, and where it is trying to get to. Keyed by the name
  // the server gave that socket.
  const avatars = new Map();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0,1,0);
  const one = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();

  let dropped = 0;

  // presence is feed.presence: id -> { lat, lon, y, heading }.
  function update(presence, dt) {
    // Anyone who has gone since the last list.
    for (const id of avatars.keys()) if (!presence.has(id)) avatars.delete(id);

    for (const [id, at] of presence) {
      const w = toWorld(at.lat, at.lon, 0);
      // Their own height is what they sent, which in fly mode is well off the
      // ground. On the ground the terrain is the better answer, because their
      // eye height is not where their feet are.
      const ground = sample(at.lat, at.lon);
      const y = Math.max((at.y ?? ground+AVATAR_EYE_M)-AVATAR_EYE_M, ground);
      // The existing sender uses atan2(-look.x,-look.z): this is Three.js yaw,
      // even though the wire field is named heading. No protocol change needed.
      const yaw = (at.heading ?? 0)*Math.PI/180;
      let avatar = avatars.get(id);
      if (!avatar) {
        avatar = { x: w.x, y, z: w.z, yaw };
        avatars.set(id, avatar);
      }
      const gap = Math.hypot(w.x - avatar.x, w.z - avatar.z);
      if (gap > JUMP_M) {
        avatar.x = w.x; avatar.y = y; avatar.z = w.z; avatar.yaw = yaw;
      } else {
        // 1 - e^-kt rather than k*dt, so a long frame cannot overshoot.
        const k = 1 - Math.exp(-EASE_PER_S * dt);
        avatar.x += (w.x - avatar.x) * k;
        avatar.y += (y - avatar.y) * k;
        avatar.z += (w.z - avatar.z) * k;
        const turn=Math.atan2(Math.sin(yaw-avatar.yaw),Math.cos(yaw-avatar.yaw));
        avatar.yaw += turn*k;
      }
    }

    let n = 0;
    dropped = 0;
    for (const avatar of avatars.values()) {
      if (n >= MAX_PEOPLE) { dropped++; continue; }
      pos.set(avatar.x, avatar.y, avatar.z);
      q.setFromAxisAngle(up,avatar.yaw);
      m.compose(pos, q, one);
      mesh.setMatrixAt(n, m);
      n++;
    }
    if (n !== mesh.count || n > 0) mesh.instanceMatrix.needsUpdate = true;
    mesh.count = n;
  }

  return {
    mesh,
    update,
    get count() { return mesh.count; },
    // How many were on the list and had nowhere to go. Read by nothing yet; here
    // so the cap is visible rather than silent if the site ever gets busy.
    get dropped() { return dropped; },
    setVisible(on) { mesh.visible = on; },
  };
}
