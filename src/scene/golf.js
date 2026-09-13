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
import { tint } from "./parts.js";
import { areaView } from "./area-view.js";
import { minutesInZone, minutesOf } from "./cast.js";
import { buildWalker } from "./vehicles.js";

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
      // The same figure as the rest of the peninsula, and the same walk. They
      // were three boxes standing still and sliding down the fairway.
      const walker = buildWalker(SHIRTS[p % SHIRTS.length]);
      const figure = new THREE.Group();
      figure.rotation.y = Math.PI;       // the models face -Z, headings point along travel
      figure.add(walker);
      const stand = new THREE.Group();
      stand.add(figure);
      stand.name = `golfer-${p}`;
      stand.userData.stride = walker.stride;
      // Placed every frame in draw(), each on their own ball.
      flight.add(stand);
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
      flight.visible = true;
      // The flight itself is only a bag to hold them; every player stands on
      // their own ball, so each one is placed in the world on its own.
      flight.position.set(0, 0, 0);
      flight.rotation.y = 0;
      flight.children.forEach((figure, p) => {
        figure.visible = p < group.players;
        if (!figure.visible) { figure.userData.was = null; return; }
        const spot = playing(through, p);
        const at = along(line, Math.min(Math.max(spot.along, 0), 1));
        // Off the centre line, square to the way the hole runs.
        const ox = Math.cos(at.heading) * spot.off, oz = -Math.sin(at.heading) * spot.off;
        const x = at.x + ox, z = at.z + oz;
        figure.position.set(x, ground(x, z), z);
        figure.rotation.y = at.heading;
        // The walk runs off ground covered, the same as the cast's. Standing
        // over a ball is standing still and looks like it.
        const was = figure.userData.was;
        const step = was ? Math.hypot(x - was.x, z - was.z) : 0;
        if (step < 8) figure.userData.walked = (figure.userData.walked || 0) + step;
        figure.userData.was = { x, z };
        if (figure.userData.stride) figure.userData.stride(figure.userData.walked || 0);
      });
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

// A shirt each, so a flight is four people rather than one drawn four times.
const SHIRTS = [0x3f5468, 0x8c5a3c, 0x4f7a55, 0x8a4f6d];


// How a hole is played, as a place to be at each moment of it.
//
// A group does not slide down the fairway at a constant crawl: they stand on the
// tee, walk to their ball, stand over it, walk again, and gather on the green.
// Each player keeps their own line down the hole and their own ball, so they
// spread out through the middle of it and come back together at the end.
//
// The tee time and the four players are the club's; this rhythm is not. It is a
// depiction of how the fifteen minutes are spent, and nothing in the sheet says
// where anybody is standing.
//
// Keyframes are (time through the hole, distance down it, metres off the line).
// Where two in a row hold the same place, the player is standing still over the
// ball.
const PLAY = [
  { t: 0.00, along: 0.02, off: 0 },
  { t: 0.09, along: 0.02, off: 0 },   // waiting on the tee
  { t: 0.26, along: 0.33, off: 1 },   // out to the first ball
  { t: 0.34, along: 0.33, off: 1 },   // standing over it
  { t: 0.50, along: 0.62, off: 1 },
  { t: 0.58, along: 0.62, off: 1 },
  { t: 0.72, along: 0.85, off: 1 },
  { t: 0.79, along: 0.85, off: 1 },
  { t: 0.88, along: 0.97, off: 0 },   // onto the green, together again
  { t: 1.00, along: 1.00, off: 0 },
];

// How far off the centre line each player's own ball lies, in metres, and how
// much further or shorter they hit it. Fixed per player rather than random, so
// the same group walks the same way every time it is looked at.
const PLAYER_LINE = [-13, 7, -5, 15];
const PLAYER_REACH = [0.04, -0.03, 0.06, -0.05];

// Where one player stands at this moment of their hole.
function playing(fraction, player) {
  const t = Math.min(Math.max(fraction, 0), 1);
  let i = 1;
  while (i < PLAY.length - 1 && PLAY[i].t < t) i++;
  const a = PLAY[i - 1], b = PLAY[i];
  const span = Math.max(b.t - a.t, 1e-6);
  let k = (t - a.t) / span;
  // Ease in and out of every walk, so they set off and pull up rather than
  // snapping from standing to walking.
  k = k * k * (3 - 2 * k);
  const reach = PLAYER_REACH[player % PLAYER_REACH.length];
  const lineOff = PLAYER_LINE[player % PLAYER_LINE.length];
  const alongA = a.along + (a.off ? reach : 0);
  const alongB = b.along + (b.off ? reach : 0);
  return {
    along: alongA + (alongB - alongA) * k,
    off: (a.off + (b.off - a.off) * k) * lineOff,
  };
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
