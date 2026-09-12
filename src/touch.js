// Driving with a finger, and looking about with a drag.
//
// One stick, not two. It is drawn where the thumb lands on the left of the
// screen and vanishes when the thumb lifts: away from you is go, across is
// turn. Look is a drag anywhere else, which on a phone is the right of the
// screen and on a desktop is the mouse anywhere on the canvas. Two visible
// sticks is the usual answer and it covers the view with thumbs and rings, and
// the view is the whole of what this page is for.
//
// The stick itself is nipplejs, which is the library everybody uses for this
// and handles the parts that were wrong here: a second finger landing while the
// first is steering, a thumb sliding off the edge of the screen, a touch that
// the browser cancels, and the ring following the thumb rather than jumping.
// What is left here is the half it does not do — reading a drag as a look — and
// turning its vector into the numbers nav.js already asks for.
//
// This only listens while a vehicle or the boat or free flight is being driven.
// Looking around from the bluff is OrbitControls' own, and it handles a
// touchscreen already.

import nipplejs from "nipplejs";

const DEAD_ZONE = 0.14;    // how far the thumb moves before anything happens
const STICK_PX = 116;      // the ring, corner to corner

export class Touch {
  // dom is what a drag is read off. zone is the strip of screen the stick may
  // be opened in, which is the left half.
  constructor(dom, zone) {
    this.dom = dom;
    this.zone = zone;
    this.active = false;
    this.move = { x: 0, y: 0 };
    this._look = { dx: 0, dy: 0 };
    this._drag = null;    // { id, x, y } of the pointer looking about
    this._held = false;   // a thumb is on the stick
    this._stick = null;

    // A mouse always looks. There is only one of it, and a stick you have to
    // hold with the same pointer you steer with is no stick at all. So the
    // stick is built only where there is a finger to work it.
    if (navigator.maxTouchPoints > 0) this._buildStick();

    dom.addEventListener("pointerdown", (e) => this._down(e));
    dom.addEventListener("pointermove", (e) => this._move(e));
    dom.addEventListener("pointerup", (e) => this._up(e));
    dom.addEventListener("pointercancel", (e) => this._up(e));
  }

  _buildStick() {
    this._stick = nipplejs.create({
      zone: this.zone,
      mode: "dynamic",            // it appears under the thumb, not in a corner
      // The view is what the page is for, so the ring is a dark disc you can
      // see through and the knob a pale one, the way it was drawn by hand.
      color: { back: "rgba(8, 16, 24, 0.30)", front: "rgba(150, 190, 220, 0.32)" },
      size: STICK_PX,
      restJoystick: true,
      multitouch: false,
      maxNumberOfNipples: 1,
      fadeTime: 120,
    });
    // One argument, carrying the data on it. nipplejs handed the handler two
    // up to version 1.
    this._stick.on("start", () => { this._held = true; });
    this._stick.on("move", (e) => {
      const d = e && e.data;
      if (!d || !d.vector) return;
      // vector is a unit vector at the edge of the ring and force is how far
      // out the thumb is, so the two together are how hard you are pushing and
      // which way. Screen up is away from you, which is forward.
      const push = Math.min(d.force, 1);
      const x = d.vector.x * push;
      const y = d.vector.y * push;
      const r = Math.hypot(x, y);
      this.move.x = r < DEAD_ZONE ? 0 : x;
      this.move.y = r < DEAD_ZONE ? 0 : y;
    });
    this._stick.on("end", () => {
      this._held = false;
      this.move.x = 0;
      this.move.y = 0;
    });
  }

  // Whether a thumb is on the stick. An aircraft reads it as the throttle:
  // a hand on the stick is an engine open.
  get steering() {
    return this._held;
  }

  // On while driving, off while looking around from the bluff. With the zone
  // gone the left of the screen is a drag like anywhere else.
  setActive(on) {
    if (this.active === on) return;
    this.active = on;
    this.zone.classList.toggle("hidden", !on);
    if (!on) this._release();
  }

  // Pixels dragged since the last time this was asked, then forgotten. The
  // caller turns them into angles; how far a pixel goes is its business.
  takeLook() {
    const out = { dx: this._look.dx, dy: this._look.dy };
    this._look.dx = 0;
    this._look.dy = 0;
    return out;
  }

  _release() {
    this._drag = null;
    this._held = false;
    this.move.x = 0;
    this.move.y = 0;
    this._look.dx = 0;
    this._look.dy = 0;
    if (this._stick) this._stick.destroy();
    if (this._stick) this._buildStick();
  }

  _down(e) {
    if (!this.active || this._drag) return;
    this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    // Hold the pointer so a finger that slides over one of the buttons keeps
    // looking instead of stopping dead. Only a real pointer can be captured —
    // a synthesised event has no pointer behind it and the call throws.
    if (e.isTrusted) this.dom.setPointerCapture(e.pointerId);
  }

  _move(e) {
    if (!this.active || !this._drag || e.pointerId !== this._drag.id) return;
    this._look.dx += e.clientX - this._drag.x;
    this._look.dy += e.clientY - this._drag.y;
    this._drag.x = e.clientX;
    this._drag.y = e.clientY;
  }

  _up(e) {
    if (this._drag && e.pointerId === this._drag.id) this._drag = null;
  }
}
