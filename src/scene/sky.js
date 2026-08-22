// The sky dome: the Preetham daylight model on a large back-faced sphere, with
// the sun's own disk drawn on top of it. The horizon colour is exposed so the
// fog can match it and the ocean fades into the sky.
//
// The model needs one number for the state of the air and one for the sun, and
// both come from outside: turbidity out of the weather feed's aerosol reading,
// the sun's elevation out of the clock. Everything else is in skylight.js, which
// works out the per-frame constants once on the processor and hands them here as
// uniforms. The shader below evaluates the Perez function and nothing more, so
// there is only the one copy of the difficult arithmetic and the test can reach
// it.
//
// The tone map and the sRGB encode are inside this shader rather than on the
// renderer. Turning tone mapping on for the whole scene would move every colour
// in it, and the water was matched against a photograph by eye.

import * as THREE from "three";
import { NIGHT_SKY, skyColour, skyState } from "./skylight.js";

const RADIUS = 26000;

// Clean coastal air, which is where this sits when the feed has said nothing
// yet. An aerosol depth of about 0.15.
const DEFAULT_TURBIDITY = 2.5;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uPA: { value: new THREE.Vector3() },
      uPB: { value: new THREE.Vector3() },
      uPC: { value: new THREE.Vector3() },
      uPD: { value: new THREE.Vector3() },
      uPE: { value: new THREE.Vector3() },
      uZenith: { value: new THREE.Vector3() },
      uNorm: { value: new THREE.Vector3(1, 1, 1) },
      uSunTint: { value: new THREE.Vector3(1, 1, 1) },
      // Where the sun really is, for its disk, and where the model is allowed to
      // think it is, which is never below the horizon.
      uSunDir: { value: new THREE.Vector3(-0.7, 0.35, 0.2).normalize() },
      uSunSky: { value: new THREE.Vector3(-0.7, 0.35, 0.2).normalize() },
      uExposure: { value: 0.1 },
      uTwilight: { value: 1 },
      uCloud: { value: 0.1 },
      uHigh: { value: 0 },
    };

    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: this.uniforms,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vDir;
        uniform vec3 uPA, uPB, uPC, uPD, uPE;
        uniform vec3 uZenith, uNorm, uSunTint, uSunDir, uSunSky;
        uniform float uExposure, uTwilight, uCloud, uHigh;

        const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
        const vec3 NIGHT = vec3(${NIGHT_SKY.join(", ")});
        const float BEAM_SHARE = 0.7;

        vec3 srgb(vec3 c) {
          c = clamp(c, 0.0, 1.0);
          return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
                     step(vec3(0.0031308), c));
        }

        void main() {
          vec3 dir = normalize(vDir);
          float cosG = clamp(dot(dir, uSunSky), -1.0, 1.0);
          float gamma = acos(cosG);
          float ct = max(dir.y, 0.01);   // the Perez function runs away below

          vec3 F = (1.0 + uPA * exp(uPB / ct))
                 * (1.0 + uPC * exp(uPD * gamma) + uPE * cosG * cosG);
          vec3 xyY = uZenith * F / uNorm;
          float x = xyY.y, y = xyY.z;

          // The colour at unit luminance, then the luminance on top of it.
          vec3 unit = y > 0.0
            ? mat3( 3.2406, -0.9689,  0.0557,
                   -1.5372,  1.8758, -0.2040,
                   -0.4986,  0.0415,  1.0570) * vec3(x / y, 1.0, (1.0 - x - y) / y)
            : vec3(0.0);

          // The light lighting the low sky came the long way in and was reddened
          // on the way. Preetham's chromaticity fit leaves that out.
          float slant = pow(1.0 - clamp(dir.y, 0.0, 1.0), 2.0);
          vec3 red = 1.0 + (uSunTint - 1.0) * slant * BEAM_SHARE;
          vec3 rgb = max(unit, 0.0) * xyY.x * uExposure * red;

          // Cloud scatters every wavelength alike: the same sky with the colour
          // taken out of it and a little of the light with it.
          rgb = mix(rgb, vec3(dot(rgb, LUMA) * 0.85), uCloud);

          // High cloud stands above the shadow line and is lit from beneath.
          rgb = mix(rgb, rgb * uSunTint * 1.7, uHigh * clamp(dir.y / 0.4, 0.0, 1.0));

          // Reinhard on the luminance alone. Squeezing each channel on its own
          // turns every bright sky white, and the sky beside a setting sun is
          // the brightest thing in the frame and the least white.
          float lum = dot(rgb, LUMA);
          rgb = lum > 0.0 ? clamp(rgb * ((lum / (1.0 + lum)) / lum), 0.0, 1.0) : vec3(0.0);
          rgb = rgb * uTwilight + NIGHT * (1.0 - uTwilight);

          // The sun's disk, in the colour the air has left it.
          float s = max(dot(dir, uSunDir), 0.0);
          float sun = smoothstep(0.9975, 0.9995, s) + pow(s, 200.0) * 0.5 + pow(s, 12.0) * 0.12;
          rgb += uSunTint * sun * (1.0 - 0.85 * uCloud) * uTwilight;

          gl_FragColor = vec4(srgb(rgb), 1.0);
        }`,
    });

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 32, 16), mat);
    scene.add(mesh);
    this.mesh = mesh;

    this._turbidity = DEFAULT_TURBIDITY;
    this._elevationDeg = 20;
    this._sunDir = [0, 0.34, -0.94];
    this._scratch = new THREE.Color();
    this._rebuild();
  }

  // dir points at the sun; elevationDeg is its height above the horizon and goes
  // negative after it sets.
  setSun(dir, elevationDeg) {
    this.uniforms.uSunDir.value.copy(dir).normalize();
    this._elevationDeg = elevationDeg;
    this._sunDir = [dir.x, dir.y, dir.z];
    this._rebuild();
  }

  // turbidity from the aerosol reading, or null to leave it where it was. cloud
  // is the low and middle cover that lids the sky, 0..1; high is the thin cloud
  // above it.
  setAir(turbidity, cloud, high) {
    if (turbidity != null) this._turbidity = turbidity;
    if (cloud != null) this.uniforms.uCloud.value = Math.max(0, Math.min(cloud, 1));
    if (high != null) this.uniforms.uHigh.value = Math.max(0, Math.min(high, 1));
    this._rebuild();
  }

  _rebuild() {
    const st = skyState(this._turbidity, this._elevationDeg);
    this.state = st;
    const u = this.uniforms;
    for (const [name, key] of [["uPA", "A"], ["uPB", "B"], ["uPC", "C"], ["uPD", "D"], ["uPE", "E"]]) {
      u[name].value.fromArray(st.perez[key]);
    }
    u.uZenith.value.fromArray(st.zenith);
    u.uNorm.value.fromArray(st.norm);
    u.uSunTint.value.fromArray(st.sun);
    u.uExposure.value = st.exposure;
    u.uTwilight.value = st.twilight;

    // The model is not allowed a sun below the horizon, so it is held there and
    // twilight takes the sky down from then on.
    const d = this._sunDir;
    const flat = Math.hypot(d[0], d[2]) || 1;
    this._sunSky = d[1] >= 0 ? d : [d[0] / flat, 0, d[2] / flat];
    u.uSunSky.value.fromArray(this._sunSky);
  }

  // The sky at the horizon in the given world direction, which is what the fog
  // has to match for the sea to run into it without a seam. Looking west into a
  // sunset that is orange and looking east it is not, so the direction matters.
  horizonColor(dir) {
    const flat = Math.hypot(dir.x, dir.z) || 1;
    const [r, g, b] = skyColour(
      this.state, [dir.x / flat * 0.999, 0.035, dir.z / flat * 0.999], this._sunSky,
      { cloud: this.uniforms.uCloud.value, high: this.uniforms.uHigh.value });
    return this._scratch.setRGB(r, g, b, THREE.SRGBColorSpace);
  }
}
