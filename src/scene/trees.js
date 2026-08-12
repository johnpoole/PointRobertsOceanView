// Trees standing where the land cover says forest, instead of a green wash on
// the ground.
//
// There are about a hundred and forty thousand of them on the tile, which is
// too many to draw as trees. So each one is drawn twice over, at two levels of
// detail, and only ever one of the two:
//
//   inside NEAR_M    trunk and stacked crowns, the tree you walk under
//   out to FAR_M     one cone or one crown blob, the tree you see from the bluff
//   past FAR_M       nothing. The ground colour is already forest green.
//
// Both rings live in instanced meshes, so the whole forest is five draw calls.
// The far ring holds every tree on the tile and collapses the ones it must not
// draw to zero size in the vertex shader — a uniform changing is free, where
// rewriting a hundred and forty thousand matrices every time the camera moves
// is not. The near ring holds only what is inside it and is rewritten when the
// camera has gone far enough to matter.
//
// The two rings are cut by the same test against the same point, the camera
// position at the last rewrite. If the shader used the live camera instead, a
// tree could fall inside the shader's near ring while the near ring itself had
// not been rewritten to include it yet, and vanish.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toWorld } from "../geo.js";
import { COVER_ONLY_M } from "./terrain.js";
import { ROAD_EXAGGERATION, ROAD_WIDTH } from "./land.js";

// Real geometry inside the first, nothing at all past the second, in metres.
// Three hundred is as far as the near ring can reach before the trees in it
// cost more than the terrain does.
const NEAR_M = 300;
const FAR_M = 2500;
// How far the camera moves before the near ring is rewritten. Small enough
// that a tree pops into detail well before you reach it.
const REBUILD_M = 20;

// Measured trees closer than this to where the view opens are left out. Twenty
// five metres is not close, and it is the number because the three standing in
// the opening view are 11.4, 19.6 and 22.8 m out. It costs six of the thirty one.
const CLEAR_OF_CAMERA_M = 25;

// Stems per hectare, by NLCD class. Second growth on this coast runs three
// hundred or so to the hectare once the canopy has closed.
const DENSITY_PER_HA = {
  41: 300,   // deciduous forest — red alder, bigleaf maple
  42: 320,   // evergreen forest — Douglas fir, western red cedar
  43: 310,   // mixed forest
  90: 200,   // woody wetland — standing thinner, and shorter
};
// How much of the class is conifer. The rest is broadleaf.
const CONIFER_SHARE = { 41: 0.05, 42: 0.95, 43: 0.5, 90: 0.6 };
// Wetland trees are stunted next to the same species on dry ground.
const SHORT_CLASSES = new Set([90]);
const SHORT_SCALE = 0.55;

const CONIFER_H_M = [18, 34];
const BROADLEAF_H_M = [12, 26];
// Crown radius as a fraction of the tree's height. A fir is a spire and a
// maple is a ball, and this is the whole of the difference at a distance.
const CONIFER_R_FRAC = [0.11, 0.16];
const BROADLEAF_R_FRAC = [0.20, 0.30];

const TRUNK_COLOR = 0x453b30;
const CONIFER_COLORS = [0x2a4024, 0x223a20, 0x31492a, 0x1e3520, 0x2f4b2d];
const BROADLEAF_COLORS = [0x4a6b30, 0x557437, 0x40602c, 0x5c7c3e, 0x496a35];

const CONIFER = 0;
const BROADLEAF = 1;

// Where the crown sits on the trunk, in tree heights. The far cone spans the
// same envelope as the near tree's stacked cones so the swap at NEAR_M changes
// how lumpy the outline is and not how tall or wide the tree is.
const CONIFER_CROWN_BASE = 0.22;
const BROADLEAF_CROWN_CENTRE = 0.70;
const BROADLEAF_CROWN_SEMI = 0.30;
const CONIFER_TRUNK_TOP = 0.30;
const BROADLEAF_TRUNK_TOP = 0.45;
const CONIFER_TRUNK_R_FRAC = 0.020;
const BROADLEAF_TRUNK_R_FRAC = 0.018;

// The roads a tree has no business standing in. Driveways, tracks and footways
// run under the canopy all over the peninsula and are left alone: the land
// cover cell is 30 m and it does not know a two metre path is cut through it.
const MAIN_ROADS = new Set(["motorway", "trunk", "primary", "secondary",
                            "tertiary", "residential", "unclassified"]);
// Clear of the road as land.js draws it, and a metre more, so the verge is bare
// and the crowns still lean out over the carriageway.
const ROAD_MARGIN_M = 1.0;
// Buckets for the road segments. Big enough that most segments land in one or
// two, small enough that a tree never looks at more than a handful.
const ROAD_CELL_M = 40;

// A predicate on world x and z: is this in a main road. Built from the OSM
// ways once, into a uniform grid, because the alternative is walking three
// hundred ways for each of a hundred and forty thousand trees.
function roadTest(roads) {
  const seg = [];   // ax, az, bx, bz, clearance squared, clearance
  for (const r of roads) {
    if (!MAIN_ROADS.has(r.kind)) continue;
    const width = ROAD_WIDTH[r.kind];
    if (!width) {
      throw new Error(
        `trees.js roadTest: MAIN_ROADS says "${r.kind}" is a main road and ` +
        `land.js ROAD_WIDTH has no width for it, so there is no way to know ` +
        `how far to hold the trees off. The two lists have gone out of step.`);
    }
    const clear = (width * ROAD_EXAGGERATION) / 2 + ROAD_MARGIN_M;
    let prev = null;
    for (const [lat, lon] of r.coords) {
      const w = toWorld(lat, lon);
      if (prev) seg.push(prev.x, prev.z, w.x, w.z, clear * clear, clear);
      prev = w;
    }
  }
  const cells = new Map();
  const key = (i, j) => i * 100000 + j;
  for (let o = 0; o < seg.length; o += 6) {
    const c = seg[o + 5];
    const j0 = Math.floor((Math.min(seg[o], seg[o + 2]) - c) / ROAD_CELL_M);
    const j1 = Math.floor((Math.max(seg[o], seg[o + 2]) + c) / ROAD_CELL_M);
    const i0 = Math.floor((Math.min(seg[o + 1], seg[o + 3]) - c) / ROAD_CELL_M);
    const i1 = Math.floor((Math.max(seg[o + 1], seg[o + 3]) + c) / ROAD_CELL_M);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        let list = cells.get(k);
        if (!list) cells.set(k, list = []);
        list.push(o);
      }
    }
  }
  return (x, z) => {
    const list = cells.get(key(Math.floor(z / ROAD_CELL_M),
                               Math.floor(x / ROAD_CELL_M)));
    if (!list) return false;
    for (const o of list) {
      const ax = seg[o], az = seg[o + 1];
      const dx = seg[o + 2] - ax, dz = seg[o + 3] - az;
      const len2 = dx * dx + dz * dz;
      let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x - (ax + t * dx), ez = z - (az + t * dz);
      if (ex * ex + ez * ez < seg[o + 4]) return true;
    }
    return false;
  };
}

// One repeatable stream, so the forest is the same forest on every reload.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Unit trees: one metre tall, one metre across at the widest part of the crown,
// standing on y = 0. The instance matrix scales height and crown radius apart,
// which is what turns one shape into a fir or a maple.

// A closed cone, base radius 1 on y = 0 and apex at y = 1, in sides + a fan
// across the base. Not ConeGeometry: that one is a cylinder with the top ring
// collapsed to a point, so it emits a zero-area triangle per segment at the
// apex and a five-sided cone costs fifteen triangles instead of eight. There
// are a hundred and forty thousand of these and the waste is the third of a
// frame that buys nothing.
function cone(segments) {
  const pos = [];
  const rim = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    rim.push([Math.cos(a), 0, Math.sin(a)]);
  }
  for (let i = 0; i < segments; i++) {
    const b = rim[i], c = rim[(i + 1) % segments];
    pos.push(0, 1, 0, c[0], c[1], c[2], b[0], b[1], b[2]);
  }
  // Base, facing down. A fan needs two fewer triangles than a hub and spokes.
  for (let i = 1; i < segments - 1; i++) {
    const a = rim[0], b = rim[i], c = rim[i + 1];
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();  // non-indexed, so this comes out flat, which is
  return g;                  // what a low-poly conifer wants anyway
}

function coniferCrownNear() {
  // Three cones up the trunk. The steps in the outline are what reads as a
  // conifer close to; one smooth cone reads as a traffic bollard.
  const tiers = [
    [CONIFER_CROWN_BASE, 0.42, 1.00],
    [0.48, 0.36, 0.72],
    [0.70, 0.30, 0.45],
  ];
  return mergeGeometries(tiers.map(([base, height, radius]) => {
    const g = cone(7);
    g.scale(radius, height, radius);
    g.translate(0, base, 0);
    return g;
  }), false);
}

function coniferCrownFar() {
  // Closed, because from the ground a tree three hundred metres off still has
  // its crown base above your eye and an open cone is a hole. Five sides: at
  // that range the facets are under a pixel across.
  const g = cone(5);
  g.scale(1, 1 - CONIFER_CROWN_BASE, 1);
  g.translate(0, CONIFER_CROWN_BASE, 0);
  return g;
}

function broadleafCrown(shape) {
  shape.scale(1, BROADLEAF_CROWN_SEMI, 1);
  shape.translate(0, BROADLEAF_CROWN_CENTRE, 0);
  return shape;
}

function trunkGeometry() {
  // Open ended: the bottom is in the ground and the top is inside the crown.
  const g = new THREE.CylinderGeometry(0.7, 1, 1, 6, 1, true);
  g.translate(0, 0.5, 0);
  return g;
}

// Collapses an instance to nothing unless its distance from ringOrigin falls
// between the two radii. A degenerate triangle costs a vertex shader and no
// fragments, which is the whole point: the buffer holds the tile and the GPU
// rasterises a disc of it.
function ringCollapse(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.ringOrigin = uniforms.ringOrigin;
    shader.uniforms.ringRange = uniforms.ringRange;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `
        #include <common>
        uniform vec3 ringOrigin;
        uniform vec2 ringRange;
      `)
      .replace("#include <begin_vertex>", `
        #include <begin_vertex>
        vec3 ringAt = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
        float ringD = length( ringAt - ringOrigin );
        if ( ringD < ringRange.x || ringD > ringRange.y ) transformed = vec3( 0.0 );
      `);
  };
  // A material whose shader is rewritten needs its own program.
  material.customProgramCacheKey = () => "trees-ring";
}

// Instance colour multiplies the material colour, so white is the only base
// that leaves the palette saying what it says.
function crownMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.9, metalness: 0 });
}

class Ring {
  // form -> InstancedMesh, plus the trunks, which are one colour for both forms.
  // room is per form; trunkRoom covers both, since a trunk is a trunk.
  constructor(scene, geoms, room, trunkRoom, materials) {
    if (!room[CONIFER] || !room[BROADLEAF]) {
      throw new Error(
        `trees.js Ring: room is ${room[CONIFER]} conifer and ${room[BROADLEAF]} ` +
        `broadleaf, and a ring with no room for a form cannot hold the colour ` +
        `buffer it is about to be given. Check DENSITY_PER_HA and CONIFER_SHARE ` +
        `against the classes actually in assets/landcover/cover.bin.`);
    }
    const white = new THREE.Color(0xffffff);
    this.crowns = [
      new THREE.InstancedMesh(geoms.conifer, materials.conifer, room[CONIFER]),
      new THREE.InstancedMesh(geoms.broadleaf, materials.broadleaf, room[BROADLEAF]),
    ];
    this.trunks = geoms.trunk
      ? new THREE.InstancedMesh(geoms.trunk, materials.trunk, trunkRoom)
      : null;
    for (const m of this.crowns) {
      // setColorAt allocates the colour buffer on first use, and a ring that
      // happens to hold no trees of a form never calls it — so allocate it
      // here rather than dereference null out on the water.
      m.setColorAt(0, white);
    }
    for (const m of this.meshes()) {
      // The bounding sphere of an instanced mesh is one unit tree at the
      // origin, so three would cull the whole forest the moment you looked
      // away from the middle of the tile.
      m.frustumCulled = false;
      m.castShadow = false;
      m.count = 0;
      scene.add(m);
    }
  }

  meshes() {
    return this.trunks ? this.crowns.concat([this.trunks]) : this.crowns.slice();
  }
}

// sample(lat, lon) -> metres above MLLW. cover is what buildTerrain read:
// { meta, codes }. roads is data.roads out of the OSM bake.
// Where the lidar counted the trees itself, its count stands and the scatter
// stands down. Everything inside this outline is measured: 31 crowns, each with
// its own trunk, height and spread, instead of three hundred to the hectare put
// down by chance.
function measuredGround(measured) {
  if (!measured) return () => false;
  const poly = measured.outline;
  return (lat, lon) => {
    let inside = false;
    for (let i = 0, n = poly.length; i < n; i++) {
      const [aLat, aLon] = poly[i];
      const [bLat, bLon] = poly[(i + 1) % n];
      if ((aLat > lat) !== (bLat > lat)
          && lon < (bLon - aLon) * (lat - aLat) / (bLat - aLat) + aLon) {
        inside = !inside;
      }
    }
    return inside;
  };
}

export function buildTrees(scene, sample, cover, roads, measured) {
  if (!cover) {
    throw new Error("buildTrees: no land cover. The near terrain must be built " +
      "with opts.landcover so the trees know where the forest is.");
  }
  if (!roads) {
    throw new Error("buildTrees: no roads. Pass data.roads from the OSM bake " +
      "(osmFeatures() in land.js) so the trees are kept out of the road.");
  }
  if (measured && !Array.isArray(measured.trees)) {
    throw new Error(
      "buildTrees: the measured trees asset has no trees array. It is written by " +
      "site/bake-oceanview-lidar.py in PointRobertsEngineering.");
  }
  if (measured && !Array.isArray(measured.outline)) {
    throw new Error(
      "buildTrees: the measured trees asset has no outline, so there is no way to " +
      "know where to stand the scattered trees down. Re-run the bake.");
  }
  const isMeasured = measuredGround(measured);
  const inRoad = roadTest(roads);
  const rand = seeded(20260807);
  const { nrows, ncols } = cover.meta.grid;
  const box = cover.meta.box;
  const cellHa = (cover.meta.cell_m * cover.meta.cell_m) / 10000;
  const dLat = (box.max_lat - box.min_lat) / nrows;
  const dLon = (box.max_lon - box.min_lon) / ncols;

  // How many could be planted, before elevation turns any of them away. Sizes
  // the arrays once instead of growing them a hundred and forty thousand times.
  let room = measured ? measured.trees.length : 0;
  for (let n = 0; n < cover.codes.length; n++) {
    const density = DENSITY_PER_HA[cover.codes[n]];
    if (density) room += Math.ceil(density * cellHa);
  }

  const px = new Float32Array(room);
  const py = new Float32Array(room);
  const pz = new Float32Array(room);
  const height = new Float32Array(room);
  const radius = new Float32Array(room);
  const yaw = new Float32Array(room);
  const form = new Uint8Array(room);
  const tint = new Uint8Array(room);
  // Where the live crown starts, in tree heights. The scattered ones all take
  // the shape's own base; the measured ones carry what the lidar found under
  // them, which on a stand-grown fir is about half way up.
  const crownBase = new Float32Array(room).fill(CONIFER_CROWN_BASE);
  // The measured trees standing in the opening view. Built like the rest and
  // held back by the near ring, so they can be asked for without a rebuild.
  const atHome = new Uint8Array(room);

  let count = 0;
  let belowCover = 0;
  let onRoad = 0;
  for (let i = 0; i < nrows; i++) {
    for (let j = 0; j < ncols; j++) {
      const code = cover.codes[i * ncols + j];
      const density = DENSITY_PER_HA[code];
      if (!density) continue;
      // A fractional tree is planted or not planted, by chance, so a class at
      // 310 to the hectare does not round to the same count as one at 320.
      const want = density * cellHa;
      let n = Math.floor(want);
      if (rand() < want - n) n++;
      const short = SHORT_CLASSES.has(code);
      const coniferShare = CONIFER_SHARE[code];
      for (let k = 0; k < n; k++) {
        const lat = box.max_lat - (i + rand()) * dLat;
        const lon = box.min_lon + (j + rand()) * dLon;
        // Over the lot the lidar counted them, so nothing is scattered there.
        if (isMeasured(lat, lon)) continue;
        const elev = sample(lat, lon);
        // Below where the land cover starts deciding the ground colour it is
        // beach, whatever a 30 m cell says, and nothing grows on the shingle.
        if (elev < COVER_ONLY_M) { belowCover++; continue; }
        const w = toWorld(lat, lon, elev);
        if (inRoad(w.x, w.z)) { onRoad++; continue; }
        const isConifer = rand() < coniferShare;
        const hRange = isConifer ? CONIFER_H_M : BROADLEAF_H_M;
        const rRange = isConifer ? CONIFER_R_FRAC : BROADLEAF_R_FRAC;
        const pal = isConifer ? CONIFER_COLORS : BROADLEAF_COLORS;
        let h = hRange[0] + (hRange[1] - hRange[0]) * rand();
        if (short) h *= SHORT_SCALE;
        px[count] = w.x;
        py[count] = w.y;
        pz[count] = w.z;
        height[count] = h;
        radius[count] = h * (rRange[0] + (rRange[1] - rRange[0]) * rand());
        yaw[count] = rand() * Math.PI * 2;
        form[count] = isConifer ? CONIFER : BROADLEAF;
        tint[count] = Math.floor(rand() * pal.length);
        count++;
      }
    }
  }

  // The measured ones. Trunk, height and crown radius are the lidar's; the ground
  // is the lidar's too, taken under the trunk rather than sampled off a tile. The
  // form is the only guess, and on this coast at these heights it is fir.
  if (measured) {
    for (const t of measured.trees) {
      const w = toWorld(t.lat, t.lon, t.ground_m);
      // The view opens at the origin looking west, and the lidar found trees
      // standing in it. The nearest is 11.4 m out and 28 m tall, and with two
      // behind it they cover 13 degrees of a 25 degree lens — the page opens on
      // three posts and no sea. They are really there, so they are built and
      // marked, and the near ring leaves them out until something asks for them.
      // Held against a photograph off the cameras they are the only things in
      // the scene with a measured trunk in a measured place.
      atHome[count] = Math.hypot(w.x, w.z) < CLEAR_OF_CAMERA_M ? 1 : 0;
      px[count] = w.x;
      py[count] = w.y;
      pz[count] = w.z;
      height[count] = t.height_m;
      radius[count] = t.radius_m;
      crownBase[count] = t.crown_base_frac;
      yaw[count] = rand() * Math.PI * 2;
      form[count] = CONIFER;
      tint[count] = Math.floor(rand() * CONIFER_COLORS.length);
      count++;
    }
  }

  // A uniform grid over the trees, so the near ring can ask what is close
  // without walking the whole tile. Counts, then the start of each bucket's
  // run, then the trees themselves in bucket order.
  const bucketM = NEAR_M;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let n = 0; n < count; n++) {
    if (px[n] < minX) minX = px[n];
    if (px[n] > maxX) maxX = px[n];
    if (pz[n] < minZ) minZ = pz[n];
    if (pz[n] > maxZ) maxZ = pz[n];
  }
  const bcols = Math.max(1, Math.ceil((maxX - minX) / bucketM) + 1);
  const brows = Math.max(1, Math.ceil((maxZ - minZ) / bucketM) + 1);
  const bucketOf = (x, z) => {
    const j = Math.min(Math.max(Math.floor((x - minX) / bucketM), 0), bcols - 1);
    const i = Math.min(Math.max(Math.floor((z - minZ) / bucketM), 0), brows - 1);
    return i * bcols + j;
  };
  const counts = new Uint32Array(brows * bcols);
  for (let n = 0; n < count; n++) counts[bucketOf(px[n], pz[n])]++;
  const starts = new Uint32Array(brows * bcols + 1);
  for (let b = 0; b < counts.length; b++) starts[b + 1] = starts[b] + counts[b];
  const items = new Uint32Array(count);
  const fill = starts.slice(0, counts.length);
  for (let n = 0; n < count; n++) items[fill[bucketOf(px[n], pz[n])]++] = n;

  // A circle of radius NEAR_M sits inside a box 2 NEAR_M across, which with
  // buckets that size spans at most three of them either way. So the busiest
  // three by three window is a hard ceiling on what the near ring can ever
  // hold, and it never has to drop a tree. It is a loose ceiling — the buffer
  // it sizes is a megabyte, and what gets drawn is the real count, not this.
  let nearCap = 0;
  for (let i = 0; i < brows; i++) {
    for (let j = 0; j < bcols; j++) {
      let sum = 0;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || ii >= brows || jj < 0 || jj >= bcols) continue;
          sum += counts[ii * bcols + jj];
        }
      }
      if (sum > nearCap) nearCap = sum;
    }
  }

  // How many of each form there are, so neither ring allocates room for trees
  // of a shape it will never hold.
  const byForm = [0, 0];
  for (let n = 0; n < count; n++) byForm[form[n]]++;

  const trunkMat = new THREE.MeshStandardMaterial({
    color: TRUNK_COLOR, roughness: 1, metalness: 0 });
  // The near ring cannot know which form fills it, so each of its two crown
  // meshes has to be able to hold the whole ring.
  const near = new Ring(scene, {
    conifer: coniferCrownNear(),
    broadleaf: broadleafCrown(new THREE.IcosahedronGeometry(1, 0)),
    trunk: trunkGeometry(),
  }, [nearCap, nearCap], nearCap, {
    conifer: crownMaterial(), broadleaf: crownMaterial(), trunk: trunkMat });

  // The far ring carries every tree and hides what it must not draw in the
  // shader, so ringOrigin and ringRange are the only things that ever change.
  const ringOrigin = { value: new THREE.Vector3(0, 0, 0) };
  const ringRange = { value: new THREE.Vector2(NEAR_M, FAR_M) };
  const farConiferMat = crownMaterial();
  const farBroadleafMat = crownMaterial();
  ringCollapse(farConiferMat, { ringOrigin, ringRange });
  ringCollapse(farBroadleafMat, { ringOrigin, ringRange });
  const far = new Ring(scene, {
    conifer: coniferCrownFar(),
    broadleaf: broadleafCrown(new THREE.OctahedronGeometry(1, 0)),
    trunk: null,
  }, byForm, 0, { conifer: farConiferMat, broadleaf: farBroadleafMat });

  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();

  const palette = (n) => (form[n] === CONIFER ? CONIFER_COLORS : BROADLEAF_COLORS);
  // The crown geometry spans CONIFER_CROWN_BASE to the top of the tree. Lifting
  // its base to where the lidar found one means squeezing that span into the
  // shorter one and dropping the origin to match, so the tip still lands at the
  // measured height. A tree whose base is the shape's own comes out unchanged.
  const crownSpanY = (n) =>
    height[n] * (1 - crownBase[n]) / (1 - CONIFER_CROWN_BASE);
  const crownMatrix = (n) => {
    const s = form[n] === CONIFER ? crownSpanY(n) : height[n];
    pos.set(px[n], py[n] + height[n] - s, pz[n]);
    quat.setFromAxisAngle(up, yaw[n]);
    scl.set(radius[n], s, radius[n]);
    return m.compose(pos, quat, scl);
  };
  const trunkMatrix = (n) => {
    const conifer = form[n] === CONIFER;
    // The trunk has to reach the crown, or a tree whose branches start half way
    // up stands on a stump with a gap over it.
    const top = conifer
      ? Math.max(CONIFER_TRUNK_TOP, crownBase[n] + 0.05)
      : BROADLEAF_TRUNK_TOP;
    const rFrac = conifer ? CONIFER_TRUNK_R_FRAC : BROADLEAF_TRUNK_R_FRAC;
    pos.set(px[n], py[n], pz[n]);
    quat.setFromAxisAngle(up, yaw[n]);
    scl.set(height[n] * rFrac, height[n] * top, height[n] * rFrac);
    return m.compose(pos, quat, scl);
  };

  // The far ring is written once and never again.
  const farAt = [0, 0];
  for (let n = 0; n < count; n++) {
    const f = form[n];
    const mesh = far.crowns[f];
    const at = farAt[f]++;
    mesh.setMatrixAt(at, crownMatrix(n));
    mesh.setColorAt(at, col.setHex(palette(n)[tint[n]]));
  }
  far.crowns[CONIFER].count = farAt[CONIFER];
  far.crowns[BROADLEAF].count = farAt[BROADLEAF];
  for (const mesh of far.crowns) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  // The near ring is rewritten when the camera has moved REBUILD_M, and
  // ringOrigin moves with it so the far ring hides exactly what the near ring
  // has just taken on.
  //
  // Twenty metres of travel changes which trees are inside three hundred by
  // about one in twelve. So a tree keeps its slot for as long as it is in the
  // ring and only the ones crossing the edge are written. A tree pulled out has
  // the last tree in the mesh dropped into its place, which keeps the slots in
  // use packed at the front, and the upload is the span that was written rather
  // than the whole buffer — the buffer is sized for the busiest corner of the
  // tile and is mostly trees that are nowhere near you.
  let anchor = null;
  const nearAt = [0, 0];            // crowns held, per form
  let trunkAt = 0;
  // The slot a tree holds, or -1 for one the ring is not carrying. A tree has a
  // crown in its own form's mesh and a trunk in the shared one, taken and given
  // up together.
  const crownSlot = new Int32Array(count).fill(-1);
  const trunkSlot = new Int32Array(count).fill(-1);
  // And the way back: which tree is in each slot.
  const crownOcc = [new Int32Array(nearCap), new Int32Array(nearCap)];
  const trunkOcc = new Int32Array(nearCap);
  // Lowest and highest slot written this pass. hi below lo means nothing moved.
  const crownLo = [0, 0], crownHi = [0, 0];
  let trunkLo = 0, trunkHi = 0;

  // Held back either for standing too far off, or for standing in the opening
  // view while nothing has asked to see it.
  let hideHome = true;
  const beyondRing = (n, at, r2) => {
    if (hideHome && atHome[n]) return true;
    const dx = px[n] - at.x, dy = py[n] - at.y, dz = pz[n] - at.z;
    return dx * dx + dy * dy + dz * dz >= r2;
  };

  function writeCrown(f, slot, n) {
    const crown = near.crowns[f];
    crown.setMatrixAt(slot, crownMatrix(n));
    crown.setColorAt(slot, col.setHex(palette(n)[tint[n]]));
    crownOcc[f][slot] = n;
    crownSlot[n] = slot;
    if (slot < crownLo[f]) crownLo[f] = slot;
    if (slot > crownHi[f]) crownHi[f] = slot;
  }

  function writeTrunk(slot, n) {
    near.trunks.setMatrixAt(slot, trunkMatrix(n));
    trunkOcc[slot] = n;
    trunkSlot[n] = slot;
    if (slot < trunkLo) trunkLo = slot;
    if (slot > trunkHi) trunkHi = slot;
  }

  function dropCrown(f, slot) {
    const last = --nearAt[f];
    crownSlot[crownOcc[f][slot]] = -1;
    if (slot !== last) writeCrown(f, slot, crownOcc[f][last]);
  }

  function dropTrunk(slot) {
    const last = --trunkAt;
    trunkSlot[trunkOcc[slot]] = -1;
    if (slot !== last) writeTrunk(slot, trunkOcc[last]);
  }

  // needsUpdate on its own sends the whole attribute. Name the span instead, or
  // every step of the camera pushes megabytes of trees that did not move.
  function uploadSpan(attr, lo, hi, stride) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(lo * stride, (hi - lo + 1) * stride);
    attr.needsUpdate = true;
  }

  function rewriteNear(at) {
    const r2 = NEAR_M * NEAR_M;
    crownLo[CONIFER] = crownLo[BROADLEAF] = trunkLo = nearCap;
    crownHi[CONIFER] = crownHi[BROADLEAF] = trunkHi = -1;

    // Out first. Pulling a tree out fills its slot from the end, so the same
    // slot has to be read again rather than stepped over.
    for (let f = 0; f < near.crowns.length; f++) {
      for (let s = 0; s < nearAt[f];) {
        const n = crownOcc[f][s];
        if (!beyondRing(n, at, r2)) { s++; continue; }
        dropTrunk(trunkSlot[n]);
        dropCrown(f, s);
      }
    }

    // Then in: what is inside the ring and not already held.
    const j0 = Math.max(Math.floor((at.x - NEAR_M - minX) / bucketM), 0);
    const j1 = Math.min(Math.floor((at.x + NEAR_M - minX) / bucketM), bcols - 1);
    const i0 = Math.max(Math.floor((at.z - NEAR_M - minZ) / bucketM), 0);
    const i1 = Math.min(Math.floor((at.z + NEAR_M - minZ) / bucketM), brows - 1);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const b = i * bcols + j;
        for (let s = starts[b]; s < starts[b + 1]; s++) {
          const n = items[s];
          if (crownSlot[n] >= 0) continue;
          if (beyondRing(n, at, r2)) continue;
          const f = form[n];
          if (nearAt[f] >= nearCap || trunkAt >= nearCap) {
            throw new Error(
              `buildTrees: the near ring wanted more than ${nearCap} trees at ` +
              `(${at.x.toFixed(0)}, ${at.z.toFixed(0)}), which the busiest ` +
              `three-by-three bucket window said was impossible. The bucket ` +
              `index in trees.js is wrong.`);
          }
          writeCrown(f, nearAt[f]++, n);
          writeTrunk(trunkAt++, n);
        }
      }
    }

    for (let f = 0; f < near.crowns.length; f++) {
      const crown = near.crowns[f];
      crown.count = nearAt[f];
      if (crownHi[f] < crownLo[f]) continue;
      uploadSpan(crown.instanceMatrix, crownLo[f], crownHi[f], 16);
      uploadSpan(crown.instanceColor, crownLo[f], crownHi[f], 3);
    }
    near.trunks.count = trunkAt;
    if (trunkHi >= trunkLo) {
      uploadSpan(near.trunks.instanceMatrix, trunkLo, trunkHi, 16);
    }
    ringOrigin.value.copy(at);
  }

  return {
    trees: count,
    conifers: farAt[CONIFER],
    broadleaves: farAt[BROADLEAF],
    belowCover,
    onRoad,
    nearCap,
    // The measured trees standing in the opening view: shown, or put away. The
    // ring is rewritten on the next update rather than here, so asking twice in
    // a frame costs nothing.
    homeTrees(show) {
      if (hideHome !== show) return;
      hideHome = !show;
      anchor = null;
    },
    update(camera) {
      if (anchor && anchor.distanceToSquared(camera.position) < REBUILD_M * REBUILD_M) return;
      anchor = anchor || new THREE.Vector3();
      anchor.copy(camera.position);
      rewriteNear(anchor);
    },
  };
}
