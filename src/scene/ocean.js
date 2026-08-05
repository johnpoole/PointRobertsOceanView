// Ocean in two planes. A near plane carries the cheap vertex-shader swell where
// it reads; a large far plane is flat water that reaches past the Gulf Islands so
// the strait is filled to the skyline. Both sit at the tide height. Normals on
// the near plane come from the wave gradient so lighting and sky reflect right.
// MeshStandardMaterial via onBeforeCompile keeps three's fog and lighting.
//
// The swell is capped by the water it stands in. Without that cap the whole
// sheet heaves as one rigid surface, and over the Point Roberts tidal flat —
// 106 m wide at 1:48 — a half-metre swell walks the waterline back and forth
// across 24 m of beach. Real waves break instead: height cannot exceed about
// 0.78 of the depth. Amplitude is half the height, so the cap is 0.39 * depth,
// taken from the baked bed heights and the current tide.

import * as THREE from "three";

const NEAR_SIZE = 24000;   // where waves are worth resolving
const NEAR_SEG = 512;      // ~47 m spacing
const FAR_SIZE = 100000;   // reaches beyond the far terrain tile

const BREAKER_GAMMA = 0.78; // depth-limited breaking, H <= gamma * depth

const WATER_COLOR = 0x2b5566;

export class Ocean {
  constructor(scene) {
    this.uniforms = {
      uTime: { value: 0 },
      uDir: { value: new THREE.Vector2(0, 1) },
      uAmp: { value: 0.25 },
      uLen: { value: 120.0 },
      uLevel: { value: 0 },                      // tide height, m MLLW
      uBed: { value: null },                     // bed heights, m MLLW, north row first
      uBedMin: { value: new THREE.Vector2() },   // world x,z of the bed tile's NW corner
      uBedSize: { value: new THREE.Vector2() },  // world extent of the bed tile
      uHasBed: { value: 0 },
    };

    // Far flat water, drawn first, underneath.
    const farMat = new THREE.MeshStandardMaterial({
      color: WATER_COLOR, roughness: 0.5, metalness: 0.0,
    });
    const far = new THREE.Mesh(new THREE.PlaneGeometry(FAR_SIZE, FAR_SIZE, 1, 1), farMat);
    far.rotation.x = -Math.PI / 2;
    far.renderOrder = 0;
    scene.add(far);
    this.far = far;

    // Near wavy water.
    const mat = new THREE.MeshStandardMaterial({
      color: WATER_COLOR, roughness: 0.35, metalness: 0.0,
      transparent: true, opacity: 0.92,
    });
    mat.onBeforeCompile = (shader) => {
      for (const name of ["uTime", "uDir", "uAmp", "uLen", "uLevel",
                          "uBed", "uBedMin", "uBedSize", "uHasBed"]) {
        shader.uniforms[name] = this.uniforms[name];
      }
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
           uniform float uTime; uniform vec2 uDir; uniform float uAmp; uniform float uLen;
           uniform float uLevel; uniform sampler2D uBed;
           uniform vec2 uBedMin; uniform vec2 uBedSize; uniform float uHasBed;

           // Water depth under a world x,z. Off the baked tile there is no bed,
           // so the water is deep and the swell runs at full height.
           float depthAt(vec2 world) {
             if (uHasBed < 0.5) return 1000.0;
             vec2 uv = (world - uBedMin) / uBedSize;
             if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1000.0;
             return uLevel - texture2D(uBed, uv).r;
           }

           vec3 swell(vec2 p, float depth) {
             // Depth-limited breaking. Deep water leaves uAmp untouched.
             float amp0 = min(uAmp, ${(BREAKER_GAMMA / 2).toFixed(3)} * max(depth, 0.0));
             float h = 0.0; vec2 dh = vec2(0.0);
             float baseDir = atan(uDir.y, uDir.x);
             for (int i = 0; i < 3; i++) {
               float fi = float(i);
               float ang = baseDir + (fi - 1.0) * 0.4;
               vec2 d = vec2(cos(ang), sin(ang));
               float len = uLen * (1.0 - 0.35 * fi);
               float amp = amp0 * (1.0 - 0.3 * fi);
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
          // The plane is rotated -90 deg about X, so local x,y lands on world x,-z.
          `vec3 _s = swell(position.xy, depthAt(vec2(position.x, -position.y)));
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
    const near = new THREE.Mesh(new THREE.PlaneGeometry(NEAR_SIZE, NEAR_SIZE, NEAR_SEG, NEAR_SEG), mat);
    near.rotation.x = -Math.PI / 2;
    near.renderOrder = 1;
    scene.add(near);
    this.mesh = near;
  }

  setWind(fromDeg, speedMps) {
    if (fromDeg != null) {
      const toward = (fromDeg + 180) * Math.PI / 180;
      this.uniforms.uDir.value.set(Math.sin(toward), Math.cos(toward)).normalize();
    }
    if (speedMps != null) {
      this.uniforms.uAmp.value = Math.min(0.12 + speedMps * 0.05, 1.2);
      this.uniforms.uLen.value = 80 + speedMps * 8;
    }
  }

  // Real sea state from the marine feed. Amplitude is half the wave height;
  // wavelength from the period, clamped so short chop does not alias. FROM dir.
  setWaves(heightM, fromDeg, periodS) {
    if (fromDeg != null) {
      const toward = (fromDeg + 180) * Math.PI / 180;
      this.uniforms.uDir.value.set(Math.sin(toward), Math.cos(toward)).normalize();
    }
    if (heightM != null) {
      this.uniforms.uAmp.value = Math.min(Math.max(heightM / 2, 0.05), 2.5);
    }
    if (periodS != null) {
      this.uniforms.uLen.value = Math.max(70, 1.56 * periodS * periodS);
    }
  }

  // Baked bed heights so the swell knows how deep the water under it is.
  // heights are metres MLLW, row-major, north row first. min/size are the tile's
  // world-space x,z corner and extent.
  setBed(heights, ncols, nrows, min, size) {
    const tex = new THREE.DataTexture(heights, ncols, nrows, THREE.RedFormat, THREE.FloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.uniforms.uBed.value = tex;
    this.uniforms.uBedMin.value.copy(min);
    this.uniforms.uBedSize.value.copy(size);
    this.uniforms.uHasBed.value = 1;
  }

  setLevel(y) {
    this.mesh.position.y = y;
    this.far.position.y = y - 0.5; // just under the near plane to avoid z-fighting
    this.uniforms.uLevel.value = y;
  }

  update(t) {
    this.uniforms.uTime.value = t;
  }
}
