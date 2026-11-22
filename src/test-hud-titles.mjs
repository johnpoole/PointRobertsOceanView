// Run: node src/test-hud-titles.mjs
import assert from "node:assert/strict";
import { tideTitle, weatherTitle } from "./hud.js";

// The weather is a model's, and the panel printed its source bare where a
// station's name goes.
assert.equal(weatherTitle({ station_id: "open-meteo" }), "open-meteo model");
assert.equal(weatherTitle({ station_id: "open-meteo", predicted: true }), "forecast");
assert.equal(weatherTitle({ predicted: true, beyond: true }), "beyond the forecast");
assert.equal(weatherTitle(null), "");
assert.equal(weatherTitle({}), "");

// The present tide is a prediction with another station's surge added.
const now = { station_id: "9449639", water_level_m: 2.1, surge_m: 0.06,
              gauge_station_id: "9449424", gauge_station_name: "Cherry Point" };
assert.equal(tideTitle(now), "predicted, surge from Cherry Point");

// Off the present hour there is no surge in it, and the trend row says predicted.
assert.equal(tideTitle({ ...now, surge_m: null, predicted: true }), "9449639");
// Held to a photograph, the level is the photograph's.
assert.equal(tideTitle({ ...now, held: true }), "9449639");
assert.equal(tideTitle({ predicted: true, beyond: true }), "");
// A reading that does not name its gauge is not given one.
assert.equal(tideTitle({ station_id: "9449639", surge_m: 0.06 }), "9449639");
assert.equal(tideTitle(null), "");

console.log("PASS: the panels say a model is a model and a prediction is a prediction.");
