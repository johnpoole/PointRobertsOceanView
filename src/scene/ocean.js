// Ocean plane with cheap vertex-shader swell. A single large plane laid flat,
// displaced in the vertex stage by three summed directional waves whose primary
// heading follows the wind. Normals are computed analytically from the wave
// gradient so lighting and the sky reflection read right. MeshStandardMaterial
// via onBeforeCompile keeps three's fog and lighting for free — no custom pipe.

import * as THREE from "three";

const SIZE = 40000;     // 40 km square: reaches the ~16 km horizon on clear days
const SEGMENTS = 600;   // ~62 m spacing; long swell resolves, stays light on Iris Xe

export class Ocean {
  constructor(scene) {
    const geom = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);

    this.uniforms = {
      uTime: { value: 0 },
      uDir: { value: new THREE.Vector2(0, 1) }, // wave travel dir, local (east,north)
      uAmp: { value: 0.25 },                    // metres, scaled by wind
      uLen: { value: 120.0 },                   // base wavelength, metres
    };

    const mat = new THREE.MeshStandardMaterial({
      color: 0x2b5566,
      roughness: 0.35,
      metalness: 0.0,
      transparent: true,
      opacity: 0.92,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uDir = this.uniforms.uDir;
      shader.uniforms.uAmp = this.uniforms.uAmp;
      shader.uniforms.uLen = this.uniforms.uLen;

      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
           uniform float uTime; uniform vec2 uDir; uniform float uAmp; uniform float uLen;
           // Three summed sine waves about the primary direction. Returns height in
           // .x and the (d/dx, d/dy) gradient in .yz, all in local plane space.
           vec3 swell(vec2 p) {
             float h = 0.0; vec2 dh = vec2(0.0);
             float baseDir = atan(uDir.y, uDir.x);
             for (int i = 0; i < 3; i++) {
               float fi = float(i);
               float ang = baseDir + (fi - 1.0) * 0.4;
               vec2 d = vec2(cos(ang), sin(ang));
               float len = uLen * (1.0 - 0.35 * fi);
               float amp = uAmp * (1.0 - 0.3 * fi);
               float k = 6.2831853 / len;
               float w = sqrt(9.81 * k);
               float ph = k * dot(d, p) - w * uTime;
               h += amp * sin(ph);
               dh += amp * k * d * cos(ph);
             }
             return vec3(h, dh);
           }`
        )
        .replace(
          "#include <beginnormal_vertex>",
          `vec3 _s = swell(position.xy);
           vec3 objectNormal = normalize(vec3(-_s.y, -_s.z, 1.0));
           #ifdef USE_TANGENT
             vec3 objectTangent = vec3(1.0, 0.0, 0.0);
           #endif`
        )
        .replace(
          "#include <begin_vertex>",
          `vec3 transformed = vec3(position);
           transformed.z += _s.x;`
        );
    };

    const mesh = new THREE.Mesh(geom, mat);
    mesh.rotation.x = -Math.PI / 2; // lay flat: local +Z becomes world +Y (up)
    mesh.position.y = 0;
    scene.add(mesh);
    this.mesh = mesh;
  }

  // Wind: direction it comes FROM (deg true) and speed (m/s). Waves travel the
  // way the wind blows (from + 180). Local plane axes are (east, north).
  setWind(fromDeg, speedMps) {
    if (fromDeg != null) {
      const toward = (fromDeg + 180) * Math.PI / 180;
      // east = sin(bearing), north = cos(bearing)
      this.uniforms.uDir.value.set(Math.sin(toward), Math.cos(toward)).normalize();
    }
    if (speedMps != null) {
      this.uniforms.uAmp.value = Math.min(0.12 + speedMps * 0.05, 1.2);
      this.uniforms.uLen.value = 80 + speedMps * 8;
    }
  }

  setLevel(y) {
    this.mesh.position.y = y;
  }

  update(t) {
    this.uniforms.uTime.value = t;
  }
}
