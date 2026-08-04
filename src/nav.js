// Camera navigation. Two modes over the existing OrbitControls:
//   orbit  - the default look-around, plus smooth tweens to preset viewpoints.
//   walk   - first person: pointer-lock mouse look, WASD/QE move, camera clamped
//            to the terrain height so you walk the bluff and town.
// The render loop calls update(dt); nothing else touches the controls.

import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

const TWEEN_SECONDS = 1.1;
const EYE = 1.7;        // walking eye height above ground
const WALK_SPEED = 22;  // m/s
const RUN_SPEED = 70;

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export class Nav {
  constructor(camera, dom, orbit, opts) {
    this.camera = camera;
    this.orbit = orbit;
    this.groundAt = opts.groundAt;   // (x,z) -> terrain y, or null
    this.seaLevel = opts.seaLevel;   // () -> water y
    this.onMode = opts.onMode || (() => {});
    this.mode = "orbit";
    this.tween = null;
    this.keys = {};

    this.lock = new PointerLockControls(camera, dom);
    this.lock.addEventListener("unlock", () => {
      if (this.mode === "walk") this._setOrbit();
    });

    window.addEventListener("keydown", (e) => this._key(e, true));
    window.addEventListener("keyup", (e) => this._key(e, false));
  }

  goTo(view) {
    if (this.mode === "walk") { this.lock.unlock(); this._setOrbit(); }
    this.orbit.enabled = false;
    this.tween = {
      t: 0,
      fromP: this.camera.position.clone(), toP: view.position.clone(),
      fromT: this.orbit.target.clone(), toT: view.target.clone(),
    };
  }

  toggleWalk() {
    if (this.mode === "walk") {
      if (this.lock.isLocked) this.lock.unlock(); // unlock event -> orbit
      else this._setOrbit();                      // pointer lock never engaged
      return;
    }
    this.tween = null;
    this.orbit.enabled = false;
    this.mode = "walk";
    this.onMode("walk");
    this.lock.lock();
  }

  _setOrbit() {
    // Pivot the orbit around a point ahead of where we are looking.
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.orbit.target.copy(this.camera.position).addScaledVector(dir, 300);
    this.orbit.enabled = true;
    this.mode = "orbit";
    this.onMode("orbit");
  }

  _key(e, down) {
    this.keys[e.code] = down;
    if (!down) return;
    if (e.code === "KeyV") this.toggleWalk();
    const m = /^Digit([1-9])$/.exec(e.code);
    if (m && this.onPreset) this.onPreset(Number(m[1]) - 1);
  }

  _walkStep(dt) {
    const speed = (this.keys.ShiftLeft || this.keys.ShiftRight ? RUN_SPEED : WALK_SPEED) * dt;
    const fwd = (this.keys.KeyW ? 1 : 0) - (this.keys.KeyS ? 1 : 0);
    const str = (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0);
    if (fwd) this.lock.moveForward(fwd * speed);
    if (str) this.lock.moveRight(str * speed);
    const up = (this.keys.KeyE ? 1 : 0) - (this.keys.KeyQ ? 1 : 0);
    // Clamp to the ground (or water surface), plus eye height. Q/E nudge eye.
    const g = this.groundAt(this.camera.position.x, this.camera.position.z);
    const floor = Math.max(g == null ? 0 : g, this.seaLevel());
    this._eyeAdjust = Math.min(Math.max((this._eyeAdjust || 0) + up * dt * 3, 0), 40);
    this.camera.position.y = floor + EYE + this._eyeAdjust;
  }

  update(dt) {
    if (this.tween) {
      this.tween.t = Math.min(this.tween.t + dt / TWEEN_SECONDS, 1);
      const e = easeInOut(this.tween.t);
      this.camera.position.lerpVectors(this.tween.fromP, this.tween.toP, e);
      this.orbit.target.lerpVectors(this.tween.fromT, this.tween.toT, e);
      this.camera.lookAt(this.orbit.target);
      if (this.tween.t >= 1) { this.tween = null; this.orbit.enabled = true; }
      return;
    }
    if (this.mode === "walk") { this._walkStep(dt); return; }
    this.orbit.update();
  }
}
