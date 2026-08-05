// Camera navigation. Two modes over the existing OrbitControls:
//   orbit - the default look-around, plus smooth tweens to preset viewpoints.
//   fly   - free flight: pointer-lock mouse look, WASD along the look direction,
//           Q/E down/up, Shift to go fast.
// Both modes are held above the surface. Dropping under the water put the camera
// inside the ocean plane looking up at the underside, which reads as nothing at
// all. opts.floor(x, z) gives the height to stay above.
// The render loop calls update(dt); nothing else touches the controls.

import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

const TWEEN_SECONDS = 1.1;
const FLY_SPEED = 60;   // m/s
const FAST_SPEED = 260;
// How far above the surface the camera is stopped. Kept under the bluff's
// standing eye height so it never overrides the opening view.
const CLEARANCE_M = 1;

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export class Nav {
  constructor(camera, dom, orbit, opts = {}) {
    this.camera = camera;
    this.orbit = orbit;
    this.onMode = opts.onMode || (() => {});
    this.floor = opts.floor || null;
    this.mode = "orbit";
    this.tween = null;
    this.keys = {};
    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();

    this.lock = new PointerLockControls(camera, dom);
    this.lock.addEventListener("unlock", () => {
      if (this.mode === "fly") this._setOrbit();
    });

    window.addEventListener("keydown", (e) => this._key(e, true));
    window.addEventListener("keyup", (e) => this._key(e, false));
  }

  goTo(view) {
    if (this.mode === "fly") { if (this.lock.isLocked) this.lock.unlock(); this._setOrbit(); }
    this.orbit.enabled = false;
    this.tween = {
      t: 0,
      fromP: this.camera.position.clone(), toP: view.position.clone(),
      fromT: this.orbit.target.clone(), toT: view.target.clone(),
    };
  }

  toggleFly() {
    if (this.mode === "fly") {
      if (this.lock.isLocked) this.lock.unlock(); // unlock event -> orbit
      else this._setOrbit();
      return;
    }
    this.tween = null;
    this.orbit.enabled = false;
    this.mode = "fly";
    this.onMode("fly");
    this.lock.lock();
  }

  _setOrbit() {
    // Pivot the orbit around a point ahead of where we are looking.
    this.camera.getWorldDirection(this._dir);
    this.orbit.target.copy(this.camera.position).addScaledVector(this._dir, 300);
    this.orbit.enabled = true;
    this.mode = "orbit";
    this.onMode("orbit");
  }

  _key(e, down) {
    this.keys[e.code] = down;
    if (!down) return;
    if (e.code === "KeyV") this.toggleFly();
    const m = /^Digit([1-9])$/.exec(e.code);
    if (m && this.onPreset) this.onPreset(Number(m[1]) - 1);
  }

  _flyStep(dt) {
    const speed = (this.keys.ShiftLeft || this.keys.ShiftRight ? FAST_SPEED : FLY_SPEED) * dt;
    this.camera.getWorldDirection(this._dir);              // includes pitch, so W flies up when looking up
    this._right.crossVectors(this._dir, this.camera.up).normalize();
    const fwd = (this.keys.KeyW ? 1 : 0) - (this.keys.KeyS ? 1 : 0);
    const str = (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0);
    const up = (this.keys.KeyE ? 1 : 0) - (this.keys.KeyQ ? 1 : 0);
    if (fwd) this.camera.position.addScaledVector(this._dir, fwd * speed);
    if (str) this.camera.position.addScaledVector(this._right, str * speed);
    if (up) this.camera.position.y += up * speed;
  }

  // Hold the camera above water and ground. In orbit mode this also stops the
  // drag that would otherwise swing the camera down through the surface.
  _clampFloor() {
    if (!this.floor) return;
    const p = this.camera.position;
    const min = this.floor(p.x, p.z) + CLEARANCE_M;
    if (p.y < min) p.y = min;
  }

  update(dt) {
    if (this.tween) {
      this.tween.t = Math.min(this.tween.t + dt / TWEEN_SECONDS, 1);
      const e = easeInOut(this.tween.t);
      this.camera.position.lerpVectors(this.tween.fromP, this.tween.toP, e);
      this.orbit.target.lerpVectors(this.tween.fromT, this.tween.toT, e);
      this._clampFloor();
      this.camera.lookAt(this.orbit.target);
      if (this.tween.t >= 1) { this.tween = null; this.orbit.enabled = true; }
      return;
    }
    if (this.mode === "fly") { this._flyStep(dt); this._clampFloor(); return; }
    this.orbit.update();
    this._clampFloor();
  }
}
