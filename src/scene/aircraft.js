// Aircraft over the strait, from adsb.lol. Mostly the Vancouver floatplane lanes
// and the approach to YVR, which is what actually crosses the view from here.
//
// Drawn the same way as vessels: real position, real altitude, but larger than
// life so a light aircraft three kilometres up is not a single pixel. Forward is
// -Z, matching everything else.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toWorld, headingToYaw } from "../geo.js";

const KN = 0.514444;
// The drawn length is no longer a flat multiple of the real one. A 737 is 4.8
// times a Cessna and the two sizes wanted of them are 3.4 apart, so real length
// is raised to a power under one and the small ones grow more than the large.
//
// The two that set it, at 20 km — the far edge of the feed — on a 900 px screen
// through the 25 degree lens:
//
//   Cessna 172   8.3 m real   197 m drawn    20 px
//   737         39.5 m real   669 m drawn    68 px
//
// LEN_POWER is ln(68/20) / ln(39.5/8.3). Nothing is ever drawn under life size.
const LEN_POWER = 0.7844;
const DRAW_AT_REF_M = 197;      // what an 8.3 m aircraft is drawn at SEEN_M
const DRAW_AT_REF_LEN_M = 8.3;
const SEEN_M = 20000;
// Apparent size falls with the square root of range rather than with range, so
// something at the edge of the feed is still a shape and not a speck.
const ZOOM_POWER = 0.5;

// Rough real lengths, metres, by ICAO type code. Anything unknown is a light
// single, which is most of what flies over Point Roberts.
const TYPE_LEN = {
  DHC2: 9.2, DHC6: 15.8, C172: 8.3, C182: 8.8, C208: 11.5, PA46: 8.7,
  B190: 14.3, BE20: 13.3, PC12: 14.4, SR22: 7.9,
  A319: 33.8, A320: 37.6, A321: 44.5, A20N: 37.6, A21N: 44.5,
  B737: 33.6, B738: 39.5, B739: 42.1, B38M: 39.5, B739ER: 42.1,
  B752: 47.3, B763: 54.9, B772: 63.7, B77W: 73.9, B788: 56.7, B789: 62.8,
  A332: 58.8, A333: 63.7, A359: 66.8, E75L: 31.7, CRJ9: 36.2, DH8D: 32.8,
};

function planeGeometry(lengthM) {
  const L = lengthM;
  const parts = [];
  const fuselage = new THREE.CylinderGeometry(L * 0.055, L * 0.035, L, 8);
  fuselage.rotateX(Math.PI / 2);
  parts.push(fuselage);
  const wing = new THREE.BoxGeometry(L * 1.05, L * 0.018, L * 0.16);
  wing.translate(0, 0, -L * 0.02);
  parts.push(wing);
  const tailplane = new THREE.BoxGeometry(L * 0.38, L * 0.015, L * 0.08);
  tailplane.translate(0, 0, L * 0.42);
  parts.push(tailplane);
  const fin = new THREE.BoxGeometry(L * 0.015, L * 0.13, L * 0.10);
  fin.translate(0, L * 0.07, L * 0.43);
  parts.push(fin);
  return mergeGeometries(parts, false);
}

export class Aircraft {
  constructor(scene) {
    this.scene = scene;
    this.groups = new Map();
  }

  pickList() {
    return Array.from(this.groups.values());
  }

  update(feed, t, camera) {
    for (const [icao, entry] of feed.aircraft) {
      const state = entry.data;
      if (state.latitude == null || state.longitude == null) continue;
      // Some transponders report a position and no altitude. Better to leave
      // one out than to fly it along the surface of the strait.
      if (state.altitude_m == null && !state.on_ground) continue;
      let group = this.groups.get(icao);
      if (!group) {
        const length = TYPE_LEN[state.aircraft_type] || 9;
        const material = new THREE.MeshStandardMaterial({
          color: 0xffffff, roughness: 0.4, metalness: 0.5,
        });
        const mesh = new THREE.Mesh(planeGeometry(length), material);
        group = new THREE.Group();
        group.add(mesh);
        group.userData = { material, length, target: new THREE.Vector3(), placed: false };
        this.scene.add(group);
        this.groups.set(icao, group);
      }
      group.userData.aircraft = state;

      if (state.track_degrees != null) group.rotation.y = headingToYaw(state.track_degrees);

      const w = toWorld(state.latitude, state.longitude, 0);
      const alt = state.altitude_m != null ? state.altitude_m : 0;
      group.userData.target.set(w.x, alt, w.z);
      if (!group.userData.placed) {
        group.position.copy(group.userData.target);
        group.userData.placed = true;
      } else {
        // Six seconds between polls, so carry it along the track in between
        // rather than letting it sit still and jump.
        group.position.lerp(group.userData.target, 0.06);
      }

      const dist = camera ? group.position.distanceTo(camera.position) : group.position.length();
      const real = group.userData.length;
      const drawn = DRAW_AT_REF_M * Math.pow(real / DRAW_AT_REF_LEN_M, LEN_POWER)
        * Math.pow(dist / SEEN_M, ZOOM_POWER);
      group.scale.setScalar(Math.max(drawn / real, 1));

      const stale = feed.isStale(entry, "aircraft");
      const mat = group.userData.material;
      if (stale !== group.userData.stale) {
        mat.color.setHex(stale ? 0x5a626c : 0xffffff);
        mat.transparent = stale;
        mat.opacity = stale ? 0.45 : 1;
        group.userData.stale = stale;
      }
    }

    for (const icao of this.groups.keys()) {
      if (!feed.aircraft.has(icao)) {
        const group = this.groups.get(icao);
        this.scene.remove(group);
        group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
        group.userData.material.dispose();
        this.groups.delete(icao);
      }
    }
  }

  static describe(state) {
    const rows = [];
    rows.push(["flight", state.callsign || state.registration || state.icao]);
    if (state.aircraft_type) rows.push(["type", state.aircraft_type]);
    if (state.on_ground) rows.push(["altitude", "on the ground"]);
    else if (state.altitude_m != null) rows.push(["altitude", `${Math.round(state.altitude_m)} m`]);
    if (state.ground_speed_kn != null) {
      rows.push(["speed", `${Math.round(state.ground_speed_kn)} kn`]);
    }
    if (state.track_degrees != null) rows.push(["track", `${Math.round(state.track_degrees)}°`]);
    if (state.distance_nm != null) rows.push(["range", `${state.distance_nm.toFixed(1)} nm`]);
    return rows;
  }
}
