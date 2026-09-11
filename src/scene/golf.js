// The golf course: its surfaces on the ground, and the holes named over them.
//
// None of this is traced. Every shape comes off OpenStreetMap, baked to
// assets/osm/golf.json by scripts/build_golf.py — eighteen greens, tees and
// pins, seventeen fairways, sixty-three bunkers and the cart paths. The names
// are the course's own.
//
// The overlay is off until it is asked for, the same as the courts and the
// campground. A par that OSM does not carry is left off the card rather than
// guessed: five holes have no par in the data and no hole has a length.

import * as THREE from "three";
import { GOLF } from "../config.js";
import { fromWorld, toWorld } from "../geo.js";
import { box, tint } from "./parts.js";
import { areaView } from "./area-view.js";
import { minutesInZone, minutesOf } from "./cast.js";

// What each kind is drawn in, how far it stands off the ground, and how finely
// it is broken up to follow the ground under it. A green is small and read
// close; a fairway is two hundred metres of grass and does not need the detail.
const SURFACE = {
  driving_range: { colour: 0x4c6f3c, lift: 0.04, step: 30 },
  fairway:       { colour: 0x54823f, lift: 0.06, step: 25 },
  tee:           { colour: 0x5d8f45, lift: 0.10, step: 8 },
  green:         { colour: 0x69a350, lift: 0.12, step: 6 },
  bunker:        { colour: 0xd9cca6, lift: 0.14, step: 6 },
  water_hazard:  { colour: 0x33566a, lift: 0.05, step: 12 },
};
// Cart paths come as lines rather than rings, so they are drawn as ribbons.
const PATH = { colour: 0x8e8b83, lift: 0.16, width: 2.4 };

// Eighteen tee times can be out at once at a ten-minute grid and a four and a
// half hour round; this is the most that will ever be drawn.
const MAX_FLIGHTS = 20;

// Where each of the four stands relative to the group: across the hole, then
// along it.
const SPREAD = [[-2.6, -6.5], [1.8, -2.2], [-1.4, 2.4], [2.9, 6.8]];

let coursePromise = null;
export function golfFeatures() {
  if (!coursePromise) coursePromise = fetch(GOLF).then((r) => {
    if (!r.ok) throw new Error(`${GOLF} returned ${r.status} ${r.statusText}`);
    return r.json();
  });
  return coursePromise;
}

export async function buildGolf(scene, sample) {
  const course = await golfFeatures();
  const group = new THREE.Group();
  group.name = "golf";
  const overlay = new THREE.Group();
  overlay.name = "golf-holes";
  overlay.visible = false;

  const ground = (x, z) => {
    const ll = fromWorld(x, z);
    return sample(ll.lat, ll.lon);
  };

  const parts = [];
  for (const feature of course.features) {
    const spec = SURFACE[feature.kind];
    if (spec) {
      const ring = feature.coords.map(([lat, lon]) => toWorld(lat, lon));
      const geometry = drape(ring, ground, spec.lift, spec.step,
        `${feature.kind} ${feature.id}`);
      if (geometry) parts.push(tint(geometry, spec.colour));
    } else if (feature.kind === "cartpath") {
      const line = feature.coords.map(([lat, lon]) => toWorld(lat, lon));
      const geometry = ribbon(line, ground, PATH.lift, PATH.width);
      if (geometry) parts.push(tint(geometry, PATH.colour));
    }
  }
  if (!parts.length) {
    throw new Error(
      `${GOLF} held ${course.features.length} features and none of them were a ` +
      `surface this knows how to draw; the bake's kinds have changed.`);
  }
  const surfaces = new THREE.Mesh(merge(parts),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
  surfaces.name = "golf-surfaces";
  group.add(surfaces);

  // A card at each pin: the number, the hole's name, and its par when the map
  // carries one.
  const holes = course.features.filter(f => f.kind === "hole" && f.ref);
  const pins = course.features.filter(f => f.kind === "pin");
  for (const hole of holes.sort((a, b) => a.ref - b.ref)) {
    const end = hole.coords[hole.coords.length - 1];
    const near = nearest(pins, end) || { coords: [end] };
    const [lat, lon] = near.coords[0];
    const at = toWorld(lat, lon);
    const card = makeCard(hole);
    card.position.set(at.x, ground(at.x, at.z) + 7.5, at.z);
    overlay.add(card);
  }
  group.add(overlay);

  // The groups out on the course, drawn on the hole the booking sheet puts them
  // on. Made once and shown as the count changes.
  const players = new THREE.Group();
  players.name = "golf-players";
  const lines = new Map(holes.map(h => [h.ref, h.coords.map(([lat, lon]) => {
    const w = toWorld(lat, lon);
    return { x: w.x, z: w.z, lat, lon };
  })]));
  const flights = [];
  for (let i = 0; i < MAX_FLIGHTS; i++) {
    const flight = new THREE.Group();
    flight.name = `golf-flight-${i}`;
    for (let p = 0; p < 4; p++) {
      const figure = new THREE.Mesh(figureGeometry(p),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
      // Strung out down the hole rather than bunched in a square. The flight is
      // turned to the hole's heading, so +z is the way they are walking: this
      // spreads them over about fourteen metres of it and a few either side,
      // which is what a fourball looks like from the next tee.
      figure.position.set(SPREAD[p][0], 0, SPREAD[p][1]);
      figure.name = `golfer-${p}`;
      flight.add(figure);
    }
    flight.visible = false;
    players.add(flight);
    flights.push(flight);
  }
  group.add(players);
  scene.add(group);

  // Where a group stands: along the centre line of the hole they are on, as far
  // down it as their pace has taken them. The line is the map's; the fraction is
  // fifteen minutes a hole.
  function draw(tee, watched) {
    const data = tee && tee.data;
    const groups = watched && data && !data.error ? (data.groups || []) : [];
    // The server says who teed off and when; how far round they are by now is
    // worked out here, every frame. Taking the server's own hole and fraction
    // moved a group once a minute, which is a step rather than a walk.
    const pace = (data && data.minutes_per_hole) || 15;
    const clock = minutesInZone(new Date());
    flights.forEach((flight, i) => {
      const group = groups[i];
      if (!group) { flight.visible = false; return; }
      let hole = group.hole, through = group.through;
      if (group.tee) {
        const out = clock - minutesOf(group.tee);
        if (out < 0 || out >= pace * 18) { flight.visible = false; return; }
        hole = Math.min(Math.floor(out / pace) + 1, 18);
        through = (out % pace) / pace;
      }
      const line = lines.get(hole);
      if (!line || line.length < 2) { flight.visible = false; return; }
      const at = along(line, Math.min(Math.max(through, 0), 1));
      flight.visible = true;
      flight.position.set(at.x, ground(at.x, at.z), at.z);
      flight.rotation.y = at.heading;
      flight.children.forEach((figure, p) => { figure.visible = p < group.players; });
    });
  }

  const bounds = new THREE.Box3();
  for (const line of lines.values()) for (const p of line) {
    bounds.expandByPoint(new THREE.Vector3(p.x, ground(p.x, p.z), p.z));
  }
  bounds.expandByScalar(60);
  const inView = areaView(bounds, { near: 700, far: 900, pixels: 90, keepPixels: 60 });

  return {
    group,
    holes: holes.length,
    // Whether the course is in front of whoever is looking and near enough to
    // make out. The flights are drawn only while it is.
    watched: false,
    get shown() { return overlay.visible; },
    toggle() { overlay.visible = !overlay.visible; return overlay.visible; },
    // The cards face whoever is looking, so they read from the bluff and from
    // straight above alike.
    update(camera, height, tee) {
      const view = inView(camera, height || 800);
      this.watched = view.enter || (this.watched && view.retain);
      draw(tee, this.watched);
      if (!overlay.visible) return;
      for (const card of overlay.children) card.quaternion.copy(camera.quaternion);
    },
    dispose() {
      group.removeFromParent();
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.map) o.material.map.dispose();
        if (o.material) o.material.dispose();
      });
      group.clear();
    },
  };
}

// Four figures to a flight, standing where their hole and their pace put them.
function figureGeometry(which) {
  const shirt = [0xb8c4cf, 0xc2b48a, 0x9fb0a2, 0xc0a0a8][which % 4];
  const parts = [box(0.40, 0.26, 0.90, 0, 0.76, 0, shirt),
                 box(0.34, 0.24, 0.72, 0, 0.04, 0, 0x3a3f47),
                 box(0.24, 0.22, 0.24, 0, 1.68, 0, 0xb08c72)];
  const total = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const position = new Float32Array(total * 3), color = new Float32Array(total * 3);
  let at = 0;
  for (const g of parts) {
    position.set(g.attributes.position.array, at * 3);
    color.set(g.attributes.color.array, at * 3);
    at += g.attributes.position.count;
    g.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(color, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// A fraction of the way down a hole's centre line, and the way it is facing.
function along(line, fraction) {
  let run = 0;
  const lengths = line.map((p, i) => {
    if (i > 0) run += Math.hypot(p.x - line[i - 1].x, p.z - line[i - 1].z);
    return run;
  });
  const want = run * fraction;
  let i = 1;
  while (i < lengths.length - 1 && lengths[i] < want) i++;
  const a = line[i - 1], b = line[i];
  const span = Math.max(lengths[i] - lengths[i - 1], 1e-6);
  const t = Math.min(Math.max((want - lengths[i - 1]) / span, 0), 1);
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    heading: Math.atan2(b.x - a.x, b.z - a.z),
  };
}

function makeCard(hole) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(12, 20, 26, 0.82)";
  round(ctx, 6, 6, 500, 180, 18);
  ctx.fill();
  ctx.strokeStyle = "rgba(150, 190, 220, 0.55)";
  ctx.lineWidth = 3;
  round(ctx, 6, 6, 500, 180, 18);
  ctx.stroke();
  ctx.fillStyle = "#e8eef2";
  ctx.textAlign = "left";
  ctx.font = "bold 96px Arial, Helvetica, sans-serif";
  ctx.fillText(String(hole.ref), 30, 132);
  ctx.font = "bold 46px Arial, Helvetica, sans-serif";
  ctx.fillText(hole.name || "", 150, 82);
  ctx.fillStyle = "#9fb6c4";
  ctx.font = "38px Arial, Helvetica, sans-serif";
  // No par in the map means no par on the card.
  ctx.fillText(hole.par ? `par ${hole.par}` : "par not mapped", 150, 140);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const card = new THREE.Mesh(new THREE.PlaneGeometry(11, 4.125),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false }));
  card.renderOrder = 3;
  card.name = `golf-hole-${hole.ref}`;
  return card;
}

function round(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function nearest(pins, [lat, lon]) {
  let best = null, bestGap = Infinity;
  for (const pin of pins) {
    const [plat, plon] = pin.coords[0];
    const gap = (plat - lat) ** 2 + (plon - lon) ** 2;
    if (gap < bestGap) { bestGap = gap; best = pin; }
  }
  return best;
}

// A closed ring laid on the ground, broken up until no edge is longer than step
// so it follows what is under it instead of cutting through it.
function drape(ring, ground, lift, step, label) {
  const flat = ring.map(p => new THREE.Vector2(p.x, p.z));
  if (flat.length < 3) {
    console.error(`golf: ${label} has ${flat.length} corners and cannot be a surface`);
    return null;
  }
  const pos = [];
  const push = (p) => pos.push(p.x, ground(p.x, p.z) + lift, p.z);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
  const far = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  // Depth is capped as well as edge length. A long thin triangle off the
  // triangulator halves on its longest edge every time and would otherwise go
  // on splitting long after the ground under it has stopped changing.
  function tri(a, b, c, depth = 0) {
    if (depth < 4 && Math.max(far(a, b), far(b, c), far(c, a)) > step) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      tri(a, ab, ca, depth + 1); tri(ab, b, bc, depth + 1);
      tri(ca, bc, c, depth + 1); tri(ab, bc, ca, depth + 1);
      return;
    }
    push(a); push(b); push(c);
  }
  let faces;
  try {
    faces = THREE.ShapeUtils.triangulateShape(flat, []);
  } catch (error) {
    // A ring that will not triangulate is a fault in the bake, not something to
    // pass over in silence: it is one hole's worth of missing grass.
    console.error(`golf: ${label} could not be triangulated`, error);
    return null;
  }
  for (const face of faces) tri(...face.map(i => ring[i]));
  if (!pos.length) {
    console.error(`golf: ${label} triangulated to nothing`);
    return null;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// A line laid on the ground with a width, for the cart paths.
function ribbon(line, ground, lift, width) {
  const pos = [];
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const run = Math.hypot(b.x - a.x, b.z - a.z);
    if (run < 0.01) continue;
    const nx = -(b.z - a.z) / run * width / 2, nz = (b.x - a.x) / run * width / 2;
    const steps = Math.max(1, Math.ceil(run / 8));
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps, t1 = (s + 1) / steps;
      const p0 = { x: a.x + (b.x - a.x) * t0, z: a.z + (b.z - a.z) * t0 };
      const p1 = { x: a.x + (b.x - a.x) * t1, z: a.z + (b.z - a.z) * t1 };
      const corners = [
        { x: p0.x + nx, z: p0.z + nz }, { x: p0.x - nx, z: p0.z - nz },
        { x: p1.x - nx, z: p1.z - nz }, { x: p1.x + nx, z: p1.z + nz },
      ];
      for (const [i0, i1, i2] of [[0, 1, 2], [0, 2, 3]]) {
        for (const c of [corners[i0], corners[i1], corners[i2]]) {
          pos.push(c.x, ground(c.x, c.z) + lift, c.z);
        }
      }
    }
  }
  if (!pos.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function merge(list) {
  const total = list.reduce((n, g) => n + g.attributes.position.count, 0);
  const position = new Float32Array(total * 3), color = new Float32Array(total * 3);
  let at = 0;
  for (const g of list) {
    position.set(g.attributes.position.array, at * 3);
    color.set(g.attributes.color.array, at * 3);
    at += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(position, 3));
  out.setAttribute("color", new THREE.BufferAttribute(color, 3));
  out.computeVertexNormals();
  return out;
}
