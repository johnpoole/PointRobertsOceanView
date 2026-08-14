// Tilt the phone and the view turns with it.
//
// This is not live mode. Live mode stands the camera where the phone stands and
// aims it where the phone is aimed, and for that the bearing has to be a real
// bearing — referenced to north, declination taken off, the lot. See live.js.
//
// This only reports how far the phone has turned since the last time it was
// asked. A difference needs no north, so it runs on a device whose orientation
// event is measured from wherever the phone happened to be lying when the page
// opened, which is most of them.
//
// It runs on top of the drag rather than instead of it. That is what a phone
// game does with a gyroscope: the thumb makes the big move and the wrist makes
// the small one.

import * as THREE from "three";

const DEG = Math.PI / 180;
// A phone with a sensor answers in a few frames. This long without one means
// there is nothing to wait for.
const ANSWER_TIMEOUT_MS = 2000;
// A quaternion read back as yaw and pitch comes apart when the phone points at
// the sky or at your feet, and one frame of that would throw the view right
// across the world. A step this big is that, not a turn of the wrist, so it is
// dropped rather than applied.
const MAX_STEP_RAD = 0.5;

export class Gyro {
  constructor() {
    this.running = false;
    this._handler = null;
    this._pending = null;
    this._last = null;      // { yaw, pitch } of the previous reading
    this._yaw = 0;          // radians banked up since take() was last called
    this._pitch = 0;
    this._q = new THREE.Quaternion();
    this._euler = new THREE.Euler(0, 0, 0, "YXZ");
    this._read = new THREE.Euler(0, 0, 0, "YXZ");
    // The camera looks out of the back of the phone, not out of the top: a
    // quarter turn down about the device's own x axis.
    this._qBack = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
    this._qScreen = new THREE.Quaternion();
    this._zee = new THREE.Vector3(0, 0, 1);
  }

  // Ask for the sensor and wait until it has answered once. Rejects with a
  // message fit to put on the screen. Must be called from a tap: iOS hands out
  // the motion permission only inside a user gesture.
  async start() {
    if (this.running) return;
    if (!window.isSecureContext) {
      throw new Error(
        "tilting needs https — a browser gives no motion sensor to a page served over http");
    }
    if (!window.DeviceOrientationEvent) {
      throw new Error("this device reports no orientation, so there is nothing to tilt by");
    }
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      let granted;
      try {
        granted = await DeviceOrientationEvent.requestPermission();
      } catch (err) {
        throw new Error(`the motion permission could not be asked for: ${err.message}`);
      }
      if (granted !== "granted") {
        throw new Error("the motion permission was refused, so tilting cannot turn the view");
      }
    }

    this._handler = (e) => this._orient(e);
    // The plain event, not the absolute one. Only differences are read here, and
    // the plain event is the one every phone has.
    window.addEventListener("deviceorientation", this._handler);
    try {
      await this._firstReading();
    } catch (err) {
      this.stop();
      throw err;
    }
    this.running = true;
  }

  stop() {
    if (this._handler) {
      window.removeEventListener("deviceorientation", this._handler);
      this._handler = null;
    }
    this._pending = null;
    this._last = null;
    this._yaw = 0;
    this._pitch = 0;
    this.running = false;
  }

  // Radians turned since this was last asked, then forgotten. Yaw grows
  // counter-clockwise from above and pitch grows upward, which is how three.js
  // counts them, so a caller adds them straight onto an angle it already holds.
  take() {
    const out = { yaw: this._yaw, pitch: this._pitch };
    this._yaw = 0;
    this._pitch = 0;
    return out;
  }

  _firstReading() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending = null;
        reject(new Error(
          "no orientation reading arrived, so this device has nothing to tilt by"));
      }, ANSWER_TIMEOUT_MS);
      this._pending = () => {
        clearTimeout(timer);
        this._pending = null;
        resolve();
      };
    });
  }

  _orient(e) {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;

    this._euler.set(e.beta * DEG, e.alpha * DEG, -e.gamma * DEG, "YXZ");
    this._q.setFromEuler(this._euler);
    this._q.multiply(this._qBack);
    // Turning the phone sideways turns the picture on it, and the world has to
    // turn back by the same amount.
    const screenDeg = screen.orientation && typeof screen.orientation.angle === "number"
      ? screen.orientation.angle : (window.orientation || 0);
    this._q.multiply(this._qScreen.setFromAxisAngle(this._zee, -screenDeg * DEG));

    this._read.setFromQuaternion(this._q);
    const yaw = this._read.y, pitch = this._read.x;
    if (this._last) {
      let dy = yaw - this._last.yaw;
      if (dy > Math.PI) dy -= 2 * Math.PI;
      else if (dy < -Math.PI) dy += 2 * Math.PI;
      const dp = pitch - this._last.pitch;
      if (Math.abs(dy) < MAX_STEP_RAD && Math.abs(dp) < MAX_STEP_RAD) {
        this._yaw += dy;
        this._pitch += dp;
      }
    }
    this._last = { yaw, pitch };

    if (this._pending) this._pending();
  }
}
