// Weather applied to the scene: fog from visibility, sky/light dimming from
// cloud cover, wind into the ocean swell, and light rain when precipitation is
// likely. Null fields leave the prior look untouched — the feed's "not supplied"
// is not treated as zero.

import * as THREE from "three";

const RAIN_COUNT = 2500;
const RAIN_BOX = 1200;   // metres around the camera the rain fills
const RAIN_TOP = 400;

export class Weather {
  constructor(scene, refs) {
    this.scene = scene;
    this.sky = refs.sky;
    this.ocean = refs.ocean;
    this.sun = refs.sun;
    this.hemi = refs.hemi;
    this.ambient = refs.ambient;

    this.dayFactor = 1;   // 1 full daylight, 0 night; set from the sun elevation
    this._cloud = 0.1;    // last known cloud fraction, so time updates keep it

    scene.fog = new THREE.Fog(this.sky.horizonColor().clone(), 800, 22000);

    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(RAIN_COUNT * 3);
    for (let i = 0; i < RAIN_COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * RAIN_BOX;
      pos[i * 3 + 1] = Math.random() * RAIN_TOP;
      pos[i * 3 + 2] = (Math.random() - 0.5) * RAIN_BOX;
    }
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x9fb4c4, size: 1.4, transparent: true, opacity: 0.5,
      sizeAttenuation: true, depthWrite: false,
    });
    this.rain = new THREE.Points(geom, mat);
    this.rain.visible = false;
    this.rainOn = false;
    scene.add(this.rain);
  }

  apply(state) {
    if (!state) return;

    if (state.cloud_cover_percent != null) {
      this._cloud = Math.max(0, Math.min(state.cloud_cover_percent / 100, 1));
    }
    // Lights are cloud dimming times daylight, so both the weather feed and the
    // sun's motion drive them without fighting.
    const c = this._cloud;
    const df = this.dayFactor;
    this.sky.setCloud(c);
    this.sky.setDaylight(df);
    this.sun.intensity = 1.25 * (1 - 0.85 * c) * df;
    this.hemi.intensity = (0.45 + 0.35 * c) * (0.2 + 0.8 * df);
    this.ambient.intensity = (0.25 + 0.1 * c) * (0.25 + 0.75 * df);

    // Fog colour tracks the (possibly greyed) horizon; distance from visibility.
    this.scene.fog.color.copy(this.sky.horizonColor());
    if (state.visibility_m != null) {
      const far = Math.max(1200, Math.min(state.visibility_m, 30000));
      this.scene.fog.far = far;
      this.scene.fog.near = far * 0.04;
    }

    // Prefer real wave height for the sea state; fall back to wind if the marine
    // feed had no waves.
    if (state.wave_height_m != null) {
      this.ocean.setWaves(state.wave_height_m, state.wave_direction_degrees, state.wave_period_s);
    } else {
      this.ocean.setWind(state.wind_direction_degrees, state.wind_speed_mps);
    }

    const precip = state.precipitation_probability_percent;
    this.rainOn = precip != null && precip >= 55;
    this.rain.visible = this.rainOn;
  }

  update(dt, camera) {
    if (!this.rainOn) return;
    const pos = this.rain.geometry.attributes.position;
    const arr = pos.array;
    const fall = 220 * dt;
    for (let i = 0; i < RAIN_COUNT; i++) {
      arr[i * 3 + 1] -= fall;
      if (arr[i * 3 + 1] < 0) arr[i * 3 + 1] = RAIN_TOP;
    }
    pos.needsUpdate = true;
    // Keep the rain box centred on the camera so it never runs out.
    this.rain.position.set(camera.position.x, 0, camera.position.z);
  }
}
