// Scene bootstrap. Camera on the West Bluff, eye ~20 m above sea level, looking
// due west. Wires the live feed to the ocean, terrain, sky, vessels, weather,
// and the HUD. Renders empty water honestly when the feed is down.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { EYE_HEIGHT_M, ORIGIN, TERRAIN } from "./config.js";
import { Feed } from "./feed.js";
import { Hud } from "./hud.js";
import { Ocean } from "./scene/ocean.js";
import { Sky } from "./scene/sky.js";
import { Vessels } from "./scene/vessels.js";
import { Weather } from "./scene/weather.js";
import { buildTerrain } from "./scene/terrain.js";
import { buildLand } from "./scene/land.js";
import { Nav } from "./nav.js";
import { toWorld, fromWorld } from "./geo.js";

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // cap for Iris Xe
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

// Narrower than a phone's wide lens, closer to how the eye frames the vista, so
// the islands and mountains across the strait read at the height they feel.
const camera = new THREE.PerspectiveCamera(
  40, window.innerWidth / window.innerHeight, 1, 150000);
camera.position.set(0, EYE_HEIGHT_M, 0);

const controls = new OrbitControls(camera, canvas);
controls.target.set(-500, 0, 0); // look west, slightly down to the water
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.52; // don't drop below the sea surface
controls.minDistance = 20;
controls.maxDistance = 8000;

// World direction pointing toward the sun, from a compass azimuth (0=N, cw) and
// elevation. World axes: +X east, +Y up, +Z south.
function sunDirection(azDeg, elevDeg) {
  const az = azDeg * Math.PI / 180;
  const el = elevDeg * Math.PI / 180;
  const h = Math.cos(el);
  const east = Math.sin(az) * h;
  const north = Math.cos(az) * h;
  return new THREE.Vector3(east, Math.sin(el), -north).normalize();
}

// Solar azimuth and elevation for a time and place (NOAA low-precision method,
// good to ~0.1°). Longitude east-positive. Returns degrees.
function solarPosition(date, latDeg, lonDeg) {
  const rad = Math.PI / 180;
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0; // days since J2000
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = (357.528 + 0.9856003 * n) % 360;
  const lambda = (L + 1.915 * Math.sin(g * rad) + 0.020 * Math.sin(2 * g * rad)) % 360;
  const eps = 23.439 - 0.0000004 * n;
  const alpha = Math.atan2(Math.cos(eps * rad) * Math.sin(lambda * rad), Math.cos(lambda * rad)) / rad;
  const delta = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad)) / rad;
  const gmst = (280.46061837 + 360.98564736629 * n) % 360;
  let H = (gmst + lonDeg - alpha) % 360;
  if (H < -180) H += 360;
  if (H > 180) H -= 360;
  const latR = latDeg * rad, dR = delta * rad, HR = H * rad;
  const elev = Math.asin(Math.sin(latR) * Math.sin(dR) +
    Math.cos(latR) * Math.cos(dR) * Math.cos(HR)) / rad;
  let az = Math.atan2(-Math.sin(HR),
    Math.tan(dR) * Math.cos(latR) - Math.sin(latR) * Math.cos(HR)) / rad;
  az = (az + 360) % 360;
  return { azimuth: az, elevation: elev };
}

const sky = new Sky(scene);
const ambient = new THREE.AmbientLight(0xffffff, 0.3);
const hemi = new THREE.HemisphereLight(0xbcd3e6, 0x33404a, 0.5);
const sun = new THREE.DirectionalLight(0xfff2d8, 1.2);
scene.add(ambient, hemi, sun);

const ocean = new Ocean(scene);
const vessels = new Vessels(scene);
const weather = new Weather(scene, { sky, ocean, sun, hemi, ambient });

// Near tile: fine, fogged, tide-driven foreground. Once it loads, drape the
// Point Roberts land reference on it. Far tile: the Gulf Islands skyline.
let landmarkPicks = [];
let groundSample = null; // (lat,lon) -> terrain height, for walk mode and presets
buildTerrain(scene, TERRAIN.near, { haze: 0, fog: true })
  .then((near) => {
    groundSample = near.sample;
    return buildLand(scene, near.sample).then((land) => { landmarkPicks = land.landmarks; });
  })
  .catch((err) => console.error("near terrain / land failed:", err));
buildTerrain(scene, TERRAIN.far, { hazeGrade: [10000, 80000, 0.15, 0.72], fog: false, yOffset: -0.5 })
  .catch((err) => console.error("far terrain failed:", err));

const hud = new Hud();
const feed = new Feed();

feed.onChange((kind) => {
  if (kind === "close") {
    // Feed down: blank the world rather than show last-known as if it were live.
    feed.vessels.clear();
    feed.weather = null;
    feed.tide = null;
    feed.providerHealth = { weather: "offline", tide: "offline", vessels: "offline", aircraft: "offline" };
  }
  hud.setConnection(feed.connected, feed.connected ? null : "reconnecting…");
  hud.update(feed);
  if (feed.weather) weather.apply(feed.weather.data);
});

// Place the sun where it really is for the current time, and re-place it each
// minute so the light and sky track the day. Looking west, the morning sun sits
// behind the camera; only near sunset does it light the water ahead.
function updateSun() {
  const { azimuth, elevation } = solarPosition(new Date(), ORIGIN.lat, ORIGIN.lon);
  sky.setSun(sunDirection(azimuth, elevation), new THREE.Color(0xfff2d8));
  sun.position.copy(sunDirection(azimuth, elevation)).multiplyScalar(15000);
  weather.dayFactor = Math.max(0, Math.min((elevation + 6) / 12, 1));
  weather.apply(feed.weather ? feed.weather.data : {});
}
updateSun();
setInterval(updateSun, 60000);

hud.setConnection(false, "connecting…");
feed.connect();

function tideLevel() {
  const t = feed.tide && feed.tide.data;
  return t && t.water_level_m != null ? t.water_level_m : 0; // MLLW datum baseline
}

// Hover picking: the vessel under the cursor shows a tooltip with its AIS data.
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const tip = document.getElementById("vessel-tip");
let pointerInside = false, cursorX = 0, cursorY = 0;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

renderer.domElement.addEventListener("pointermove", (e) => {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  cursorX = e.clientX; cursorY = e.clientY;
  pointerInside = true;
});
renderer.domElement.addEventListener("pointerleave", () => {
  pointerInside = false;
  tip.classList.add("hidden");
});

function updateHover() {
  if (!pointerInside) return;
  raycaster.setFromCamera(pointer, camera);
  const targets = vessels.pickList().concat(landmarkPicks);
  const hits = raycaster.intersectObjects(targets, true);
  let o = hits.length ? hits[0].object : null;
  while (o && !o.userData.vessel && !o.userData.landmark) o = o.parent;
  if (!o) { tip.classList.add("hidden"); return; }
  let rows, stale = false;
  if (o.userData.vessel) {
    rows = Vessels.describe(o.userData.vessel);
    stale = o.userData.stale;
  } else {
    rows = [["place", o.userData.landmark.name], ["type", o.userData.landmark.kind]];
  }
  const html = rows
    .map(([k, v]) => `<div class="tip-row"><span class="tip-k">${esc(k)}</span><span class="tip-v">${esc(v)}</span></div>`)
    .join("");
  tip.innerHTML = html + (stale ? `<div class="tip-stale">stale</div>` : "");
  tip.style.left = (cursorX + 14) + "px";
  tip.style.top = (cursorY + 14) + "px";
  tip.classList.remove("hidden");
}

let lastW = 0, lastH = 0;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (w === 0 || h === 0 || (w === lastW && h === lastH)) return;
  lastW = w; lastH = h;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

// Navigation: preset viewpoints (tween) and a first-person walk mode.
const PRESETS = [
  { name: "Bluff", lat: 48.989009, lon: -123.085318, eye: 20, lookLat: 48.989, lookLon: -123.20 },
  { name: "Lighthouse", lat: 48.9728, lon: -123.0821, eye: 7, lookLat: 48.962, lookLon: -123.11 },
  { name: "Marina", lat: 48.9773, lon: -123.0633, eye: 9, lookLat: 48.981, lookLon: -123.045 },
  { name: "Above town", lat: 48.986, lon: -123.073, eye: 750, lookLat: 48.9861, lookLon: -123.0731 },
  { name: "Shipping lane", lat: 48.992, lon: -123.135, eye: 35, lookLat: 48.99, lookLon: -123.36 },
];
function groundY(lat, lon) {
  return groundSample ? Math.max(groundSample(lat, lon), 0) : 0;
}
function toView(p) {
  const pos = toWorld(p.lat, p.lon, groundY(p.lat, p.lon) + p.eye);
  const t = toWorld(p.lookLat, p.lookLon, groundY(p.lookLat, p.lookLon));
  return { position: new THREE.Vector3(pos.x, pos.y, pos.z), target: new THREE.Vector3(t.x, t.y, t.z) };
}

const nav = new Nav(camera, renderer.domElement, controls, {
  groundAt: (x, z) => { if (!groundSample) return null; const g = fromWorld(x, z); return groundSample(g.lat, g.lon); },
  seaLevel: () => tideLevel(),
  onMode: (m) => document.getElementById("walk-hint").classList.toggle("hidden", m !== "walk"),
});
nav.onPreset = (i) => { if (PRESETS[i]) nav.goTo(toView(PRESETS[i])); };

const viewBtns = document.getElementById("view-btns");
PRESETS.forEach((p, i) => {
  const b = document.createElement("button");
  b.className = "view-btn";
  b.textContent = `${i + 1}  ${p.name}`;
  b.addEventListener("click", () => nav.goTo(toView(p)));
  viewBtns.appendChild(b);
});
document.getElementById("walk-btn").addEventListener("click", () => nav.toggleWalk());

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;

  resize(); // self-correct if the canvas came up 0×0 (e.g. loaded while hidden)

  const level = tideLevel();
  ocean.setLevel(level);
  ocean.update(t);
  vessels.update(feed, level, t, camera);
  updateHover();
  weather.update(dt, camera);

  nav.update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener("resize", resize);
