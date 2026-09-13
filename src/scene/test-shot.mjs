// The camera on a script: the arc, the ease and the move into a shot.
//
// Run:
//     node src/scene/test-shot.mjs
//
// This is the arithmetic the novel's route runs on. It has put the camera
// through the subject before, and eased from the wrong place.

import assert from "node:assert/strict";
import { arc, ease, lerp, Move } from "./shot.js";

function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { console.log(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) < tol, `${what}: ${a} is not ${b}`);

// ---- the shape of a move ----------------------------------------------------

test("an ease starts and ends still", () => {
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  near(ease(0.5), 0.5, 0.001, "the middle of the ease");
  // and it is clamped, because a beat can overrun by a frame
  assert.equal(ease(-1), 0);
  assert.equal(ease(2), 1);
});

test("an ease is slowest at both ends", () => {
  const rate = (k) => (ease(k + 0.01) - ease(k - 0.01)) / 0.02;
  assert.ok(rate(0.05) < rate(0.5), "it leaves at full speed");
  assert.ok(rate(0.95) < rate(0.5), "it arrives at full speed");
});

test("a lerp is clamped at both ends", () => {
  const a = { x: 0, y: 0, z: 0 }, b = { x: 10, y: 4, z: 20 };
  assert.deepEqual(lerp(a, b, 0), { x: 0, y: 0, z: 0 });
  assert.deepEqual(lerp(a, b, 1), { x: 10, y: 4, z: 20 });
  assert.deepEqual(lerp(a, b, -3), { x: 0, y: 0, z: 0 });
  assert.deepEqual(lerp(a, b, 3), { x: 10, y: 4, z: 20 });
});

test("a lerp with no height is a lerp on the flat", () => {
  // Marks on the ground carry x and z and take their height off the terrain.
  const at = lerp({ x: 0, z: 0 }, { x: 10, z: 20 }, 0.5);
  assert.equal(at.x, 5);
  assert.equal(at.z, 10);
  assert.equal(at.y, 0);
});

// ---- the arc ----------------------------------------------------------------

const SUBJECT = { x: 100, y: 51, z: -40 };
const SWING = { from: 215, sweep: 130, radius: 30, height: 15, aim: 1.2 };

test("the camera holds its radius the whole way round", () => {
  for (let k = 0; k <= 1.0001; k += 0.05) {
    const { eye } = arc(SUBJECT, SWING, k);
    near(Math.hypot(eye.x - SUBJECT.x, eye.z - SUBJECT.z), SWING.radius, 1e-9,
      `at ${k.toFixed(2)} the radius`);
  }
});

test("the camera holds its height off the ground under the subject", () => {
  for (const k of [0, 0.5, 1]) {
    assert.equal(arc(SUBJECT, SWING, k).eye.y, SUBJECT.y + SWING.height);
  }
});

test("the lens points at the subject's chest, not its boots", () => {
  const { aim } = arc(SUBJECT, SWING, 0.4);
  assert.equal(aim.x, SUBJECT.x);
  assert.equal(aim.z, SUBJECT.z);
  assert.equal(aim.y, SUBJECT.y + SWING.aim);
});

test("the swing actually swings", () => {
  const a = arc(SUBJECT, SWING, 0), b = arc(SUBJECT, SWING, 1);
  const bearing = (p) => Math.atan2(p.eye.z - SUBJECT.z, p.eye.x - SUBJECT.x);
  let turned = (bearing(b) - bearing(a)) * 180 / Math.PI;
  while (turned < -180) turned += 360;
  while (turned > 180) turned -= 360;
  near(Math.abs(turned), Math.abs(SWING.sweep) % 360, 0.001, "the sweep");
});

test("the arc never passes through the subject", () => {
  // 130 degrees of swing at a fixed radius cannot, but a sweep read as radians
  // or a radius left at zero would, and both have happened.
  for (let k = 0; k <= 1.0001; k += 0.02) {
    const { eye } = arc(SUBJECT, SWING, k);
    assert.ok(Math.hypot(eye.x - SUBJECT.x, eye.z - SUBJECT.z) > 5,
      `at ${k.toFixed(2)} the camera is on top of the subject`);
  }
});

test("the arc is clamped, because a beat can overrun", () => {
  assert.deepEqual(arc(SUBJECT, SWING, 2), arc(SUBJECT, SWING, 1));
  assert.deepEqual(arc(SUBJECT, SWING, -1), arc(SUBJECT, SWING, 0));
});

test("a perch overrides the radius and height and nothing else", () => {
  const high = arc(SUBJECT, { ...SWING, radius: 52, height: 52 }, 0);
  const low = arc(SUBJECT, SWING, 0);
  assert.equal(high.eye.y, SUBJECT.y + 52);
  near(Math.hypot(high.eye.x - SUBJECT.x, high.eye.z - SUBJECT.z), 52, 1e-9, "radius");
  // Same bearing, further out: the start of the swing does not move.
  near(Math.atan2(high.eye.z - SUBJECT.z, high.eye.x - SUBJECT.x),
       Math.atan2(low.eye.z - SUBJECT.z, low.eye.x - SUBJECT.x), 1e-9, "bearing");
  assert.deepEqual(high.aim, low.aim);
});

// ---- the move into a shot ---------------------------------------------------

// The least of a camera and OrbitControls that Move touches.
function rig(x, y, z, tx, ty, tz) {
  const v = (a, b, c) => ({
    x: a, y: b, z: c,
    set(p, q, r) { this.x = p; this.y = q; this.z = r; },
    clone() { return v(this.x, this.y, this.z); },
  });
  return {
    camera: { position: v(x, y, z) },
    controls: { target: v(tx, ty, tz), updates: 0, update() { this.updates++; } },
  };
}

test("a move starts where the camera was and ends on the shot", () => {
  const { camera, controls } = rig(0, 0, 0, 0, 0, 0);
  const pose = { eye: { x: 100, y: 20, z: -40 }, aim: { x: 100, y: 1, z: -40 } };
  const move = new Move(5);
  move.mark(camera, controls);

  move.to(camera, controls, pose, 0);
  assert.deepEqual([camera.position.x, camera.position.y, camera.position.z], [0, 0, 0]);

  move.to(camera, controls, pose, 5);
  assert.deepEqual([camera.position.x, camera.position.y, camera.position.z], [100, 20, -40]);
  assert.deepEqual([controls.target.x, controls.target.y, controls.target.z], [100, 1, -40]);
});

test("past the move the shot does the moving", () => {
  const { camera, controls } = rig(0, 0, 0, 0, 0, 0);
  const move = new Move(5);
  move.mark(camera, controls);
  move.to(camera, controls, { eye: { x: 7, y: 8, z: 9 }, aim: { x: 1, y: 2, z: 3 } }, 400);
  assert.deepEqual([camera.position.x, camera.position.y, camera.position.z], [7, 8, 9]);
});

test("a move that was never marked marks itself on the first frame", () => {
  // A caller may not know where the camera is when the shot is chosen, only
  // when the first frame is drawn.
  const { camera, controls } = rig(3, 4, 5, 0, 0, 0);
  const move = new Move(5);
  move.to(camera, controls, { eye: { x: 3, y: 4, z: 5 }, aim: { x: 0, y: 0, z: 0 } }, 0);
  assert.deepEqual([camera.position.x, camera.position.y, camera.position.z], [3, 4, 5]);
  assert.ok(move.from, "the move never remembered where it started");
});

test("a move drives the controls, or the camera snaps back next frame", () => {
  const { camera, controls } = rig(0, 0, 0, 0, 0, 0);
  new Move(5).to(camera, controls, { eye: { x: 1, y: 1, z: 1 }, aim: { x: 0, y: 0, z: 0 } }, 1);
  assert.equal(controls.updates, 1);
});

if (!process.exitCode) {
  console.log("\nPASS: the arc holds its radius, the move starts where the camera "
    + "was.");
}
