// A thumb stick that turns the view, for a phone.
//
// Two fingers rotate on a desktop trackpad and they do not on a phone: a twist
// that is not perfectly parallel changes the distance at the same time, and the
// gesture is gone before it has turned anything. So the left half of the screen
// gets a stick. One thumb, rotation only, nothing else moving.
//
// It takes the touch before MapControls sees it — window, capture phase, and the
// event stopped there — because MapControls reads one finger as a pan and would
// drag the ground out from under the turn. The right half of the screen is left
// alone and still pans, pinches and twists as it did.

import * as THREE from "three";

const STICK_R = 56;          // pixels from centre to full deflection
const DEAD = 0.12;           // inside this the thumb is resting, not steering
const TURN_RATE = Math.PI / 2;   // radians a second at full deflection
const TILT_RATE = Math.PI / 3;

export class OrbitStick {
  // isOn() says whether the stick should be live at all — the normal view and
  // nothing else. controls is the MapControls the camera hangs off.
  // onGrab is called as the stick opens, to put the pivot on the ground in the
  // middle of the screen. The stick stops the event before the canvas hears it,
  // so the canvas's own handler never runs and this has to do it.
  constructor(camera, controls, ring, knob, isOn, onGrab) {
    if (!ring || !knob) {
      throw new Error(
        "OrbitStick: no ring or knob element. index.html must carry #stick and " +
        "#stick-knob, which is also what the driving stick draws itself with.");
    }
    this.camera = camera;
    this.controls = controls;
    this.ring = ring;
    this.knob = knob;
    this.isOn = isOn;
    this.onGrab = onGrab || (() => {});
    this.held = null;          // { id, x, y } of the thumb holding it
    this.move = { x: 0, y: 0 };
    this._offset = new THREE.Vector3();
    this._spherical = new THREE.Spherical();

    // Capture on the window, so this runs before the canvas hears anything.
    addEventListener("pointerdown", (e) => this._down(e), { capture: true });
    addEventListener("pointermove", (e) => this._move(e), { capture: true });
    addEventListener("pointerup", (e) => this._up(e), { capture: true });
    addEventListener("pointercancel", (e) => this._up(e), { capture: true });
  }

  _release() {
    this.held = null;
    this.move.x = 0;
    this.move.y = 0;
    this.ring.classList.add("hidden");
  }

  _down(e) {
    if (e.pointerType !== "touch" || !this.isOn()) return;
    if (this.held) {
      // A second finger means a pinch, and a pinch is the controls' business.
      // Hand the whole gesture over rather than half-steering through it.
      this._release();
      return;
    }
    if (e.clientX > innerWidth / 2) return;      // the right half is unchanged
    this.onGrab();
    this.held = { id: e.pointerId, x: e.clientX, y: e.clientY };
    this.ring.style.left = `${e.clientX}px`;
    this.ring.style.top = `${e.clientY}px`;
    this.ring.classList.remove("hidden");
    this.knob.style.transform = "translate(-50%, -50%)";
    e.stopPropagation();
    e.preventDefault();
  }

  _move(e) {
    if (!this.held || e.pointerId !== this.held.id) return;
    let dx = (e.clientX - this.held.x) / STICK_R;
    let dy = (e.clientY - this.held.y) / STICK_R;
    const r = Math.hypot(dx, dy);
    if (r > 1) { dx /= r; dy /= r; }
    this.move.x = Math.abs(dx) < DEAD ? 0 : dx;
    this.move.y = Math.abs(dy) < DEAD ? 0 : dy;
    this.knob.style.transform =
      `translate(calc(-50% + ${dx * STICK_R}px), calc(-50% + ${dy * STICK_R}px))`;
    e.stopPropagation();
    e.preventDefault();
  }

  _up(e) {
    if (!this.held || e.pointerId !== this.held.id) return;
    this._release();
    e.stopPropagation();
  }

  // Called from the render loop. Turns the camera about whatever the controls
  // are pivoting on, which is the ground in the middle of the screen.
  update(dt) {
    if (!this.held || (!this.move.x && !this.move.y)) return;
    if (!this.isOn()) { this._release(); return; }
    const c = this.controls;
    this._offset.copy(this.camera.position).sub(c.target);
    this._spherical.setFromVector3(this._offset);
    this._spherical.theta -= this.move.x * TURN_RATE * dt;
    this._spherical.phi = Math.min(
      Math.max(this._spherical.phi - this.move.y * TILT_RATE * dt, c.minPolarAngle),
      c.maxPolarAngle);
    this._spherical.makeSafe();
    this.camera.position.copy(c.target).add(
      this._offset.setFromSpherical(this._spherical));
    this.camera.lookAt(c.target);
    c.update();
  }
}
