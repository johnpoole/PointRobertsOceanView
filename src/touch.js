// Driving with a finger, and looking about with a drag.
//
// One stick, not two. It is drawn where the thumb lands on the left of the
// screen and vanishes when the thumb lifts: away from you is go, across is
// turn. Look is a drag anywhere else, which on a phone is the right of the
// screen and on a desktop is the mouse anywhere on the canvas. Two visible
// sticks is the usual answer and it covers the view with thumbs and rings, and
// the view is the whole of what this page is for.
//
// This only listens while a vehicle or the boat or free flight is being driven.
// Looking around from the bluff is OrbitControls' own, and it handles a
// touchscreen already.

const STICK_R = 58;        // px from the middle of the ring to the stops
const DEAD_ZONE = 0.14;    // how far the thumb moves before anything happens

export class Touch {
  // ring and knob are the two elements drawn for the stick; look is read off
  // whatever else is dragged.
  constructor(dom, ring, knob) {
    this.dom = dom;
    this.ring = ring;
    this.knob = knob;
    this.active = false;
    this.move = { x: 0, y: 0 };
    this._look = { dx: 0, dy: 0 };
    this._stick = null;   // { id, x, y } of the thumb that opened it
    this._drag = null;    // { id, x, y } of the pointer looking about

    dom.addEventListener("pointerdown", (e) => this._down(e));
    dom.addEventListener("pointermove", (e) => this._move(e));
    dom.addEventListener("pointerup", (e) => this._up(e));
    dom.addEventListener("pointercancel", (e) => this._up(e));
  }

  // Whether a thumb is on the stick. An aircraft reads it as the throttle:
  // a hand on the stick is an engine open.
  get steering() {
    return this._stick !== null;
  }

  // On while driving, off while looking around from the bluff.
  setActive(on) {
    if (this.active === on) return;
    this.active = on;
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
    this._stick = null;
    this._drag = null;
    this.move.x = 0;
    this.move.y = 0;
    this._look.dx = 0;
    this._look.dy = 0;
    this.ring.classList.add("hidden");
  }

  _down(e) {
    if (!this.active) return;
    // A mouse always looks. There is only one of it, and a stick you have to
    // hold with the same pointer you steer with is no stick at all.
    const thumb = e.pointerType === "touch";
    if (thumb && !this._stick && e.clientX < window.innerWidth / 2) {
      this._stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.ring.style.left = `${e.clientX}px`;
      this.ring.style.top = `${e.clientY}px`;
      this.knob.style.transform = "translate(-50%, -50%)";
      this.ring.classList.remove("hidden");
    } else if (!this._drag) {
      this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    } else {
      return;
    }
    // Hold the pointer so a thumb that slides over one of the buttons keeps
    // steering instead of stopping dead. Only a real pointer can be captured —
    // a synthesised event has no pointer behind it and the call throws.
    if (e.isTrusted) this.dom.setPointerCapture(e.pointerId);
  }

  _move(e) {
    if (!this.active) return;
    if (this._stick && e.pointerId === this._stick.id) {
      let dx = (e.clientX - this._stick.x) / STICK_R;
      let dy = (e.clientY - this._stick.y) / STICK_R;
      const r = Math.hypot(dx, dy);
      if (r > 1) { dx /= r; dy /= r; }
      // Away from you is forward, so screen-down is negative.
      this.move.x = Math.abs(dx) < DEAD_ZONE ? 0 : dx;
      this.move.y = Math.abs(dy) < DEAD_ZONE ? 0 : -dy;
      this.knob.style.transform =
        `translate(calc(-50% + ${dx * STICK_R}px), calc(-50% + ${dy * STICK_R}px))`;
    } else if (this._drag && e.pointerId === this._drag.id) {
      this._look.dx += e.clientX - this._drag.x;
      this._look.dy += e.clientY - this._drag.y;
      this._drag.x = e.clientX;
      this._drag.y = e.clientY;
    }
  }

  _up(e) {
    if (this._stick && e.pointerId === this._stick.id) {
      this._stick = null;
      this.move.x = 0;
      this.move.y = 0;
      this.ring.classList.add("hidden");
    } else if (this._drag && e.pointerId === this._drag.id) {
      this._drag = null;
    }
  }
}
