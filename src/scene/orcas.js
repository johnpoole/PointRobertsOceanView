// Orcas passing the West Bluff.
//
// This is not a feed and must never be dressed as one. Nobody publishes where
// the whales are right now — Ocean Wise holds the live alerts for commercial
// mariners and delays everyone else a day, and Orca Network's reports are
// prose. What is published is how often they are seen, month by month, and that
// is what this draws: a season and a rate, and a group put on the water at that
// rate. It carries no label and makes no claim about today. See issue #10.
//
// The rate comes from the Orca Behavior Institute's 2025 Salish Sea count of
// Bigg's killer whales. Published: 1860 unique sightings over the year, 96 in
// February, 190 in September, 252 across December, January and February
// together, most in June then August then May, fewest in December then November
// then January. The other nine months are fitted to those figures — they are not
// published and are the weakest thing here.
//
// Bigg's and not the Southern Residents, because Bigg's are what passes now. The
// residents were absent from the whole Salish Sea in May, June and August of
// 2025. So the groups are Bigg's groups: two to six, a mother and her offspring,
// a grown son with them about a third of the time.
//
// The one number with nothing behind it is LOCAL_SHARE, the share of Salish Sea
// groups that come within sight of this bluff. It is an assumption. The sightings
// concentrate in Haro Strait and the San Juans and Point Roberts sits on the edge
// of that, so it is set low.

import * as THREE from "three";

// Unique Bigg's killer whale sightings in the Salish Sea by month, 2025.
const SALISH_2025 = [82, 96, 160, 170, 205, 230, 195, 210, 190, 170, 78, 74];
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Assumed share of those groups that pass within sight of the West Bluff.
const LOCAL_SHARE = 0.03;

// Turn this down to 1. Anything above it puts the whales on the water far more
// often than they are there.
const RATE_MULTIPLIER = 25000;

// The water they are drawn in: west of the house, out to three kilometres, and
// as far north and south as a group is still worth more than a few pixels.
const OFFSHORE_M = [500, 3000];
const CORRIDOR_Z = 2000;
const LEAVE_Z = 2600;
const MIN_DEPTH_M = 8;

// Travelling speed. Bigg's on the move make six to ten kilometres an hour.
const SPEED_MPS = [1.7, 2.8];

// One group at a time. Two in sight of each other happens and is not what this
// is for.
const MAX_GROUPS = 1;

// A surfacing, from the back breaking the surface to gone again.
const ARC_S = 3.4;
// Where in that arc the blowhole clears.
const BLOW_AT = 0.32;
const BLOW_LIFE_S = 2.6;
// Between breaths inside a series, then the long dive after the last of them.
const BREATH_GAP_S = [13, 21];
const SERIES = [3, 5];
const DEEP_S = [110, 300];

// How deep the body's centre sits between breaths, and how much of its own
// radius stays under at the top of the arc.
const SHALLOW_M = 2.6;
const SURFACE_FRACTION = 0.55;
// Below this it is not worth drawing, and on the long dive it is far below it.
const GONE_M = 4.0;

const BLACK = new THREE.Color(0x101214);
const WHITE = new THREE.Color(0xe8ece9);
const GREY = new THREE.Color(0x6a7076);

// Girth along the body, as a fraction of length. Nose at 0, fluke notch at 1.
const PROFILE = [
  [0.00, 0.006], [0.04, 0.048], [0.10, 0.072], [0.20, 0.090],
  [0.32, 0.095], [0.45, 0.088], [0.60, 0.070], [0.75, 0.046],
  [0.88, 0.026], [0.96, 0.016], [1.00, 0.010],
];

function lerpProfile(t) {
  const u = Math.min(1, Math.max(0, t));
  for (let i = 1; i < PROFILE.length; i++) {
    if (u <= PROFILE[i][0]) {
      const [t0, r0] = PROFILE[i - 1];
      const [t1, r1] = PROFILE[i];
      return r0 + (r1 - r0) * ((u - t0) / (t1 - t0));
    }
  }
  return PROFILE[PROFILE.length - 1][1];
}

function smoothstep(a, b, x) {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));

// The tail stock is squeezed flat from the sides, so it is taller than it is wide.
const squeezeX = (t) => 1 - 0.55 * smoothstep(0.72, 1.0, t);
const squeezeY = (t) => 1 + 0.45 * smoothstep(0.72, 1.0, t);

// Where the white belly stops and the black starts, as the cosine of the angle
// from vertical. It climbs the flank behind the dorsal and drops at the stock.
function whiteLine(t) {
  return -0.45 + 0.55 * smoothstep(0.52, 0.78, t) - 0.35 * smoothstep(0.86, 1.0, t);
}

function bodyColor(t, a) {
  const up = Math.cos(a);
  const flank = Math.abs(Math.sin(a));
  if (up < whiteLine(t)) return WHITE;
  if (t > 0.10 && t < 0.20 && up > 0.05 && up < 0.62 && flank > 0.72) return WHITE;
  if (t > 0.44 && t < 0.58 && up > 0.45) return GREY;
  return BLACK;
}

// Forward is -Z, matching the boat and the geo transform.
function bodyPoint(len, t, a) {
  const r = lerpProfile(t) * len;
  return new THREE.Vector3(
    r * squeezeX(t) * Math.sin(a),
    r * squeezeY(t) * Math.cos(a),
    -len / 2 + t * len);
}

// A flat piece: three points, one colour, and the normal off the winding. The
// material is double sided, so a piece facing away still lights correctly.
function plate(out, pts, color) {
  const n = new THREE.Vector3()
    .subVectors(pts[1], pts[0])
    .cross(new THREE.Vector3().subVectors(pts[2], pts[0]))
    .normalize();
  for (const p of pts) {
    out.pos.push(p.x, p.y, p.z);
    out.nrm.push(n.x, n.y, n.z);
    out.col.push(color.r, color.g, color.b);
  }
}

function fan(out, ring, color) {
  for (let i = 1; i < ring.length - 1; i++) {
    plate(out, [ring[0], ring[i], ring[i + 1]], color);
  }
}

// Two sides of a thin plate and the rim between them, from an outline in the ZY
// plane pushed out either side of xAt.
function blade(out, outline, xAt, halfT, color) {
  const near = outline.map(([z, y]) => new THREE.Vector3(xAt + halfT, y, z));
  const far = outline.map(([z, y]) => new THREE.Vector3(xAt - halfT, y, z));
  fan(out, near, color);
  fan(out, far.slice().reverse(), color);
  for (let i = 0; i < outline.length; i++) {
    const j = (i + 1) % outline.length;
    plate(out, [near[i], far[i], far[j]], color);
    plate(out, [near[i], far[j], near[j]], color);
  }
}

// A flat paddle lying in the XZ plane, pushed above and below yAt.
function paddle(out, outline, yAt, halfT, color) {
  const top = outline.map(([x, z]) => new THREE.Vector3(x, yAt + halfT, z));
  const bot = outline.map(([x, z]) => new THREE.Vector3(x, yAt - halfT, z));
  fan(out, top, color);
  fan(out, bot.slice().reverse(), color);
  for (let i = 0; i < outline.length; i++) {
    const j = (i + 1) % outline.length;
    plate(out, [top[i], bot[i], bot[j]], color);
    plate(out, [top[i], bot[j], top[j]], color);
  }
}

// A male's dorsal stands nearly straight and reaches a fifth of his length. A
// female's and a youngster's hooks back and is little more than half that.
function dorsalOutline(h, c, male) {
  return male
    ? [[-c * 0.50, 0], [-c * 0.44, h * 0.36], [-c * 0.30, h * 0.74],
       [-c * 0.04, h], [c * 0.34, h * 0.60], [c * 0.50, h * 0.10]]
    : [[-c * 0.50, 0], [-c * 0.34, h * 0.44], [-c * 0.04, h * 0.84],
       [c * 0.22, h], [c * 0.36, h * 0.68], [c * 0.50, h * 0.16]];
}

function whaleGeometry(len, male) {
  const out = { pos: [], nrm: [], col: [] };

  // Body. Normals come off the parametrisation rather than off the triangles,
  // so it reads as a body and not as a barrel of facets when the boat gets near.
  const RINGS = 22, SEG = 14;
  const dt = 1 / RINGS, da = (Math.PI * 2) / SEG;
  const radial = new THREE.Vector3();
  const normalAt = (t, a) => {
    const e = 1e-3;
    const dPt = bodyPoint(len, t + e, a).sub(bodyPoint(len, t - e, a));
    const dPa = bodyPoint(len, t, a + e).sub(bodyPoint(len, t, a - e));
    const n = new THREE.Vector3().crossVectors(dPa, dPt).normalize();
    // Force it outward. An inside-out normal lights the whale from the wrong side.
    radial.set(Math.sin(a), Math.cos(a), 0);
    if (n.dot(radial) < 0) n.negate();
    return n;
  };
  const push = (t, a) => {
    const p = bodyPoint(len, t, a);
    const n = normalAt(t, a);
    const c = bodyColor(t, a);
    out.pos.push(p.x, p.y, p.z);
    out.nrm.push(n.x, n.y, n.z);
    out.col.push(c.r, c.g, c.b);
  };
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEG; j++) {
      const t0 = i * dt, t1 = (i + 1) * dt, a0 = j * da, a1 = (j + 1) * da;
      push(t0, a0); push(t1, a0); push(t1, a1);
      push(t0, a0); push(t1, a1); push(t0, a1);
    }
  }

  // Dorsal, at 45% of the way back, standing on the top of the body there.
  const finH = len * (male ? 0.225 : 0.13);
  const finC = len * (male ? 0.19 : 0.16);
  const finZ = -len / 2 + 0.45 * len;
  const finFoot = lerpProfile(0.45) * len * squeezeY(0.45) * 0.86;
  blade(out,
    dorsalOutline(finH, finC, male).map(([z, y]) => [z + finZ, y + finFoot]),
    0, len * 0.014, BLACK);

  // Pectorals. A grown male's are great rounded paddles; everyone else's are
  // narrower. Set low on the flank at a fifth of the way back, swept aft.
  const pecL = len * (male ? 0.16 : 0.12);
  const pecW = len * (male ? 0.085 : 0.055);
  const pecZ = -len / 2 + 0.22 * len;
  const pecX = lerpProfile(0.22) * len * 0.72;
  for (const s of [-1, 1]) {
    paddle(out, [
      [s * pecX, pecZ - pecW * 0.4],
      [s * (pecX + pecW * 0.9), pecZ + pecL * 0.25],
      [s * (pecX + pecW * 1.0), pecZ + pecL * 0.75],
      [s * (pecX + pecW * 0.5), pecZ + pecL],
      [s * pecX, pecZ + pecL * 0.55],
    ], -len * 0.028, len * 0.006, BLACK);
  }

  // Flukes, spread either side of the notch at the very end.
  const flukeSpan = len * 0.105;
  const flukeC = len * 0.10;
  const flukeZ = len / 2;
  for (const s of [-1, 1]) {
    paddle(out, [
      [0, flukeZ - flukeC * 0.35],
      [s * flukeSpan * 0.45, flukeZ - flukeC * 0.30],
      [s * flukeSpan, flukeZ + flukeC * 0.20],
      [s * flukeSpan * 0.7, flukeZ + flukeC * 0.45],
      [0, flukeZ + flukeC * 0.15],
    ], 0, len * 0.005, BLACK);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(out.pos), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(out.nrm), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(out.col), 3));
  return g;
}

// A Bigg's group: a mother, her offspring, and about a third of the time a grown
// son travelling with them.
function groupMembers() {
  const n = randInt(2, 6);
  const lens = [rand(6.0, 6.8)]; // the mother
  const male = [false];
  if (Math.random() < 0.34) { lens.push(rand(7.0, 7.9)); male.push(true); }
  while (lens.length < n) {
    lens.push(rand(2.9, 5.2));   // calves and juveniles
    male.push(false);
  }
  return lens.map((len, i) => ({ len, male: male[i] }));
}

// opts: seaAt(x,z) -> { y, dx, dz, depth, aground }, the same one the boat floats on.
export function buildOrcas(scene, opts = {}) {
  const seaAt = opts.seaAt;
  if (!seaAt) {
    throw new Error(
      "buildOrcas: no seaAt was given, so there is no water surface to put a " +
      "whale on. Build it inside the near-terrain promise in main.js, the way " +
      "buildDrift is.");
  }

  const group = new THREE.Group();
  scene.add(group);

  const skin = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.35, metalness: 0.05, side: THREE.DoubleSide,
  });
  // A blow is a puff of water and breath hanging over the whale, not a solid.
  const breath = new THREE.MeshBasicMaterial({
    color: 0xf2f6f5, transparent: true, opacity: 0, depthWrite: false,
  });

  // Groups per day passing this stretch of water, for the month we are in.
  function ratePerSecond(month) {
    const perDay = (SALISH_2025[month] / DAYS[month]) * LOCAL_SHARE;
    return (perDay * RATE_MULTIPLIER) / 86400;
  }

  const pods = [];
  const euler = new THREE.Euler(0, 0, 0, "YXZ");

  function spawn() {
    // Somewhere in the corridor, on a heading up or down the strait, and under
    // water: every whale starts its first breath from below, so none of them
    // appears out of nothing on the surface.
    const heading = (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.35, 0.35);
    let x = 0, z = 0, placed = false;
    for (let tries = 0; tries < 20; tries++) {
      x = -rand(OFFSHORE_M[0], OFFSHORE_M[1]);
      z = rand(-CORRIDOR_Z, CORRIDOR_Z);
      const s = seaAt(x, z);
      if (!s.aground && s.depth > MIN_DEPTH_M) { placed = true; break; }
    }
    if (!placed) return;

    const members = groupMembers();
    const pod = {
      x, z, heading,
      speed: rand(SPEED_MPS[0], SPEED_MPS[1]),
      animals: members.map((m, i) => {
        const mesh = new THREE.Mesh(whaleGeometry(m.len, m.male), skin);
        mesh.frustumCulled = false;
        mesh.visible = false;
        group.add(mesh);
        const blow = new THREE.Mesh(
          new THREE.ConeGeometry(0.75, 3.0, 8, 1, true), breath.clone());
        blow.frustumCulled = false;
        blow.visible = false;
        group.add(blow);
        return {
          len: m.len, mesh, blow,
          // Spread through the group: the mother leads, the rest fall in beside
          // and behind her.
          lag: i === 0 ? 0 : rand(4, 26),
          abeam: i === 0 ? 0 : rand(-22, 22),
          breaths: randInt(SERIES[0], SERIES[1]),
          // Nobody breathes in step, and everyone starts down.
          timer: rand(0, DEEP_S[1]),
          deep: true,
          arc: -1,
          blowT: -1,
        };
      }),
    };
    pods.push(pod);
  }

  function retire(pod) {
    for (const a of pod.animals) {
      group.remove(a.mesh, a.blow);
      a.mesh.geometry.dispose();
      a.blow.geometry.dispose();
      a.blow.material.dispose();
    }
  }

  return {
    group,
    update(dt) {
      if (pods.length < MAX_GROUPS) {
        const r = ratePerSecond(new Date().getMonth());
        if (Math.random() < 1 - Math.exp(-r * dt)) spawn();
      }

      for (let p = pods.length - 1; p >= 0; p--) {
        const pod = pods[p];
        // Heading is a compass bearing: north is -Z, east is +X.
        const hx = Math.sin(pod.heading), hz = -Math.cos(pod.heading);
        pod.x += hx * pod.speed * dt;
        pod.z += hz * pod.speed * dt;
        if (Math.abs(pod.z) > LEAVE_Z
            || pod.x > -OFFSHORE_M[0] * 0.5 || pod.x < -OFFSHORE_M[1] * 1.4) {
          retire(pod);
          pods.splice(p, 1);
          continue;
        }

        for (const a of pod.animals) {
          // Breathing. A series of short surfacings, then a long dive.
          if (a.arc >= 0) {
            a.arc += dt;
            if (a.arc > ARC_S) a.arc = -1;
          }
          a.timer -= dt;
          if (a.timer <= 0 && a.arc < 0) {
            a.arc = 0;
            a.blowT = 0;
            a.deep = false;
            a.breaths -= 1;
            if (a.breaths > 0) {
              a.timer = rand(BREATH_GAP_S[0], BREATH_GAP_S[1]);
            } else {
              a.timer = rand(DEEP_S[0], DEEP_S[1]);
              a.breaths = randInt(SERIES[0], SERIES[1]);
              a.deep = true;
            }
          }

          // How far the body's centre sits under the surface. On the long dive
          // it is far enough down not to be drawn at all.
          const surface = lerpProfile(0.32) * a.len * SURFACE_FRACTION;
          let sub = a.deep && a.arc < 0 ? 30 : SHALLOW_M;
          let rise = 0;
          if (a.arc >= 0) {
            const u = a.arc / ARC_S;
            const hump = Math.sin(Math.PI * u);
            sub = SHALLOW_M + (surface - SHALLOW_M) * hump;
            // Rolling up and over, the way a travelling whale does.
            rise = Math.cos(Math.PI * u) * 0.22;
          }

          // Station on the group: back along the heading, and out to one side
          // of it.
          const ax = pod.x - hx * a.lag - hz * a.abeam;
          const az = pod.z - hz * a.lag + hx * a.abeam;
          const sea = seaAt(ax, az);

          if (sub > GONE_M) {
            a.mesh.visible = false;
          } else {
            a.mesh.visible = true;
            a.mesh.position.set(ax, sea.y - sub, az);
            // Yaw runs the other way from a compass bearing: this is the same
            // atan2(-x, -z) the overview map turns a look direction with.
            euler.set(Math.atan(sea.dz) + rise, -pod.heading, -Math.atan(sea.dx));
            a.mesh.quaternion.setFromEuler(euler);
          }

          // The blow. It leaves the blowhole as the head clears and hangs over
          // the water after the whale has gone down again.
          if (a.blowT >= 0 && a.arc >= 0 && a.arc / ARC_S >= BLOW_AT && a.blowT === 0) {
            const hole = new THREE.Vector3(0, lerpProfile(0.13) * a.len * 0.9,
                                           -a.len / 2 + 0.13 * a.len);
            hole.applyQuaternion(a.mesh.quaternion);
            a.blow.position.set(a.mesh.position.x + hole.x,
                                a.mesh.position.y + hole.y,
                                a.mesh.position.z + hole.z);
            a.blow.visible = true;
            a.blowT = 1e-4;
          } else if (a.blowT > 0) {
            a.blowT += dt;
            const u = a.blowT / BLOW_LIFE_S;
            if (u >= 1) {
              a.blow.visible = false;
              a.blowT = -1;
            } else {
              // Rising, spreading and thinning out.
              a.blow.position.y += 0.9 * dt;
              a.blow.scale.set(0.5 + u * 1.6, 0.6 + u * 0.9, 0.5 + u * 1.6);
              a.blow.material.opacity = 0.75 * (1 - u) * (1 - u);
            }
          }
        }
      }
    },
  };
}
