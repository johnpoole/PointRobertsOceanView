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

// Rebuild the sea mask when the tide has moved this far. The mask is a flood
// fill over 2.5 M cells, too heavy for every frame and pointless at every
// millimetre.
const MASK_TIDE_STEP_M = 0.05;

// Shared by both water planes. A flat plane at the tide height covers every
// point of ground lower than the tide, including the low fields behind the
// beach ridge that the sea cannot actually reach — the airfield sits at 2.5 to
// 2.8 m MLLW and a 2.7 m tide turned it into a lagoon. uSea marks the cells the
// open water reaches; everywhere else inside the tile the water is not drawn.
const SEA_MASK_GLSL = `
  uniform sampler2D uSea;
  uniform vec2 uBedMin;
  uniform vec2 uBedSize;
  uniform float uHasSea;
  varying vec2 vSeaXZ;
`;

const SEA_MASK_DISCARD = `
  if (uHasSea > 0.5) {
    vec2 suv = (vSeaXZ - uBedMin) / uBedSize;
    bool inside = suv.x >= 0.0 && suv.x <= 1.0 && suv.y >= 0.0 && suv.y <= 1.0;
    if (inside && texture2D(uSea, suv).r < 0.5) discard;
  }
`;

// Both planes are rotated -90 deg about X and moved only in Y, so plane-local
// x,y lands on world x,-z for either of them.
const SEA_MASK_VARYING = "vSeaXZ = vec2(position.x, -position.y);";

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
      uSea: { value: null },                     // 1 where open water reaches
      uHasSea: { value: 0 },
    };
    this._bed = null;
    this._maskTide = null;

    // Far flat water, drawn first, underneath. It reaches across the near tile
    // too, so it needs the same mask or the puddles just show through it.
    const farMat = new THREE.MeshStandardMaterial({
      color: WATER_COLOR, roughness: 0.5, metalness: 0.0,
    });
    farMat.onBeforeCompile = (shader) => {
      for (const name of ["uSea", "uBedMin", "uBedSize", "uHasSea"]) {
        shader.uniforms[name] = this.uniforms[name];
      }
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n varying vec2 vSeaXZ;`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n ${SEA_MASK_VARYING}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n ${SEA_MASK_GLSL}`)
        .replace("#include <clipping_planes_fragment>",
                 `#include <clipping_planes_fragment>\n ${SEA_MASK_DISCARD}`);
    };
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
                          "uBed", "uBedMin", "uBedSize", "uHasBed",
                          "uSea", "uHasSea"]) {
        shader.uniforms[name] = this.uniforms[name];
      }
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n ${SEA_MASK_GLSL}`)
        .replace("#include <clipping_planes_fragment>",
                 `#include <clipping_planes_fragment>\n ${SEA_MASK_DISCARD}`);
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
           varying vec2 vSeaXZ;
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
           transformed.z += _s.x;
           ${SEA_MASK_VARYING}`
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

    this._bed = { heights, ncols, nrows };
    this._sea = new Uint8Array(ncols * nrows);
    this._stack = new Int32Array(ncols * nrows);
    const seaTex = new THREE.DataTexture(this._sea, ncols, nrows, THREE.RedFormat);
    seaTex.minFilter = THREE.NearestFilter;
    seaTex.magFilter = THREE.NearestFilter;
    seaTex.wrapS = THREE.ClampToEdgeWrapping;
    seaTex.wrapT = THREE.ClampToEdgeWrapping;
    this.uniforms.uSea.value = seaTex;
    this.uniforms.uHasSea.value = 1;
    this._maskTide = null;
  }

  // Flood fill inward from the tile edge across everything under the tide. What
  // it reaches is sea; a hollow lower than the tide but walled off from it is
  // dry ground, which is most of the low country behind the beach ridge.
  _rebuildSeaMask(tide) {
    const { heights, ncols, nrows } = this._bed;
    const sea = this._sea, stack = this._stack;
    sea.fill(0);
    let top = 0;
    const push = (idx) => {
      if (sea[idx] === 0 && heights[idx] < tide) { sea[idx] = 1; stack[top++] = idx; }
    };
    for (let j = 0; j < ncols; j++) { push(j); push((nrows - 1) * ncols + j); }
    for (let i = 0; i < nrows; i++) { push(i * ncols); push(i * ncols + ncols - 1); }
    while (top > 0) {
      const idx = stack[--top];
      const i = (idx / ncols) | 0, j = idx - i * ncols;
      if (j > 0) push(idx - 1);
      if (j < ncols - 1) push(idx + 1);
      if (i > 0) push(idx - ncols);
      if (i < nrows - 1) push(idx + ncols);
    }
    this.uniforms.uSea.value.needsUpdate = true;
    this._maskTide = tide;
  }

  setLevel(y) {
    this.mesh.position.y = y;
    this.far.position.y = y - 0.5; // just under the near plane to avoid z-fighting
    this.uniforms.uLevel.value = y;
    if (this._bed && (this._maskTide === null ||
                      Math.abs(y - this._maskTide) > MASK_TIDE_STEP_M)) {
      this._rebuildSeaMask(y);
    }
  }

  update(t) {
    this.uniforms.uTime.value = t;
  }
}
