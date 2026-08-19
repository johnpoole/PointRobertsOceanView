// What the card says about one ship or one aircraft.
//
// Run:
//     node src/scene/test-track-detail.mjs
//
// The point of the card is that nothing in the record is left off it. So each
// record here is written out whole and the rows are checked against it field for
// field, and every record carries a field the code has never heard of, which has
// to come out the far end anyway.
//
// vessels.js and aircraft.js import three, which is not installed — the browser
// gets it from a CDN. Each module is read, its three rewritten to the stub
// beside this file, and handed to node as a data URL, the same as test-trees.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// config.js reads the page it was served from. Nothing under test uses it.
globalThis.location = { protocol: "http:", host: "localhost" };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUB = pathToFileURL(path.join(HERE, "test-three-stub.mjs")).href;

const rewritten = new Map();
function asDataUrl(file) {
  const abs = path.resolve(file);
  if (rewritten.has(abs)) return rewritten.get(abs);
  const src = fs.readFileSync(abs, "utf8").replace(
    /from\s+"([^"]+)"/g,
    (whole, spec) => {
      if (spec === "three" || spec.startsWith("three/")) return `from "${STUB}"`;
      if (spec.startsWith(".")) {
        return `from "${asDataUrl(path.resolve(path.dirname(abs), spec))}"`;
      }
      throw new Error(
        `test-track-detail: ${path.basename(abs)} imports "${spec}", which is ` +
        `neither three nor a file beside it, so the test has no way to resolve it.`);
    });
  const url = "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64");
  rewritten.set(abs, url);
  return url;
}

const { Vessels } = await import(asDataUrl(path.join(HERE, "vessels.js")));
const { Aircraft } = await import(asDataUrl(path.join(HERE, "aircraft.js")));
const { bearing, cardinal, latText, lonText } =
  await import(asDataUrl(path.join(HERE, "..", "select.js")));

let failures = 0;
function ok(cond, what) {
  if (cond) return;
  failures++;
  console.error("FAIL " + what);
}
function is(got, want, what) {
  ok(got === want, `${what}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
}

// The rows as a label -> value lookup, with a check that no label was written
// twice, which would lose one of them.
function lookup(rows, what) {
  const out = new Map();
  for (const [k, v] of rows) {
    ok(!out.has(k), `${what}: two rows labelled ${k}`);
    out.set(k, v);
  }
  return out;
}

// Every row wanted, and no row besides. The card is the whole record, so a field
// that stops being shown is a failure and so is one invented.
function rowsAre(rows, want, what) {
  const got = lookup(rows, what);
  for (const [k, v] of Object.entries(want)) is(got.get(k), v, `${what}: ${k}`);
  for (const k of got.keys()) {
    ok(k in want, `${what}: an extra row, ${k} = ${got.get(k)}`);
  }
}

// ---- a class A ship, everything the AIS feed carries -----------------------
// deep_draught is not a field the code knows. It has to come through as itself.
rowsAre(Vessels.detail({
  mmsi: "316001234",
  name: "  QUEEN OF ALBERNI  ",
  imo: "7422446",
  call_sign: "CG2947",
  vessel_type: 60,
  dimensions_m: { length: 139, beam: 27, to_bow: 100, to_stern: 39 },
  latitude: 49.0102,
  longitude: -123.2001,
  speed_over_ground_knots: 17.25,
  course_over_ground_degrees: 271.4,
  true_heading_degrees: 270,
  navigation_status: 0,
  deep_draught: 5.4,
}), {
  name: "QUEEN OF ALBERNI",
  mmsi: "316001234",
  imo: "7422446",
  "call sign": "CG2947",
  "ais type": "60",
  "drawn as": "passenger",
  length: "139 m",
  beam: "27 m",
  "to bow": "100 m",
  "to stern": "39 m",
  speed: "17.3 kn",
  course: "271°",
  heading: "270°",
  status: "under way",
  "deep draught": "5.4",
}, "the ferry");

// A ship's own account of where it is going, out of AIS message 5.
rowsAre(Vessels.detail({
  mmsi: "316001234",
  vessel_type: 70,
  destination: "TSAWWASSEN",
  eta_utc: "08-19 14:30 UTC",
  draught_m: 5.4,
}), {
  mmsi: "316001234",
  "ais type": "70",
  "drawn as": "cargo",
  destination: "TSAWWASSEN",
  eta: "08-19 14:30 UTC",
  draught: "5.4 m",
}, "the voyage");

// ---- a scraped one ---------------------------------------------------------
// Their panel gives a width where AIS gives a beam, and the source has to be on
// the card: a scraped position is labelled scraped everywhere it is shown.
rowsAre(Vessels.detail({
  mmsi: "367123456",
  name: "SEA WOLF",
  vessel_type_name: "Tug",
  vessel_type: 52,
  dimensions_m: { length: 23, width: 8 },
  latitude: 48.9,
  longitude: -123.1,
  source: "shipfinder",
}), {
  name: "SEA WOLF",
  mmsi: "367123456",
  type: "Tug",
  "ais type": "52",
  "drawn as": "service",
  length: "23 m",
  beam: "8 m",
  source: "shipfinder",
}, "the tug");

// A ship with nothing but a position still says what it is drawn as, because
// something is out there on the water and that is what it looks like.
rowsAre(Vessels.detail({ mmsi: "1", latitude: 48.9, longitude: -123.1 }),
        { mmsi: "1", "drawn as": "default" }, "the bare ship");

// A status code nobody has written down is shown as the code, not guessed at.
is(lookup(Vessels.detail({ mmsi: "1", navigation_status: 14 }), "status 14").get("status"),
   "code 14", "an unnamed nav status");

// One of the Tsawwassen boats, with its sailing on it from BC Ferries.
rowsAre(Vessels.detail({
  mmsi: "316001234",
  name: "Coastal Celebration",
  vessel_type: 60,
  ferry_route: "Swartz Bay to Tsawwassen",
  ferry_status: "under way",
  ferry_departure: "5:59 am",
  ferry_arrival: "7:34 am",
  also_from: "bcferriesapi.ca",
}), {
  name: "Coastal Celebration",
  mmsi: "316001234",
  "ais type": "60",
  "drawn as": "passenger",
  sailing: "Swartz Bay to Tsawwassen",
  "sailing status": "under way",
  departs: "5:59 am",
  arrives: "7:34 am",
  "also from": "bcferriesapi.ca",
}, "the ferry under way");

// One still at the berth says how full it is going to be.
is(lookup(Vessels.detail({ mmsi: "1", ferry_fill_percent: 76 }), "the fill")
   .get("how full"), "76%", "how full the next sailing is");

// ---- an airliner -----------------------------------------------------------
// squawk is not a field the code knows.
rowsAre(Aircraft.detail({
  icao: "a1b2c3",
  callsign: "ACA553",
  registration: "C-FGKN",
  aircraft_type: "B738",
  latitude: 49.02,
  longitude: -123.15,
  altitude_m: 1219.2,
  on_ground: false,
  ground_speed_kn: 250,
  track_degrees: 91.6,
  distance_nm: 8.42,
  squawk: "1200",
}), {
  flight: "ACA553",
  registration: "C-FGKN",
  icao: "a1b2c3",
  type: "B738",
  altitude: "1219 m · 4000 ft",
  speed: "250 kn · 463 km/h",
  track: "92°",
  "off the point": "8.4 nm",
  squawk: "1200",
}, "the 737");

// Everything a new box sends. All of it has a row, and the units are on it.
rowsAre(Aircraft.detail({
  icao: "a1b2c3",
  callsign: "ACA553",
  aircraft_type: "B738",
  latitude: 49.02,
  longitude: -123.15,
  altitude_m: 1219.2,
  on_ground: false,
  ground_speed_kn: 250,
  track_degrees: 91.6,
  altitude_geometric_m: 1264.9,
  vertical_rate_fpm: -640,
  selected_altitude_ft: 5000,
  indicated_airspeed_kn: 240,
  true_airspeed_kn: 262,
  mach: 0.412,
  true_heading_degrees: 91.2,
  magnetic_heading_degrees: 88.6,
  roll_degrees: -1.4,
  squawk: "1200",
  category: "A3",
  wind_kn: 22,
  wind_from_degrees: 310,
  outside_air_temp_c: -4,
  signal_dbm: -18.7,
  messages: 4213,
  seen_s: 0.3,
}), {
  flight: "ACA553",
  icao: "a1b2c3",
  type: "B738",
  altitude: "1219 m · 4000 ft",
  speed: "250 kn · 463 km/h",
  track: "92°",
  "geometric altitude": "1265 m · 4150 ft",
  "vertical rate": "-640 ft/min",
  "selected altitude": "5000 ft",
  "indicated airspeed": "240 kn",
  "true airspeed": "262 kn",
  mach: "0.41",
  "true heading": "91°",
  "magnetic heading": "89°",
  roll: "-1.4°",
  squawk: "1200",
  category: "A3",
  wind: "22 kn from 310°",
  "outside air": "-4°C",
  signal: "-18.7 dBm",
  messages: "4213",
  "last message": "0.3 s ago",
}, "the airliner in full");

// What was looked up by the transponder address and by the callsign.
rowsAre(Aircraft.detail({
  icao: "c010ea",
  callsign: "ACA553",
  registration: "C-FGKN",
  aircraft_type: "A321",
  model: "A321 212",
  manufacturer: "Airbus",
  operator: "Air Canada",
  operator_country: "Canada",
  airline: "Air Canada",
  origin: "Victoria International Airport (CYYJ)",
  destination: "Vancouver International Airport (CYVR)",
  also_from: "adsbdb.com",
}), {
  flight: "ACA553",
  registration: "C-FGKN",
  icao: "c010ea",
  type: "A321",
  model: "A321 212",
  manufacturer: "Airbus",
  operator: "Air Canada",
  "operator country": "Canada",
  airline: "Air Canada",
  origin: "Victoria International Airport (CYYJ)",
  destination: "Vancouver International Airport (CYVR)",
  "also from": "adsbdb.com",
}, "the airframe and the route");

// A climb reads with its sign, so it cannot be mistaken for a descent.
is(lookup(Aircraft.detail({ icao: "x", vertical_rate_fpm: 1280 }), "climbing")
   .get("vertical rate"), "+1280 ft/min", "a climb");

// on_ground is false and has to stay off the card as a row of its own; sitting
// on the ground it replaces the altitude.
rowsAre(Aircraft.detail({
  icao: "c0ffee", callsign: "N123AB", latitude: 48.9, longitude: -123.1,
  altitude_m: 0, on_ground: true,
}), {
  flight: "N123AB", icao: "c0ffee", altitude: "on the ground",
}, "the one on the ground");

// ---- where it is from here -------------------------------------------------
// North is -Z and east is +X, the same as the rest of the scene.
is(bearing(0, -100), 0, "due north");
is(bearing(100, 0), 90, "due east");
is(bearing(0, 100), 180, "due south");
is(bearing(-100, 0), 270, "due west");
is(Math.round(bearing(100, -100)), 45, "north east");
is(cardinal(0), "N", "north");
is(cardinal(247.5), "WSW", "west south west");
is(cardinal(359), "N", "just short of north");
is(latText(48.98931), "48.98931° N", "a north latitude");
is(latText(-48.98931), "48.98931° S", "a south latitude");
is(lonText(-123.08321), "123.08321° W", "a west longitude");
is(lonText(123.08321), "123.08321° E", "an east longitude");

if (failures) {
  console.error(`${failures} failed`);
  process.exit(1);
}
console.log("track detail: all good");
