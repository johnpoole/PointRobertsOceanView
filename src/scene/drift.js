// What the water is carrying, so the current can be read off it.
//
// Not arrows. Nobody reads a current off a vector field — they watch what goes
// past and judge it against something that is not moving. So: kelp, sticks and
// flecks of foam, drifting on the real stream and riding the real swell.
//
// Kelp and sticks lie along the flow, which means the direction reads before
// anything has visibly moved. Speed you get from watching a stick go past a
// piling.
//
// Full density out to 80 m and thinning to nothing by 300 m. The near figure is
// John's. The far one is where a stick stops being worth drawing: at this
// field of view a one metre stick is 101 px at 20 m, 20 px at 100 m and 7 px at
// 300 m, so 300 is about where it stops being a stick and starts being a speck.
// The thinning is not only for the cost — scattered debris really does fade out
// with distance as it stops resolving, so a hard edge would look wrong.
//
// The honesty rule: no current reading, nothing drawn. Debris that sat still on
// the water would be decoration, and debris that moved without a reading behind
// it would be a lie. See issue #13.

import * as THREE from "three";
import { seeded } from "./parts.js";

// It was 1200 and the water read as a raft rather than as open sea with things
// on it. A quarter of that is 165 sticks, 90 pieces of kelp and 45 of foam,
// which is still enough to read the set off and not enough to cover the strait.
const POOL = 300;
const FULL_M = 80;
const FADE_M = 300;
// How many frames it takes to ask the whole pool where the sea is. See update().
const STRIDE = 3;

// Of the pool: mostly sticks, a good deal of kelp, a little foam.
const SHARE = { stick: 0.55, kelp: 0.30, foam: 0.15 };

const STICK_L = [0.4, 1.7];
const STICK_COLORS = [0x6b5a46, 0x7a6a54, 0x554839, 0x847354];
const KELP_L = [0.9, 3.4];
const KELP_COLORS = [0x4a4526, 0x3d3a20, 0x5a5330, 0x2f2c19];
const FOAM_L = [0.5, 1.6];
const FOAM_COLORS = [0xdfe4e2, 0xc9d2d0, 0xeef2f0];

// A piece sits this far into the water rather than on top of it.
const SIT_M = 0.03;

function stickGeometry() {
  // Long in X, so a yaw of zero points it north and the flow can turn it.
  return new THREE.BoxGeometry(1, 0.055, 0.075);
}

function bladeGeometry() {
  const g = new THREE.PlaneGeometry(1, 0.34);
  g.rotateX(-Math.PI / 2);
  return g;
}

function foamGeometry() {
  const g = new THREE.PlaneGeometry(1, 0.55);
  g.rotateX(-Math.PI / 2);
  return g;
}

// opts: seaAt(x,z) -> { y, dx, dz, aground }, the same one the boat floats on.
export function buildDrift(scene, opts = {}) {
  const seaAt = opts.seaAt || null;
  const rand = seeded(0x0ceaa1);

  const counts = {
    stick: Math.round(POOL * SHARE.stick),
    kelp: Math.round(POOL * SHARE.kelp),
    foam: Math.round(POOL * SHARE.foam),
  };
  const spec = {
    stick: { geom: stickGeometry(), colors: STICK_COLORS, len: STICK_L,
             mat: { roughness: 0.9, metalness: 0 } },
    kelp: { geom: bladeGeometry(), colors: KELP_COLORS, len: KELP_L,
            mat: { roughness: 0.55, metalness: 0, side: THREE.DoubleSide } },
    foam: { geom: foamGeometry(), colors: FOAM_COLORS, len: FOAM_L,
            mat: { roughness: 1, metalness: 0, side: THREE.DoubleSide,
                   transparent: true, opacity: 0.72 } },
  };

  const group = new THREE.Group();
  group.visible = false;
  const kinds = [];
  const white = new THREE.Color(0xffffff);
  for (const name of Object.keys(counts)) {
    const s = spec[name];
    const mesh = new THREE.InstancedMesh(
      s.geom,
      new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: false, ...s.mat }),
      counts[name]);
    mesh.setColorAt(0, white);        // allocate the colour buffer up front
    mesh.frustumCulled = false;       // its bounds are one piece at the origin
    mesh.castShadow = false;
    group.add(mesh);
    kinds.push({ name, mesh, spec: s, pieces: [] });
    for (let i = 0; i < counts[name]; i++) {
      kinds[kinds.length - 1].pieces.push({
        x: 0, z: 0, born: false,
        y: 0, tiltX: 0, tiltZ: 0,     // last answer from the sea, held between turns
        len: s.len[0] + (s.len[1] - s.len[0]) * rand(),
        color: new THREE.Color(s.colors[Math.floor(rand() * s.colors.length)]),
        // Nothing lies perfectly along the stream.
        skew: (rand() - 0.5) * 0.7,
        bob: rand() * Math.PI * 2,
      });
    }
  }
  // Slots are fixed, so each piece's colour goes in once and stays.
  for (const k of kinds) {
    k.pieces.forEach((p, i) => k.mesh.setColorAt(i, p.color));
    k.mesh.instanceColor.needsUpdate = true;
  }
  scene.add(group);

  const m = new THREE.Matrix4();
  // Retired pieces get this: every vertex on one point, so the triangles are
  // degenerate and never reach the rasteriser.
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, "YXZ");

  // Density: solid inside FULL_M, falling off linearly to nothing at FADE_M.
  const wanted = (r) => (r <= FULL_M ? 1 : Math.max(0, 1 - (r - FULL_M) / (FADE_M - FULL_M)));

  // Put a piece somewhere in the disc, on water, thinned by distance. Biased
  // upstream so pieces drift in and across rather than appearing in front of you.
  function place(p, cx, cz, ux, uz) {
    for (let tries = 0; tries < 12; tries++) {
      // Area-weighted radius, or the middle of the disc fills up and the edge
      // stays bare.
      const r = FADE_M * Math.sqrt(rand());
      if (rand() > wanted(r)) continue;
      // Two thirds of the time, upstream of the camera.
      const up = Math.atan2(-ux, -uz);
      const a = rand() < 0.66
        ? up + (rand() - 0.5) * 2.2
        : rand() * Math.PI * 2;
      const x = cx + Math.sin(a) * r;
      const z = cz + Math.cos(a) * r;
      const s = seaAt ? seaAt(x, z) : null;
      if (s && s.aground) continue;
      p.x = x; p.z = z; p.born = true;
      // It has to sit on the water from its first frame, not wait its turn.
      if (s) { p.y = s.y; p.tiltX = Math.atan(s.dz); p.tiltZ = -Math.atan(s.dx); }
      return true;
    }
    p.born = false;
    return false;
  }

  let frame = 0;
  return {
    group,
    // current: { x, z } metres a second in world axes, or null for no reading.
    update(dt, camera, current) {
      if (!current || !seaAt) {
        if (group.visible) group.visible = false;
        return;
      }
      group.visible = true;
      frame++;
      const phase = frame % STRIDE;
      const cx = camera.position.x, cz = camera.position.z;
      const sp = Math.hypot(current.x, current.z);
      // Slack water still has debris on it; it just is not going anywhere. Give
      // the pieces an along-flow heading only when there is a flow to have one.
      const ux = sp > 1e-4 ? current.x / sp : 0;
      const uz = sp > 1e-4 ? current.z / sp : 1;
      const flowYaw = Math.atan2(current.x, current.z);

      // Every piece keeps its own instance slot for as long as it exists, so the
      // colours are written once when it is built and never again, and there is
      // no packing to do. A piece with nowhere to be is scaled to nothing, which
      // costs a degenerate triangle and no fragments.
      //
      // seaAt is the expensive call in here — three wave components and a bed
      // lookup — so it is made exactly once per piece and everything, the
      // grounding test included, comes out of that one answer.
      for (const k of kinds) {
        for (let i = 0; i < k.pieces.length; i++) {
          const p = k.pieces[i];
          if (p.born) {
            p.x += current.x * dt;
            p.z += current.z * dt;
          } else {
            place(p, cx, cz, ux, uz);
          }
          // Only a third of the pool asks the sea where it is on any one frame.
          // seaAt is two bilinear lookups into a three-and-a-half million element
          // heightmap, a cache miss apiece, and at 1200 pieces a frame that was
          // 3.6 ms — a fifth of the budget, for driftwood. Positions still move
          // every frame; it is the height and the tilt that lag, by at most two
          // frames, on a swell whose period is measured in seconds.
          if (p.born && (i % STRIDE) === phase) {
            const s = seaAt(p.x, p.z);
            const r = Math.hypot(p.x - cx, p.z - cz);
            // Out of range, or ashore. The thinning with distance happens when a
            // piece is placed, not here — a per-frame rejection test would kill
            // most of the pool every second and the water would boil. What is
            // left is a slow retirement, per second rather than per frame, for
            // pieces that have drifted into the thin part of the scatter.
            if (s.aground || r > FADE_M
                || rand() < (1 - wanted(r)) * dt * STRIDE * 0.4) {
              p.born = false;
            } else {
              p.y = s.y;
              p.tiltX = Math.atan(s.dz);
              p.tiltZ = -Math.atan(s.dx);
            }
          }
          if (!p.born) {
            k.mesh.setMatrixAt(i, ZERO);
            continue;
          }
          pos.set(p.x, p.y - SIT_M, p.z);
          // Lying along the stream, and lying on the wave it is sitting on.
          euler.set(p.tiltX, flowYaw + p.skew, p.tiltZ);
          quat.setFromEuler(euler);
          scl.set(p.len, 1, 1);
          k.mesh.setMatrixAt(i, m.compose(pos, quat, scl));
        }
        k.mesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
