// Terrain mesh from a baked GMRT heightmap. Each grid node is a real lat/lon with
// an elevation in metres above MLLW, projected to world coords with the shared geo
// transform. Two tiles are built: a near tile for the tide-driven foreground, and
// a far tile for the Gulf Islands skyline across the strait. The waterline is not
// drawn here — the ocean plane at the tide height covers every node below it.

import * as THREE from "three";
import { toWorld } from "../geo.js";

const SKYLINE_HAZE = new THREE.Color(0x8295a8);

// Half a metre to a band, while the ground is banded by height. The beach falls
// about a metre in twenty, so a metre to a band would put two bands on the whole
// of it; the bank east of the house climbs eighteen degrees and would have forty.
const BAND_STEP_M = 0.5;

// The flat of the beach is sand. Where it tilts it is shingle: rounded grey and
// brown stone, no two square metres the same colour. Slope is what sorts them —
// the sea takes the fines off anything that leans and leaves the stone behind.
const SAND = new THREE.Color(0x9c8f6f);
const SHINGLE = new THREE.Color(0x767065);

// Rise over run. Flat berm and tide flat below the first, bluff toe and berm lip
// above the second.
const SAND_SLOPE = 0.05;
const STONE_SLOPE = 0.22;
// Above this the grass starts and there is no beach left to gravel.
const BEACH_TOP_M = 6.0;

// Pea gravel, an inch and under. Far too small to be geometry — a beach of it
// is millions of stones — so it is laid on per pixel instead, at the size the
// stones actually are. It fades out with distance because past forty metres an
// inch is smaller than a pixel, and drawing it there only makes it crawl.
const GRAVEL_M = 0.025;
const GRAVEL_COARSE_M = 0.07;
const GRAVEL_DEPTH = 0.16;
const GRAVEL_FADE_NEAR_M = 12.0;
const GRAVEL_FADE_FAR_M = 45.0;

// Value noise off the grid indices. Not smooth, and it does not need to be:
// what is wanted is speckle at about the size of a stone.
//
// Integer mixing rather than the usual sin-and-take-the-fraction. This is
// called some seven million times building the near tile and the trigonometric
// version took seven seconds of it.
function speckle(row, col) {
  let h = Math.imul(row, 73856093) ^ Math.imul(col, 19349663);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// What is on the ground, by NLCD class. Land cover says what grows or is built;
// it says nothing about the beach, because at 30 m a 20 m strip of shingle
// falls inside whichever cell it happens to touch.
const COVER_COLORS = {
  21: 0x8d9077,   // developed, open space — lawns, verges, the golf course
  22: 0x8a8574,   // developed, low — houses among trees
  23: 0x8d8880,   // developed, medium
  24: 0x91908c,   // developed, high — the pavement
  31: 0xa49984,   // barren
  41: 0x4e6b33,   // deciduous forest
  42: 0x2c4526,   // evergreen forest
  43: 0x3d5a2d,   // mixed forest
  52: 0x6a7046,   // shrub
  71: 0x7c8455,   // grassland
  81: 0x7d8a44,   // hay and pasture
  82: 0x8a7f3f,   // cultivated crops
  90: 0x435339,   // woody wetland
  95: 0x5b6a47,   // emergent wetland
};
const COVER_WATER = new Set([11, 12]);

// The beach runs from the water to about here. Below it elevation and slope
// decide; above it the land cover does; between, they cross over.
const BEACH_ONLY_M = 3.0;
export const COVER_ONLY_M = 6.5;

// Ground dries and pales as it climbs away from the sea, whatever is growing on
// it. This is the elevation still speaking after the class has had its say.
const EXPOSURE_TOP_M = 60.0;
const EXPOSURE_LIGHTEN = 0.06;

// Made once. This runs per vertex and the near tile has three and a half
// million of them; five colours built on every call cost seconds.
const GRASS = new THREE.Color(0x4f6b3a);
const FOREST = new THREE.Color(0x2f4a28);
const FLOOR = new THREE.Color(0x24322f);
const scratchBeach = new THREE.Color();
const scratchLand = new THREE.Color();

// Lighten or darken in place. offsetHSL converts to HSL and back on every call,
// which for a nudge this small is a lot of arithmetic to arrive at a multiply.
function shade(color, amount) {
  const k = 1 + amount * 2;
  color.r = Math.min(Math.max(color.r * k, 0), 1);
  color.g = Math.min(Math.max(color.g * k, 0), 1);
  color.b = Math.min(Math.max(color.b * k, 0), 1);
}

function colorForGround(elev, target, row, col, slope, cover) {
  const grass = GRASS;
  const forest = FOREST;
  const floor = FLOOR;
  const beach = scratchBeach;
  const land = scratchLand;
  if (elev < 0) {
    target.copy(floor);
    return target;
  }
  const stony = Math.min(Math.max((slope - SAND_SLOPE) / (STONE_SLOPE - SAND_SLOPE), 0), 1);
  beach.copy(SAND).lerp(SHINGLE, stony);
  // Only the stone is mottled. Sand is even, which is what makes it read as sand.
  if (stony > 0) {
    shade(beach, (speckle(row, col) - 0.5) * 0.16 * stony);
  }
  if (elev < BEACH_ONLY_M) {
    target.copy(beach);
    return target;
  }

  // Above the beach the class decides, and height alone is the fallback for
  // cells the survey does not cover — the Canadian end of the tile.
  const known = COVER_COLORS[cover];
  if (known != null && !COVER_WATER.has(cover)) {
    land.setHex(known);
    // A patch of one class is not one colour. Break it up at the vertex.
    shade(land, (speckle(row + 7919, col + 104729) - 0.5) * 0.07);
  } else {
    land.copy(grass).lerp(forest, Math.min(Math.max((elev - 14) / 40, 0), 1));
  }
  // Then elevation modulates whatever it turned out to be.
  const exposure = Math.min(Math.max(elev / EXPOSURE_TOP_M, 0), 1);
  shade(land, EXPOSURE_LIGHTEN * exposure);

  if (elev < COVER_ONLY_M) {
    target.copy(beach).lerp(land, (elev - BEACH_ONLY_M) / (COVER_ONLY_M - BEACH_ONLY_M));
  } else {
    target.copy(land);
  }
  return target;
}

// Lays gravel on whatever the stony attribute says is stony. Two octaves of
// value noise in world metres, one at the size of a pea and one at the size of
// the patches they gather in, darkening and lightening the ground rather than
// tinting it — wet stone and dry stone next to each other, not a colour wash.
//
// A photograph thrown onto the ground from where it was taken, the way a slide
// projector would, so the picture lies over the terrain in depth instead of
// across the screen and you can walk away from the camera and see whether it
// still sits on the ground it was taken of.
//
// There is no depth test against the projector, so ground the camera cannot see
// — the far side of a bank — is painted as though it could. Nothing to do about
// that short of a shadow map, and it is obvious enough on the screen.
//
// The camera is a fisheye and a straight lens cannot undo that by being given a
// wider angle: the two disagree by more the further out you look, which is why
// the middle of a frame can sit right on the ground while the edges are metres
// off. So the ground is not put through a lens at all. Every fragment is turned
// into a direction from the camera, and the direction is read straight off the
// picture the way the lens laid it down — angle from the axis carried to a
// radius from the centre of the frame, in proportion. That is the equidistant
// model, which is what a wide security lens is built to, and the only number in
// it is how far off the axis the corner of the frame sits.
//
// projLens.z is how far a ray may run before it stops painting, in metres, or 0
// for no limit. A camera that looks up a hill sends most of its rays over the
// crest, and past the crest the ground falls away and the ray grazes on for
// tens of kilometres before it meets anything. Without a limit a photograph of a
// bank twenty metres off gets smeared across the far side of the strait.
const PROJECTOR_GLSL_FRAGMENT = `
  vec3 projRgb = vec3(0.0);
  float projOn = 0.0;
  if (projMix > 0.0) {
    vec3 pc = (projView * vec4(vGroundPos, 1.0)).xyz;
    if (pc.z < 0.0 && (projLens.z <= 0.0 || length(pc) <= projLens.z)) {
      float off = length(pc.xy);
      float theta = atan(off, -pc.z);       // angle off the axis
      if (theta < projLens.x) {
        vec2 dir = off > 1e-6 ? pc.xy / off : vec2(0.0);
        // Radius in frame heights: the corner of the frame is the far edge.
        float r = (theta / projLens.x) * 0.5 * sqrt(projLens.y * projLens.y + 1.0);
        vec2 puv = vec2(0.5 + r * dir.x / projLens.y, 0.5 + r * dir.y);
        if (puv.x >= 0.0 && puv.x <= 1.0 && puv.y >= 0.0 && puv.y <= 1.0) {
          projRgb = texture2D(projMap, puv).rgb;
          projOn = projMix;
        }
      }
    }
  }
`;

// One white pixel, so the sampler has something to point at before a photograph
// is handed over. A null sampler is a link error, not an empty picture.
function blankMap() {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

// Anything drawn as its own geometry that has to catch the same photograph — the
// stair, and whatever follows it — needs the same few lines in its shader and
// the same uniform objects, so one project() call moves all of it at once.
function dressAnything(material, projector) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.projView = projector.view;
    shader.uniforms.projLens = projector.lens;
    shader.uniforms.projMap = projector.map;
    shader.uniforms.projMix = projector.mix;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `
        #include <common>
        varying vec3 vGroundPos;
      `)
      .replace("#include <begin_vertex>", `
        #include <begin_vertex>
        vGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `
        #include <common>
        varying vec3 vGroundPos;
        uniform mat4 projView;
        uniform vec3 projLens;
        uniform sampler2D projMap;
        uniform float projMix;
      `)
      .replace("#include <color_fragment>", `
        #include <color_fragment>
        ${PROJECTOR_GLSL_FRAGMENT}
      `)
      .replace("#include <colorspace_fragment>", `
        gl_FragColor.rgb = mix(gl_FragColor.rgb, projRgb, projOn);
        #include <colorspace_fragment>
      `);
  };
  material.customProgramCacheKey = () => "projected";
}

// A screen for the half of the frame that lands on nothing.
//
// The projection needs ground to fall on, and above the island skyline there is
// none: those rays go over the horizon and out of the world. So the islands show
// up in a frame as a band a few pixels deep at the very top of what is painted,
// which is the worst thing there is to line up on — an edge against an edge,
// with the whole sky above it blank.
//
// This is a sphere the projector sits at the middle of, out past the far tile
// and inside the camera's far plane, showing nothing except where the photograph
// falls on it. Every ray hits it, so the whole frame is on it; the ground and
// the islands stand in front and cover their own parts, and what is left showing
// is exactly the part that had nowhere to land. The skyline in the photograph
// then has the rendered skyline in front of it and the two can be read against
// each other.
//
// Being a sphere around the camera rather than a plane means nothing for the
// comparison: the picture is cast along rays from the eye, so seen from the eye
// it sits in the right direction whatever shape it lands on.
const SCREEN_RADIUS_M = 120000;

export function buildScreen(scene) {
  const projector = {
    view: { value: new THREE.Matrix4() },
    lens: { value: new THREE.Vector3(1, 16 / 9, 0) },
    map: { value: blankMap() },
    mix: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      projView: projector.view, projLens: projector.lens,
      projMap: projector.map, projMix: projector.mix,
    },
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,   // it is behind everything; it must not mask anything
    // Written out by hand, so it does not get the logarithmic depth transform
    // the built-in materials get. Without it the screen tests its depth against
    // a buffer written the other way. See main.js.
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vGroundPos;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vGroundPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      varying vec3 vGroundPos;
      uniform mat4 projView;
      uniform vec3 projLens;
      uniform sampler2D projMap;
      uniform float projMix;
      void main() {
        #include <logdepthbuf_fragment>
        ${PROJECTOR_GLSL_FRAGMENT}
        // Off the frame there is no screen at all, only sky.
        if (projOn <= 0.0) discard;
        gl_FragColor = vec4(projRgb, projOn);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(SCREEN_RADIUS_M, 48, 24), material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  // Same call as a tile's, so one loop moves the ground and the screen together.
  const project = (map, camera, mix, lens) => {
    if (map) projector.map.value = map;
    if (camera) {
      camera.updateMatrixWorld();
      projector.view.value.copy(camera.matrixWorldInverse);
      // The screen belongs to the camera, so it moves with it. Off centre, the
      // frame would land on it stretched to one side.
      mesh.position.setFromMatrixPosition(camera.matrixWorld);
    }
    if (lens) projector.lens.value.set(lens.corner, lens.aspect, lens.range || 0);
    projector.mix.value = mix;
  };
  return { mesh, project };
}

function dressGround(material, projector, gravel) {
  material.onBeforeCompile = (shader) => {
    if (projector) {
      shader.uniforms.projView = projector.view;
      shader.uniforms.projLens = projector.lens;
      shader.uniforms.projMap = projector.map;
      shader.uniforms.projMix = projector.mix;
      shader.uniforms.projBand = projector.band;
      shader.uniforms.projBandStep = projector.bandStep;
    }
    if (gravel) {
    shader.uniforms.gravelSize = { value: GRAVEL_M };
    shader.uniforms.gravelCoarse = { value: GRAVEL_COARSE_M };
    shader.uniforms.gravelDepth = { value: GRAVEL_DEPTH };
    shader.uniforms.gravelFade = {
      value: new THREE.Vector2(GRAVEL_FADE_NEAR_M, GRAVEL_FADE_FAR_M),
    };
    }

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `
        #include <common>
        ${gravel ? `
        attribute float stony;
        varying float vStony;
        ` : ""}
        varying vec3 vGroundPos;
      `)
      .replace("#include <begin_vertex>", `
        #include <begin_vertex>
        ${gravel ? "vStony = stony;" : ""}
        vGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `
        #include <common>
        varying vec3 vGroundPos;
        ${gravel ? `
        varying float vStony;
        uniform float gravelSize;
        uniform float gravelCoarse;
        uniform float gravelDepth;
        uniform vec2 gravelFade;
        ` : ""}
        ${projector ? `
        uniform mat4 projView;
        uniform vec3 projLens;   // x: angle to the frame's corner, y: aspect, z: reach
        uniform sampler2D projMap;
        uniform float projMix;
        uniform float projBand;      // 1 while the ground is banded by height
        uniform float projBandStep;  // metres to a band

        vec3 hsv2rgb(vec3 c) {
          vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
          vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
          return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
        }
        ` : ""}

        float hash21(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float valueNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
      `)
      .replace("#include <colorspace_fragment>", `
        ${projector ? `
        // After the light, not before it. A photograph taken at noon put into
        // the diffuse colour is shaded by whatever the sun is doing now, and in
        // the evening that turns it black — which reads as the photograph
        // having failed to load.
        gl_FragColor.rgb = mix(gl_FragColor.rgb, projRgb, projOn);
        ` : ""}
        #include <colorspace_fragment>
      `)
      .replace("#include <color_fragment>", `
        #include <color_fragment>
        ${gravel ? `
        if (vStony > 0.001) {
          // Wrapped to a kilometre first: world coordinates run to thousands of
          // metres and a float cannot hold both that and a 25 mm stone.
          vec2 ground = mod(vGroundPos.xz, 1000.0);
          float stones = valueNoise(ground / gravelSize) - 0.5;
          float patches = valueNoise(ground / gravelCoarse) - 0.5;
          float dist = length(vGroundPos - cameraPosition);
          float near = 1.0 - smoothstep(gravelFade.x, gravelFade.y, dist);
          float grit = (stones * 0.7 + patches * 0.3) * gravelDepth * vStony * near;
          diffuseColor.rgb = clamp(diffuseColor.rgb * (1.0 + grit * 2.0), 0.0, 1.0);
        }
        ` : ""}
        ${projector ? `
        // Height in bands, for lining a photograph up. Sand and grass and shingle
        // all read the same under a photograph laid over them, so the shape of
        // the ground is invisible where it matters. This throws the ground colour
        // away and puts the height there instead. The hue jumps a long way each
        // band so that neighbours never look alike; it says nothing about how
        // high, only where the ground changes.
        if (projBand > 0.5) {
          float band = floor(vGroundPos.y / projBandStep);
          diffuseColor.rgb = hsv2rgb(vec3(fract(band * 0.137), 0.85, 0.95));
        }
        ` : ""}
        ${projector ? PROJECTOR_GLSL_FRAGMENT : ""}
      `);
  };
  // A material whose shader is rewritten needs its own program.
  material.customProgramCacheKey = () =>
    `terrain${gravel ? "-gravel" : ""}${projector ? "-proj" : ""}`;
}

// fetch resolves for a 404 and a 500 as happily as for a 200 — only a network
// failure rejects. Left unchecked, an error page came back as twenty-one bytes,
// went into an Int16Array, and built three and a half million vertices whose
// height was undefined. The tile drew as nothing, the ground sampler answered
// NaN, the audio was handed a non-finite number, and the page reported that it
// had loaded.
async function grab(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `${url}: HTTP ${res.status} ${res.statusText}. The baked assets are served ` +
      `from the same origin as the page, so this is a deploy or a build problem ` +
      `and not a network one.`);
  }
  return res;
}

// asset: { heightmap, meta }. opts: { haze 0..1, hazeGrade [nearM,farM,nearHaze,
// farHaze], fog, yOffset }. hazeGrade ramps haze with distance for atmospheric
// perspective, so nearer islands read crisp and far mountains fade.
export async function buildTerrain(scene, asset, opts = {}) {
  const haze = opts.haze || 0;
  const grade = opts.hazeGrade || null;
  const fog = opts.fog !== false;
  const yOffset = opts.yOffset || 0;

  const meta = await (await grab(asset.meta)).json();
  const bin = await (await grab(asset.heightmap)).arrayBuffer();

  // What is on the ground, if this tile has it. Its grid is its own: 30 m cells
  // over the same box, so a vertex is looked up by where it is, not by index.
  let cover = null;
  if (opts.landcover) {
    const cMeta = await (await fetch(opts.landcover.meta)).json();
    const cBin = new Uint8Array(await (await fetch(opts.landcover.cover)).arrayBuffer());
    const want = cMeta.grid.nrows * cMeta.grid.ncols;
    if (cBin.length !== want) {
      throw new Error(
        `${opts.landcover.cover}: ${cBin.length} bytes, but the meta says ` +
        `${cMeta.grid.nrows} x ${cMeta.grid.ncols} = ${want}. Re-run build_landcover.py.`);
    }
    cover = { meta: cMeta, codes: cBin };
  }
  // Nearest cell, with the lookup nudged by up to half a cell so a 30 m grid
  // does not draw the peninsula as squares. The nudge is the vertex's own
  // speckle, so it is the same every time rather than shimmering.
  const coverAt = (lat, lon, row, col) => {
    if (!cover) return 0;
    const { nrows, ncols } = cover.meta.grid;
    const b = cover.meta.box;
    const fx = (lon - b.min_lon) / (b.max_lon - b.min_lon) * ncols
      + (speckle(row * 3, col * 3) - 0.5);
    const fy = (b.max_lat - lat) / (b.max_lat - b.min_lat) * nrows
      + (speckle(col * 5, row * 5) - 0.5);
    const j = Math.min(Math.max(Math.floor(fx), 0), ncols - 1);
    const i = Math.min(Math.max(Math.floor(fy), 0), nrows - 1);
    return cover.codes[i * ncols + j];
  };
  const { nrows, ncols, cellsize_deg, north_lat, west_lon, dtype, scale_m } = meta.grid;
  // The heightmap has to be the size the metadata says it is. A short file does
  // not fail, it reads as undefined past its end, and undefined heights become
  // NaN positions that three will happily draw.
  const sampleBytes = dtype === "int16" ? 2 : 4;
  const wantBytes = nrows * ncols * sampleBytes;
  if (bin.byteLength !== wantBytes) {
    throw new Error(
      `${asset.heightmap}: ${bin.byteLength} bytes, but ${asset.meta} says ` +
      `${nrows} x ${ncols} of ${dtype} = ${wantBytes}. Re-run ` +
      `scripts/build_terrain.py, or check what the server actually served.`);
  }
  // Stored as int16 decimetres to keep the file small; everything downstream
  // works in metres, so scale once here and hand on a Float32Array.
  let Z;
  if (dtype === "int16") {
    const counts = new Int16Array(bin);
    Z = new Float32Array(counts.length);
    for (let i = 0; i < counts.length; i++) Z[i] = counts[i] * scale_m;
  } else if (dtype === "float32") {
    Z = new Float32Array(bin);
  } else {
    throw new Error(`${asset.heightmap}: grid dtype is ${dtype}, expected int16 or float32`);
  }
  // Cells the tile does not cover, e.g. the far tile's hole under the near tile.
  const nodata = meta.nodata != null ? meta.nodata : null;
  const isValueHole = (v) => nodata != null && v <= nodata / 2;

  // Something the bake could not hold, cut into the ground before anything reads
  // it. carve(lat, lon, height) hands back the height it wants there. The stair
  // is the case it exists for: see stairCarve in stair.js.
  //
  // Here rather than on the mesh, because the mesh is not the only thing that
  // asks. sample() is built off this same array below, and that is what the
  // floor, the trees, the beach and the boat all read. A cut in the mesh alone
  // would draw a channel and leave the sampler swearing the bank was still there.
  if (opts.carve) {
    for (let i = 0; i < nrows; i++) {
      const lat = north_lat - i * cellsize_deg;
      for (let j = 0; j < ncols; j++) {
        const n = i * ncols + j;
        if (isValueHole(Z[n])) continue;
        Z[n] = opts.carve(lat, west_lon + j * cellsize_deg, Z[n]);
      }
    }
  }

  // Ground a better tile covers, as a test on the point rather than a box: the
  // fine tile over the lot is a rectangle in Washington South, which is turned
  // against latitude and longitude, so its edge is not a box here. The far
  // tile's hole is baked into its own file; this one is applied at load, so a
  // re-bake of the coarse tile cannot quietly lose it.
  const inHole = opts.hole || (() => false);

  const count = nrows * ncols;
  // One mask for both reasons a vertex is not drawn, so everything downstream
  // asks the same question once instead of two different ones.
  const holed = new Uint8Array(count);
  for (let i = 0; i < nrows; i++) {
    const lat = north_lat - i * cellsize_deg;
    for (let j = 0; j < ncols; j++) {
      const n = i * ncols + j;
      if (isValueHole(Z[n]) || inHole(lat, west_lon + j * cellsize_deg)) holed[n] = 1;
    }
  }
  const isHole = (n) => holed[n] === 1;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  // How stony this vertex is, 0 on the sand and 1 on the steep. The fragment
  // shader reads it to know where to lay the gravel.
  const stony = new Float32Array(count);
  const tmp = new THREE.Color();

  // One cell on the ground, for the slope. A degree of latitude is 111320 m and
  // a degree of longitude is that times the cosine of where you are standing.
  const cellNorthM = cellsize_deg * 111320;
  const cellEastM = cellNorthM * Math.cos((north_lat * Math.PI) / 180);

  for (let i = 0; i < nrows; i++) {
    const lat = north_lat - i * cellsize_deg;
    for (let j = 0; j < ncols; j++) {
      const lon = west_lon + j * cellsize_deg;
      const raw = Z[i * ncols + j];
      // Hole vertices are never indexed, but they still sit in the position
      // buffer, so give them a finite height or the bounding sphere goes bad
      // and three culls the whole mesh.
      const elev = isHole(i * ncols + j) ? 0 : raw;
      const w = toWorld(lat, lon, elev);
      const idx = (i * ncols + j) * 3;
      positions[idx] = w.x;
      positions[idx + 1] = w.y;
      positions[idx + 2] = w.z;
      // Slope from the cells either side. The edges have no neighbour, and the
      // edge of the tile is nowhere near the beach, so they take zero.
      let slope = 0;
      if (i > 0 && i < nrows - 1 && j > 0 && j < ncols - 1) {
        const iUp = (i - 1) * ncols + j, iDown = (i + 1) * ncols + j;
        const iLeft = i * ncols + j - 1, iRight = i * ncols + j + 1;
        if (!isHole(iUp) && !isHole(iDown) && !isHole(iLeft) && !isHole(iRight)) {
          slope = Math.hypot((Z[iUp] - Z[iDown]) / (2 * cellNorthM),
                             (Z[iRight] - Z[iLeft]) / (2 * cellEastM));
        }
      }
      colorForGround(elev, tmp, i, j, slope, coverAt(lat, lon, i, j));
      stony[i * ncols + j] = elev < BEACH_TOP_M
        ? Math.min(Math.max((slope - SAND_SLOPE) / (STONE_SLOPE - SAND_SLOPE), 0), 1)
        : 0;
      let h = haze;
      if (grade) {
        // Not a straight ramp. On a clear morning the near island reads almost
        // its own colour and the far ones wash out to nearly sky, and a straight
        // line between the two ends puts too much haze on the near one and not
        // enough on the far — everything comes out the same middling grey and
        // you cannot tell what is twenty kilometres off from what is sixty.
        // Eased at both ends instead, which is what the photographs show.
        const d = Math.hypot(w.x, w.z);
        const tg = Math.min(Math.max((d - grade[0]) / (grade[1] - grade[0]), 0), 1);
        const ease = tg * tg * (3 - 2 * tg);
        h = grade[2] + (grade[3] - grade[2]) * ease;
      }
      if (h > 0) tmp.lerp(SKYLINE_HAZE, h); // atmospheric perspective for distance
      colors[idx] = tmp.r;
      colors[idx + 1] = tmp.g;
      colors[idx + 2] = tmp.b;
    }
  }

  const indices = new Uint32Array((nrows - 1) * (ncols - 1) * 6);
  let k = 0;
  for (let i = 0; i < nrows - 1; i++) {
    for (let j = 0; j < ncols - 1; j++) {
      const a = i * ncols + j;
      const b = a + 1;
      const c = a + ncols;
      const d = c + 1;
      if (isHole(a) || isHole(b) || isHole(c) || isHole(d)) continue;
      indices[k++] = a; indices[k++] = c; indices[k++] = b;
      indices[k++] = b; indices[k++] = c; indices[k++] = d;
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geom.setAttribute("stony", new THREE.BufferAttribute(stony, 1));
  geom.setIndex(new THREE.BufferAttribute(indices.subarray(0, k), 1));
  geom.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 0, fog,
  });
  // Held here rather than in the shader object, because onBeforeCompile runs
  // once and whoever hands over a photograph does it long afterwards.
  const projector = opts.projector
    ? { view: { value: new THREE.Matrix4() },
        lens: { value: new THREE.Vector3(1, 16 / 9, 0) },
        map: { value: blankMap() }, mix: { value: 0 },
        band: { value: 0 }, bandStep: { value: BAND_STEP_M } }
    : null;
  const gravel = opts.gravel !== false;
  if (gravel || projector) dressGround(mat, projector, gravel);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.y = yOffset;
  scene.add(mesh);

  // Bilinear height lookup (metres MLLW) for draping map features on the ground.
  // Out-of-tile lat/lon clamp to the nearest edge.
  const sample = (lat, lon) => {
    let fi = Math.min(Math.max((north_lat - lat) / cellsize_deg, 0), nrows - 1);
    let fj = Math.min(Math.max((lon - west_lon) / cellsize_deg, 0), ncols - 1);
    const i0 = Math.floor(fi), j0 = Math.floor(fj);
    const i1 = Math.min(i0 + 1, nrows - 1), j1 = Math.min(j0 + 1, ncols - 1);
    const ti = fi - i0, tj = fj - j0;
    const top = Z[i0 * ncols + j0] * (1 - tj) + Z[i0 * ncols + j1] * tj;
    const bot = Z[i1 * ncols + j0] * (1 - tj) + Z[i1 * ncols + j1] * tj;
    return top * (1 - ti) + bot * ti;
  };
  // Throw a photograph on the ground, or take it off with mix 0. camera stands
  // where the photograph was taken and points where it pointed; only where it
  // is and how it is turned are used, because the lens is not a straight one and
  // is dealt with in the shader. lens is { corner, aspect, range }: the angle
  // from the axis out to the corner of the frame, in radians, the frame's shape,
  // and how far a ray may run before it stops painting, in metres, or 0 for as
  // far as there is ground.
  const project = (map, camera, mix, lens) => {
    if (!projector) {
      throw new Error(
        "buildTerrain: this tile was not built with opts.projector, so there is " +
        "no projector in its shader to hand a photograph to.");
    }
    if (map) projector.map.value = map;
    if (camera) {
      camera.updateMatrixWorld();
      projector.view.value.copy(camera.matrixWorldInverse);
    }
    if (lens) projector.lens.value.set(lens.corner, lens.aspect, lens.range || 0);
    projector.mix.value = mix;
  };
  // Throw the ground colour away and put the height there instead.
  const bands = (on) => {
    if (!projector) {
      throw new Error(
        "buildTerrain: this tile was not built with opts.projector, so its " +
        "shader has no height bands to turn on.");
    }
    projector.band.value = on ? 1 : 0;
  };
  return { mesh, meta, sample, heights: Z, cover, project, bands,
           projector: projector ? { dress: (m) => dressAnything(m, projector) } : null };
}
