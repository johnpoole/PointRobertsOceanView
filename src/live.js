// Live: the phone's own view. Where the phone is and where it is pointed set the
// camera, so the screen frames what the camera on the back of it would frame.
//
// Two sensors, and neither is trusted further than it has earned.
//
// Position comes from geolocation. It is good to a few metres across the ground
// and worth nothing up and down — ten to thirty metres of vertical error against
// a bluff that is twenty metres high would stand you under the water or in the
// air — so only the latitude and longitude are taken here and the height comes
// off the baked terrain. See Nav._liveStep.
//
// Direction comes from the orientation event. iOS gives webkitCompassHeading,
// which CoreLocation has already corrected to true north. Android gives an
// absolute alpha off the rotation vector, which is referenced to magnetic north
// and is corrected by nobody. Nothing in the event says which one you are
// holding, and declination at Point Roberts is 15.4° east, so a guess either way
// aims the whole view a hand's width off the island in front of you. So neither
// is corrected and the trim is put on the screen instead: slide it until the
// shoreline on the glass sits on the shoreline out the window.
//
// An orientation event that is not absolute and carries no compass heading is
// measured from wherever the phone happened to be lying when the page opened.
// That is not a bearing. It is refused, and live mode says so rather than
// opening pointed at nothing in particular.

import * as THREE from "three";

const DEG = Math.PI / 180;
// A phone that has a compass answers in well under a second. This long without
// one means there is nothing to wait for.
const ORIENT_TIMEOUT_MS = 4000;
const FIX_TIMEOUT_MS = 20000;

export class Live {
  constructor(opts = {}) {
    // Called when a sensor fails after live mode is already running. The caller
    // drops out of live mode and says why. Nothing carries on off a stale fix.
    this.onFail = opts.onFail || (() => {});

    this.fix = null;              // { lat, lon } of the last position
    this.accuracyM = null;
    this.orientation = new THREE.Quaternion();
    this.trim = 0;                // radians, clockwise, added by hand on screen

    this._watch = null;
    this._event = null;           // which orientation event we are listening to
    this._handler = null;
    this._pending = null;         // resolves the wait for the first bearing
    this._sawRelative = false;    // an orientation event arrived with no north in it

    this._euler = new THREE.Euler();
    // The camera looks out of the back of the phone, not out of the top: a
    // quarter turn down about the device's own x axis.
    this._qBack = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
    this._qScreen = new THREE.Quaternion();
    this._qTrim = new THREE.Quaternion();
    this._zee = new THREE.Vector3(0, 0, 1);
    this._up = new THREE.Vector3(0, 1, 0);
  }

  // Ask for both sensors and wait until each has answered once. Rejects with a
  // message fit to put on the screen; the caller stays where it was.
  //
  // Must be called from a tap: iOS only hands out the orientation permission
  // inside a user gesture, and everything before that first await is still in it.
  async start() {
    if (!window.isSecureContext) {
      throw new Error("live needs https — a browser gives no location or compass to a page served over http");
    }
    if (!navigator.geolocation) {
      throw new Error("this browser has no geolocation, so there is no position to stand at");
    }
    if (!window.DeviceOrientationEvent) {
      throw new Error("this device reports no orientation, so there is no direction to look");
    }
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      let granted;
      try {
        granted = await DeviceOrientationEvent.requestPermission();
      } catch (err) {
        throw new Error(`the compass permission could not be asked for: ${err.message}`);
      }
      if (granted !== "granted") {
        throw new Error("the compass permission was refused, so there is no direction to look");
      }
    }

    this._listen();
    const fixed = this._watchPosition();
    // The wait below can reject first, and a rejected promise nobody is looking
    // at is an unhandled rejection in the console. This handler is only there to
    // be looking; the await further down still gets the failure.
    fixed.catch(() => {});
    try {
      await this._firstBearing();
      await fixed;
    } catch (err) {
      this.stop();
      throw err;
    }
  }

  stop() {
    if (this._watch !== null) {
      navigator.geolocation.clearWatch(this._watch);
      this._watch = null;
    }
    if (this._handler) {
      window.removeEventListener(this._event, this._handler);
      this._handler = null;
      this._event = null;
    }
    this._pending = null;
    this._sawRelative = false;
    this.fix = null;
    this.accuracyM = null;
  }

  _listen() {
    // Chrome fires the absolute event and leaves plain deviceorientation
    // relative. Safari has only the plain one and puts the compass on it.
    this._event = "ondeviceorientationabsolute" in window
      ? "deviceorientationabsolute" : "deviceorientation";
    this._handler = (e) => this._orient(e);
    window.addEventListener(this._event, this._handler);
  }

  _firstBearing() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending = null;
        reject(new Error(this._sawRelative
          ? "this device's orientation is not referenced to north, so live mode has no bearing to aim by"
          : "no compass reading arrived, so there is no direction to look"));
      }, ORIENT_TIMEOUT_MS);
      this._pending = () => {
        clearTimeout(timer);
        this._pending = null;
        resolve();
      };
    });
  }

  _orient(e) {
    const compass = typeof e.webkitCompassHeading === "number" ? e.webkitCompassHeading : null;
    if (compass === null && !e.absolute) { this._sawRelative = true; return; }
    if (e.alpha == null || e.beta == null || e.gamma == null) { this._sawRelative = true; return; }

    // alpha is the turn about the vertical, counted the other way round from a
    // compass bearing, so a heading in hand goes back the same way.
    const alpha = compass === null ? e.alpha * DEG : (360 - compass) * DEG;
    const beta = e.beta * DEG;
    const gamma = e.gamma * DEG;
    const screenDeg = screen.orientation && typeof screen.orientation.angle === "number"
      ? screen.orientation.angle : (window.orientation || 0);

    const q = this.orientation;
    this._euler.set(beta, alpha, -gamma, "YXZ");
    q.setFromEuler(this._euler);
    q.multiply(this._qBack);
    // Turning the phone sideways turns the picture on it, and the world must
    // turn back by the same amount.
    q.multiply(this._qScreen.setFromAxisAngle(this._zee, -screenDeg * DEG));
    // The hand correction, about the world's vertical, so it is a bearing and
    // nothing else. Positive swings the view clockwise.
    q.premultiply(this._qTrim.setFromAxisAngle(this._up, -this.trim));

    if (this._pending) this._pending();
  }

  _watchPosition() {
    return new Promise((resolve, reject) => {
      let first = true;
      this._watch = navigator.geolocation.watchPosition(
        (p) => {
          this.fix = { lat: p.coords.latitude, lon: p.coords.longitude };
          this.accuracyM = p.coords.accuracy;
          if (first) { first = false; resolve(); }
        },
        (err) => {
          const said = `the phone's location is not available: ${err.message}`;
          if (first) { first = false; reject(new Error(said)); }
          else this.onFail(said);
        },
        { enableHighAccuracy: true, timeout: FIX_TIMEOUT_MS, maximumAge: 0 });
    });
  }
}
