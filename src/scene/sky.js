// Gradient sky dome with a soft sun. A large back-faced sphere shaded top-to-
// horizon; cloud cover washes it toward flat grey and dims the sun. The horizon
// colour is exposed so the fog can match it and the ocean fades into the sky.

import * as THREE from "three";

const RADIUS = 26000;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uTop: { value: new THREE.Color(0x2b6bb0) },
      uHorizon: { value: new THREE.Color(0xbcd3e6) },
      uSunDir: { value: new THREE.Vector3(-0.7, 0.35, 0.2).normalize() },
      uSunColor: { value: new THREE.Color(0xfff2d8) },
      uCloud: { value: 0.1 },
    };

    const clearTop = new THREE.Color(0x2b6bb0);
    const clearHorizon = new THREE.Color(0xbcd3e6);
    const greyTop = new THREE.Color(0x7d8792);
    const greyHorizon = new THREE.Color(0xaeb6bd);
    this._clearTop = clearTop;
    this._clearHorizon = clearHorizon;
    this._greyTop = greyTop;
    this._greyHorizon = greyHorizon;

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
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunColor;
        uniform vec3 uSunDir; uniform float uCloud;
        void main() {
          float h = clamp(vDir.y, -0.1, 1.0);
          float t = pow(clamp(h, 0.0, 1.0), 0.6);
          vec3 col = mix(uHorizon, uTop, t);
          float s = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
          float disk = smoothstep(0.9975, 0.9995, s);
          float glow = pow(s, 200.0) * 0.5 + pow(s, 12.0) * 0.12;
          float sun = (disk + glow) * (1.0 - 0.85 * uCloud);
          col += uSunColor * sun;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 32, 16), mat);
    scene.add(mesh);
    this.mesh = mesh;
  }

  setSun(dir, color) {
    this.uniforms.uSunDir.value.copy(dir).normalize();
    if (color) this.uniforms.uSunColor.value.copy(color);
  }

  // cloud 0..1: wash the gradient toward grey.
  setCloud(cloud) {
    const c = Math.max(0, Math.min(cloud, 1));
    this.uniforms.uCloud.value = c;
    this.uniforms.uTop.value.copy(this._clearTop).lerp(this._greyTop, c);
    this.uniforms.uHorizon.value.copy(this._clearHorizon).lerp(this._greyHorizon, c);
  }

  horizonColor() {
    return this.uniforms.uHorizon.value;
  }
}
