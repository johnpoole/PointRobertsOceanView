// Anyone else who has the page open, as a ball standing where they are.
//
// The server gives each open socket a random name and sends the list of
// positions round once a second. It never sends an address, and this never asks
// for one: a marker here is a stranger and stays a stranger.
//
// A second between updates is a long time on a screen running at sixty frames,
// so nothing is drawn where the last message put it. Each ball is eased toward
// where it was last said to be, which turns one position a second into a mark
// that slides rather than one that jumps. The easing is the only thing in here
// that is not a fact off the wire, and it can only ever be behind the truth,
// never ahead of it — nothing is extrapolated, so a ball never runs on past
// somebody who has stopped.
//
// Drawn as spheres in one instanced mesh, because the number of them is not
// known and re-making geometry every time somebody opens the page would be a
// leak with extra steps.

import * as THREE from "three";
import { toWorld } from "../geo.js";

// How big a person's marker is, and how far over the ground it floats. A ball on
// the ground at this size is half buried, and a ball at eye height is a balloon.
const BALL_R = 0.9;
const BALL_LIFT_M = 1.2;

// The most that will ever be drawn at once. It is a hard cap on the instanced
// mesh rather than a guess at how busy the site gets: past this the extras are
// dropped and the count says so, which is better than the mesh silently
// overflowing.
const MAX_PEOPLE = 64;

// How fast a ball closes on where it was last said to be. Per second, as a
// fraction of the gap left.
const EASE_PER_S = 6.0;
// Further than this and it is not the same person moving, it is a page that
// reloaded somewhere else or a mode change across the peninsula. Jump.
const JUMP_M = 400;

const COLOUR = 0xffb454;

export function buildPeople(scene, sample) {
  const geo = new THREE.SphereGeometry(BALL_R, 14, 10);
  const mat = new THREE.MeshStandardMaterial({
    color: COLOUR, roughness: 0.45, metalness: 0.05,
    emissive: COLOUR, emissiveIntensity: 0.25,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX_PEOPLE);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;   // the matrices move without the bounds knowing
  scene.add(mesh);

  // Where each ball is now, and where it is trying to get to. Keyed by the name
  // the server gave that socket.
  const balls = new Map();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();

  let dropped = 0;

  // presence is feed.presence: id -> { lat, lon, y, heading }.
  function update(presence, dt) {
    // Anyone who has gone since the last list.
    for (const id of balls.keys()) if (!presence.has(id)) balls.delete(id);

    for (const [id, at] of presence) {
      const w = toWorld(at.lat, at.lon, 0);
      // Their own height is what they sent, which in fly mode is well off the
      // ground. On the ground the terrain is the better answer, because their
      // eye height is not where their feet are.
      const ground = sample(at.lat, at.lon);
      const y = Math.max(at.y ?? ground, ground) + BALL_LIFT_M;
      let ball = balls.get(id);
      if (!ball) {
        ball = { x: w.x, y, z: w.z };
        balls.set(id, ball);
      }
      const gap = Math.hypot(w.x - ball.x, w.z - ball.z);
      if (gap > JUMP_M) {
        ball.x = w.x; ball.y = y; ball.z = w.z;
      } else {
        // 1 - e^-kt rather than k*dt, so a long frame cannot overshoot.
        const k = 1 - Math.exp(-EASE_PER_S * dt);
        ball.x += (w.x - ball.x) * k;
        ball.y += (y - ball.y) * k;
        ball.z += (w.z - ball.z) * k;
      }
    }

    let n = 0;
    dropped = 0;
    for (const ball of balls.values()) {
      if (n >= MAX_PEOPLE) { dropped++; continue; }
      pos.set(ball.x, ball.y, ball.z);
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
