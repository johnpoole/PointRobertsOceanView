// The view, in the address bar.
//
// Where you are standing and what you are looking at go into the URL hash, and
// the hash is rewritten as you move, so the address bar is always the view on the
// screen. There is nothing to press. Copy it out of the bar and someone else gets
// what you are looking at; reload it and you are back where you were.
//
// A viewpoint, not a vehicle. What is written down is the eye position and a
// point three hundred metres down the line of sight, taken from the camera
// itself, so it does not matter whether it was captured from the bluff or the
// boat or in free flight — it reconstructs as a look-around view either way. You
// cannot hand somebody your boat.
//
// Latitude and longitude rather than the world's metres, because those mean
// something on their own and they survive any change to where the origin sits.
// Six decimal places is about 110 mm, which is finer than the terrain.

import * as THREE from "three";
import { fromWorld, toWorld } from "./geo.js";

const AIM_M = 300;           // how far down the line of sight the aim point sits
const DEG = 6;               // decimal places on a bearing
const M = 1;                 // decimal places on a height
// The address bar is the only way this is shared, so it should not trail the view
// by long. Not much under this either: browsers rate-limit replaceState, Firefox
// at about one every 300 ms, and this runs from the render loop.
const REWRITE_MS = 600;

const _dir = new THREE.Vector3();

function place(x, y, z) {
  const { lat, lon } = fromWorld(x, z);
  return `${lat.toFixed(DEG)},${lon.toFixed(DEG)},${y.toFixed(M)}`;
}

function readPlace(text) {
  const bits = String(text).split(",");
  if (bits.length !== 3) return null;
  const lat = Number(bits[0]), lon = Number(bits[1]), y = Number(bits[2]);
  if (![lat, lon, y].every(Number.isFinite)) return null;
  const w = toWorld(lat, lon, y);
  return new THREE.Vector3(w.x, w.y, w.z);
}

// The hash for the view as it stands. extras are the switches worth carrying —
// only the ones that are on, so a plain view makes a short link.
export function viewHash(camera, extras = {}) {
  camera.getWorldDirection(_dir);
  const eye = camera.position;
  const aim = _dir.multiplyScalar(AIM_M).add(eye);
  const parts = [`eye=${place(eye.x, eye.y, eye.z)}`,
                 `aim=${place(aim.x, aim.y, aim.z)}`];
  for (const [k, v] of Object.entries(extras)) if (v) parts.push(`${k}=1`);
  return `#${parts.join("&")}`;
}

// What a hash asks for, or null if there is nothing usable in it. A malformed
// link is ignored rather than half applied: half a viewpoint is worse than none.
export function readViewHash(hash) {
  const text = String(hash || "").replace(/^#/, "");
  if (!text) return null;
  const got = {};
  for (const pair of text.split("&")) {
    const eq = pair.indexOf("=");
    if (eq > 0) got[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  const eye = readPlace(got.eye);
  const aim = readPlace(got.aim);
  if (!eye || !aim) return null;
  return { eye, aim, brademy: got.brademy === "1", map: got.map === "1" };
}

// Keeps the address bar on the current view, and hands out the link.
// extras() returns the switches, read fresh each time.
export class Share {
  constructor(camera, extras = () => ({})) {
    this.camera = camera;
    this.extras = extras;
    this._last = "";
    this._due = 0;
  }

  // Called from the render loop. replaceState rather than pushState: the back
  // button should leave the page, not walk back through every metre travelled.
  update(nowMs) {
    if (nowMs < this._due) return;
    this._due = nowMs + REWRITE_MS;
    const hash = viewHash(this.camera, this.extras());
    if (hash === this._last) return;
    this._last = hash;
    history.replaceState(null, "", hash);
  }

}
