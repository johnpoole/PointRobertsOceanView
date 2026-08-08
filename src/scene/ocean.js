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

// Matched to the view off the deck rather than to what a sea is supposed to look
// like. This is a shallow strait under a big pale sky and it mirrors it: on the
// photograph the water is silver grey with a little blue in it and sits at about
// four fifths the brightness of the cloud above it.
//
// Matched on that ratio and not on the number. The photograph's sky is brighter
// than this page renders one, so matching the water's absolute value would have
// put the sea brighter than the sky it is reflecting. Measured here: the water
// comes out at 113 against a sky of 135, which is 0.84.
//
// It was 0x2b5566, a deep slate, which rendered at 46 against that same sky —
// a third of it — and made an afternoon in August look like the North Atlantic
// in February.
//
// It is a fixed colour and does not follow the sky, so it will be wrong at
// sunset and wrong under a black squall. What the weather moves is the light on
// it, not this.
const WATER_COLOR = 0xa8b6bd;

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
  uniform vec2 uHullPos;
  uniform vec2 uHullFwd;
  uniform vec2 uHullHalf;
  uniform float uHasHull;
  varying vec2 vSeaXZ;
`;

// The sea is one unbroken plane and knows nothing about a hull sitting in it, so
// it draws straight through an open boat and the waterline turns up inside it —
// worst when it pitches and the transom dips under. Cutting the footprint out
// of the water is the only fix that holds at any angle: an occluder inside the
// hull only works while the whole opening is above the waterline, which stops
// being true past about nine degrees of trim.
const HULL_HOLE_GLSL = `
  if (uHasHull > 0.5) {
    vec2 rel = vSeaXZ - uHullPos;
    float along = dot(rel, uHullFwd);
    float across = dot(rel, vec2(-uHullFwd.y, uHullFwd.x));
    float t = clamp(along / uHullHalf.x, -1.0, 1.0);
    // Narrow toward the stem so the cut follows the waterline, not a box.
    float halfBeam = uHullHalf.y * (1.0 - 0.85 * smoothstep(0.55, 1.0, t));
    if (abs(along) < uHullHalf.x && abs(across) < halfBeam) discard;
  }
`;

const SEA_MASK_DISCARD = `
  if (uHasSea > 0.5) {
    vec2 suv = (vSeaXZ - uBedMin) / uBedSize;
    bool inside = suv.x >= 0.0 && suv.x <= 1.0 && suv.y >= 0.0 && suv.y <= 1.0;
    if (inside && texture2D(uSea, suv).r < 0.5) discard;
  }
` + HULL_HOLE_GLSL;

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
      uHullPos: { value: new THREE.Vector2() },  // a hull's footprint, cut out
      uHullFwd: { value: new THREE.Vector2(0, 1) },
      uHullHalf: { value: new THREE.Vector2() },
      uHasHull: { value: 0 },
    };
    this._bed = null;
    this._maskTide = null;

    // Far flat water, drawn first, underneath. It reaches across the near tile
    // too, so it needs the same mask or the puddles just show through it.
    const farMat = new THREE.MeshStandardMaterial({
      color: WATER_COLOR, roughness: 0.5, metalness: 0.0,
    });
    farMat.onBeforeCompile = (shader) => {
      for (const name of ["uSea", "uBedMin", "uBedSize", "uHasSea",
                          "uHullPos", "uHullFwd", "uHullHalf", "uHasHull"]) {
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
                          "uSea", "uHasSea",
                          "uHullPos", "uHullFwd", "uHullHalf", "uHasHull"]) {
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
    // 255, not 1: a byte texture is normalized to 0..1 in the shader, so a 1
    // arrives as 0.004 and reads as land.
    const push = (idx) => {
      if (sea[idx] === 0 && heights[idx] < tide) { sea[idx] = 255; stack[top++] = idx; }
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

  // Bed height in metres MLLW under a world x,z, or null off the baked tile.
  _bedAt(x, z) {
    if (!this._bed) return null;
    const { heights, ncols, nrows } = this._bed;
    const u = (x - this.uniforms.uBedMin.value.x) / this.uniforms.uBedSize.value.x;
    const v = (z - this.uniforms.uBedMin.value.y) / this.uniforms.uBedSize.value.y;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const j = Math.min(ncols - 1, Math.max(0, Math.round(u * (ncols - 1))));
    const i = Math.min(nrows - 1, Math.max(0, Math.round(v * (nrows - 1))));
    return heights[i * ncols + j];
  }

  // The same swell the vertex shader draws, worked out on the CPU so a boat can
  // ride it. Kept deliberately in step with the GLSL above — the wave sum, the
  // breaker cap and the plane's x,-z mapping all have to match or the hull sits
  // in water that is not where it is drawn.
  surfaceAt(x, z) {
    const level = this.uniforms.uLevel.value;
    const bed = this._bedAt(x, z);
    const depth = bed === null ? 1000 : level - bed;
    const amp0 = Math.min(this.uniforms.uAmp.value,
                          (BREAKER_GAMMA / 2) * Math.max(depth, 0));
    const dir = this.uniforms.uDir.value;
    const base = Math.atan2(dir.y, dir.x);
    const t = this.uniforms.uTime.value;
    const px = x, py = -z;
    let h = 0, gx = 0, gy = 0;
    for (let i = 0; i < 3; i++) {
      const ang = base + (i - 1) * 0.4;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const len = this.uniforms.uLen.value * (1 - 0.35 * i);
      const amp = amp0 * (1 - 0.3 * i);
      const k = (2 * Math.PI) / len;
      const w = Math.sqrt(9.81 * k);
      const ph = k * (dx * px + dy * py) - w * t;
      h += amp * Math.sin(ph);
      const c = amp * k * Math.cos(ph);
      gx += c * dx;
      gy += c * dy;
    }
    // gy is along +py, and py = -z, so the slope along +z is its negative.
    return { y: level + h, dx: gx, dz: -gy, bed };
  }

  // h = { x, z, fx, fz, halfLen, halfBeam } or null to fill the water back in.
  setHull(h) {
    if (!h) { this.uniforms.uHasHull.value = 0; return; }
    this.uniforms.uHullPos.value.set(h.x, h.z);
    this.uniforms.uHullFwd.value.set(h.fx, h.fz);
    this.uniforms.uHullHalf.value.set(h.halfLen, h.halfBeam);
    this.uniforms.uHasHull.value = 1;
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
