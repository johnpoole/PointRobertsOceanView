// The Brademy: six tennis courts on the old Breakers parking lot.
//
// Not built yet, so it is off until asked for on T rather than drawn into the
// world. The switch is the whole of how it is kept apart from the peninsula.
//
// The lot's four corners are John's, off the ground rather than off a survey.
// Everything else here is worked out from them: the buildable rectangle, where
// the courts sit in it, and how high the pad has to be so nothing pokes through.
//
// Two sets of three, side by side within a set, one set north of the other. The
// courts run north and south, which is the convention — the low sun ends up off
// to the side rather than in a server's eyes. Side by side would have wanted
// 119 m of width and the lot has 62 m, so the sets stack.
//
// The hedge is the exception. It is round the lot now, so it is drawn now, in its
// own group outside the switch. With the courts off you get a hedge round an empty
// lot, which is what is there.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { fromWorld, toWorld } from "../geo.js";
import { box, gableRoof, pick, seeded, tint } from "./parts.js";

// The old Breakers parking lot, clockwise from the northeast. Supplied, not
// surveyed.
const LOT = [
  [48.9841635665451, -123.08228060944315],   // NE
  [48.98333968343413, -123.08216612219306],  // SE
  [48.98334018863542, -123.08313207910217],  // SW
  [48.98418392813251, -123.08315269838253],  // NW
];

// The Breakers building itself, so the clubhouse can stand where it stands and
// the old block can be taken away while the proposal is up.
//
// It is not named in OSM, so it is found by what it is: the largest footprint for
// two hundred metres, 1,501 m² at 38 by 58, tagged as trading premises, sitting
// between the parking lot and the water with the parking behind it. 16,157 sq ft,
// which is what a hall licensed for 999 wants.
const BREAKERS_AT = { x: 123, z: 582 };   // world metres, its centroid
const BREAKERS_WITHIN_M = 30;

export function isBreakers(coords) {
  let x = 0, z = 0;
  for (const [lat, lon] of coords) {
    const w = toWorld(lat, lon, 0);
    x += w.x; z += w.z;
  }
  x /= coords.length; z /= coords.length;
  return Math.hypot(x - BREAKERS_AT.x, z - BREAKERS_AT.z) <= BREAKERS_WITHIN_M;
}

// The clubhouse that replaces it. Not sixteen thousand square feet: a tennis club
// wants about four, which is the figure the budget was built on. Two volumes, a
// lounge and a lower service wing, with the long walls facing the courts to the
// east and the water to the west.
const CH_MAIN_W = 11.0;      // east to west
const CH_MAIN_L = 16.0;      // north to south, so the ridge runs north-south
const CH_MAIN_WALL = 5.4;
const CH_MAIN_RISE = 2.1;    // shallow, which is what the rain here wants
const CH_WING_W = 8.0;
const CH_WING_L = 12.0;
const CH_WING_WALL = 3.5;
const CH_WING_RISE = 1.3;
const CH_EAVE = 0.9;         // deep, and the whole of why it reads as a building
const CH_PLINTH = 0.35;
const CH_TERRACE_D = 3.6;    // the covered walk facing the courts
const CH_TERRACE_H = 3.1;
const CH_DECK_D = 4.2;       // and the open deck facing the water
const CH_RAIL_H = 1.05;
const CH_GLASS_H = 2.0;
const CH_GLASS_SILL = 1.0;

// Stained cedar. Kept well off black: at 0x3d3227 the walls came out as one dark
// mass and the eaves, the plinth and the glazing all disappeared into it.
const CH_CLAD = 0x6d5a45;
const CH_CLAD_WING = 0x7c6851;
const CH_TRIM = 0xd6d0c2;
const CH_ROOF = 0x53585b;        // standing seam
const CH_GLASS = 0x1b2b35;
const CH_DECK_COLOR = 0x8b7355;
const CH_POST = 0x2e2822;
const CH_PLINTH_COLOR = 0x6d6e6a;

// A tennis court, in metres. These are the real numbers.
const COURT_L = 23.77;      // baseline to baseline
const COURT_W = 10.97;      // doubles, sideline to sideline
const SINGLES_W = 8.23;
const SERVICE_FROM_NET = 6.40;
const LINE_W = 0.05;        // 5 cm, as marked
const BASELINE_W = 0.10;    // baselines are drawn wider
const CENTRE_MARK_L = 0.10; // the tick on the baseline at the centre

// Run-off round the playing area. These are the club minimum rather than the
// full ITF recommendation. Full run-offs would leave 5.4 m at each end of the
// lot, and the walking paths and the benches need more than that.
const RUN_END = 5.48;       // behind each baseline
const RUN_SIDE = 3.05;      // beside each sideline, and between two courts
const PATH_M = 8.0;         // the treed walk between the two sets

// The pad stands a little over the highest ground under it so the terrain never
// comes through the surface.
const PAD_CLEARANCE_M = 0.03;
const PAD_APRON_M = 2.0;    // pad beyond the fence, for the fence to stand on
const SKIRT_M = 3.0;        // how far the retaining edge is carried down

const FENCE_H = 3.0;
const FENCE_POST_R = 0.05;
const FENCE_SPACING_M = 3.0;
const RAIL_M = 0.04;

// A net is 1.07 m at the posts and sags to 0.914 m in the middle. Drawn flat at
// the post height: the sag is geometry we are not modelling, not a number we are
// getting wrong.
const NET_H = 1.07;
const NET_POST_R = 0.06;
const NET_BEYOND_M = 0.914; // posts stand this far outside the doubles sideline

const PAD_COLOR = 0x6f7370;     // graded ground round the courts
const APRON_COLOR = 0x2f6b4a;   // inside the fence, off the court
const COURT_COLOR = 0x2f5f8f;
const LINE_COLOR = 0xf0f0ea;
const FENCE_COLOR = 0x3f4a52;
const NET_COLOR = 0x23282c;

// The hedge that is round the lot now. Its line is the lot boundary, which is
// John's four corners. Two things about it are assumed and neither is measured:
// it is taken as 3 m, which is what "high" gets you in a clipped cedar, and it
// is drawn unbroken because nobody has said where the way in is.
const HEDGE_H = 3.0;
const HEDGE_W = 1.15;
const HEDGE_STEP_M = 1.2;       // how finely it is cut before being laid on the ground
const HEDGE_TOP_JITTER = 0.13;  // a clipped hedge is level, not flat
const HEDGE_SIDE_JITTER = 0.09;
const HEDGE_COLORS = [0x24462c, 0x1e3d27, 0x2b4f33, 0x1a3623];

// Landscaping. Ornamental trees, not the firs on the bluff: what goes round a
// court is small and round-headed so it does not shade the surface or drop
// needles on it.
const TREE_H_M = [4.0, 6.8];
const TREE_CROWN_FRAC = [0.34, 0.46];   // crown radius over height, so round
const TREE_TRUNK_TOP = 0.42;
const TREE_TRUNK_R_FRAC = 0.030;
const TREE_COLORS = [0x3f6b3a, 0x4a7742, 0x36602f, 0x53804a, 0x2f5730];
const TRUNK_COLOR = 0x4a3f33;

const SHRUB_R_M = [0.45, 1.05];
const SHRUB_SQUASH = 0.72;
const SHRUB_COLORS = [0x37613a, 0x2d5533, 0x426b3c, 0x4d7444, 0x5d6f36];

// A path you would walk on, laid between the pad and the planting.
const PATH_W_M = 2.0;
const PATH_LIFT_M = 0.05;
const PATH_COLOR = 0xbdb49c;

// Casual seating, not bleachers: a slatted timber bench with a back, the kind
// that stands in a park. 1.8 m long, which seats two in comfort and three at a
// push.
const BENCH_L = 1.8;
const BENCH_SEAT_H = 0.44;
const BENCH_SEAT_D = 0.46;
const BENCH_BACK_H = 0.52;
const BENCH_SLAT_T = 0.035;
const BENCH_WOOD = [0x8a6a45, 0x94734c, 0x7d5f3d];
const BENCH_FRAME_COLOR = 0x3a3f42;

// Marks the court surface out per pixel instead of building a mesh of painted
// lines. Every line on a tennis court is straight and axis-aligned, so each one
// is a distance test, and six courts cost two triangles between them. Same trick
// the beach gravel uses in terrain.js.
function paintCourts(material, layout) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.blockMin = { value: new THREE.Vector2(layout.blockX0, layout.blockZ0) };
    shader.uniforms.setSpan = { value: new THREE.Vector2(layout.setW, layout.setD) };
    shader.uniforms.setZ = { value: new THREE.Vector2(layout.setZ0, layout.setZ1) };
    shader.uniforms.courtPitch = { value: layout.courtPitch };
    shader.uniforms.padColor = { value: new THREE.Color(PAD_COLOR) };
    shader.uniforms.apronColor = { value: new THREE.Color(APRON_COLOR) };
    shader.uniforms.courtColor = { value: new THREE.Color(COURT_COLOR) };
    shader.uniforms.lineColor = { value: new THREE.Color(LINE_COLOR) };

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `
        #include <common>
        varying vec3 vGround;
      `)
      .replace("#include <begin_vertex>", `
        #include <begin_vertex>
        vGround = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `
        #include <common>
        varying vec3 vGround;
        uniform vec2 blockMin;
        uniform vec2 setSpan;
        uniform vec2 setZ;
        uniform float courtPitch;
        uniform vec3 padColor;
        uniform vec3 apronColor;
        uniform vec3 courtColor;
        uniform vec3 lineColor;

        // 1.0 on a line of half-width h, faded over one pixel so a 5 cm line
        // does not crawl when it is a pixel wide.
        float band( float d, float h, float aa ) {
          return 1.0 - smoothstep( h - aa, h + aa, abs( d ) );
        }
        // 1.0 inside a span, for cutting a line off at its ends.
        float within( float v, float lo, float hi ) {
          return step( lo, v ) * step( v, hi );
        }
      `)
      .replace("#include <color_fragment>", `
        #include <color_fragment>
        {
          float ex = fwidth( vGround.x );
          float ez = fwidth( vGround.z );
          float aa = max( max( ex, ez ), 0.0005 );
          vec3 surface = padColor;

          // Which set of three, if either. z grows south.
          float z0 = -1.0e9;
          if ( vGround.z >= setZ.x && vGround.z <= setZ.x + setSpan.y ) z0 = setZ.x;
          if ( vGround.z >= setZ.y && vGround.z <= setZ.y + setSpan.y ) z0 = setZ.y;
          float inSetX = within( vGround.x, blockMin.x, blockMin.x + setSpan.x );

          if ( z0 > -1.0e8 && inSetX > 0.5 ) {
            surface = apronColor;

            // Which of the three courts, and where inside it. Court i starts one
            // side run-off in, then repeats every court plus one run-off.
            float across = vGround.x - blockMin.x - ${RUN_SIDE.toFixed(4)};
            float i = floor( across / courtPitch );
            float cx = across - i * courtPitch - ${(COURT_W / 2).toFixed(4)};
            float cz = vGround.z - z0 - ${RUN_END.toFixed(4)} - ${(COURT_L / 2).toFixed(4)};
            bool onCourt = i >= 0.0 && i <= 2.0
              && abs( cx ) <= ${(COURT_W / 2 + 0.2).toFixed(4)}
              && abs( cz ) <= ${(COURT_L / 2 + 0.2).toFixed(4)};

            if ( onCourt ) {
              if ( abs( cx ) <= ${(COURT_W / 2).toFixed(4)}
                && abs( cz ) <= ${(COURT_L / 2).toFixed(4)} ) surface = courtColor;

              float halfL = ${(COURT_L / 2).toFixed(4)};
              float halfW = ${(COURT_W / 2).toFixed(4)};
              float halfS = ${(SINGLES_W / 2).toFixed(4)};
              float lw = ${(LINE_W / 2).toFixed(4)};
              float bw = ${(BASELINE_W / 2).toFixed(4)};
              float sv = ${SERVICE_FROM_NET.toFixed(4)};

              float ink = 0.0;
              // Baselines, and the doubles sidelines that close the rectangle.
              ink = max( ink, band( abs( cz ) - halfL, bw, aa ) * within( abs( cx ), 0.0, halfW + lw ) );
              ink = max( ink, band( abs( cx ) - halfW, lw, aa ) * within( abs( cz ), 0.0, halfL + bw ) );
              // Singles sidelines run the full length.
              ink = max( ink, band( abs( cx ) - halfS, lw, aa ) * within( abs( cz ), 0.0, halfL ) );
              // Service lines, only as wide as the singles court.
              ink = max( ink, band( abs( cz ) - sv, lw, aa ) * within( abs( cx ), 0.0, halfS ) );
              // Centre service line, from one service line to the other.
              ink = max( ink, band( cx, lw, aa ) * within( abs( cz ), 0.0, sv ) );
              // The centre mark, a tick inside each baseline.
              ink = max( ink, band( cx, bw, aa )
                * within( abs( cz ), halfL - ${CENTRE_MARK_L.toFixed(4)}, halfL ) );

              surface = mix( surface, lineColor, clamp( ink, 0.0, 1.0 ) );
            }
          }
          diffuseColor.rgb *= surface;
        }
      `);
  };
  material.customProgramCacheKey = () => "brademy-courts";
}

// The largest north-south rectangle that fits inside the lot. The lot is a
// trapezoid leaning a little off north, and the courts are not, so the corners
// that pinch it are the ones that count.
function buildable(corners) {
  const [ne, se, sw, nw] = corners;
  return {
    x0: Math.max(sw.x, nw.x),
    x1: Math.min(ne.x, se.x),
    // z grows south, so the north edge is the smaller z.
    z0: Math.max(ne.z, nw.z),
    z1: Math.min(se.z, sw.z),
  };
}

function slab(x0, x1, z0, z1, y) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  return g;
}

// The retaining edge: the pad's four sides carried down far enough that the
// ground closes over the bottom of them wherever it happens to sit.
function skirt(x0, x1, z0, z1, top) {
  const h = SKIRT_M;
  const y = top - h / 2;
  // Rotate before translating: rotateY turns about the origin, so a wall that
  // has already been moved into place swings away from it. The material is
  // double sided, so which way each one faces does not matter.
  const wall = (w, alongZ, cx, cz) => {
    const g = new THREE.PlaneGeometry(w, h);
    if (alongZ) g.rotateY(Math.PI / 2);
    g.translate(cx, y, cz);
    return g;
  };
  return mergeGeometries([
    wall(x1 - x0, false, (x0 + x1) / 2, z0),   // north
    wall(x1 - x0, false, (x0 + x1) / 2, z1),   // south
    wall(z1 - z0, true, x0, (z0 + z1) / 2),    // west
    wall(z1 - z0, true, x1, (z0 + z1) / 2),    // east
  ], false);
}

// Posts and a top rail round a rectangle. Chain link itself is not drawn: at any
// range this is seen from, posts and a rail read as a fence, and a see-through
// mesh would be the only sorted transparency on the page.
function fence(x0, x1, z0, z1, y) {
  const parts = [];
  const post = (x, z) => {
    const g = new THREE.CylinderGeometry(FENCE_POST_R, FENCE_POST_R, FENCE_H, 6, 1, true);
    g.translate(x, y + FENCE_H / 2, z);
    parts.push(g);
  };
  const rail = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az);
    const g = new THREE.BoxGeometry(len, RAIL_M, RAIL_M);
    g.rotateY(-Math.atan2(bz - az, bx - ax));
    g.translate((ax + bx) / 2, y + FENCE_H - RAIL_M / 2, (az + bz) / 2);
    parts.push(g);
  };
  const run = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / FENCE_SPACING_M));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      post(ax + (bx - ax) * t, az + (bz - az) * t);
    }
    rail(ax, az, bx, bz);
  };
  run(x0, z0, x1, z0);
  run(x1, z0, x1, z1);
  run(x1, z1, x0, z1);
  run(x0, z1, x0, z0);
  post(x0, z0);
  return mergeGeometries(parts, false);
}

// The hedge round the lot: the boundary cut into short stations, each with its
// own ground height, its own width and its own top, then closed up into a strip.
// The jitter is what stops it reading as a painted wall — a clipped hedge is
// level without being flat.
function hedgeGeometry(corners, sample, rand) {
  const pts = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.round(len / HEDGE_STEP_M));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      pts.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }

  const rows = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const dx = q.x - p.x, dz = q.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l, nz = dx / l;          // across the run, horizontal
    const half = (HEDGE_W / 2) * (1 + (rand() - 0.5) * 2 * HEDGE_SIDE_JITTER);
    const { lat, lon } = fromWorld(p.x, p.z);
    const ground = sample(lat, lon);
    return {
      ox: p.x + nx * half, oz: p.z + nz * half,
      ix: p.x - nx * half, iz: p.z - nz * half,
      // Sunk a little so the ground closes over the bottom wherever it sits.
      base: ground - 0.35,
      top: ground + HEDGE_H + (rand() - 0.5) * 2 * HEDGE_TOP_JITTER,
      color: new THREE.Color(pick(HEDGE_COLORS, rand)),
    };
  });

  const pos = [];
  const col = [];
  const push = (x, y, z, c) => {
    pos.push(x, y, z);
    col.push(c.r, c.g, c.b);
  };
  // Two faces and a top per station. The bottom is underground and the loop is
  // closed, so there is nothing else to draw. Double sided in the material,
  // which saves getting the winding right on both faces of a shell.
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i], b = rows[(i + 1) % rows.length];
    const quad = (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, ca, cb) => {
      push(ax, ay, az, ca); push(bx, by, bz, cb); push(cx, cy, cz, cb);
      push(ax, ay, az, ca); push(cx, cy, cz, cb); push(dx, dy, dz, ca);
    };
    quad(a.ox, a.base, a.oz, b.ox, b.base, b.oz, b.ox, b.top, b.oz,
         a.ox, a.top, a.oz, a.color, b.color);
    quad(a.ix, a.base, a.iz, b.ix, b.base, b.iz, b.ix, b.top, b.iz,
         a.ix, a.top, a.iz, a.color, b.color);
    quad(a.ox, a.top, a.oz, b.ox, b.top, b.oz, b.ix, b.top, b.iz,
         a.ix, a.top, a.iz, a.color, b.color);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 3));
  g.computeVertexNormals();
  return g;
}

// A small round-headed ornamental on a short trunk, standing on the ground.
function ornamental(x, z, ground, rand) {
  const h = TREE_H_M[0] + (TREE_H_M[1] - TREE_H_M[0]) * rand();
  const r = h * (TREE_CROWN_FRAC[0] + (TREE_CROWN_FRAC[1] - TREE_CROWN_FRAC[0]) * rand());
  const parts = [];
  const trunk = new THREE.CylinderGeometry(
    h * TREE_TRUNK_R_FRAC * 0.8, h * TREE_TRUNK_R_FRAC, h * TREE_TRUNK_TOP, 6, 1, true);
  trunk.translate(x, ground + (h * TREE_TRUNK_TOP) / 2, z);
  parts.push(tint(trunk, TRUNK_COLOR));
  const crown = new THREE.IcosahedronGeometry(r, 0);
  crown.scale(1, 0.86, 1);
  crown.rotateY(rand() * Math.PI * 2);
  crown.translate(x, ground + h - r * 0.86, z);
  parts.push(tint(crown, pick(TREE_COLORS, rand)));
  return parts;
}

function shrub(x, z, ground, rand) {
  const r = SHRUB_R_M[0] + (SHRUB_R_M[1] - SHRUB_R_M[0]) * rand();
  const g = new THREE.IcosahedronGeometry(r, 0);
  g.scale(1 + rand() * 0.3, SHRUB_SQUASH, 1 + rand() * 0.3);
  g.rotateY(rand() * Math.PI * 2);
  g.translate(x, ground + r * SHRUB_SQUASH * 0.75, z);
  return tint(g, pick(SHRUB_COLORS, rand));
}

// A slatted timber bench with a back and arms, standing on the ground facing -Z.
// Not bleachers: somewhere to sit for twenty minutes and watch, or to sit for the
// sake of sitting.
function benchGeometry(rand) {
  const parts = [];
  const slat = 0.115, gap = 0.03;
  const wood = () => pick(BENCH_WOOD, rand);
  // Seat: four slats front to back.
  for (let k = 0; k < 4; k++) {
    const g = new THREE.BoxGeometry(BENCH_L, BENCH_SLAT_T, slat);
    g.translate(0, BENCH_SEAT_H, -BENCH_SEAT_D / 2 + slat / 2 + k * (slat + gap));
    parts.push(tint(g, wood()));
  }
  // Back: three slats, leaned back the way a comfortable one is.
  for (let k = 0; k < 3; k++) {
    const g = new THREE.BoxGeometry(BENCH_L, slat, BENCH_SLAT_T);
    g.rotateX(-0.19);
    g.translate(0, BENCH_SEAT_H + 0.10 + k * (slat + gap), BENCH_SEAT_D / 2 - 0.03);
    parts.push(tint(g, wood()));
  }
  // Two end frames: a leg fore and aft, and an arm across them.
  for (const side of [-1, 1]) {
    const ex = side * (BENCH_L / 2 - 0.055);
    for (const ez of [-BENCH_SEAT_D / 2 + 0.05, BENCH_SEAT_D / 2 - 0.05]) {
      const leg = new THREE.BoxGeometry(0.045, BENCH_SEAT_H, 0.045);
      leg.translate(ex, BENCH_SEAT_H / 2, ez);
      parts.push(tint(leg, BENCH_FRAME_COLOR));
    }
    const arm = new THREE.BoxGeometry(0.045, 0.045, BENCH_SEAT_D);
    arm.translate(ex, BENCH_SEAT_H + BENCH_BACK_H * 0.42, 0);
    parts.push(tint(arm, BENCH_FRAME_COLOR));
  }
  return mergeGeometries(parts, false);
}

// A band of glass set into a wall face, standing a little proud so it catches its
// own shadow line rather than reading as paint.
function glazing(along, x, y, z, faceX, color) {
  const g = faceX
    ? new THREE.BoxGeometry(0.08, CH_GLASS_H, along)
    : new THREE.BoxGeometry(along, CH_GLASS_H, 0.08);
  g.translate(x, y + CH_GLASS_H / 2, z);
  return tint(g, color);
}

// The clubhouse. Two volumes, deep eaves, a covered walk facing the courts and an
// open deck facing the water.
function clubhouse(cx, cz, ground) {
  const parts = [];
  const mw = CH_MAIN_W / 2, ml = CH_MAIN_L / 2;
  const base = ground + CH_PLINTH;

  // Plinth, a little wider than the walls, so the building sits rather than floats.
  parts.push(box(CH_MAIN_W + 1.0, CH_MAIN_L + 1.0, CH_PLINTH, cx, ground, cz, CH_PLINTH_COLOR));

  // The lounge: walls, then glass east toward the courts and west toward the sea.
  parts.push(box(CH_MAIN_W, CH_MAIN_L, CH_MAIN_WALL, cx, base, cz, CH_CLAD));
  parts.push(glazing(CH_MAIN_L - 2.0, cx + mw, base + CH_GLASS_SILL, cz, true, CH_GLASS));
  parts.push(glazing(CH_MAIN_L - 2.0, cx - mw, base + CH_GLASS_SILL, cz, true, CH_GLASS));
  // A clerestory band under the eaves, which is what lifts the inside light.
  const cl = new THREE.BoxGeometry(0.08, 0.7, CH_MAIN_L - 4.0);
  cl.translate(cx + mw, base + CH_MAIN_WALL - 0.85, cz);
  parts.push(tint(cl, CH_GLASS));
  // The gable ends: south looks down the water, north is the way in from the car.
  // Neither may be left a blank slab — that is what makes a box read as a box.
  parts.push(glazing(CH_MAIN_W - 3.0, cx, base + CH_GLASS_SILL, cz + ml, false, CH_GLASS));
  parts.push(glazing(CH_MAIN_W - 5.0, cx, base + CH_GLASS_SILL, cz - ml, false, CH_GLASS));
  // Fascia along the wall head, and a belt course at the window head, which is
  // what stops eleven metres of cladding reading as one surface.
  for (const s of [-1, 1]) {
    parts.push(box(0.14, CH_MAIN_L + 0.4, 0.22, cx + s * mw, base + CH_MAIN_WALL - 0.22, cz, CH_TRIM));
    parts.push(box(0.11, CH_MAIN_L + 0.3, 0.10, cx + s * mw,
                   base + CH_GLASS_SILL + CH_GLASS_H, cz, CH_TRIM));
  }
  for (const s of [-1, 1]) {
    parts.push(box(CH_MAIN_W + 0.3, 0.11, 0.10, cx,
                   base + CH_GLASS_SILL + CH_GLASS_H, cz + s * ml, CH_TRIM));
  }
  const roof = gableRoof(mw, ml, base + CH_MAIN_WALL, CH_MAIN_RISE, CH_EAVE, CH_ROOF);
  roof.translate(cx, 0, cz);
  parts.push(roof);

  // The service wing, lower, off the north end and running east.
  const wx = cx + CH_WING_L / 2 - 1.0;
  const wz = cz - ml - CH_WING_W / 2 + 1.5;
  parts.push(box(CH_WING_L + 0.8, CH_WING_W + 0.8, CH_PLINTH, wx, ground, wz, CH_PLINTH_COLOR));
  parts.push(box(CH_WING_L, CH_WING_W, CH_WING_WALL, wx, base, wz, CH_CLAD_WING));
  parts.push(glazing(CH_WING_L - 3.0, wx, base + CH_GLASS_SILL, wz + CH_WING_W / 2, false, CH_GLASS));
  const wingRoof = gableRoof(CH_WING_W / 2, CH_WING_L / 2, base + CH_WING_WALL,
                             CH_WING_RISE, CH_EAVE * 0.8, CH_ROOF);
  wingRoof.rotateY(Math.PI / 2);   // ridge across the wing, east to west
  wingRoof.translate(wx, 0, wz);
  parts.push(wingRoof);

  // The covered walk facing the courts: a deck, six posts and a flat canopy.
  const tz = cz;
  const tx = cx + mw + CH_TERRACE_D / 2;
  parts.push(box(CH_TERRACE_D, CH_MAIN_L, 0.18, tx, ground + CH_PLINTH - 0.18, tz, CH_DECK_COLOR));
  for (let k = 0; k < 6; k++) {
    const pz = cz - ml + 0.9 + (k * (CH_MAIN_L - 1.8)) / 5;
    parts.push(box(0.16, 0.16, CH_TERRACE_H, cx + mw + CH_TERRACE_D - 0.3, base, pz, CH_POST));
  }
  parts.push(box(CH_TERRACE_D + 0.5, CH_MAIN_L + 0.5, 0.16,
                  tx + 0.1, base + CH_TERRACE_H, tz, CH_ROOF));
  parts.push(box(CH_TERRACE_D + 0.5, 0.12, 0.26,
                  tx + 0.1, base + CH_TERRACE_H - 0.26, tz + (CH_MAIN_L + 0.5) / 2, CH_TRIM));

  // The deck facing the water, open, with a rail.
  const dx = cx - mw - CH_DECK_D / 2;
  parts.push(box(CH_DECK_D, CH_MAIN_L - 2.0, 0.18, dx, ground + CH_PLINTH - 0.18, cz, CH_DECK_COLOR));
  const rail = (x, z, w, d) => {
    parts.push(box(w, d, 0.08, x, base + CH_RAIL_H, z, CH_TRIM));
  };
  rail(dx, cz - (CH_MAIN_L - 2.0) / 2, CH_DECK_D, 0.08);
  rail(dx, cz + (CH_MAIN_L - 2.0) / 2, CH_DECK_D, 0.08);
  rail(cx - mw - CH_DECK_D, cz, 0.08, CH_MAIN_L - 2.0);
  for (let k = 0; k < 7; k++) {
    const pz = cz - (CH_MAIN_L - 2.0) / 2 + (k * (CH_MAIN_L - 2.0)) / 6;
    parts.push(box(0.09, 0.09, CH_RAIL_H, cx - mw - CH_DECK_D, base, pz, CH_POST));
  }

  // A door, pale, on the court side under the walk.
  parts.push(box(0.1, 1.6, 2.2, cx + mw + 0.02, base, cz + 2.0, CH_TRIM));

  return parts;
}

// A flat walk laid on the ground, cut fine enough to follow it. Same idea as the
// road ribbons on the peninsula, in world coordinates rather than lat/lon.
function walk(loop, sample, width) {
  const pos = [];
  const half = width / 2;
  const pts = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.round(len / 2.5));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const { lat, lon } = fromWorld(x, z);
      pts.push({ x, z, y: sample(lat, lon) + PATH_LIFT_M });
    }
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    const px = (-dz / l) * half, pz = (dx / l) * half;
    pos.push(a.x + px, a.y, a.z + pz, a.x - px, a.y, a.z - pz, b.x + px, b.y, b.z + pz);
    pos.push(b.x + px, b.y, b.z + pz, a.x - px, a.y, a.z - pz, b.x - px, b.y, b.z - pz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

// One net per court: two posts and a flat panel between them.
function nets(layout, y) {
  const parts = [];
  const half = COURT_W / 2 + NET_BEYOND_M;
  for (const z0 of [layout.setZ0, layout.setZ1]) {
    const zNet = z0 + RUN_END + COURT_L / 2;
    for (let i = 0; i < 3; i++) {
      const cx = layout.blockX0 + RUN_SIDE + i * layout.courtPitch + COURT_W / 2;
      for (const side of [-1, 1]) {
        const p = new THREE.CylinderGeometry(NET_POST_R, NET_POST_R, NET_H, 6, 1, true);
        p.translate(cx + side * half, y + NET_H / 2, zNet);
        parts.push(p);
      }
      const panel = new THREE.BoxGeometry(half * 2, NET_H, 0.02);
      panel.translate(cx, y + NET_H / 2, zNet);
      parts.push(panel);
    }
  }
  return mergeGeometries(parts, false);
}

// sample(lat, lon) -> metres above MLLW, the near tile's own sampler.
export function buildBrademy(scene, sample) {
  const corners = LOT.map(([lat, lon]) => toWorld(lat, lon, 0));
  const lot = buildable(corners);

  const setW = 3 * COURT_W + 4 * RUN_SIDE;
  const setD = COURT_L + 2 * RUN_END;
  const blockW = setW;
  const blockD = setD * 2 + PATH_M;
  const marginX = ((lot.x1 - lot.x0) - blockW) / 2;
  const marginZ = ((lot.z1 - lot.z0) - blockD) / 2;
  if (marginX < 0 || marginZ < 0) {
    throw new Error(
      `brademy: two sets of three need ${blockW.toFixed(1)} x ${blockD.toFixed(1)} m ` +
      `and the lot's buildable rectangle is only ` +
      `${(lot.x1 - lot.x0).toFixed(1)} x ${(lot.z1 - lot.z0).toFixed(1)} m. ` +
      `Check the corners in LOT, or cut the run-offs or the middle path.`);
  }

  const layout = {
    blockX0: lot.x0 + marginX,
    blockZ0: lot.z0 + marginZ,
    setW, setD, blockW, blockD,
    courtPitch: COURT_W + RUN_SIDE,
    setZ0: lot.z0 + marginZ,
    setZ1: lot.z0 + marginZ + setD + PATH_M,
  };

  // The pad is one level for all six courts, set just over the highest ground
  // under it. The lot's own high corner reaches 6.8 m but it falls in the margin
  // where the trees go, not under a court, so it does not lift the pad.
  const padX0 = layout.blockX0 - PAD_APRON_M;
  const padX1 = layout.blockX0 + blockW + PAD_APRON_M;
  const padZ0 = layout.blockZ0 - PAD_APRON_M;
  const padZ1 = layout.blockZ0 + blockD + PAD_APRON_M;
  let high = -Infinity, low = Infinity;
  const STEPS = 40;
  for (let i = 0; i <= STEPS; i++) {
    for (let j = 0; j <= STEPS; j++) {
      const x = padX0 + ((padX1 - padX0) * j) / STEPS;
      const z = padZ0 + ((padZ1 - padZ0) * i) / STEPS;
      const { lat, lon } = fromWorld(x, z);
      const h = sample(lat, lon);
      if (h > high) high = h;
      if (h < low) low = h;
    }
  }
  const padY = high + PAD_CLEARANCE_M;

  const group = new THREE.Group();
  group.visible = false;

  const padMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.95, metalness: 0 });
  paintCourts(padMat, layout);
  group.add(new THREE.Mesh(slab(padX0, padX1, padZ0, padZ1, padY), padMat));

  group.add(new THREE.Mesh(
    skirt(padX0, padX1, padZ0, padZ1, padY),
    new THREE.MeshStandardMaterial({
      color: PAD_COLOR, roughness: 1, metalness: 0, side: THREE.DoubleSide })));

  const fenceMat = new THREE.MeshStandardMaterial({
    color: FENCE_COLOR, roughness: 0.8, metalness: 0.2 });
  for (const z0 of [layout.setZ0, layout.setZ1]) {
    group.add(new THREE.Mesh(
      fence(layout.blockX0, layout.blockX0 + setW, z0, z0 + setD, padY), fenceMat));
  }

  group.add(new THREE.Mesh(nets(layout, padY), new THREE.MeshStandardMaterial({
    color: NET_COLOR, roughness: 0.9, metalness: 0, side: THREE.DoubleSide })));

  // ---- landscaping and seating -------------------------------------------
  const rand = seeded(20260807);
  const groundAt = (x, z) => {
    const { lat, lon } = fromWorld(x, z);
    return sample(lat, lon);
  };

  // Points spaced round the four sides of a rectangle, nudged off the line so a
  // planted row does not read as a fence of trees.
  const ring = (x0, x1, z0, z1, spacing, jitter) => {
    const out = [];
    const side = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / spacing));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        out.push({
          x: ax + (bx - ax) * t + (rand() - 0.5) * 2 * jitter,
          z: az + (bz - az) * t + (rand() - 0.5) * 2 * jitter,
        });
      }
    };
    side(x0, z0, x1, z0);
    side(x1, z0, x1, z1);
    side(x1, z1, x0, z1);
    side(x0, z1, x0, z0);
    return out;
  };
  const out = (m) => [padX0 - m, padX1 + m, padZ0 - m, padZ1 + m];

  // The walk: a loop just outside the pad, and the planting beyond it.
  group.add(new THREE.Mesh(
    walk([
      { x: padX0 - 1.1, z: padZ0 - 1.1 }, { x: padX1 + 1.1, z: padZ0 - 1.1 },
      { x: padX1 + 1.1, z: padZ1 + 1.1 }, { x: padX0 - 1.1, z: padZ1 + 1.1 },
    ], sample, PATH_W_M),
    new THREE.MeshStandardMaterial({
      color: PATH_COLOR, roughness: 1, side: THREE.DoubleSide })));

  const planting = [];
  for (const p of ring(...out(3.6), 8.5, 1.1)) {
    planting.push(...ornamental(p.x, p.z, groundAt(p.x, p.z), rand));
  }
  for (const p of ring(...out(4.9), 2.6, 0.9)) {
    planting.push(shrub(p.x, p.z, groundAt(p.x, p.z), rand));
  }

  // The walk between the two sets is the one that matters: it is where you stand
  // to watch, so it gets the trees and the benches face the courts from it.
  const midZ = layout.setZ0 + setD + PATH_M / 2;
  for (let k = 0; k < 6; k++) {
    const x = layout.blockX0 + setW * ((k + 0.5) / 6);
    planting.push(...ornamental(x, midZ, padY, rand));
  }
  group.add(new THREE.Mesh(mergeGeometries(planting, false),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })));

  // Benches. A bench faces -Z before it is turned, so the yaw that points it at
  // a thing is atan2 of the negated offset.
  const benchBase = benchGeometry(rand);
  const benches = [];
  const seat = (x, y, z, dx, dz) => {
    const g = benchBase.clone();
    g.rotateY(Math.atan2(-dx, -dz));
    g.translate(x, y, z);
    benches.push(g);
  };
  for (let k = 0; k < 3; k++) {
    const x = layout.blockX0 + setW * (0.22 + k * 0.28);
    seat(x, padY, midZ - 2.4, 0, -1);   // watching the north set
    seat(x, padY, midZ + 2.4, 0, 1);    // watching the south set
  }
  // And a few on the outer walk looking in, for sitting rather than watching.
  for (let k = 0; k < 3; k++) {
    const z = padZ0 + (padZ1 - padZ0) * (0.2 + k * 0.3);
    seat(padX1 + 1.1, groundAt(padX1 + 1.1, z), z, -1, 0);
    seat(padX0 - 1.1, groundAt(padX0 - 1.1, z), z, 1, 0);
  }
  group.add(new THREE.Mesh(mergeGeometries(benches, false),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 })));

  // The clubhouse, on the Breakers footprint. Its ground is taken as the highest
  // under the building so the plinth sits on the slope rather than into it.
  let chGround = -Infinity;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const h = groundAt(BREAKERS_AT.x + i * (CH_MAIN_W / 2 + CH_DECK_D),
                         BREAKERS_AT.z + j * (CH_MAIN_L / 2 + CH_WING_W));
      if (h > chGround) chGround = h;
    }
  }
  group.add(new THREE.Mesh(
    mergeGeometries(clubhouse(BREAKERS_AT.x, BREAKERS_AT.z, chGround), false),
    new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.75, metalness: 0.05,
      // The roof hangs past the walls, so the soffit is seen from underneath.
      side: THREE.DoubleSide })));

  scene.add(group);

  // The hedge is round the lot now, so it is drawn now — its own group, outside
  // the switch.
  const hedge = new THREE.Group();
  hedge.add(new THREE.Mesh(
    hedgeGeometry(corners, sample, seeded(19940115)),
    new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide })));
  scene.add(hedge);
  return {
    group,
    hedge,
    courts: 6,
    benches: benches.length,
    padY,
    // The middle of the six courts, on the pad, so a caller can aim at them.
    centre: new THREE.Vector3(
      layout.blockX0 + blockW / 2, padY, layout.blockZ0 + blockD / 2),
    // How far off the whole thing has to be seen from, which is its long side
    // over the tangent of half the vertical field of view, with room round it.
    span: Math.max(blockW, blockD),
    groundLow: low,
    groundHigh: high,
    retainingM: padY - low,
    get visible() { return group.visible; },
    setVisible(on) { group.visible = on; },
  };
}
