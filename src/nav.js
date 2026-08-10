// Camera navigation. Three modes over the existing OrbitControls:
//   orbit - the default look-around.
//   fly   - free flight: pointer-lock mouse look, WASD along the look direction,
//           Q/E down/up, Shift to go fast.
//   boat  - a 12 ft aluminium boat with a 4.5 hp outboard. W throttles, A and D
//           work the tiller. The camera sits at the transom and cannot leave it,
//           so the bow is in the view and the horizon moves against it.
//   live  - the phone's own view. Nothing is driven: the camera stands where the
//           phone stands and points where it is pointed. See live.js.
// Both modes are held above the surface. Dropping under the water put the camera
// inside the ocean plane looking up at the underside, which reads as nothing at
// all. opts.floor(x, z) gives the height to stay above.
// The render loop calls update(dt); nothing else touches the controls.

import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { BOAT } from "./scene/boat.js";
import { toWorld } from "./geo.js";

const FLY_SPEED = 60;   // m/s
const FAST_SPEED = 260;
// How far above the surface the camera is stopped. Kept under the bluff's
// standing eye height so it never overrides the opening view.
const CLEARANCE_M = 1;

const KNOT = 0.514444;
// 4.5 hp on a 12 ft hull is marginal for planing, so the boat only just gets
// over the hump at the top of its range. Hull speed for an 11 ft waterline is
// 4.4 kn, the bow starts lifting near 6.6 (speed-length ratio 2.0), and 8 kn is
// the honest ceiling light and flat.
const BOAT_MAX_MPS = 8.0 * KNOT;
const BOAT_PLANE_MPS = 6.6 * KNOT;
const BOAT_ACCEL_TAU = 4.0;   // s, throttle open: a small outboard builds slowly
const BOAT_DECEL_TAU = 2.2;   // s, throttle shut: quick, but it still carries way
// An outboard steers by aiming its thrust: nothing at idle, sharpest at
// displacement speed where the stern swings on thrust alone, stiffer on plane
// where the hull tracks straight.
const BOAT_YAW_MAX = 30 * Math.PI / 180;   // rad/s at full tiller, displacement
const BOAT_YAW_PLANE_FACTOR = 0.6;         // 30 deg/s falls to 18 on plane
const BOAT_YAW_THRUST_FLOOR = 0.45;        // it still pivots on thrust alone
const BOAT_TRIM_MAX = 9 * Math.PI / 180;   // bow-up at the hump
const BOAT_BANK_MAX = 6 * Math.PI / 180;   // banks into the turn, on plane
const BOW_CLEAR_M = 0.06;                  // forefoot held this far clear of it
const LAUNCH_SEARCH_M = 2000;              // how far to look for water
const LAUNCH_STEP_M = 10;                  // spacing of the search
const LAUNCH_DEPTH_M = 0.4;                // enough under it to float clear
const AIR_START_M = 60;                    // height an aircraft is entered at
const AIR_FLOOR_M = 3;                     // and how close to the ground it may fly
const HELM_AFT_M = 1.25;                   // the tiller seat, aft of centre
const HELM_EYE_M = 1.00;                   // eye above the waterline, seated
const LIVE_EYE_M = 1.6;                    // a phone held at eye height, standing
// A fix wanders a few metres where it stands still, and at eye height that reads
// as the whole world sliding about. The camera is walked toward the fix instead
// of set to it, which costs a second of lag on a walking pace.
const LIVE_POS_TAU = 1.0;                  // s

// Where you are looking is not where the thing is pointed. A helmsman watches
// the shore go by without steering at it, and a driver checks a mirror. So the
// hull or the wheels hold their heading and the head turns on top of it, as far
// as a neck goes and no further.
const LOOK_YAW_MAX = 150 * Math.PI / 180;
const LOOK_PITCH_MAX = 78 * Math.PI / 180;
const LOOK_RAD_PER_PX = 0.0035;   // a drag across 900 px is half a turn

function smoothstep(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

function clamp(x, lo, hi) {
  return Math.min(Math.max(x, lo), hi);
}

export class Nav {
  constructor(camera, dom, orbit, opts = {}) {
    this.camera = camera;
    this.orbit = orbit;
    this.onMode = opts.onMode || (() => {});
    this.floor = opts.floor || null;
    // seaAt(x, z) -> { y, dx, dz } : the surface the boat floats on and its
    // slope, whichever is higher of the swell and the ground.
    this.seaAt = opts.seaAt || null;
    this.boatMesh = opts.boatMesh || null;
    // hullHole(h) : cut the hull's footprint out of the water, or null to fill it in.
    this.hullHole = opts.hullHole || null;
    // obstacles() -> [{ x, z, r }] : pilings, other vessels, anything solid.
    this.obstacles = opts.obstacles || null;
    // current() -> { x, z } : the tidal stream in metres a second, world axes,
    // or null when there is no reading. Null means no current, never a guess.
    this.current = opts.current || null;
    // hasGround() -> whether the terrain has loaded. Nothing that travels over
    // the ground may be entered before it has, because seaAt has no seabed to
    // answer with and will say so rather than invent one.
    this.hasGround = opts.hasGround || (() => true);
    // speed is through the water, which is what the throttle sets. course and
    // madeGood are over the ground, which is what the current makes of it.
    this.boat = { yaw: 0, speed: 0, pos: new THREE.Vector3(), trim: 0, bank: 0,
                  throttle: 0, planing: 0, maxSpeed: BOAT_MAX_MPS,
                  course: null, madeGood: 0, set: null, drift: 0 };
    // Walking, bicycle, golf cart, ultralight all ride on this one.
    this.rider = { yaw: 0, speed: 0, pos: new THREE.Vector3(), pitch: 0, roll: 0 };
    this.vehicle = null;
    this.vehicleMesh = null;
    // The phone's sensors, in live mode. Set by enterLive.
    this.live = null;
    this.livePos = null;
    this._liveTarget = new THREE.Vector3();
    // touch: the on-screen stick and the drag that looks about, or null on a
    // machine that has neither.
    this.touch = opts.touch || null;
    // Where the head is turned, in the frame of whatever is carrying it.
    this.look = { yaw: 0, pitch: 0 };
    this._euler = new THREE.Euler(0, 0, 0, "YXZ");
    this._lookEuler = new THREE.Euler(0, 0, 0, "YXZ");
    this._bodyQ = new THREE.Quaternion();
    this._lookQ = new THREE.Quaternion();
    this._offset = new THREE.Vector3();
    this.mode = "orbit";
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

  // What the stick is asking for, zero on a machine with no touch screen.
  _stick() {
    return this.touch ? this.touch.move : { x: 0, y: 0 };
  }

  // Turn the accumulated drag into a head angle. Drag right and you look right,
  // drag down and you look down, the way a mouse does.
  _applyLook() {
    if (!this.touch) return;
    const d = this.touch.takeLook();
    if (!d.dx && !d.dy) return;
    this.look.yaw = clamp(this.look.yaw - d.dx * LOOK_RAD_PER_PX,
                          -LOOK_YAW_MAX, LOOK_YAW_MAX);
    this.look.pitch = clamp(this.look.pitch - d.dy * LOOK_RAD_PER_PX,
                            -LOOK_PITCH_MAX, LOOK_PITCH_MAX);
  }

  // Seat the camera at the driver's eye and point it where the head is turned,
  // which is the body's heading with the look laid on top.
  _seat(pitch, yaw, roll, pos, eyeY, eyeZ) {
    this._euler.set(pitch, yaw, roll);
    this._bodyQ.setFromEuler(this._euler);
    // The seat is bolted to the body, so the offset turns with the body and not
    // with the head. Look over your shoulder and you stay in your seat.
    this._offset.set(0, eyeY, eyeZ).applyQuaternion(this._bodyQ);
    this.camera.position.copy(pos).add(this._offset);
    this._lookEuler.set(this.look.pitch, this.look.yaw, 0);
    this._lookQ.setFromEuler(this._lookEuler);
    this.camera.quaternion.copy(this._bodyQ).multiply(this._lookQ);
  }

  // Face front again, and stop the stick and the drag where they are.
  _resetLook() {
    this.look.yaw = 0;
    this.look.pitch = 0;
    if (this.touch) this.touch.takeLook();
  }

  toggleFly() {
    if (this.mode === "fly") {
      if (this.lock.isLocked) this.lock.unlock(); // unlock event -> orbit
      else this._setOrbit();
      return;
    }
    this.orbit.enabled = false;
    this.mode = "fly";
    this._resetLook();
    if (this.touch) this.touch.setActive(true);
    this.onMode("fly");
    // Only ask for the pointer where there is one to take. On a touch screen
    // the request is refused and the refusal is an unhandled rejection in the
    // console, and the drag looks about perfectly well without it.
    if (window.matchMedia("(pointer: fine)").matches) this.lock.lock();
  }

  // The nearest place the boat will float, searched outward from where you stand.
  // That is the water's edge by definition, so pressing B from the bluff walks
  // you down to the beach rather than launching you on the grass.
  _launchSpot(x0, z0) {
    if (!this.seaAt) return { x: x0, z: z0 };
    for (let r = 0; r <= LAUNCH_SEARCH_M; r += LAUNCH_STEP_M) {
      const steps = r === 0 ? 1 : Math.max(12, Math.round((2 * Math.PI * r) / LAUNCH_STEP_M));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
        const s = this.seaAt(x, z);
        if (!s.aground && s.depth >= LAUNCH_DEPTH_M) return { x, z };
      }
    }
    return { x: x0, z: z0 };
  }

  // Launch at the water's edge, on the surface, pointing where the camera looks.
  toggleBoat(start) {
    if (this.mode === "boat") { this._setOrbit(); return; }
    if (!this.hasGround()) return;   // no seabed to float on yet
    if (this.mode === "fly" && this.lock.isLocked) this.lock.unlock();
    this.orbit.enabled = false;
    if (this.vehicleMesh) this.vehicleMesh.visible = false;
    this.vehicle = null;
    this.camera.getWorldDirection(this._dir);
    const b = this.boat;
    b.yaw = Math.atan2(-this._dir.x, -this._dir.z);
    b.speed = 0;
    b.trim = 0;
    b.bank = 0;
    const from = start ? toWorld(start.lat, start.lon) : this.camera.position;
    const spot = this._launchSpot(from.x, from.z);
    b.pos.set(spot.x, 0, spot.z);
    if (this.boatMesh) this.boatMesh.visible = true;
    this.mode = "boat";
    this._resetLook();
    if (this.touch) this.touch.setActive(true);
    this.onMode("boat");
  }

  // Push the hull out of anything solid it has run into and scrub off the speed
  // that was driving into it, so a glancing blow slides and a head-on stops.
  // The centreline is treated as a segment, the obstacles as circles.
  _resolveCollisions() {
    if (!this.obstacles) return;
    const b = this.boat;
    const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
    const half = BOAT.LENGTH_M / 2, beam = BOAT.BEAM_M / 2;
    for (const o of this.obstacles()) {
      const dx = o.x - b.pos.x, dz = o.z - b.pos.z;
      const t = Math.min(half, Math.max(-half, dx * fx + dz * fz));
      let nx = b.pos.x + fx * t - o.x, nz = b.pos.z + fz * t - o.z;
      const d = Math.hypot(nx, nz);
      const clear = o.r + beam;
      if (d >= clear) continue;
      if (d < 1e-6) { nx = -fx; nz = -fz; } else { nx /= d; nz /= d; }
      b.pos.x += nx * (clear - d);
      b.pos.z += nz * (clear - d);
      const headOn = -(fx * nx + fz * nz);
      if (headOn > 0) b.speed *= Math.max(0, 1 - headOn);
    }
  }

  // Hold a thing to its own element. The boat may not drive up the beach and a
  // golf cart may not drive into the sea; it is the same rule read either way
  // round. A step that lands in the wrong element has the part crossing the
  // shoreline stripped out, so it slides along the water's edge instead, and if
  // even that is wrong it stops. Resting on the line itself is allowed — this
  // only blocks travelling through the other element.
  //
  // pos is mutated in place and carries a speed the caller owns.
  _confine(pos, fromX, fromZ, wantAground, scrub) {
    if (!this.seaAt) return;
    const ok = (x, z) => this.seaAt(x, z).aground === wantAground;
    if (ok(pos.x, pos.z)) return;

    const dx = pos.x - fromX, dz = pos.z - fromZ;
    const d = 3;
    // Uphill from where it ended up. Dry ground is up, so a boat is pushed back
    // downhill and a land vehicle back uphill — the sign falls out of wantAground.
    const gx = this.seaAt(pos.x + d, pos.z).y - this.seaAt(pos.x - d, pos.z).y;
    const gz = this.seaAt(pos.x, pos.z + d).y - this.seaAt(pos.x, pos.z - d).y;
    const gl = Math.hypot(gx, gz);
    if (gl > 1e-6) {
      const s = wantAground ? -1 : 1;
      const ux = (gx / gl) * s, uz = (gz / gl) * s;
      const into = dx * ux + dz * uz;
      if (into > 0) {
        const tx = fromX + (dx - ux * into), tz = fromZ + (dz - uz * into);
        if (ok(tx, tz)) { pos.x = tx; pos.z = tz; return scrub; }
      }
    }
    pos.x = fromX; pos.z = fromZ;
    return 0;
  }

  _keepAfloat(fromX, fromZ) {
    const b = this.boat;
    const keep = this._confine(b.pos, fromX, fromZ, false, 0.75);
    if (keep !== undefined) b.speed *= keep;
  }

  // Walking, bicycle, golf cart, ultralight. The boat keeps its own step because
  // it has real hydrodynamics — trim, planing, riding the swell — that none of
  // these need. W drives, A and D steer, and in the air Q and E lose or gain
  // height. The camera sits at the vehicle's own eye, so a cart driver sees over
  // the bonnet and a walker sees from head height.
  enterVehicle(spec, avatar) {
    if (!this.hasGround()) return;   // nothing to travel over yet
    if (this.mode === "fly" && this.lock.isLocked) this.lock.unlock();
    this.orbit.enabled = false;
    if (this.boatMesh) this.boatMesh.visible = false;
    if (this.hullHole) this.hullHole(null);
    if (this.vehicleMesh) this.vehicleMesh.visible = false;

    this.vehicle = spec;
    this.vehicleMesh = avatar;
    avatar.visible = true;

    this.camera.getWorldDirection(this._dir);
    const v = this.rider;
    v.yaw = Math.atan2(-this._dir.x, -this._dir.z);
    v.speed = spec.medium === "air" ? (spec.stallSpeed || spec.maxSpeed) : 0;
    v.pitch = 0;
    v.roll = 0;
    // Each one is got into where it lives, not wherever the camera happened to
    // be looking from.
    const home = spec.start ? toWorld(spec.start.lat, spec.start.lon) : this.camera.position;
    const spot = spec.medium === "air"
      ? { x: home.x, z: home.z }
      : this._groundSpot(home.x, home.z);
    v.pos.set(spot.x, 0, spot.z);
    if (spec.medium === "air") {
      const g = this.seaAt ? this.seaAt(spot.x, spot.z).y : 0;
      v.pos.y = Math.max(this.camera.position.y, g + AIR_START_M);
    }
    this.mode = "vehicle";
    this._resetLook();
    if (this.touch) this.touch.setActive(true);
    this.onMode("vehicle", spec);
  }

  // The phone's own view. Nothing is driven here — you move it by walking — so
  // there is no stick, no keys and no look drag: the phone is the whole of the
  // control. live is a running Live from live.js, already answering.
  enterLive(live) {
    if (!this.hasGround()) return;   // no ground to stand the eye on
    if (this.mode === "fly" && this.lock.isLocked) this.lock.unlock();
    this.orbit.enabled = false;
    if (this.boatMesh) this.boatMesh.visible = false;
    if (this.hullHole) this.hullHole(null);
    if (this.vehicleMesh) this.vehicleMesh.visible = false;
    this.vehicle = null;
    this.live = live;
    this.livePos = null;   // snapped to the first fix on the next step
    this.mode = "live";
    this._resetLook();
    if (this.touch) this.touch.setActive(false);
    this.onMode("live");
  }

  _liveStep(dt) {
    const fix = this.live.fix;
    if (!fix) return;   // the watch has not answered yet
    const w = toWorld(fix.lat, fix.lon);
    // Whatever is underfoot, which off the bluff is the ground and on the beach
    // at high water is the water. The fix's own altitude is not used: see live.js.
    const y = (this.seaAt ? this.seaAt(w.x, w.z).y : 0) + LIVE_EYE_M;
    this._liveTarget.set(w.x, y, w.z);
    if (!this.livePos) this.livePos = this._liveTarget.clone();
    else this.livePos.lerp(this._liveTarget, 1 - Math.exp(-dt / LIVE_POS_TAU));
    this.camera.position.copy(this.livePos);
    // Taken as it comes. The sensor fusion behind it has already done the
    // smoothing, and a second pass here would only make the view lag the hand.
    this.camera.quaternion.copy(this.live.orientation);
  }

  // Nearest dry ground, the mirror of _launchSpot.
  _groundSpot(x0, z0) {
    if (!this.seaAt) return { x: x0, z: z0 };
    for (let r = 0; r <= LAUNCH_SEARCH_M; r += LAUNCH_STEP_M) {
      const steps = r === 0 ? 1 : Math.max(12, Math.round((2 * Math.PI * r) / LAUNCH_STEP_M));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
        if (this.seaAt(x, z).aground) return { x, z };
      }
    }
    return { x: x0, z: z0 };
  }

  _vehicleStep(dt) {
    const spec = this.vehicle, v = this.rider;
    const air = spec.medium === "air";
    const stick = this._stick();
    // On the ground the stick is what W and S are: push away to go, pull back
    // to reverse. In the air it is the climb instead, because an ultralight
    // that cannot change its height is not flying, and a hand on the stick is
    // taken for an open throttle.
    const held = this.touch ? this.touch.steering : false;
    const throttle = air
      ? ((this.keys.KeyW || held) ? 1 : 0)
      : Math.max(this.keys.KeyW ? 1 : 0, Math.max(stick.y, 0));

    // An aircraft cannot be flown slower than its stall and stay up. Reverse
    // exists only where the real thing has it: a cart does, and you can back up
    // on your own feet; a bicycle and an aircraft cannot.
    const wantBack = this.keys.KeyS || (!air && stick.y < 0);
    const backing = spec.reverse && wantBack && !throttle;
    const target = air
      ? Math.max(spec.stallSpeed || 0, throttle * spec.maxSpeed)
      : (backing ? -spec.reverse : throttle * spec.maxSpeed);
    const tau = target > v.speed ? spec.accelTau : spec.decelTau;
    v.speed += (target - v.speed) * (1 - Math.exp(-dt / tau));

    // D turns right, and so does the stick pushed right. That is the opposite
    // of the boat, whose tiller is pushed the way you do not want to go — a
    // wheel and a pair of feet are not.
    const steer = clamp((this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0) + stick.x, -1, 1);
    // Wheels and wings need to be moving to turn; feet do not. Backing up
    // steers the other way round, the way reversing a car does.
    const bite = spec.pivot ? 1 : smoothstep(0, spec.maxSpeed * 0.35, Math.abs(v.speed));
    const sense = v.speed < 0 ? -1 : 1;
    v.yaw -= steer * (spec.turn * Math.PI / 180) * bite * sense * dt;

    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
    const fromX = v.pos.x, fromZ = v.pos.z;
    v.pos.x += fx * v.speed * dt;
    v.pos.z += fz * v.speed * dt;

    if (air) {
      const lift = clamp((this.keys.KeyE ? 1 : 0) - (this.keys.KeyQ ? 1 : 0) + stick.y, -1, 1);
      v.pos.y += lift * spec.climb * dt;
      const g = this.seaAt ? this.seaAt(v.pos.x, v.pos.z).y : 0;
      if (v.pos.y < g + AIR_FLOOR_M) v.pos.y = g + AIR_FLOOR_M;
      v.pitch = 0;
      v.roll = -steer * (spec.bank * Math.PI / 180) * bite;
    } else {
      const keep = this._confine(v.pos, fromX, fromZ, true, 0.6);
      if (keep !== undefined) v.speed *= keep;
      // Sit on the ground and lie along it.
      const s = this.seaAt ? this.seaAt(v.pos.x, v.pos.z) : { y: 0 };
      v.pos.y = s.y;
      const d = 2;
      const gx = this.seaAt ? (this.seaAt(v.pos.x + d, v.pos.z).y - this.seaAt(v.pos.x - d, v.pos.z).y) / (2 * d) : 0;
      const gz = this.seaAt ? (this.seaAt(v.pos.x, v.pos.z + d).y - this.seaAt(v.pos.x, v.pos.z - d).y) / (2 * d) : 0;
      v.pitch = -Math.atan(gx * fx + gz * fz);
      v.roll = Math.atan(gx * -fz + gz * fx);
    }

    if (this.vehicleMesh) {
      this.vehicleMesh.position.copy(v.pos);
      this.vehicleMesh.rotation.set(0, 0, 0);
      this.vehicleMesh.rotateY(v.yaw);
      this.vehicleMesh.rotateX(v.pitch);
      this.vehicleMesh.rotateZ(v.roll);
    }

    this._applyLook();
    this._seat(v.pitch, v.yaw, v.roll, v.pos, spec.eye.y, spec.eye.z);
  }

  _boatStep(dt) {
    const b = this.boat;

    const stick = this._stick();
    // The stick pushed away opens the throttle, and being a stick it opens it
    // by as much as you push. A 4.5 hp outboard has a twist grip, not a switch.
    const throttle = Math.max(this.keys.KeyW ? 1 : 0, Math.max(stick.y, 0));
    const target = throttle * BOAT_MAX_MPS;
    const tau = target > b.speed ? BOAT_ACCEL_TAU : BOAT_DECEL_TAU;
    b.speed += (target - b.speed) * (1 - Math.exp(-dt / tau));

    // A pushes the tiller handle to port, which turns the boat to starboard.
    // Yaw grows counter-clockwise from above, so starboard is yaw decreasing.
    // The stick is the tiller itself, so it goes the same way round: pushed to
    // port the boat goes to starboard.
    const tiller = clamp((this.keys.KeyA ? 1 : 0) - (this.keys.KeyD ? 1 : 0) - stick.x, -1, 1);
    const planing = smoothstep(BOAT_PLANE_MPS, BOAT_MAX_MPS, b.speed);
    b.throttle = throttle;   // the engine note is driven off these
    b.planing = planing;
    // An outboard steers on thrust, not on speed through the water, so the boat
    // still pivots with the throttle open and no way on — which is what gets it
    // off a piling it has stopped against.
    const bite = Math.max(
      smoothstep(0.5 * KNOT, 3.5 * KNOT, b.speed)
        * (1 - (1 - BOAT_YAW_PLANE_FACTOR) * planing),
      throttle * BOAT_YAW_THRUST_FLOOR,
    );
    b.yaw -= tiller * BOAT_YAW_MAX * bite * dt;

    // The hull's own way through the water, and then the water itself. The
    // current does not turn the boat, it carries it: heading stays where the
    // tiller put it and the wake goes somewhere else. Steer at the marina on an
    // ebb and you will watch yourself go past it.
    const fromX = b.pos.x, fromZ = b.pos.z;
    const through = { x: -Math.sin(b.yaw) * b.speed, z: -Math.cos(b.yaw) * b.speed };
    const stream = this.current ? this.current() : null;
    const overX = through.x + (stream ? stream.x : 0);
    const overZ = through.z + (stream ? stream.z : 0);
    b.pos.x += overX * dt;
    b.pos.z += overZ * dt;
    // What the readout needs: the set being felt, and the course actually made.
    b.set = stream ? stream.set : null;
    b.drift = stream ? stream.drift : 0;
    b.madeGood = Math.hypot(overX, overZ);
    b.course = b.madeGood > 0.05 ? Math.atan2(-overX, -overZ) : null;
    this._resolveCollisions();
    this._keepAfloat(fromX, fromZ);

    // Bow up to the hump, then down as it comes onto plane.
    const hump = smoothstep(0, BOAT_PLANE_MPS, b.speed);
    const trim = BOAT_TRIM_MAX * hump * (1 - planing);
    const bank = -BOAT_BANK_MAX * tiller * planing;

    // Ride the swell: its height sets where the hull sits, its slope sets how
    // it lies on it.
    let surfaceY = 0, slopeX = 0, slopeZ = 0;
    if (this.seaAt) {
      const s = this.seaAt(b.pos.x, b.pos.z);
      surfaceY = s.y; slopeX = s.dx; slopeZ = s.dz;
    }
    b.pos.y = surfaceY;
    const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
    const alongBow = slopeX * fx + slopeZ * fz;      // slope under the keel
    const acrossBeam = slopeX * -fz + slopeZ * fx;   // slope across the beam
    b.trim = trim + Math.atan(alongBow);
    b.bank = bank + Math.atan(acrossBeam);

    // The forefoot never goes under. Lift the bow as far as it takes, measured
    // against the water where the bow actually is rather than under the helm,
    // so the boat rides over a wave face instead of spearing it.
    const half = BOAT.LENGTH_M / 2;
    if (this.seaAt) {
      const bowWater = this.seaAt(b.pos.x + fx * half, b.pos.z + fz * half).y;
      const rise = (bowWater + BOW_CLEAR_M - b.pos.y - BOAT.BOW_KEEL_Y) / half;
      if (rise > -1) b.trim = Math.max(b.trim, Math.asin(Math.min(rise, 1)));
    }

    if (this.hullHole) {
      this.hullHole({
        x: b.pos.x, z: b.pos.z, fx, fz,
        halfLen: BOAT.LENGTH_M / 2, halfBeam: (BOAT.BEAM_M / 2) * 1.04,
      });
    }

    if (this.boatMesh) {
      this.boatMesh.position.copy(b.pos);
      this.boatMesh.rotation.set(0, 0, 0);
      this.boatMesh.rotateY(b.yaw);
      this.boatMesh.rotateX(b.trim);
      this.boatMesh.rotateZ(b.bank);
    }

    // The seat is bolted to the transom and pitches with the hull, which is the
    // whole point: the bow holds still in the frame and the horizon moves. The
    // head turns on top of that, so you can watch the shore go by without
    // steering at it.
    this._applyLook();
    this._seat(b.trim, b.yaw, b.bank, b.pos, HELM_EYE_M, HELM_AFT_M);
  }

  // Put whatever you were in away and go back to looking around.
  toOrbit() { this._setOrbit(); }

  _setOrbit() {
    if (this.boatMesh) this.boatMesh.visible = false;
    if (this.hullHole) this.hullHole(null);
    if (this.vehicleMesh) this.vehicleMesh.visible = false;
    this.vehicle = null;
    // Pivot the orbit around a point ahead of where we are looking.
    this.camera.getWorldDirection(this._dir);
    this.orbit.target.copy(this.camera.position).addScaledVector(this._dir, 300);
    this.orbit.enabled = true;
    this.mode = "orbit";
    this._resetLook();
    // Looking around from the bluff is OrbitControls' own, on a finger as much
    // as on a mouse, so the stick and the drag stand down here.
    if (this.touch) this.touch.setActive(false);
    this.onMode("orbit");
  }

  _key(e, down) {
    this.keys[e.code] = down;
    if (!down) return;
    if (e.code === "KeyV") this.toggleFly();
    if (e.code === "KeyB") this.toggleBoat();
  }

  _flyStep(dt) {
    // With the pointer locked the mouse already turns the camera. Without it —
    // a phone, or a lock the browser would not give — the drag does.
    if (!this.lock.isLocked && this.touch) {
      const d = this.touch.takeLook();
      if (d.dx || d.dy) {
        this._euler.setFromQuaternion(this.camera.quaternion);
        this._euler.y -= d.dx * LOOK_RAD_PER_PX;
        this._euler.x = clamp(this._euler.x - d.dy * LOOK_RAD_PER_PX,
                              -LOOK_PITCH_MAX, LOOK_PITCH_MAX);
        this._euler.z = 0;
        this.camera.quaternion.setFromEuler(this._euler);
      }
    }
    const speed = (this.keys.ShiftLeft || this.keys.ShiftRight ? FAST_SPEED : FLY_SPEED) * dt;
    this.camera.getWorldDirection(this._dir);              // includes pitch, so W flies up when looking up
    this._right.crossVectors(this._dir, this.camera.up).normalize();
    const stick = this._stick();
    // Nothing to stand on up here, so the stick flies you along the way you are
    // looking. Look down and go forward and you descend, which is how a camera
    // in free flight has always worked.
    const fwd = clamp((this.keys.KeyW ? 1 : 0) - (this.keys.KeyS ? 1 : 0) + stick.y, -1, 1);
    const str = clamp((this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0) + stick.x, -1, 1);
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
    // No floor clamp in boat mode: the boat already floats on the surface, and the
    // clamp would shove the camera up off the transom. Nor in live mode, where
    // the eye is already set from the ground under the phone.
    if (this.mode === "live") { this._liveStep(dt); return; }
    if (this.mode === "vehicle") { this._vehicleStep(dt); return; }
    if (this.mode === "boat") { this._boatStep(dt); return; }
    if (this.mode === "fly") { this._flyStep(dt); this._clampFloor(); return; }
    this.orbit.update();
    this._clampFloor();
  }
}
