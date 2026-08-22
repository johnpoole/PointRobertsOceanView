// Weather applied to the scene: fog from visibility, the state of the air into
// the sky, cloud cover into the lights, wind into the ocean swell, and light
// rain when precipitation is likely. Null fields leave the prior look untouched
// — the feed's "not supplied" is not treated as zero.

import * as THREE from "three";
import { turbidityFromAerosol } from "./skylight.js";

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
    this._view = new THREE.Vector3(0, 0, -1);   // where the fog is being looked through

    scene.fog = new THREE.Fog(this.sky.horizonColor(this._view).clone(), 800, 22000);

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

    // The sky wants the layers and not the total. Low and middle cloud put a lid
    // on it and kill the colour; high cloud stands above the shadow line and is
    // what a good evening is made of. One number for all three cannot tell a
    // fired-up sky from a grey one, which is why the total is no use here.
    const lid = fraction(state.cloud_cover_low_percent, state.cloud_cover_mid_percent);
    const high = state.cloud_cover_high_percent != null
      ? Math.max(0, Math.min(state.cloud_cover_high_percent / 100, 1)) : null;
    this.sky.setAir(turbidityFromAerosol(state.aerosol_optical_depth), lid, high);

    // Lights are cloud dimming times daylight, so both the weather feed and the
    // sun's motion drive them without fighting. This is the total cover, because
    // what the lights want is how much of the sun is getting through.
    const c = this._cloud;
    const df = this.dayFactor;
    this.sun.intensity = 1.25 * (1 - 0.85 * c) * df;
    this.hemi.intensity = (0.45 + 0.35 * c) * (0.2 + 0.8 * df);
    this.ambient.intensity = (0.25 + 0.1 * c) * (0.25 + 0.75 * df);

    // Distance from visibility. The colour is set every frame, in update, because
    // it follows the horizon the camera is pointed at.
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
    // The fog has to be the colour of the sky it fades into, and at sunset the
    // sky behind you is not the colour of the sky ahead. So it follows where the
    // camera is looking.
    camera.getWorldDirection(this._view);
    this.scene.fog.color.copy(this.sky.horizonColor(this._view));

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

// Two cloud layers into the one fraction of sky they shut out between them.
// Either alone can close it, so it is what gets through both that multiplies.
function fraction(lowPercent, midPercent) {
  if (lowPercent == null && midPercent == null) return null;
  const low = lowPercent == null ? 0 : Math.max(0, Math.min(lowPercent / 100, 1));
  const mid = midPercent == null ? 0 : Math.max(0, Math.min(midPercent / 100, 1));
  return 1 - (1 - low) * (1 - mid);
}
