// Scene bootstrap. Camera on the West Bluff, eye ~20 m above sea level, looking
// due west. Wires the live feed to the ocean, terrain, sky, vessels, weather,
// and the HUD. Renders empty water honestly when the feed is down.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { EYE_HEIGHT_M } from "./config.js";
import { Feed } from "./feed.js";
import { Hud } from "./hud.js";
import { Ocean } from "./scene/ocean.js";
import { Sky } from "./scene/sky.js";
import { Vessels } from "./scene/vessels.js";
import { Weather } from "./scene/weather.js";
import { buildTerrain } from "./scene/terrain.js";

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // cap for Iris Xe
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  55, window.innerWidth / window.innerHeight, 1, 60000);
camera.position.set(0, EYE_HEIGHT_M, 0);

const controls = new OrbitControls(camera, canvas);
controls.target.set(-500, 0, 0); // look west, slightly down to the water
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.52; // don't drop below the sea surface
controls.minDistance = 20;
controls.maxDistance = 8000;

// Sun low in the west-southwest, the way you look. Direction points toward it.
function sunDirection(azDeg, elevDeg) {
  const az = azDeg * Math.PI / 180;
  const el = elevDeg * Math.PI / 180;
  const h = Math.cos(el);
  const east = Math.sin(az) * h;
  const north = Math.cos(az) * h;
  return new THREE.Vector3(east, Math.sin(el), -north).normalize();
}
const SUN = sunDirection(255, 20);

const sky = new Sky(scene);
sky.setSun(SUN, new THREE.Color(0xfff2d8));

const ambient = new THREE.AmbientLight(0xffffff, 0.3);
const hemi = new THREE.HemisphereLight(0xbcd3e6, 0x33404a, 0.5);
const sun = new THREE.DirectionalLight(0xfff2d8, 1.2);
sun.position.copy(SUN).multiplyScalar(15000);
scene.add(ambient, hemi, sun);

const ocean = new Ocean(scene);
const vessels = new Vessels(scene);
const weather = new Weather(scene, { sky, ocean, sun, hemi, ambient });

buildTerrain(scene).catch((err) => console.error("terrain failed to load:", err));

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

hud.setConnection(false, "connecting…");
feed.connect();

function tideLevel() {
  const t = feed.tide && feed.tide.data;
  return t && t.water_level_m != null ? t.water_level_m : 0; // MLLW datum baseline
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

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;

  resize(); // self-correct if the canvas came up 0×0 (e.g. loaded while hidden)

  const level = tideLevel();
  ocean.setLevel(level);
  ocean.update(t);
  vessels.update(feed, level, t);
  weather.update(dt, camera);

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener("resize", resize);
