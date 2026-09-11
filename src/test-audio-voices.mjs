// The two voices added to the sound: halyards at the marina and wind on the
// bluff. Both are driven by the wind the weather station is reporting.
//
// Run:
//     node src/test-audio-voices.mjs
//
// Web Audio does not exist in node, so the graph is stubbed and what is checked
// is the arithmetic: what gets louder, what gets quieter, and what is silent.

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// A stub of just enough Web Audio to let the graph build and the numbers land.
const seen = { taps: 0 };
function param(name) {
  return { value: 0, _name: name,
    setTargetAtTime(v) { this.value = v; },
    setValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime(v) { this.value = v; },
    exponentialRampToValueAtTime(v) { this.value = v; } };
}
function node(kind) {
  const n = { kind, gain: param(kind + ".gain"), frequency: param(kind + ".f"),
    Q: param("Q"), type: "", buffer: null, loop: false,
    connect(x) { return x; }, start() { if (kind === "buffer") seen.taps++; }, stop() {},
    setPeriodicWave() {} };
  return n;
}
const ctx = {
  currentTime: 0, sampleRate: 48000, destination: node("dest"),
  createGain: () => node("gain"),
  createBiquadFilter: () => node("filter"),
  createOscillator: () => Object.assign(node("osc"), { start() {}, stop() {} }),
  createBufferSource: () => node("buffer"),
  createWaveShaper: () => node("shaper"),
  createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
  resume() {},
};
globalThis.window = { AudioContext: function () { return ctx; },
  addEventListener() {} };
globalThis.localStorage = { getItem: () => "on", setItem() {} };

const src = fs.readFileSync(path.join(here, "audio.js"), "utf8");
const { Audio } = await import(
  "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"));

const audio = new Audio();
audio._build();
assert.ok(audio.ready, "the graph built");

const base = { waveHeightM: 0.3, wavePeriodS: 4, waterDistanceM: 50,
  listenerHeightM: 20, boat: null };
const run = (over) => { audio.update(0.5, { ...base, ...over }); };

// ---- wind -------------------------------------------------------------------
run({ windSpeedMps: 0 });
const calm = audio.windGain.gain.value;
run({ windSpeedMps: 12 });
const blowing = audio.windGain.gain.value;
assert.ok(calm < 0.005, `dead calm still makes ${calm}`);
assert.ok(blowing > calm * 4, `12 m/s is only ${blowing} against ${calm}`);
// It opens upward as it gets up, rather than just getting louder.
run({ windSpeedMps: 2 });
const lowBand = audio.windFilter.frequency.value;
run({ windSpeedMps: 14 });
assert.ok(audio.windFilter.frequency.value > lowBand * 1.5, "the band opens with the wind");

// On the beach the bank takes it off you; on the bluff it does not.
run({ windSpeedMps: 10, listenerHeightM: 2 });
const low = audio.windGain.gain.value;
run({ windSpeedMps: 10, listenerHeightM: 45 });
assert.ok(audio.windGain.gain.value > low * 2, "the bluff is windier than the beach");

// ---- halyards ---------------------------------------------------------------
run({ windSpeedMps: 8, marinaDistanceM: 40 });
const atBasin = audio.halyardGain.gain.value;
run({ windSpeedMps: 8, marinaDistanceM: 3000 });
const away = audio.halyardGain.gain.value;
assert.ok(atBasin > 0.02, `standing at the basin they are only ${atBasin}`);
assert.ok(away < atBasin / 8, `three kilometres off they are still ${away}`);

// No wind, no knocking, however close you stand.
run({ windSpeedMps: 0, marinaDistanceM: 20 });
assert.ok(audio.halyardGain.gain.value < 0.005, "they knock in a flat calm");

// They are struck, not looped: taps arrive when there is wind and a basin.
seen.taps = 0;
for (let i = 0; i < 20; i++) run({ windSpeedMps: 12, marinaDistanceM: 30 });
const struck = seen.taps;
assert.ok(struck > 5, `only ${struck} taps in ten seconds of a good breeze`);
seen.taps = 0;
for (let i = 0; i < 20; i++) run({ windSpeedMps: 12, marinaDistanceM: 5000 });
assert.equal(seen.taps, 0, "masts knocking five kilometres away");

// ---- the surf ---------------------------------------------------------------
// The station reports the wind chop, which here is often two or three seconds.
// Pulsing the surf at that rate is a tick, so the audible rhythm is slower than
// the reading and shallower the shorter the reading is.
run({ wavePeriodS: 2.45, windSpeedMps: 4 });
const chopRate = audio.swellLfos[0].lfo.frequency.value;
const chopDepth = audio.swellDepths[0].gain.value;
assert.ok(chopRate < 1 / 6, `a 2.45 s chop still beats at ${(1 / chopRate).toFixed(1)} s`);
run({ wavePeriodS: 13, windSpeedMps: 4 });
const swellRate = audio.swellLfos[0].lfo.frequency.value;
assert.ok(swellRate < chopRate, "a long swell is slower than a chop");
assert.ok(audio.swellDepths[0].gain.value > chopDepth * 1.5,
  "a long swell breaks harder than a chop washes");

// Three rhythms, none a multiple of another, or it repeats and a repeat is what
// makes it annoying.
assert.equal(audio.swellLfos.length, 3, "three rhythms");
const rates = audio.swellLfos.map(l => l.lfo.frequency.value);
for (let i = 1; i < rates.length; i++) {
  const ratio = rates[i] / rates[0];
  assert.ok(Math.abs(ratio - Math.round(ratio)) > 0.2,
    `rhythm ${i} is ${ratio.toFixed(2)} of the first, which repeats`);
}

console.log(`PASS: wind ${calm.toFixed(3)} calm to ${blowing.toFixed(3)} blowing, ` +
  `halyards ${atBasin.toFixed(3)} at the basin and ${away.toFixed(3)} away, ` +
  `${struck} taps in ten seconds of breeze, surf at ${(1 / chopRate).toFixed(0)}s ` +
  `on a 2.45s chop.`);
