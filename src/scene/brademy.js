// The Brademy: six tennis courts on the old Breakers parking lot.
//
// This is not there. It is a proposal, so it is off until asked for and it says
// proposed whenever it is on. Everything else on this page is a measurement of
// something real and this is the one thing that is not, which is why it is kept
// behind a switch rather than drawn into the world.
//
// The lot's four corners are John's, off the ground rather than off a survey.
// Everything else here is worked out from them: the buildable rectangle, where
// the courts sit in it, and how high the pad has to be so nothing pokes through.
//
// Two sets of three, side by side within a set, one set north of the other. The
// courts run north and south, which is the convention — the low sun ends up off
// to the side rather than in a server's eyes. Side by side would have wanted
// 119 m of width and the lot has 62 m, so the sets stack.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { fromWorld, toWorld } from "../geo.js";

// The old Breakers parking lot, clockwise from the northeast. Supplied, not
// surveyed.
const LOT = [
  [48.9841635665451, -123.08228060944315],   // NE
  [48.98333968343413, -123.08216612219306],  // SE
  [48.98334018863542, -123.08313207910217],  // SW
  [48.98418392813251, -123.08315269838253],  // NW
];

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

  scene.add(group);
  return {
    group,
    courts: 6,
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
