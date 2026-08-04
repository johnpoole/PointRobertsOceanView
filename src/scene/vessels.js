// Vessel meshes from the feed. One group per mmsi: a hull sized by dimensions,
// a thin mast so distant traffic leaves a vertical tick, and a screen-constant
// label so it stays findable out in the strait. Positions lerp between reports,
// hulls orient by heading and bob on the swell, stale tracks dim but never drop.

import * as THREE from "three";
import { toWorld, headingToYaw } from "../geo.js";

const DEFAULT = { length: 40, beam: 10, height: 7 };

function makeLabel(text) {
  const pad = 8;
  const font = "500 30px ui-monospace, Menlo, Consolas, monospace";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = 44;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.fillStyle = "rgba(8,16,24,0.7)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(150,190,220,0.5)";
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  ctx.fillStyle = "#cfe4f2";
  ctx.textBaseline = "middle";
  ctx.fillText(text, pad, h / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
  const sprite = new THREE.Sprite(mat);
  // sizeAttenuation defaults true; keep labels constant on screen instead.
  mat.sizeAttenuation = false;
  const screenH = 0.05; // ~5% of viewport height
  sprite.scale.set(screenH * (w / h), screenH, 1);
  sprite._aspect = w / h;
  return sprite;
}

class VesselMesh {
  constructor(scene, state) {
    this.group = new THREE.Group();
    this.labelText = "";
    this.stale = false;

    const dim = state.dimensions_m || {};
    const length = dim.length || DEFAULT.length;
    const beam = dim.beam || DEFAULT.beam;
    const height = Math.max(4, Math.min(beam, DEFAULT.height));

    const hullGeom = new THREE.BoxGeometry(beam, height, length);
    this.hullMat = new THREE.MeshStandardMaterial({ color: 0xb8c2cc, roughness: 0.7, metalness: 0.1 });
    const hull = new THREE.Mesh(hullGeom, this.hullMat);
    hull.position.y = height * 0.25; // sit a touch into the water
    this.group.add(hull);
    this.height = height;

    const mastGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 55, 0),
    ]);
    this.mastMat = new THREE.LineBasicMaterial({ color: 0xffce54, transparent: true, opacity: 0.6 });
    this.group.add(new THREE.Line(mastGeom, this.mastMat));

    this.label = makeLabel(this._labelFor(state));
    this.labelText = this._labelFor(state);
    this.label.position.set(0, 70, 0);
    this.group.add(this.label);

    this.target = new THREE.Vector3();
    this.placed = false;
    scene.add(this.group);
  }

  _labelFor(state) {
    return (state.name && state.name.trim()) || String(state.mmsi);
  }

  update(state, quality, tideLevel, t, stale) {
    const heading = state.true_heading_degrees ?? state.course_over_ground_degrees;
    if (heading != null) this.group.rotation.y = headingToYaw(heading);

    const w = toWorld(state.latitude, state.longitude, 0);
    this.target.set(w.x, tideLevel, w.z);
    if (!this.placed) {
      this.group.position.copy(this.target);
      this.placed = true;
    } else {
      this.group.position.lerp(this.target, 0.08);
    }
    const bob = Math.sin(t * 0.8 + w.x * 0.01) * 0.4;
    this.group.position.y = tideLevel + bob;

    const wanted = this._labelFor(state) + (stale ? " · stale" : "");
    if (wanted !== this.labelText) {
      this.group.remove(this.label);
      this.label.material.map.dispose();
      this.label.material.dispose();
      this.label = makeLabel(wanted);
      this.label.position.set(0, 70, 0);
      this.group.add(this.label);
      this.labelText = wanted;
    }

    if (stale !== this.stale) {
      this.stale = stale;
      this.hullMat.color.set(stale ? 0x6b7480 : 0xb8c2cc);
      this.hullMat.opacity = stale ? 0.55 : 1;
      this.hullMat.transparent = stale;
      this.mastMat.opacity = stale ? 0.25 : 0.6;
      this.label.material.opacity = stale ? 0.5 : 1;
    }
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }
}

export class Vessels {
  constructor(scene) {
    this.scene = scene;
    this.meshes = new Map();
  }

  update(feed, tideLevel, t) {
    for (const [mmsi, entry] of feed.vessels) {
      if (entry.data.latitude == null || entry.data.longitude == null) continue;
      let mesh = this.meshes.get(mmsi);
      if (!mesh) {
        mesh = new VesselMesh(this.scene, entry.data);
        this.meshes.set(mmsi, mesh);
      }
      mesh.update(entry.data, entry.quality, tideLevel, t, feed.isStale(entry));
    }
    // Drop meshes whose mmsi the feed no longer carries (e.g. after a snapshot).
    for (const mmsi of this.meshes.keys()) {
      if (!feed.vessels.has(mmsi)) {
        this.meshes.get(mmsi).dispose(this.scene);
        this.meshes.delete(mmsi);
      }
    }
  }
}
