// Scene bootstrap. Camera on the West Bluff, eye ~20 m above sea level, looking
// due west. Wires the live feed to the ocean, terrain, sky, vessels, weather,
// and the HUD. Renders empty water honestly when the feed is down.

import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";

import { EYE_HEIGHT_M, LANDCOVER, ORIGIN, SITE_BOULDERS, SITE_TREES, TERRAIN } from "./config.js";
import { Feed } from "./feed.js";
import { Hud } from "./hud.js";
import { Ocean } from "./scene/ocean.js";
import { Sky } from "./scene/sky.js";
import { Vessels } from "./scene/vessels.js";
import { Aircraft } from "./scene/aircraft.js";
import { Weather } from "./scene/weather.js";
import { buildTerrain, buildScreen } from "./scene/terrain.js";
import { buildLand, osmFeatures } from "./scene/land.js";
import { buildBeach } from "./scene/beach.js";
import { buildTrees } from "./scene/trees.js";
import { buildBrademy, isBreakers } from "./scene/brademy.js";
import { buildCabin } from "./scene/cabin.js";
import { buildLighthouse } from "./scene/lighthouse.js";
import { buildDrift } from "./scene/drift.js";
import { buildOrcas } from "./scene/orcas.js";
import { buildBoat } from "./scene/boat.js";
import { VEHICLES, vehicleById, BOAT_START } from "./scene/vehicles.js";
import { Nav } from "./nav.js";
import { Live } from "./live.js";
import { Touch } from "./touch.js";
import { OrbitStick } from "./orbit-stick.js";
import { Share, readViewHash } from "./share.js";
import { Audio } from "./audio.js";
import { OverviewMap } from "./map.js";
import { fromWorld, toWorld } from "./geo.js";
import { numberAt, offsetHours, sceneNow, setOffsetHours, shifted, slotAt } from "./clock.js";

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // cap for Iris Xe
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

// Narrower than a phone's wide lens, closer to how the eye frames the vista, so
// the islands and mountains across the strait read at the height they feel.
// Live mode takes the phone's lens instead — see applyFov.
const LOOK_FOV_DEG = 25;
const camera = new THREE.PerspectiveCamera(
  LOOK_FOV_DEG, window.innerWidth / window.innerHeight, 1, 150000);
camera.position.set(0, EYE_HEIGHT_M, 0);

// Google Maps' 3D bindings, which is what people already have in their hands:
// drag to pull the ground about, ctrl-drag or right-drag to swing round and tilt,
// wheel to zoom at whatever the pointer is over. On a touch screen, one finger
// drags and two pinch and twist. MapControls is OrbitControls with those bindings
// and with panning held parallel to the ground instead of to the screen.
//
// This is a requirement, not a preference. See REQUIREMENTS.md.
const controls = new MapControls(camera, canvas);
controls.target.set(-500, 0, 0); // look west, slightly down to the water
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.52; // don't drop below the sea surface
// Google puts no floor under how close you may come, and a floor of 20 m is a
// floor on looking at a 7 m building: it stopped the camera two storeys off the
// cabin and would not go in. What is left is the near plane, which is 1 m: any
// closer and the thing you came to look at is clipped away.
controls.minDistance = 1;
controls.maxDistance = 8000;
// Zoom toward what is under the pointer rather than toward the middle of the
// screen. This is the half of the Google feel that is not in the bindings.
controls.zoomToCursor = true;

// Google swings about the ground in the middle of the screen. OrbitControls
// swings about controls.target, and the target is wherever it was last left —
// on opening it is 500 m out on the water, so a ctrl-drag threw the whole world
// past instead of turning around what you were looking at.
//
// The fix is to put the target on the ground straight ahead before a swing
// starts. That point is on the view axis already, so moving the target there
// changes the distance and not the direction: nothing jumps, and the swing then
// pivots about what is in front of you.
const PIVOT_MAX_M = 8000;      // give up past this and leave the target alone
const PIVOT_STEP_M = 2;        // first crossing to within this, then bisect

function groundUnderCentre() {
  if (!groundSample) return null;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const at = (t) => {
    const p = camera.position.clone().addScaledVector(dir, t);
    const { lat, lon } = fromWorld(p.x, p.z);
    const g = groundSample(lat, lon);
    return { p, above: p.y - (g == null ? 0 : g) };
  };
  if (at(0).above <= 0) return null;              // already underground
  let lo = 0;
  let hi = 0;
  for (let t = PIVOT_STEP_M; t <= PIVOT_MAX_M; t *= 1.35) {
    if (at(t).above <= 0) { hi = t; break; }
    lo = t;
  }
  if (!hi) return null;                            // looking at the sky
  for (let i = 0; i < 24 && hi - lo > 0.05; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid).above <= 0) hi = mid; else lo = mid;
  }
  return at((lo + hi) / 2).p;
}

function pivotOnCentre() {
  if (!controls.enabled || nav.mode !== "orbit") return;
  const hit = groundUnderCentre();
  if (hit) controls.target.copy(hit);
}

// On every press, not only the ones that swing: a two finger twist has no
// modifier to test, and a drag over ground that is 20 m under the old target
// pans at the wrong speed for the same reason.
canvas.addEventListener("pointerdown", pivotOnCentre);

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
const aircraft = new Aircraft(scene);
const boat = buildBoat();
scene.add(boat);
// One avatar per way of getting about. They are world objects, not first-person
// props, so another player can see which one you are.
const avatars = new Map();
for (const spec of VEHICLES) {
  const a = spec.build();
  a.visible = false;
  scene.add(a);
  avatars.set(spec.id, a);
}
const weather = new Weather(scene, { sky, ocean, sun, hemi, ambient });

// Navigating on foot is guesswork without one — every road looks alike from
// 1.6 m up.
const overview = new OverviewMap(document.getElementById("overview"));

// Near tile: fine, fogged, tide-driven foreground. Once it loads, drape the
// Point Roberts land reference on it. Far tile: the Gulf Islands skyline.
let landmarkPicks = [];
let groundSample = null; // (lat,lon) -> terrain height, for preset viewpoints
let pilingPosts = [];    // the wharf's posts, as things the boat cannot pass through
let trees = null;        // swaps each tree between near and far detail as you move
// The two tiles a camera frame can land on. The lot is a hole cut in the near
// one, so anything looking over the house lands on the lot and nothing else.
let ground = null;
let lot = null;
let skylineTile = null;   // the Gulf Islands, so the far half of a frame lands too
let brademy = null;      // the proposed courts. Off until asked for.
let breakers = null;     // the old Breakers block, on its own so it can stand down
let drift = null;        // kelp, sticks and foam, so the current can be seen
let orcas = null;        // a group passing, at the rate the season says
let lighthouse = null;   // the light on the point, and its flash
// Where the fine tile really has ground, which is not its box: it is a rectangle
// in Washington South and the corners of a lat/lon box round it hold no lidar.
// Asked one coarse cell out on all sides as well, so the coarse tile keeps
// reaching under the fine one's edge rather than pulling back and leaving a gap.
function fineCovers(fine) {
  const g = fine.meta.grid;
  const nodata = fine.meta.nodata;
  const out = g.cellsize_deg * 4; // about one coarse cell
  const has = (lat, lon) => {
    const i = Math.round((g.north_lat - lat) / g.cellsize_deg);
    const j = Math.round((lon - g.west_lon) / g.cellsize_deg);
    if (i < 0 || j < 0 || i >= g.nrows || j >= g.ncols) return false;
    return fine.heights[i * g.ncols + j] > nodata / 2;
  };
  return (lat, lon) =>
    has(lat, lon) && has(lat + out, lon) && has(lat - out, lon)
    && has(lat, lon + out) && has(lat, lon - out);
}

// The lot itself, off airborne lidar at about a metre. It is built before the
// coarse tile because the coarse tile is holed under wherever this one reaches,
// and only this one knows where that is: its edge is a rectangle in Washington
// South, which is turned against latitude and longitude.
//
// The trees need the roads to keep out of them, so the OSM bake is waited on
// here rather than left to buildLand further down. It is the same one fetch.
buildTerrain(scene, TERRAIN.fine,
             { haze: 0, fog: true, landcover: LANDCOVER, projector: true })
  .then((fine) => {
    const covers = fineCovers(fine);
    return Promise.all([
      fine,
      covers,
      buildTerrain(scene, TERRAIN.near,
        { haze: 0, fog: true, landcover: LANDCOVER, hole: covers, projector: true }),
      osmFeatures(),
      fetch(SITE_TREES).then((r) => r.json()),
      fetch(SITE_BOULDERS).then((r) => r.json()),
    ]);
  })
  .then(([fine, covers, near, osm, siteTrees, siteBoulders]) => {
    // Everything standing on the ground asks one sampler, and it answers off the
    // lidar where the lidar reaches. Otherwise the cabin would sit on CUDEM while
    // the ground under it was drawn from something else.
    const coarseSample = near.sample;
    near.sample = (lat, lon) =>
      covers(lat, lon) ? fine.sample(lat, lon) : coarseSample(lat, lon);
    groundSample = near.sample;
    ground = near;
    lot = fine;
    const { nrows, ncols, cellsize_deg, north_lat, west_lon } = near.meta.grid;
    const nw = toWorld(north_lat, west_lon);
    const se = toWorld(north_lat - (nrows - 1) * cellsize_deg, west_lon + (ncols - 1) * cellsize_deg);
    ocean.setBed(near.heights, ncols, nrows,
      new THREE.Vector2(nw.x, nw.z), new THREE.Vector2(se.x - nw.x, se.z - nw.z));
    buildBeach(scene, near.sample, ORIGIN, siteBoulders);
    trees = buildTrees(scene, near.sample, near.cover, osm.roads, siteTrees);
    trees.update(camera);
    brademy = buildBrademy(scene, near.sample);
    // The Breakers block is drawn on its own so the clubhouse can stand in for it
    // while the courts are up.
    // The cabin is modelled off photographs rather than extruded from its OSM
    // trace, so land.js leaves the home alone and cabin.js puts it there.
    buildCabin(scene, near.sample);
    lighthouse = buildLighthouse(scene, near.sample);
    // What the water is carrying. Uses the same seaAt the boat floats on, so it
    // rides the same swell and knows the same shoreline.
    drift = buildDrift(scene, { seaAt: nav.seaAt });
    return buildLand(scene, near.sample, {
      isolate: (b) => isBreakers(b.coords),
      skipHome: true,
    }).then((land) => {
      landmarkPicks = land.landmarks;
      pilingPosts = land.pilings;
      breakers = land.isolated;
      overview.build(land.features);
      // The whales run the west shore, so they need the coastline, which only
      // exists once the land has been built. They ride the same surface the boat
      // floats on, and the same sampler is what tells them which side is the sea.
      //
      // And they need a tide. Which side of the coastline is water is decided by
      // depth, and with no tide reading the sea sits at chart datum, where the
      // flats west of the peninsula are dry ground: at 0 m not one of the 131
      // coastline points can tell its two sides apart, and at 1 m ninety can. So
      // this waits for the first reading rather than racing it.
      whenTide(() => {
        orcas = buildOrcas(scene, {
          seaAt: nav.seaAt,
          coastline: land.features.coastline,
        });
      }, "the whales");
      // What a shared link asked for, now that there is something to switch on.
      // Set directly rather than through the toggles: toggleBrademy re-aims the
      // camera, which would throw away the view the link carried.
      if (shared && shared.brademy) {
        brademy.setVisible(true);
        if (breakers) breakers.visible = false;
      }
      if (shared && shared.map) overview.toggle();
    });
  })
  .catch((err) => failed("the ground under the view", err));
// No gravel on the far tile: its nearest ground is ten kilometres off.
buildTerrain(scene, TERRAIN.far,
  { hazeGrade: [12000, 70000, 0.06, 0.85], fog: false, yOffset: -0.5, gravel: false,
    projector: true })
  .then((far) => { skylineTile = far; })
  .catch((err) => failed("the skyline across the strait", err));

// A feed that goes down says so on screen and the terrain did not, and the
// terrain is most of what is out there. Losing it quietly left a page that
// looked like it had loaded and had no beach, no land and no bottom to the sea.
// Run something once there is a water level to run it against. If the tide is
// already in, that is now.
//
// Whatever is waiting here is a thing on the scene, not the scene. It gets its
// own catch so a piece that will not start leaves the rest of the page alone.
const waitingOnTide = [];
function runWaiting(fn, what) {
  try {
    fn();
  } catch (err) {
    console.error(`${what} did not start, and is left off:`, err);
    return false;
  }
  return true;
}
function whenTide(fn, what) {
  if (feed.tide) runWaiting(fn, what);
  else waitingOnTide.push({ fn, what });
}

function failed(what, err) {
  console.error(`${what} failed to load:`, err);
  const banner = document.getElementById("terrain-fail");
  const said = document.getElementById("terrain-fail-sub");
  // Both tiles can fail, and the second must not erase the first.
  said.textContent = said.textContent
    ? `${said.textContent}; ${what}` : `${what} did not load`;
  banner.classList.remove("hidden");
}

const hud = new Hud();
const feed = new Feed();

feed.onChange((kind) => {
  if (kind === "close") {
    // Feed down: blank the world rather than show last-known as if it were live.
    feed.vessels.clear();
    feed.aircraft.clear();
    feed.weather = null;
    feed.tide = null;
    feed.providerHealth = { weather: "offline", tide: "offline", vessels: "offline", aircraft: "offline" };
  }
  hud.setConnection(feed.connected, feed.connected ? null : "reconnecting…");
  hud.update(feed, { tide: tideAt(), weather: weatherAt(), current: currentAt() });
  if (feed.weather) weather.apply(weatherAt());
  while (feed.tide && waitingOnTide.length) {
    const job = waitingOnTide.shift();
    runWaiting(job.fn, job.what);
  }
  document.getElementById("whales-btn").classList.toggle("off", !orcas);
});

// The slider that drives the scene clock. What reads that clock is in clock.js.
const clockRange = document.getElementById("clock-range");
const clockValue = document.getElementById("clock-value");

function setClockOffset(hours) {
  setOffsetHours(hours);
  clockRange.value = String(hours);
  const t = sceneNow();
  const shown = Math.round(hours * 4) / 4;   // #hour= lands on any offset at all
  clockValue.textContent = hours === 0
    ? "now"
    : `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`
      + ` (${shown > 0 ? "+" : ""}${shown} h)`;
  // Everything that reads the clock, re-read. The sun and the sky, the water the
  // shoreline runs at, the stream the drift rides, and the panels.
  updateSun();
  weather.apply(weatherAt() || {});
  hud.update(feed, { tide: tideAt(), weather: weatherAt(), current: currentAt() });
}

// #hour=14 opens at two in the afternoon. It is turned into an offset from now,
// so the slider and the link say the same thing and a share carries it.
function hourFromHash(hash) {
  const m = /(?:^#|&)hour=(-?\d+(?:\.\d+)?)/.exec(String(hash || ""));
  if (!m) return null;
  const want = Number(m[1]);
  if (!Number.isFinite(want) || want < 0 || want >= 24) return null;
  const now = new Date();
  // Not rounded to the slider's quarter hour: hour=14 should put the sun at two
  // o'clock, not six minutes short of it. The thumb snaps, the clock does not.
  return want - (now.getHours() + now.getMinutes() / 60);
}

clockRange.addEventListener("input", () => setClockOffset(Number(clockRange.value)));
document.getElementById("clock-now").addEventListener("click", () => setClockOffset(0));

// Place the sun where it really is for the scene's time, and re-place it each
// minute so the light and sky track the day. Looking west, the morning sun sits
// behind the camera; only near sunset does it light the water ahead.
function updateSun() {
  const { azimuth, elevation } = solarPosition(sceneNow(), ORIGIN.lat, ORIGIN.lon);
  sky.setSun(sunDirection(azimuth, elevation), new THREE.Color(0xfff2d8));
  sun.position.copy(sunDirection(azimuth, elevation)).multiplyScalar(15000);
  weather.dayFactor = Math.max(0, Math.min((elevation + 6) / 12, 1));
  weather.apply(weatherAt() || {});
}
setClockOffset(hourFromHash(location.hash) ?? 0);
setInterval(updateSun, 60000);

// The corner row says "connecting" from the first frame. The banner does not:
// see below.
hud.setConnection(false, "connecting…");

// A feed that is down matters and gets a banner. A feed that has simply not
// finished opening yet does not — that put a red box over the water on every
// load for the second or so the socket took, which is not a fault and should
// not look like one. Nothing is shown until it has been down this long.
const OFFLINE_GRACE_MS = 6000;
let downSince = performance.now();
feed.connect();

// What the feeds say at the hour the page is standing at.
//
// On the present hour that is the feed itself — a measurement. Moved off it, the
// reading comes out of the run the proxy baked, and it is a forecast. `predicted`
// says which, and the HUD says it out loud rather than passing a forecast off as
// a gauge reading.
function tideAt() {
  const t = feed.tide && feed.tide.data;
  if (!t || !shifted()) return t;
  const s = t.series;
  const m = numberAt(s, s && s.values, sceneNow());
  if (m == null) return t;
  // Astronomical only. The surge was measured minutes ago and it is weather.
  return { ...t, water_level_m: m, surge_m: null, trend: null, predicted: true };
}

function currentAt() {
  const c = feed.current && feed.current.data;
  if (!c || !shifted()) return c;
  const s = c.series;
  const row = slotAt(s, s && s.rows, sceneNow());
  if (!row) return c;
  const [drift, set, state] = row;
  return { ...c, drift_mps: drift, drift_kn: drift / 0.514444,
           set_degrees: set, state, predicted: true };
}

function weatherAt() {
  const w = feed.weather && feed.weather.data;
  if (!w || !shifted()) return w;
  const s = w.series;
  if (!s) return w;
  const when = sceneNow();
  const out = { ...w, predicted: true };
  for (const k of ["cloud_cover_percent", "wind_speed_mps", "wind_direction_degrees",
                   "temperature_c", "relative_humidity_percent", "visibility_m",
                   "precipitation_probability_percent"]) {
    const v = numberAt(s, s[k], when);
    if (v != null) out[k] = v;
  }
  const d = slotAt(s, s.description, when);
  if (d) out.description = d;
  return out;
}

// The sea at the hour a camera frame was taken, while that frame is up. NOAA
// gives the level at the timestamp on the picture: the Point Roberts prediction
// with the surge measured at Cherry Point carried onto it, the same sum the feed
// makes for now. Without this the ocean stands at today's tide over a beach the
// photograph shows dry, and the picture is under the water rather than missing.
let heldTide = null;

function tideLevel() {
  if (heldTide !== null) return heldTide;
  const t = tideAt();
  return t && t.water_level_m != null ? t.water_level_m : 0; // MLLW datum baseline
}

// Whichever is higher under a point, the sea floor or the tide.
function floorAt(x, z) {
  if (!groundSample) return tideLevel();
  const { lat, lon } = fromWorld(x, z);
  return Math.max(groundSample(lat, lon), tideLevel());
}

// Dragging means the point you put the cursor on stays under the cursor for the
// whole drag. OrbitControls cannot do that, and no setting on it can.
//
// Its pan moves the camera by 2 * targetDistance * tan(fov/2) / height per
// pixel, so the only ground that keeps up with your hand is the ground at
// exactly the orbit target's distance. Scaling that by the range to what you
// grabbed fixes a sideways drag exactly and leaves an up-and-down one wrong by
// up to 89 px in 200, because on a tilted camera the ground is foreshortened
// along one axis and not the other, and panSpeed is one number for both.
//
// So the plain left drag is taken over here and done properly: work out the
// point on the ground under the cursor when the button goes down, and then on
// every move slide the camera so that same point is under the cursor again. The
// height never changes, which is what keeps it feeling like a map and not like
// flying. Everything else — ctrl-drag, right-drag, the wheel, two fingers — is
// left to the controls untouched.
const RANGE_MAX_M = 60000;

// How far the thing under the pointer is, by marching the ray until it goes
// under the ground or the water. The steps grow, so near ground is found finely
// and the far strait cheaply. Null means the ray went to the sky.
function rangeUnderPointer() {
  raycaster.setFromCamera(pointer, camera);
  const o = raycaster.ray.origin, d = raycaster.ray.direction;
  let t = 2;
  for (let i = 0; i < 700 && t < RANGE_MAX_M; i++) {
    if (o.y + d.y * t <= floorAt(o.x + d.x * t, o.z + d.z * t)) return t;
    t *= 1.02;
  }
  return null;
}

const grab = { active: false, point: new THREE.Vector3(), id: -1 };
const grabRay = new THREE.Ray();
const grabHit = new THREE.Vector3();
const grabPlane = new THREE.Plane();
const grabDelta = new THREE.Vector3();
// A ray this close to level meets the ground plane far enough away that the
// answer is noise, so the drag holds still rather than throwing the camera.
const GRAZE = 0.02;

function setPointerFrom(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}

function grabStart(e) {
  // Not while a camera frame is being lined up. That drag moves the photograph,
  // and this one takes hold of the ground on the way down — in the capture phase
  // on the window — so if it answers first the photograph never hears the press.
  if (wyzeView) return false;
  if (nav.mode !== "orbit") return false;
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  setPointerFrom(e);
  const range = rangeUnderPointer();
  if (range == null) return false;        // sky: nothing to take hold of
  raycaster.setFromCamera(pointer, camera);
  grab.point.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, range);
  grab.active = true;
  grab.id = e.pointerId;
  return true;
}

function grabMove(e) {
  if (!grab.active || e.pointerId !== grab.id) return;
  setPointerFrom(e);
  raycaster.setFromCamera(pointer, camera);
  grabRay.copy(raycaster.ray);
  if (grabRay.direction.y > -GRAZE) return;   // pointing at or above the horizon
  // Where the cursor now falls on the level plane the grabbed point sits in.
  grabPlane.set(new THREE.Vector3(0, 1, 0), -grab.point.y);
  if (!grabRay.intersectPlane(grabPlane, grabHit)) return;
  // Slide camera and target together, so the orbit is unchanged and only the
  // ground moves. The height is untouched.
  grabDelta.subVectors(grab.point, grabHit);
  grabDelta.y = 0;
  camera.position.add(grabDelta);
  controls.target.add(grabDelta);
  controls.update();
}

function grabEnd(e) {
  if (e.pointerId !== grab.id) return;
  grab.active = false;
  grab.id = -1;
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
// Taking the plain drag off the controls has to happen before they see it, and
// they are listening on the canvas itself and got there first. A listener on the
// same element cannot cut in front of one already registered — at the target
// phase they run in the order they were added, capture flag or not. So this sits
// on the window in the capture phase, which runs on the way down, before the
// canvas is reached at all.
//
// A modified drag, a right drag or a second finger is none of its business and
// goes straight through to the controls.
window.addEventListener("pointerdown", (e) => {
  if (e.target !== renderer.domElement) return;
  pointerInside = true;
  if (e.pointerType === "touch" && grab.active) return;   // second finger: let go
  if (!grabStart(e)) return;
  e.stopImmediatePropagation();
  renderer.domElement.setPointerCapture(e.pointerId);
}, true);
// Move and release are watched on the window so a drag that leaves the canvas
// still tracks and still ends.
window.addEventListener("pointermove", grabMove, true);
window.addEventListener("pointerup", grabEnd, true);
window.addEventListener("pointercancel", grabEnd, true);

function showTip(rows, stale) {
  if (!rows) { tip.classList.add("hidden"); return; }
  const html = rows
    .map(([k, v]) => `<div class="tip-row"><span class="tip-k">${esc(k)}</span><span class="tip-v">${esc(v)}</span></div>`)
    .join("");
  tip.innerHTML = html + (stale ? `<div class="tip-stale">stale</div>` : "");
  tip.style.left = (cursorX + 14) + "px";
  tip.style.top = (cursorY + 14) + "px";
  tip.classList.remove("hidden");
}

// The sounding where the pointer meets the water, over the marina, where the
// bottom is drawn and the contours are already there to be counted. Two figures,
// because a boat wants both: what is under the keel now, and what the chart
// says, which is the same bottom at the datum the soundings are printed on.
// Null anywhere else.
function soundingUnderPointer() {
  if (!groundSample) return null;
  const t = rangeUnderPointer();
  if (t === null) return null;   // the ray went to the sky
  const o = raycaster.ray.origin, d = raycaster.ray.direction;
  const x = o.x + d.x * t, z = o.z + d.z * t;
  if (!ocean.inMarina(x, z)) return null;
  const { lat, lon } = fromWorld(x, z);
  const bed = groundSample(lat, lon);
  const depth = tideLevel() - bed;
  if (depth <= 0) return null;   // the ray stopped on the dry inside the box
  return [
    ["depth", `${depth.toFixed(1)} m`],
    ["MLLW", bed <= 0 ? `${(-bed).toFixed(1)} m` : `dries ${bed.toFixed(1)} m`],
  ];
}

function updateHover() {
  if (!pointerInside) return;
  raycaster.setFromCamera(pointer, camera);
  const targets = vessels.pickList().concat(aircraft.pickList(), landmarkPicks);
  const hits = raycaster.intersectObjects(targets, true);
  let o = hits.length ? hits[0].object : null;
  while (o && !o.userData.vessel && !o.userData.aircraft && !o.userData.landmark) o = o.parent;
  if (!o) { showTip(soundingUnderPointer()); return; }
  let rows, stale = false;
  if (o.userData.vessel) {
    rows = Vessels.describe(o.userData.vessel);
    stale = o.userData.stale;
  } else if (o.userData.aircraft) {
    rows = Aircraft.describe(o.userData.aircraft);
    stale = o.userData.stale;
  } else {
    rows = [["place", o.userData.landmark.name], ["type", o.userData.landmark.kind]];
  }
  showTip(rows, stale);
}

// The lens. Looking around, it is the narrow one set above. In live mode it is
// the phone's own: a main camera at 26 mm equivalent covers 69.4° across the long
// side of the frame, 2·atan(18/26). Portrait stands that long side up the screen
// and landscape lays it across, and the short side falls out of the aspect ratio,
// so what is on the glass is what the lens behind it would take.
const PHONE_LONG_FOV_DEG = 69.4;
function applyFov() {
  let fov = LOOK_FOV_DEG;
  if (wyzeView) fov = WYZE_FOV_DEG;
  if (nav.mode === "live") {
    const long = (PHONE_LONG_FOV_DEG * Math.PI) / 180;
    fov = camera.aspect >= 1
      ? (2 * Math.atan(Math.tan(long / 2) / camera.aspect) * 180) / Math.PI
      : PHONE_LONG_FOV_DEG;
  }
  if (camera.fov === fov) return;
  camera.fov = fov;
  camera.updateProjectionMatrix();
}

let lastW = 0, lastH = 0;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (w === 0 || h === 0 || (w === lastW && h === lastH)) return;
  lastW = w; lastH = h;
  camera.aspect = w / h;
  applyFov();   // turning the phone changes which side of the frame is the long one
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

// The stick and the drag that looks about. Only live while something is being
// driven; Nav switches it on and off with the mode.
const touch = new Touch(
  renderer.domElement,
  document.getElementById("stick"),
  document.getElementById("stick-knob"));

// The same stick, in the normal view, turning the camera instead of driving
// something. Two fingers rotate on a trackpad and they do not on a phone.
const orbitStick = new OrbitStick(
  camera, controls,
  document.getElementById("stick"),
  document.getElementById("stick-knob"),
  () => nav.mode === "orbit" && controls.enabled,
  pivotOnCentre);

// Navigation: a free-fly camera alongside whichever vehicle you are in.
const nav = new Nav(camera, renderer.domElement, controls, {
  touch,
  onMode: (m, spec) => {
    document.getElementById("fly-hint").classList.toggle("hidden", m !== "fly");
    const hint = document.getElementById("boat-hint");
    const show = m === "boat" || m === "vehicle" || m === "live";
    hint.classList.toggle("hidden", !show);
    if (m === "boat") hint.textContent = BOAT_HINT;
    else if (m === "vehicle" && spec) hint.textContent = vehicleHint(spec);
    else if (m === "live") hint.textContent = LIVE_HINT;
    // The location watch and the compass run only while their view is on screen.
    if (m !== "live") live.stop();
    trimPanel.classList.toggle("hidden", m !== "live");
    applyFov();
  },
  boatMesh: boat,
  hullHole: (h) => ocean.setHull(h),
  // Solid things in the water: the wharf's pilings and every tracked ship.
  obstacles: () => pilingPosts.concat(vessels.obstacles()),
  // The tidal stream, in world metres a second. One station eight kilometres
  // offshore stands for the whole tile, which is wrong near the land and is the
  // whole of issue #13. Null when there is no reading, never a guess.
  current: () => {
    const c = currentAt();
    if (!c || c.set_degrees == null || !c.drift_mps) return null;
    // A set is the compass bearing the water runs toward. North is -Z.
    const set = (c.set_degrees * Math.PI) / 180;
    return {
      x: Math.sin(set) * c.drift_mps,
      z: -Math.cos(set) * c.drift_mps,
      set: c.set_degrees,
      drift: c.drift_mps,
    };
  },
  // What the hull floats on: the swell where there is water under it, the
  // ground where there is not, so the boat can sit on the line between the two.
  //
  // This used to read the ground as zero until the terrain loaded, which stood
  // the boat on a flat imaginary bottom at chart datum and made the shoreline
  // mean nothing, and said not a word about it. The modes that need ground are
  // refused until there is ground, so getting here without it is a bug.
  seaAt: (x, z) => {
    if (!groundSample) {
      throw new Error(
        "seaAt: no terrain, so there is no seabed to float the boat on. Boat and " +
        "vehicle modes are meant to be refused until the near tile has loaded — " +
        "see needsGround in main.js.");
    }
    const s = ocean.surfaceAt(x, z);
    const { lat, lon } = fromWorld(x, z);
    const ground = groundSample(lat, lon);
    if (ground > s.y) return { y: ground, dx: 0, dz: 0, depth: 0, aground: true };
    return { y: s.y, dx: s.dx, dz: s.dz, depth: s.y - ground, aground: false };
  },
  // Whichever is higher under the camera, the sea floor or the tide. Off the
  // near tile the terrain sample clamps to a deep edge value, so out in the
  // strait this is just the water. Looking around and free flight both work
  // without terrain, so with none the water is the whole of the floor.
  floor: (x, z) => {
    if (!groundSample) return tideLevel();
    const { lat, lon } = fromWorld(x, z);
    return Math.max(groundSample(lat, lon), tideLevel());
  },
  // B launches the boat straight from the keyboard, so the guard has to live in
  // Nav as well as in the chooser.
  hasGround: () => groundSample != null,
});
document.getElementById("fly-btn").addEventListener("click", () => nav.toggleFly());
// How you are getting about has to be chosen before the world is yours to move
// in. The free camera stays: "look around" picks it instead of a vehicle, and
// fly still works once you are in.
const chooser = document.getElementById("chooser");
const chooserBtns = document.getElementById("chooser-btns");
const modeHint = document.getElementById("boat-hint");
const chooserNote = document.getElementById("chooser-note");

// The phone's location and compass. A sensor that stops answering takes the view
// with it: live mode ends and the reason goes on the chooser, rather than the
// screen sitting on the last reading looking live.
const live = new Live({
  onFail: (message) => {
    nav.toOrbit();
    chooserNote.textContent = message;
    chooser.classList.remove("hidden");
  },
});

// The hand correction on the bearing. Declination is taken off in live.js; what
// is left is the phone's own compass error, and that is set by eye against what
// is out the window.
const trimPanel = document.getElementById("trim");
const trimRange = document.getElementById("trim-range");
const trimValue = document.getElementById("trim-value");
function readTrim() {
  const deg = Number(trimRange.value);
  live.trim = (deg * Math.PI) / 180;
  trimValue.textContent = `${deg > 0 ? "+" : ""}${deg.toFixed(1)}°`;
}
trimRange.addEventListener("input", readTrim);
readTrim();

// Each mode says what it actually has. The boat's tiller is backwards on
// purpose; nothing else is.
// What each mode actually has. On a touch screen the keys are not there, so
// each says what the stick does instead.
const TOUCH = window.matchMedia("(pointer: coarse)").matches;
const LOOK_HINT = TOUCH ? "drag right side to look" : "drag to look";
const BOAT_HINT = TOUCH
  ? `stick: push to open the throttle, across for the tiller · ${LOOK_HINT} · M to change`
  : `W throttle · A/D tiller (A turns right) · ${LOOK_HINT} · M to change`;
// Nothing to drive in live mode: the phone is the control, and walking is the
// only way to move.
const LIVE_HINT = "hold the phone up and turn · slide aim until the view lines up · M to change";
function vehicleHint(spec) {
  const air = spec.medium === "air";
  if (TOUCH) {
    // The stick's fore-and-aft is the climb in the air and the throttle on the
    // ground, which is the one place it does not mean the same thing.
    const stick = air ? "stick: push to climb, pull to descend, across to turn"
                      : "stick: push to go, across to steer";
    return `${stick} · ${LOOK_HINT} · M to change`;
  }
  const parts = ["W go"];
  if (spec.reverse) parts.push("S back");
  parts.push("A/D steer");
  if (air) parts.push("Q/E down-up");
  parts.push(LOOK_HINT);
  parts.push("M to change");
  return parts.join(" · ");
}

// Back to where the app opens: the bluff at the house, eye above sea level,
// looking due west. toOrbit aims the target down the current view, so the
// position and the target are set after it, not before.
function toBluff() {
  leaveWyze();
  nav.toOrbit();
  camera.position.set(0, EYE_HEIGHT_M, 0);
  controls.target.set(-500, 0, 0);
  controls.update();
}

// Stand the scene camera where the Ocean View camera hangs, with its lens, so a
// frame off it and the render can be held against each other.
//
// The eye and the aim are a viewpoint set by hand in the app and read back out
// of the address bar, which is the same pair share.js writes: a position and a
// point three hundred metres down the line of sight. That works out at 14.2 m
// above MLLW, 112.8° from north and 14.1° below level.
//
// A Wyze Cam V3 covers 110° across the diagonal of a 16:9 frame, which is 70°
// up the short side. That is the vertical angle the render is given, so the
// horizon sits at the same height in both whatever the window is doing. It is a
// fisheye and the render is not, so the middle will agree before the edges do.
// Each one is a frame off the camera and the viewpoint it was taken from, set
// by hand in the app and read back out of the address bar — the same eye and
// aim pair share.js writes, a position and a point 300 m down the line of sight.
//
//   ocean view   14.2 m MLLW, 112.8° from north, 14.1° down, west over the beach
//   front door   12.9 m MLLW,  59.0° from north, level, east up the bank
//
// A Wyze Cam V3 covers 110° across the diagonal of a 16:9 frame. Half of that,
// 55°, is how far off the axis the corner of the picture sits, and it is the
// only number the projector needs: the lens is read as equidistant, angle off
// the axis carried straight to radius from the middle of the frame.
//
// The render itself still gets a plain 70° lens, which is what 110° on the
// diagonal comes to up the short side if the lens were straight. It is not, so
// the render's edges stretch where the photograph's do not. That does not stop
// the two being compared: the photograph is on the ground now, and the ground
// is where they meet.
const WYZE_FOV_DEG = 70;
// 60.26° to the corner, and 1.5986 across rather than the frame's own 16:9, so
// the camera does not work the same across as it does up: 102.2° across and
// 63.9° up. Both numbers came off a frame lined up by hand against the screen
// behind the islands, and the corner barely moved from the 61 an earlier fit on
// the skyline gave. Wyze publish 130° for this camera without saying how it is
// measured.
//
// Both cameras are the same V3 and share this one lens. It was fitted on the
// beach frame and the bank frame then lined up without it being touched, which
// is what says 1.5986 describes the glass rather than covering for an error on
// the ocean view side.
const WYZE_LENS = { corner: (60.26 * Math.PI) / 180, aspect: 1.5986 };
const WYZE_CAMS = [
  {
    // On the roof, a foot in from the south edge and five feet up the slope
    // from the east edge. Off cabin.js's gable the skin there is 12.78 m MLLW,
    // and the lens sits 0.15 m over it on the camera's own base — the roof here
    // is a surface with no thickness and the seams stand 3 cm off it, so a lens
    // laid on the skin looks at the underside of the roof.
    //
    // The bank east of the house climbs — the ground is up to the lens 4 m out
    // and 18° above it by 15 — so a camera on this roof looks up a hill.
    //
    // Lined up by hand against the frame below: 71.94° from north, 11.28° up.
    // Not level, which is what it was carried as, and not the 67.5 the arrow
    // arithmetic pointed at either. That went the wrong way. The arrows were
    // seven marks on a screenshot pairing a trunk in the photograph with the
    // same trunk in the render, and a trunk is painted where its ray meets the
    // dirt behind it, so they were never going to answer this. Fitting the
    // measured trees said 57 and was worse — those are crown apexes.
    //
    // The lens was not touched to get here. It was fitted on the beach camera
    // and it holds on this one, which is what says 1.5986 is the glass and not a
    // number covering for something else.
    name: "front door",
    eye: { lat: 48.989046, lon: -123.085735, y: 12.9 },
    aim: { lat: 48.989865, lon: -123.081906, y: 71.58 },
    shot: "assets/reference/front_door-20260812T203304Z.png",
    tide: -0.21,
    // Nothing in this frame is further off than the trees at the top of the
    // bank. Aimed 11° up it sends most of its rays over the crest, and past the
    // crest the ground falls away and they graze on until they meet the far side
    // of the strait — the stair and the shed painted across Vancouver Island.
    range: 100,
  },
  {
    // Off two things at once: the lidar boulder 30 m out and the islands 30 km
    // out. How far below level the boulder's foot sits depends on how high the
    // camera is; the islands do not care how high it is at all. So the near one
    // fixes the height and the far one fixes the pitch, and with the lens left
    // at what the maker claims both land exactly.
    //
    // That put the eye at 8.14 rather than the 14.2 it was carrying, which is
    // the lower floor and not six metres above it. The height was the wrong
    // number all along; the aim was only wrong because it was bending to fit it.
    //
    // The frame is 08:08:58 on the 13th, near the top of the tide: 1.82 m MLLW,
    // the Point Roberts prediction of 1.76 with the 0.06 measured at Cherry
    // Point carried onto it. The beach the earlier frame showed dry is under
    // water in this one, and the boulder that fixed the height is a cap above
    // the surface with its foot out of sight. Its waterline is still a line the
    // render can be held against, but the foot is not.
    name: "ocean view",
    //
    // Lined up by hand against the frame below, on the screen behind the
    // islands: 245.69° from north, 11.66° down.
    eye: { lat: 48.989022, lon: -123.085925, y: 8.14 },
    aim: { lat: 48.987935, lon: -123.089590, y: -52.49 },
    shot: "assets/reference/ocean_view-20260813T150858Z.png",
    tide: 1.82,
    // This one alone gets the screen behind the islands. It is the only frame
    // with anything in it past the terrain. The front door looks up a bank 20 m
    // off, so every ray above the bank top clears the ground and would land on
    // the sphere 120 km out — the stair and the trees painted the size of a
    // mountain range across the sky.
    screen: true,
  },
];
// How much of the photograph is laid over the ground. Not all of it: the render
// showing through is what you are comparing it against.
const WYZE_MIX = 0.75;
// Standing at a camera is one thing and the photograph being up is another.
// Flipping the photograph used to leave the camera as well, which put the lens
// back to the app's own 25° — so the flip was comparing a 70° photograph
// against a quarter of the view, and nothing could ever line up.
let wyzeView = false;    // standing at a camera, with its lens
let wyzePhoto = false;   // and the photograph thrown on the ground
let wyzeCam = 0;

// The lens the photograph was taken with, standing where it was taken. The
// terrain reads the ground back through this, so the frame lands where the
// camera was pointed instead of across the screen.
const wyzeLens = new THREE.PerspectiveCamera(WYZE_FOV_DEG, 16 / 9, 1, 4000);
// What the rays that clear the skyline land on. It shows nothing until a
// photograph is handed to it, so it costs nothing to have it standing there.
const wyzeScreen = buildScreen(scene);
const wyzeShots = new Map();

// Where the projector is pointed, in degrees, off the aim the camera carries.
const wyzeAim = { heading: 0, pitch: 0 };
const wyzeEye = new THREE.Vector3();

function readWyzeAim(cam) {
  const eye = toWorld(cam.eye.lat, cam.eye.lon, cam.eye.y);
  const aim = toWorld(cam.aim.lat, cam.aim.lon, cam.aim.y);
  const d = new THREE.Vector3(aim.x - eye.x, aim.y - eye.y, aim.z - eye.z).normalize();
  wyzeEye.set(eye.x, eye.y, eye.z);
  wyzeAim.heading = (Math.atan2(d.x, -d.z) * 180) / Math.PI;
  wyzeAim.pitch = (Math.asin(d.y) * 180) / Math.PI;
}

// Point the projector where wyzeAim says.
function applyWyzeAim() {
  const h = (wyzeAim.heading * Math.PI) / 180;
  const p = (wyzeAim.pitch * Math.PI) / 180;
  const far = 300;
  wyzeLens.position.copy(wyzeEye);
  wyzeLens.lookAt(wyzeEye.x + Math.sin(h) * Math.cos(p) * far,
                  wyzeEye.y + Math.sin(p) * far,
                  wyzeEye.z - Math.cos(h) * Math.cos(p) * far);
  wyzeLens.updateProjectionMatrix();
  const cam = WYZE_CAMS[wyzeCam];
  const shot = wyzeTexture(cam.shot);
  const mix = wyzePhoto ? WYZE_MIX : 0;
  // The glass is the same on both cameras. How far its picture is allowed to
  // reach is not: that is what is in the frame.
  const lens = { ...WYZE_LENS, range: cam.range || 0 };
  for (const tile of [ground, lot, skylineTile]) {
    if (tile) tile.project(shot, wyzeLens, mix, lens);
  }
  wyzeScreen.project(shot, wyzeLens, cam.screen ? mix : 0, lens);
}

function wyzeTexture(url) {
  if (!wyzeShots.has(url)) {
    const tex = new THREE.TextureLoader().load(url, () => { tex.needsUpdate = true; });
    tex.colorSpace = THREE.SRGBColorSpace;
    wyzeShots.set(url, tex);
  }
  return wyzeShots.get(url);
}

// C throws the camera's own photograph onto the ground from where it was taken,
// and stands you at the camera to start with. C again takes it off. You are not
// held there: walk away and the picture stays on the ground it was taken of,
// which is the whole of the test. N moves to the next camera.
function toWyzeCam() {
  const cam = WYZE_CAMS[wyzeCam];
  const eye = toWorld(cam.eye.lat, cam.eye.lon, cam.eye.y);
  const aim = toWorld(cam.aim.lat, cam.aim.lon, cam.aim.y);
  nav.toOrbit();
  camera.position.set(eye.x, eye.y, eye.z);
  controls.target.set(aim.x, aim.y, aim.z);
  controls.update();

  readWyzeAim(cam);
  wyzePhoto = true;
  applyWyzeAim();

  // The measured trees in the opening view are the only things out there with a
  // trunk the lidar put in a known place, so they are what the photograph has to
  // be lined up against.
  if (trees) trees.homeTrees(true);
  heldTide = cam.tide;
  wyzeView = true;
  applyFov();
}

// Whichever camera is looking most nearly the way you are. Facing the water it
// is the one on the lower wall, facing the bank it is the one on the roof.
function nearestWyzeCam() {
  const look = new THREE.Vector3();
  camera.getWorldDirection(look);
  let best = 0, most = -Infinity;
  for (let i = 0; i < WYZE_CAMS.length; i++) {
    const c = WYZE_CAMS[i];
    const eye = toWorld(c.eye.lat, c.eye.lon, c.eye.y);
    const aim = toWorld(c.aim.lat, c.aim.lon, c.aim.y);
    const dot = new THREE.Vector3(aim.x - eye.x, aim.y - eye.y, aim.z - eye.z)
      .normalize().dot(look);
    if (dot > most) { most = dot; best = i; }
  }
  return best;
}

// The photograph on and off. Where you are standing and what lens you are
// standing behind do not move: that is the whole of the comparison.
function flipWyze() {
  if (!ground) return;   // no terrain to throw it on yet
  if (!wyzeView) { wyzeCam = nearestWyzeCam(); toWyzeCam(); return; }
  wyzePhoto = !wyzePhoto;
  applyWyzeAim();
}

function nextWyzeCam() {
  if (!ground) return;
  wyzeCam = (wyzeCam + 1) % WYZE_CAMS.length;
  toWyzeCam();
}

// Out of the camera altogether: the photograph off, the trees standing in the
// opening view put away, and the app's own lens back.
function leaveWyze() {
  if (!wyzeView) return;
  for (const tile of [ground, lot, skylineTile, wyzeScreen]) {
    if (tile) tile.project(null, null, 0);
  }
  if (trees) trees.homeTrees(false);
  heldTide = null;
  wyzeView = false;
  wyzePhoto = false;
  applyFov();
}

// Looking around is Google Maps' 3D view, and that view is an oblique one from
// above. It has to be, because the drag is a pan: it slides the camera over the
// ground, so the ground under your hand keeps up only when the ground is what
// you are looking at. Standing at eye height staring at a strait, the content is
// 10 to 80 km off and a 400 px drag moved it seven pixels, which is the one
// setup where Maps' bindings do not work at all.
//
// So this opens where Maps opens: over the peninsula, tilted, close enough to
// the ground that a drag takes hold of it.
const MAP_RANGE_M = 1200;
const MAP_TILT_DEG = 55;      // from straight down, so 35° above the ground
function toMapView() {
  nav.toOrbit();
  const groundY = groundSample ? groundSample(ORIGIN.lat, ORIGIN.lon) : 0;
  const tilt = (MAP_TILT_DEG * Math.PI) / 180;
  // East of the house, so the water is beyond it and the view still faces west.
  controls.target.set(0, groundY, 0);
  camera.position.set(
    MAP_RANGE_M * Math.sin(tilt),
    groundY + MAP_RANGE_M * Math.cos(tilt),
    0);
  controls.update();
}

// A link someone was sent. Read once, at load, before the address bar starts
// being rewritten. Malformed hashes come back null and the page opens as usual.
const shared = readViewHash(location.hash);
function toShared() {
  nav.toOrbit();
  camera.position.copy(shared.eye);
  controls.target.copy(shared.aim);
  controls.update();
}
if (shared) toShared();

// Everything that travels needs to know where the ground is: a boat to float and
// run aground, a cart and a pair of feet to stay on it. Without the terrain they
// would all be moving over nothing, so they are refused and told why. Looking
// around and free flight need no ground and stay available.
const needsGround = (id) => id !== "bluff" && id !== "look";

// Two sensors to ask for and either can refuse, so this one is not instant and
// cannot simply be entered. The chooser stays up until the phone is answering or
// there is a reason on it.
// Pressing it twice must not leave a second watch and a second listener running
// behind the first, so a start already under way and a mode already running both
// swallow the press.
let liveStarting = false;
function startLive() {
  if (liveStarting) return;
  if (nav.mode === "live") { chooser.classList.add("hidden"); return; }
  liveStarting = true;
  chooserNote.textContent = "asking for the phone's location and compass…";
  live.start().then(() => {
    chooserNote.textContent = "";
    chooser.classList.add("hidden");
    nav.enterLive(live);
  }).catch((err) => {
    chooserNote.textContent = err.message;
  }).finally(() => {
    liveStarting = false;
  });
}

function chooseMode(id) {
  if (needsGround(id) && !groundSample) {
    document.getElementById("chooser-note").textContent =
      "the ground has not loaded, so there is nothing to travel over yet";
    return;   // chooser stays open, with the reason on it
  }
  if (id === "live") { startLive(); return; }
  chooser.classList.add("hidden");
  if (id === "bluff") { toBluff(); return; }
  if (id === "look") { toMapView(); return; }
  if (id === "boat") { nav.toggleBoat(BOAT_START); return; }
  const spec = vehicleById(id);
  if (spec) nav.enterVehicle(spec, avatars.get(id));
}

for (const [id, label, note] of [
  ["walk", "walking", "5 km/h"],
  ["bike", "bicycle", "18 km/h"],
  ["cart", "golf cart", "24 km/h"],
  ["boat", "boat", "8 kn"],
  ["ultralight", "ultra light", "90 km/h"],
  ["live", "live", "where the phone is"],
  ["bluff", "bluff", "looking west"],
  ["look", "look around", "no vehicle"],
]) {
  const b = document.createElement("button");
  b.className = "chooser-btn";
  b.innerHTML = `${label}<span class="cb-note">${note}</span>`;
  b.addEventListener("click", () => chooseMode(id));
  chooserBtns.appendChild(b);
}

document.getElementById("mode-btn").addEventListener("click", () => chooser.classList.remove("hidden"));
document.getElementById("map-btn").addEventListener("click", () => overview.toggle());

// Turning the courts on takes you to them. They sit 616 m south-southeast of the
// house and there is no point drawing something that is behind you. Turning them
// off leaves the view wherever you have got to.
function toggleBrademy() {
  if (!brademy) return;
  const on = !brademy.visible;
  brademy.setVisible(on);
  // The clubhouse stands where the Breakers stands, so one of them is up at a
  // time. With the courts off you get the building that is actually there.
  if (breakers) breakers.visible = !on;
  if (on) lookAtBrademy();
}

function lookAtBrademy() {
  const c = brademy.centre;
  // Far enough back that the whole facility sits inside the vertical field of
  // view, with a margin, and from the south so the peninsula is behind it.
  const fov = (camera.fov * Math.PI) / 360;
  const range = (brademy.span / 2) / Math.tan(fov) * 1.25;
  nav.toOrbit();   // whatever you were driving, you are not driving it now
  camera.position.set(c.x, c.y + range * 0.62, c.z + range * 0.78);
  controls.target.copy(c);
  controls.update();
}
document.getElementById("brademy-btn").addEventListener("click", toggleBrademy);

// Whales, now, on the water beside wherever you are, and then it puts you where
// you can watch them, the way turning the courts on takes you to the courts.
//
// Where it puts you is the whole of whether this works, and two things had to be
// measured to get it right. Only about 1.2 m of an orca is ever out of the
// water — the back and the fin, and no more — so at a kilometre that is a
// three pixel notch and at 300 m it is seven. And a group travelling at 2.2 m/s
// leaves the frame inside a minute, so standing abeam of them showed a speck
// that then swam away.
//
// So it gets ahead of them and off to one side, and they come on. They start
// about 180 m off and pass within 60, growing the whole way, and there is a
// couple of minutes of it.
const WHALE_AHEAD_M = 170;   // down their track, so they are coming toward you
const WHALE_SIDE_M = 55;     // and off to the shore side, so they pass rather than hit
const WHALE_EYE_M = 8;       // low, a look across the water and not down on it
const WHALE_AIM_M = 60;      // aim between you and them, so they swim into the middle
document.getElementById("whales-btn").addEventListener("click", () => {
  if (!orcas) return;
  if (!orcas.show(camera.position.x, camera.position.z)) return;
  const c = orcas.centre();
  if (!c) return;
  nav.toOrbit();
  camera.position.set(
    c.at.x + c.heading.x * WHALE_AHEAD_M - c.seaward.x * WHALE_SIDE_M,
    c.at.y + WHALE_EYE_M,
    c.at.z + c.heading.z * WHALE_AHEAD_M - c.seaward.z * WHALE_SIDE_M);
  controls.target.set(
    c.at.x + c.heading.x * WHALE_AIM_M,
    c.at.y,
    c.at.z + c.heading.z * WHALE_AIM_M);
  controls.update();
});

// The address bar is the view. Nothing to press: it is rewritten as you move, so
// whatever is in it is what is on the screen, and copying it out of the bar is
// the whole of sharing.
const share = new Share(camera, () => ({
  brademy: brademy ? brademy.visible : false,
  map: overview.visible,
  // The hour the scene is standing at, so a link opens on the same light. Left
  // off when the clock is the real one. Quartered, or the address bar would be
  // rewritten every minute as the offset clock ran on.
  hour: offsetHours()
    ? Math.round((sceneNow().getHours() + sceneNow().getMinutes() / 60) * 4) / 4
    : 0,
}));

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyM") chooser.classList.remove("hidden");
  if (e.code === "KeyO") overview.toggle();
  if (e.code === "KeyT") toggleBrademy();
  // Held down, C would strobe the photograph on and off at the key repeat rate.
  if (e.code === "KeyC" && !e.repeat) flipWyze();
  if (e.code === "KeyN" && !e.repeat) nextWyzeCam();
});

// How far the nearest water is from the camera, which the surf volume rides on.
// The tide moves it a long way — the waterline below the bluff sits 99 m out at
// a 0.5 m tide and 43 m at 3.5 m — so it has to be re-measured, but a coarse
// ring search twice a second is plenty for a volume knob.
const WATER_SCAN_SECONDS = 0.5;
const WATER_SCAN_MAX_M = 900;
const WATER_SCAN_STEP_M = 25;
let waterDistance = WATER_SCAN_MAX_M;
let waterScanDue = 0;
function scanWaterDistance() {
  if (!groundSample) return;
  const cx = camera.position.x, cz = camera.position.z;
  for (let r = 0; r <= WATER_SCAN_MAX_M; r += WATER_SCAN_STEP_M) {
    const steps = r === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * r) / WATER_SCAN_STEP_M));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const { lat, lon } = fromWorld(x, z);
      if (tideLevel() - groundSample(lat, lon) > 0) { waterDistance = r; return; }
    }
  }
  waterDistance = WATER_SCAN_MAX_M;
}

const audio = new Audio();
const soundBtn = document.getElementById("sound-btn");
soundBtn.addEventListener("click", () => audio.toggle());
const showSound = (on) => { soundBtn.textContent = on ? "sound on" : "sound off"; };
audio.onChange(showSound);
showSound(audio.enabled);

const lookDir = new THREE.Vector3();
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;

  resize(); // self-correct if the canvas came up 0×0 (e.g. loaded while hidden)

  const level = tideLevel();
  ocean.setLevel(level);
  ocean.update(t);
  // Ships light up as the sun goes down, and so does the point.
  const night = 1 - weather.dayFactor;
  vessels.update(feed, level, t, camera, night);
  if (lighthouse) lighthouse.update(t, night);
  aircraft.update(feed, t, camera);
  updateHover();
  weather.update(dt, camera);

  nav.update(dt);
  orbitStick.update(dt);
  if (trees) trees.update(camera);
  hud.helm(nav.mode === "boat", nav.boat, feed.current && { ...feed.current, data: currentAt() });
  if (drift) drift.update(dt, camera, nav.current ? nav.current() : null);
  if (orcas) orcas.update(dt);

  const wall = performance.now();
  share.update(wall);
  if (feed.connected) downSince = null;
  else if (downSince === null) downSince = wall;
  hud.banner(downSince !== null && wall - downSince > OFFLINE_GRACE_MS,
             "reconnecting…");

  // Whatever is carrying you is what the map should mark.
  if (overview.visible) {
    const who = nav.mode === "boat" ? nav.boat : (nav.mode === "vehicle" ? nav.rider : null);
    if (who) {
      overview.update(who.pos.x, who.pos.z, who.yaw);
    } else {
      camera.getWorldDirection(lookDir);
      overview.update(camera.position.x, camera.position.z,
        Math.atan2(-lookDir.x, -lookDir.z));
    }
  }

  if (t >= waterScanDue) { waterScanDue = t + WATER_SCAN_SECONDS; scanWaterDistance(); }
  const wx = feed.weather && feed.weather.data;
  audio.update(dt, {
    waveHeightM: wx ? wx.wave_height_m : null,
    wavePeriodS: wx ? wx.wave_period_s : null,
    waterDistanceM: waterDistance,
    listenerHeightM: camera.position.y - level,
    boat: nav.mode === "boat" ? nav.boat : null,
  });

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener("resize", resize);
