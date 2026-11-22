// Run: node src/scene/test-aircraft-height.mjs
import assert from "node:assert/strict";
import { altitudeLabel } from "./aircraft-height.js";

assert.equal(altitudeLabel({ altitude_m: 150, altitude_source: "geometric" }), "altitude");
assert.equal(altitudeLabel({ altitude_m: 701, altitude_source: "barometric" }), "pressure altitude");
// An old line of the record carries no source. It was a pressure altitude.
assert.equal(altitudeLabel({ altitude_m: 701 }), "pressure altitude");

console.log("PASS: a pressure altitude is called one.");
