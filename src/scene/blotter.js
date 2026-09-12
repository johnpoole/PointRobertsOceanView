// Where the deputy was called out, put on the ground.
//
// The Sheriff's log gives a street and nothing finer — GULF RD, or a junction
// like APA RD & BOUNDARY BAY RD. So a call stands on its road, not on a house,
// because a house is not what the record says. Where a street has had more than
// one call, they are spread along it rather than stacked in one place.
//
// The street names come off OpenStreetMap with the roads themselves, and his
// rows are matched to them by pulling both down to the same shape: GULF RD and
// Gulf Road are the same street, S BEACH RD is South Beach Road.

import * as THREE from "three";
import { toWorld, fromWorld } from "../geo.js";

const POST_M = 2.6;
const HEAD_M = 0.42;
// Standing in the road is where the record puts it, and standing in the road is
// also where it would be run over. Out to the verge.
const VERGE_M = 3.4;
const SEEN_M = 1800;

// What the two of them call the same thing.
const SUFFIX = {
  RD: "ROAD", AV: "AVENUE", AVE: "AVENUE", ST: "STREET", DR: "DRIVE",
  PL: "PLACE", WA: "WAY", WY: "WAY", LN: "LANE", CT: "COURT",
  BLVD: "BOULEVARD", TER: "TERRACE", CIR: "CIRCLE", HWY: "HIGHWAY",
  PKWY: "PARKWAY",
};
const PREFIX = { S: "SOUTH", N: "NORTH", E: "EAST", W: "WEST" };

export function tidyStreet(name) {
  const words = String(name || "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (!words.length) return "";
  if (PREFIX[words[0]]) words[0] = PREFIX[words[0]];
  const last = words.length - 1;
  if (SUFFIX[words[last]]) words[last] = SUFFIX[words[last]];
  return words.join(" ");
}

// Every named road, by its tidied name, longest first so a street split into
// several ways is led by its longest piece.
function index(roads) {
  const by = new Map();
  for (const road of roads) {
    if (!road.name) continue;
    const key = tidyStreet(road.name);
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(road);
  }
  for (const list of by.values()) list.sort((a, b) => span(b) - span(a));
  return by;
}

function span(road) {
  let run = 0;
  for (let i = 1; i < road.coords.length; i++) {
    const a = toWorld(road.coords[i - 1][0], road.coords[i - 1][1]);
    const b = toWorld(road.coords[i][0], road.coords[i][1]);
    run += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return run;
}

// A point a fraction of the way along a road, and which way the road runs there.
function alongRoad(road, fraction) {
  const pts = road.coords.map(([lat, lon]) => toWorld(lat, lon));
  const runs = [0];
  for (let i = 1; i < pts.length; i++) {
    runs.push(runs[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  const total = runs[runs.length - 1];
  const want = total * Math.min(Math.max(fraction, 0), 1);
  let i = 1;
  while (i < runs.length - 1 && runs[i] < want) i++;
  const a = pts[i - 1], b = pts[i];
  const step = Math.max(runs[i] - runs[i - 1], 1e-6);
  const k = Math.min(Math.max((want - runs[i - 1]) / step, 0), 1);
  const heading = Math.atan2(b.x - a.x, b.z - a.z);
  return {
    x: a.x + (b.x - a.x) * k,
    z: a.z + (b.z - a.z) * k,
    heading,
  };
}

// Where two named streets meet: the closest their two lines come to each other.
function junction(one, two) {
  let best = null, gap = Infinity;
  for (const a of one.coords) {
    const p = toWorld(a[0], a[1]);
    for (const b of two.coords) {
      const q = toWorld(b[0], b[1]);
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      if (d < gap) { gap = d; best = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 }; }
    }
  }
  // Two streets that never come within a block of each other are not a junction
  // and the record is of something else.
  return gap <= 120 ? { ...best, heading: 0 } : null;
}

export function buildBlotter(scene, sample, roads) {
  const group = new THREE.Group();
  group.name = "blotter";
  group.visible = false;
  scene.add(group);

  const streets = index(roads);
  const post = new THREE.CylinderGeometry(0.06, 0.06, POST_M, 6);
  post.translate(0, POST_M / 2, 0);
  const head = new THREE.SphereGeometry(HEAD_M, 12, 8);
  head.translate(0, POST_M + HEAD_M * 0.7, 0);
  const shape = mergeSafe([post, head]);
  const stalk = new THREE.MeshStandardMaterial({
    color: 0x9fb4c4, roughness: 0.5, metalness: 0.2,
  });
  const lit = new THREE.MeshBasicMaterial({ color: 0x6fa8dc });

  let placed = [];
  const sphere = new THREE.Sphere(new THREE.Vector3(), POST_M);
  const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4();

  return {
    group,
    get shown() { return group.visible; },
    get count() { return placed.length; },
    setVisible(on) { group.visible = on; },

    // calls is what the proxy sends: newest first, each with a street.
    setCalls(calls) {
      for (const p of placed) p.marker.removeFromParent();
      placed = [];
      // How many have already gone on this street, so the next one stands
      // further along it instead of inside the last.
      const used = new Map();
      for (const call of calls) {
        const spot = locate(call, streets, used);
        if (!spot) continue;
        const marker = new THREE.Group();
        marker.add(new THREE.Mesh(shape, stalk));
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(HEAD_M * 0.55, 10, 8),
                                    lit);
        lamp.position.y = POST_M + HEAD_M * 0.7;
        marker.add(lamp);
        const ground = fromWorld(spot.x, spot.z);
        const y = sample(ground.lat, ground.lon);
        marker.position.set(spot.x, y, spot.z);
        marker.userData.call = call;
        group.add(marker);
        placed.push({ marker, call, spot: { ...spot, y }, lamp });
      }
      return placed.length;
    },

    // The call standing under this ray, or null.
    pick(raycaster) {
      if (!group.visible) return null;
      const hits = raycaster.intersectObjects(group.children, true);
      for (const hit of hits) {
        let o = hit.object;
        while (o && !o.userData.call) o = o.parent;
        if (o) {
          const found = placed.find(p => p.marker === o);
          if (found) return found;
        }
      }
      return null;
    },

    update(camera, t) {
      if (!group.visible) return;
      camera.updateMatrixWorld();
      matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(matrix);
      // The lamp breathes, so a marker reads as something to press rather than
      // as a post somebody left in the verge.
      const breath = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.6));
      for (const p of placed) {
        sphere.center.set(p.spot.x, p.spot.y + POST_M, p.spot.z);
        const range = camera.position.distanceTo(sphere.center);
        p.marker.visible = range <= SEEN_M && frustum.intersectsSphere(sphere);
        if (p.marker.visible) p.lamp.scale.setScalar(breath);
      }
    },

    dispose() {
      group.removeFromParent();
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      stalk.dispose();
      lit.dispose();
      group.clear();
    },
  };
}

// Where one call stands. A junction is where the two streets meet; a street on
// its own is spread down its length, a call at a time, so a road with six of
// them reads as six.
function locate(call, streets, used) {
  const raw = call.street;
  if (!raw) return null;
  const parts = String(raw).split("&").map(s => tidyStreet(s));
  const found = parts.map(p => streets.get(p));
  if (found.some(f => !f || !f.length)) return null;

  if (found.length >= 2) {
    const at = junction(found[0][0], found[1][0]);
    if (at) return offset(at, 0);
  }
  const road = found[0][0];
  const n = used.get(parts[0]) || 0;
  used.set(parts[0], n + 1);
  // Spread them down the road rather than all at the middle: 0.5, 0.3, 0.7, …
  const spread = [0.5, 0.3, 0.7, 0.4, 0.6, 0.22, 0.78, 0.35, 0.65];
  return offset(alongRoad(road, spread[n % spread.length]), 0);
}

// Off the carriageway, on the side the road's own direction says is right.
function offset(spot) {
  return {
    x: spot.x + Math.cos(spot.heading) * VERGE_M,
    z: spot.z - Math.sin(spot.heading) * VERGE_M,
    heading: spot.heading,
  };
}

// mergeGeometries is an addon; this only ever merges two, and doing it by hand
// keeps the import list of this module to three.
function mergeSafe(geoms) {
  const merged = new THREE.BufferGeometry();
  const parts = geoms.map(g => g.toNonIndexed());
  const size = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(size * 3), nor = new Float32Array(size * 3);
  let at = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, at * 3);
    nor.set(g.attributes.normal.array, at * 3);
    at += g.attributes.position.count;
  }
  merged.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return merged;
}
