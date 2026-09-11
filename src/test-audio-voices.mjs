// The voices added to the sound beyond the water and the outboard: halyards at
// the marina, wind on the bluff, rain when it is falling, and gulls near the
// shore. Everything but the gulls is driven by what the station is reporting.
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
// Struck sounds make a source and throw it away, so counting starts counts them.
const seen = { struck: 0, cries: 0 };
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
    connect(x) { return x; }, start() { if (kind === "buffer") seen.struck++; }, stop() {},
    setPeriodicWave() {} };
  return n;
}
const ctx = {
  currentTime: 0, sampleRate: 48000, destination: node("dest"),
  createGain: () => node("gain"),
  createBiquadFilter: () => node("filter"),
  createOscillator: () => Object.assign(node("osc"), {
    start() { seen.cries++; }, stop() {} }),
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
seen.struck = 0;
for (let i = 0; i < 20; i++) run({ windSpeedMps: 12, marinaDistanceM: 30 });
const struck = seen.struck;
assert.ok(struck > 5, `only ${struck} taps in ten seconds of a good breeze`);
seen.struck = 0;
for (let i = 0; i < 20; i++) run({ windSpeedMps: 12, marinaDistanceM: 5000 });
assert.equal(seen.struck, 0, "masts knocking five kilometres away");

// ---- the surf ---------------------------------------------------------------
// The beat runs at the period the station is reporting and is not slowed down
// to sound better. What a short sea loses is the beat itself, not the rate.
run({ wavePeriodS: 2.45, windSpeedMps: 4 });
const chopRate = audio.waveLfos[0].lfo.frequency.value;
const chopDepth = audio.waveDepths[0].gain.value;
assert.ok(Math.abs(1 / chopRate - 2.45) < 0.01,
  `a 2.45 s sea beats at ${(1 / chopRate).toFixed(2)} s`);
assert.ok(chopDepth < 1e-6, `chop still pulses at ${chopDepth}`);

run({ wavePeriodS: 13, windSpeedMps: 4 });
const swellRate = audio.waveLfos[0].lfo.frequency.value;
assert.ok(Math.abs(1 / swellRate - 13) < 0.02, "a 13 s swell beats at 13 s");
const swellDepth = audio.waveDepths[0].gain.value;
assert.ok(swellDepth > 0.02, `a long swell barely breaks, at ${swellDepth}`);

// Where a long swell runs under the chop it is the swell that breaks.
run({ wavePeriodS: 2.2, swellPeriodS: 11, windSpeedMps: 4 });
assert.ok(Math.abs(1 / audio.waveLfos[0].lfo.frequency.value - 11) < 0.02,
  "the chop drowned out the swell under it");

// The sets run whatever the sea is doing, or a flat calm is a flat tone and a
// flat tone is what was annoying about it.
run({ wavePeriodS: 2.2, windSpeedMps: 0 });
assert.ok(audio.setDepths[0].gain.value > 0.01,
  "the water holds one level with no sets in it");
assert.equal(audio.setDepths.length, 2, "two sets, or one rhythm repeats");

// ---- rain -------------------------------------------------------------------
// A probability makes no sound. Only what is falling.
run({ precipitationMm: 0, windSpeedMps: 0, marinaDistanceM: 9000 });
assert.ok(audio.rainGain.gain.value < 1e-6, "it rains on a dry day");
run({ precipitationMm: 0.3, windSpeedMps: 0, marinaDistanceM: 9000 });
const drizzle = audio.rainGain.gain.value;
const drizzleBand = audio.rainFilter.frequency.value;
run({ precipitationMm: 6, windSpeedMps: 0, marinaDistanceM: 9000 });
const downpour = audio.rainGain.gain.value;
assert.ok(drizzle > 0.001, `drizzle is inaudible at ${drizzle}`);
assert.ok(downpour > drizzle * 2, `6 mm is only ${downpour} against ${drizzle}`);
assert.ok(audio.rainFilter.frequency.value > drizzleBand * 1.5,
  "hard rain is no higher than drizzle");

// Hard rain has drops in it. Drizzle is hiss alone.
seen.struck = 0;
for (let i = 0; i < 20; i++) run({ precipitationMm: 6, windSpeedMps: 0, marinaDistanceM: 9000 });
const drops = seen.struck;
assert.ok(drops > 20, `only ${drops} drops in ten seconds of hard rain`);
seen.struck = 0;
for (let i = 0; i < 20; i++) run({ precipitationMm: 0, windSpeedMps: 0, marinaDistanceM: 9000 });
assert.equal(seen.struck, 0, "drops falling on a dry day");

// ---- gulls ------------------------------------------------------------------
// Near the water, and quiet in the dark.
seen.cries = 0;
for (let i = 0; i < 600; i++) run({ waterDistanceM: 30, dayFactor: 1, windSpeedMps: 0,
  marinaDistanceM: 9000, precipitationMm: 0 });
const shore = seen.cries;
assert.ok(shore > 0, "no gull in five minutes on the beach");

seen.cries = 0;
for (let i = 0; i < 600; i++) run({ waterDistanceM: 6000, dayFactor: 1, windSpeedMps: 0,
  marinaDistanceM: 9000, precipitationMm: 0 });
assert.ok(seen.cries < shore / 2,
  `six kilometres inland is as loud with gulls as the beach: ${seen.cries} against ${shore}`);

seen.cries = 0;
for (let i = 0; i < 600; i++) run({ waterDistanceM: 30, dayFactor: 0, windSpeedMps: 0,
  marinaDistanceM: 9000, precipitationMm: 0 });
assert.equal(seen.cries, 0, "they call in the dark, and they roost in it");

console.log(`PASS: wind ${calm.toFixed(3)} calm to ${blowing.toFixed(3)} blowing, ` +
  `halyards ${atBasin.toFixed(3)} at the basin and ${away.toFixed(3)} away, ` +
  `${struck} taps in ten seconds of breeze, surf beating at the reported ` +
  `2.45s with no depth and at 13s with ${swellDepth.toFixed(3)}, ` +
  `${drops} drops in ten seconds of hard rain, ${shore} gull notes in five ` +
  `minutes on the beach.`);
