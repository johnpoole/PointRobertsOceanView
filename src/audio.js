// Sound, synthesised rather than sampled. Four voices:
//
//   water    - always on, filtered noise driven by the real sea state and how far
//              away the water actually is at the current tide.
//   engine   - boat mode only, a two-stroke outboard: one bang per firing, into
//              fixed resonances, at a rate that follows engine revs rather than
//              boat speed.
//   halyards - near the marina, three hundred masts: a rope slapping aluminium,
//              struck at a rate the real wind sets, each tap a short ring.
//   wind     - noise through a band that opens as the wind gets up, and louder
//              the higher and barer the ground you are standing on.
//   rain     - only when it is actually falling, at the rate the station gives,
//              from a hiss in drizzle to a hard rattle.
//   gulls    - the one voice with no reading behind it. Near the water, now and
//              then, and hardly at all in the dark.
//
// Nothing is loaded from disk. Both voices are a handful of oscillators and a
// noise buffer, which costs nothing in payload and, more to the point, lets the
// sound follow state the app already computes instead of looping a clip.
//
// Browsers will not start audio until the page has been interacted with, so the
// graph is not built until the first click or keypress. Before that it is
// silent, deliberately: there is no way to make noise sooner.

const STORE_KEY = "oceanview.sound";

// ---- halyards ---------------------------------------------------------------
//
// A marina in any breeze is one sound above all others: rope on mast. It is not
// a tone, it is a tap — a short strike with a metal ring after it, and three
// hundred boats means taps arriving at random all the time.
//
// The rate is what carries the wind. Nothing at a whisper, a lazy knock every
// second or two at five metres a second, and a continuous rattle at fifteen.
const HALYARD_HZ = [0.0, 9.0];         // taps a second, at no wind and at gale
const HALYARD_WIND = [1.2, 15.0];      // metres a second, over which that maps
// Masts ring where their section rings. Aluminium spars land in this range and
// the spread is what stops three hundred boats sounding like one.
const HALYARD_RING = [420, 1500];
const HALYARD_DECAY = [0.05, 0.16];    // seconds for a tap to die away
// How far the sound carries. Beyond this the basin is quiet.
const MARINA_REF_M = 260;

// ---- wind -------------------------------------------------------------------
//
// Noise through a band. What changes with strength is not just level: a breeze
// in firs is low and soft, and a blow is higher and harder, so the band opens
// upward as it gets up.
const WIND_BAND_HZ = [300, 1250];
const WIND_GAIN = [0.0, 0.14];
// Exposure: on the beach with the bank behind you it is quieter than it is on
// the bluff. Height above the water stands in for that.
const WIND_HEIGHT_M = 45;

// ---- the rhythm of the surf -------------------------------------------------
//
// Two things, and they are not the same thing.
//
// Sets. A beach is loud for a minute and quiet for the next two, whatever the
// sea is doing. Two slow sines with no common multiple, always running, and
// their sum never repeats.
const SET_PERIOD_S = [43, 67];
const SET_DEPTH = [0.34, 0.22];

// Waves. The beat of one breaker after the next, and it runs at the period the
// station is reporting rather than at a period chosen to sound better. Here
// that is two or three seconds nearly always: the Strait is fetch-limited, no
// Pacific swell gets past Vancouver Island, and chop has no beat in it.
//
// So the rate is the real one and the DEPTH carries the sea state. Below the
// first of these there is nothing to hear and the water is a wash. Above the
// second there are separate breakers.
const WAVE_RATIOS = [1, 0.61];
const WAVE_HEARD_S = [4.0, 10.0];
const WAVE_DEPTH = 0.5;

// ---- rain -------------------------------------------------------------------
//
// Broadband hiss, and the harder it falls the more of it is high. Driven by
// what the station says is falling, in millimetres in the last hour, and not by
// whether it might. A probability makes no sound.
const RAIN_MM = [0.02, 4.0];           // drizzle, and hard rain
const RAIN_GAIN = [0.0, 0.20];
const RAIN_HP_HZ = [700, 2600];
// Heavy rain has grains in it. Single drops on something hard, struck the way
// the halyards are.
const RAIN_DROPS_HZ = 26;              // drops a second, at the hard end
const RAIN_DROP_HZ = [1400, 4200];

// ---- gulls ------------------------------------------------------------------
//
// The one voice with nothing behind it. There is no gull feed. They are here
// because a shore without them is wrong, and the model is only this: near the
// water, sparsely, and quiet in the dark.
const GULL_EVERY_S = [16, 90];         // seconds between calls, near and far
const GULL_REF_M = 400;
const GULL_NOTE_HZ = [1250, 620];      // each cry falls through this
const GULL_NOTES = [2, 5];

const IDLE_RPM = 1100;
// OMC propped these to turn 4000-5000 at wide open throttle.
const MAX_RPM = 4800;

// An engine does not hold a note. Each firing is a bang, and what we hear is a
// small aluminium leg and a column of exhaust ringing after it. So the sound is
// a train of narrow pulses at the firing rate, fed through resonances that do
// NOT move with the revs. Fixed resonances are the whole trick: they are why a
// motor is recognisably the same motor at idle and at full throttle, and why a
// sawtooth sliding up the scale sounds like a synthesiser instead.
//
// The Evinrude 4.5 is a twin, so it fires twice a revolution and the rate in
// hertz is rpm/30 — 37 at idle, 160 wide open.
const FIRINGS_PER_REV = 2;
// How narrow the bang is. The pulse fills about ln(2)/k of a cycle, so 10 gives
// 7 percent — a crack at idle that smears into a buzz as the firings crowd.
const PULSE_SHARPNESS = 10;
// A pulse that narrow carries 15 times less energy than a full waveform, so the
// bank needs that back or the motor disappears under the surf.
const PULSE_DRIVE = 15;
// Noise gated by the pulse: a puff of gas with each bang.
const CHUFF = 0.9;
// Where the motor rings, how long it rings for, how loud. A resonance that dies
// away in `decay` seconds is a bandpass of Q = pi f decay.
const RING = [
  { f: 190, decay: 0.0151, gain: 1.00 },
  { f: 430, decay: 0.0052, gain: 0.55 },
  { f: 1150, decay: 0.0014, gain: 0.28 },
];
// The exhaust goes out through the prop hub, under water. That is what takes
// the edge off, and it lets go as the leg lifts on plane.
const DROWNED_HZ = 900;
const OPEN_HZ = 3200;
// Overall level, at idle and wide open.
const ENGINE_GAIN = [0.05, 0.21];

// Small engines never hold their revs. Two slow wanders, as a fraction of the
// firing rate.
const HUNT = [
  { hz: 0.43, depth: 0.025 },
  { hz: 0.17, depth: 0.012 },
];
// Revs sag as the hull pushes against its own bow wave, then pick up as it comes
// onto plane and the load falls away.
const LOAD_SAG_RPM = 700;
const REV_TAU = 0.35;      // s — revs answer the throttle far quicker than the hull

// How the water fades with range. Falls off as 1/(1 + d/REF), which keeps the
// beach loud and the strait audible from the bluff without going silent.
const WATER_REF_M = 70;

function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }

// Turns a sawtooth into a pulse train. The saw ramps -1 to 1 once a cycle;
// raising that ramp to a power leaves it near zero for most of the cycle and
// spikes it at the top, so one bang comes out per cycle. The resonators below
// are fed by this, and they block the DC it carries.
function pulseCurve(k, n = 1024) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = Math.pow(i / (n - 1), k);
  return curve;
}

function ringQ(f, decay) { return Math.PI * f * decay; }

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem(STORE_KEY) !== "off";
    this.revs = IDLE_RPM;
    this._onChange = () => {};

    // The graph cannot exist until a gesture, so wait for one.
    const wake = () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
      this._build();
    };
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
  }

  onChange(fn) { this._onChange = fn; }

  get ready() { return this.ctx != null; }

  setEnabled(on) {
    this.enabled = on;
    localStorage.setItem(STORE_KEY, on ? "on" : "off");
    if (this.ctx) {
      if (on) this.ctx.resume();
      this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
    }
    this._onChange(on);
  }

  toggle() { this.setEnabled(!this.enabled); }

  _build() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 1 : 0;
    this.master.connect(ctx.destination);

    // Two seconds of white noise, looped. Both voices draw on it.
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // ---- water -------------------------------------------------------------
    this.surfNoise = ctx.createBufferSource();
    this.surfNoise.buffer = buf;
    this.surfNoise.loop = true;
    this.surfFilter = ctx.createBiquadFilter();
    this.surfFilter.type = "lowpass";
    this.surfFilter.frequency.value = 500;
    this.surfGain = ctx.createGain();
    this.surfGain.gain.value = 0;
    this.surfNoise.connect(this.surfFilter).connect(this.surfGain).connect(this.master);

    // Sets: slow, always running, and nothing to do with the reading.
    this.setDepths = [];
    for (const seconds of SET_PERIOD_S) {
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 1 / seconds;
      const depth = ctx.createGain();
      depth.gain.value = 0;
      lfo.connect(depth).connect(this.surfGain.gain);
      lfo.start();
      this.setDepths.push(depth);
    }

    // Waves: the beat on top, at whatever period the water is running at now.
    this.waveLfos = [];
    this.waveDepths = [];
    for (const ratio of WAVE_RATIOS) {
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = ratio / 5;
      const depth = ctx.createGain();
      depth.gain.value = 0;
      lfo.connect(depth).connect(this.surfGain.gain);
      lfo.start();
      this.waveLfos.push({ lfo, ratio });
      this.waveDepths.push(depth);
    }

    // ---- wind --------------------------------------------------------------
    this.windNoise = ctx.createBufferSource();
    this.windNoise.buffer = buf;
    this.windNoise.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = WIND_BAND_HZ[0];
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windNoise.connect(this.windFilter).connect(this.windGain).connect(this.master);
    // Wind is not steady. A slow wander on the level is the difference between
    // weather and a hiss.
    this.gustLfo = ctx.createOscillator();
    this.gustLfo.type = "sine";
    this.gustLfo.frequency.value = 0.09;
    this.gustDepth = ctx.createGain();
    this.gustDepth.gain.value = 0;
    this.gustLfo.connect(this.gustDepth).connect(this.windGain.gain);
    this.gustLfo.start();
    this.windNoise.start();

    // ---- rain --------------------------------------------------------------
    this.rainNoise = ctx.createBufferSource();
    this.rainNoise.buffer = buf;
    this.rainNoise.loop = true;
    this.rainFilter = ctx.createBiquadFilter();
    this.rainFilter.type = "highpass";
    this.rainFilter.frequency.value = RAIN_HP_HZ[0];
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.rainNoise.connect(this.rainFilter).connect(this.rainGain).connect(this.master);
    this.rainNoise.start();
    // The grains in it, struck one at a time like the halyards.
    this.dropGain = ctx.createGain();
    this.dropGain.gain.value = 0;
    this.dropGain.connect(this.master);
    this.dropDue = 0;

    // ---- gulls -------------------------------------------------------------
    this.gullGain = ctx.createGain();
    this.gullGain.gain.value = 0.5;
    this.gullGain.connect(this.master);
    this.gullDue = GULL_EVERY_S[0];

    // ---- halyards ----------------------------------------------------------
    // No source of its own: each tap is made when it is struck and thrown away.
    this.halyardGain = ctx.createGain();
    this.halyardGain.gain.value = 0;
    this.halyardGain.connect(this.master);
    this.halyardNoise = buf;
    this.halyardDue = 0;
    this.halyardRate = 0;

    // ---- engine ------------------------------------------------------------
    const idleFire = IDLE_RPM * FIRINGS_PER_REV / 60;

    // The exhaust, under water, and the level. Everything ends up here.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = DROWNED_HZ;
    this.engineFilter.Q.value = 0.7;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(this.master);

    // Saw -> waveshaper is the pulse train. One bang per firing.
    this.fire = ctx.createOscillator();
    this.fire.type = "sawtooth";
    this.fire.frequency.value = idleFire;
    this.pulse = ctx.createWaveShaper();
    this.pulse.curve = pulseCurve(PULSE_SHARPNESS);
    this.pulse.oversample = "4x";
    this.fire.connect(this.pulse);
    this.fire.start();

    // Revs wander. A motor held to the sample is the giveaway that it is not one.
    this.hunt = [];
    for (const h of HUNT) {
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = h.hz;
      const depth = ctx.createGain();
      depth.gain.value = idleFire * h.depth;
      lfo.connect(depth).connect(this.fire.frequency);
      lfo.start();
      this.hunt.push({ depth, fraction: h.depth });
    }

    // The bangs ring the motor. Fixed frequencies, so the motor keeps its own
    // voice as the revs climb.
    for (const r of RING) {
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = r.f;
      band.Q.value = ringQ(r.f, r.decay);
      const g = ctx.createGain();
      g.gain.value = r.gain * PULSE_DRIVE;
      this.pulse.connect(band).connect(g).connect(this.engineFilter);

      // A puff of gas with each bang, gated by the pulse, rung by the same bank.
      const gate = ctx.createGain();
      gate.gain.value = 0;               // driven entirely by the pulse
      const level = ctx.createGain();
      level.gain.value = CHUFF;
      this.pulse.connect(level).connect(gate.gain);
      const chuff = ctx.createBufferSource();
      chuff.buffer = buf;
      chuff.loop = true;
      chuff.connect(gate).connect(band);
      chuff.start();
    }

    this.surfNoise.start();
    if (this.enabled) ctx.resume();
    this._onChange(this.enabled);
  }

  // One halyard against one mast: a struck ring that dies in a tenth of a
  // second. Made, played and dropped, which is cheaper than it sounds and is
  // the only way three hundred of them stay uncorrelated.
  _tap() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const f = HALYARD_RING[0] + Math.random() * (HALYARD_RING[1] - HALYARD_RING[0]);
    const decay = HALYARD_DECAY[0] + Math.random() * (HALYARD_DECAY[1] - HALYARD_DECAY[0]);
    const src = ctx.createBufferSource();
    src.buffer = this.halyardNoise;
    src.loop = true;
    // A narrow band on noise is a ring; the Q sets how long it hangs on.
    const ring = ctx.createBiquadFilter();
    ring.type = "bandpass";
    ring.frequency.value = f;
    ring.Q.value = ringQ(f, decay);
    const hit = ctx.createGain();
    hit.gain.setValueAtTime(0, now);
    hit.gain.linearRampToValueAtTime(0.7 + Math.random() * 0.3, now + 0.002);
    hit.gain.exponentialRampToValueAtTime(0.0008, now + decay);
    src.connect(ring).connect(hit).connect(this.halyardGain);
    src.start(now);
    src.stop(now + decay + 0.02);
  }

  // One drop on something hard: the halyard trick at an eighth of the length.
  _drop() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const f = RAIN_DROP_HZ[0] + Math.random() * (RAIN_DROP_HZ[1] - RAIN_DROP_HZ[0]);
    const decay = 0.012 + Math.random() * 0.02;
    const src = ctx.createBufferSource();
    src.buffer = this.halyardNoise;
    src.loop = true;
    const ring = ctx.createBiquadFilter();
    ring.type = "bandpass";
    ring.frequency.value = f;
    ring.Q.value = ringQ(f, decay);
    const hit = ctx.createGain();
    hit.gain.setValueAtTime(0, now);
    hit.gain.linearRampToValueAtTime(0.5 + Math.random() * 0.5, now + 0.001);
    hit.gain.exponentialRampToValueAtTime(0.0008, now + decay);
    src.connect(ring).connect(hit).connect(this.dropGain);
    src.start(now);
    src.stop(now + decay + 0.02);
  }

  // One gull. Three or four harsh notes, each falling in pitch, each shorter
  // and quieter than the one before as the bird runs out of breath.
  _gull(level) {
    const ctx = this.ctx;
    let at = ctx.currentTime + 0.05;
    const notes = GULL_NOTES[0]
      + Math.floor(Math.random() * (GULL_NOTES[1] - GULL_NOTES[0] + 1));
    const top = GULL_NOTE_HZ[0] * (0.85 + Math.random() * 0.3);
    for (let n = 0; n < notes; n++) {
      const fade = Math.pow(0.82, n);
      const length = (0.20 + Math.random() * 0.10) * fade;
      const osc = ctx.createOscillator();
      // A saw through a narrow band is the harshness. A sine is a whistle.
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(top * fade, at);
      osc.frequency.exponentialRampToValueAtTime(GULL_NOTE_HZ[1] * fade, at + length);
      const throat = ctx.createBiquadFilter();
      throat.type = "bandpass";
      throat.frequency.value = 1100;
      throat.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(level * 0.5 * fade, at + 0.02);
      g.gain.setValueAtTime(level * 0.5 * fade, at + length * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0006, at + length);
      osc.connect(throat).connect(g).connect(this.gullGain);
      osc.start(at);
      osc.stop(at + length + 0.02);
      at += length + 0.06 + Math.random() * 0.05;
    }
  }

  // s: { waveHeightM, wavePeriodS, swellPeriodS, waterDistanceM,
  //      listenerHeightM, windSpeedMps, marinaDistanceM, precipitationMm,
  //      dayFactor, boat: { throttle, speed, planing, maxSpeed } | null }
  update(dt, s) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const at = (param, v, tau = 0.15) => param.setTargetAtTime(v, now, tau);

    // ---- water -------------------------------------------------------------
    const h = clamp(s.waveHeightM != null ? s.waveHeightM : 0.2, 0.05, 4);
    // Slant range: climbing the bluff or flying off should quieten the sea the
    // same way walking inland does.
    const range = Math.hypot(s.waterDistanceM, Math.max(0, s.listenerHeightM));
    const near = 1 / (1 + range / WATER_REF_M);
    const level = clamp(0.16 * Math.pow(h / 0.5, 0.7) * near, 0, 0.5);
    at(this.surfGain.gain, level, 0.4);
    at(this.surfFilter.frequency, 260 + 420 * clamp(h / 2, 0, 1), 0.4);

    // Sets run whatever the sea is doing.
    for (let i = 0; i < this.setDepths.length; i++) {
      at(this.setDepths[i].gain, level * SET_DEPTH[i], 0.6);
    }

    // The beat runs at the period the station is reporting. Where there is a
    // long swell under the chop it is the swell that breaks, so the beat takes
    // the longer of the two. A short sea is not slowed down to sound better. It
    // has no beat to hear and the depth goes to nothing.
    const chop = s.wavePeriodS != null ? s.wavePeriodS : 3;
    const swell = s.swellPeriodS != null ? s.swellPeriodS : 0;
    const period = clamp(Math.max(chop, swell), 1.2, 22);
    const heard = clamp((period - WAVE_HEARD_S[0])
      / (WAVE_HEARD_S[1] - WAVE_HEARD_S[0]), 0, 1);
    for (let i = 0; i < this.waveLfos.length; i++) {
      at(this.waveLfos[i].lfo.frequency, this.waveLfos[i].ratio / period, 0.8);
      at(this.waveDepths[i].gain, level * WAVE_DEPTH * heard * [1, 0.55][i], 0.6);
    }

    // ---- wind --------------------------------------------------------------
    const wind = clamp(s.windSpeedMps != null ? s.windSpeedMps : 0, 0, 25);
    const blow = clamp((wind - HALYARD_WIND[0]) / (HALYARD_WIND[1] - HALYARD_WIND[0]), 0, 1);
    // Higher and barer is windier. On the beach the bank takes it off you.
    const exposure = clamp(Math.max(0, s.listenerHeightM) / WIND_HEIGHT_M, 0.25, 1);
    const windLevel = (WIND_GAIN[0] + (WIND_GAIN[1] - WIND_GAIN[0]) * Math.pow(blow, 0.8))
      * exposure;
    at(this.windGain.gain, windLevel, 0.6);
    at(this.windFilter.frequency,
      WIND_BAND_HZ[0] + (WIND_BAND_HZ[1] - WIND_BAND_HZ[0]) * blow, 0.6);
    at(this.gustDepth.gain, windLevel * 0.5, 0.6);

    // ---- halyards ----------------------------------------------------------
    // Only near the basin, and only when there is wind to move them.
    const toMarina = s.marinaDistanceM != null ? s.marinaDistanceM : Infinity;
    const nearBasin = 1 / (1 + toMarina / MARINA_REF_M);
    const halyardLevel = clamp(0.22 * nearBasin * Math.pow(blow, 0.5), 0, 0.3);
    at(this.halyardGain.gain, halyardLevel, 0.5);
    this.halyardRate = (HALYARD_HZ[0] + (HALYARD_HZ[1] - HALYARD_HZ[0]) * blow)
      * (toMarina < MARINA_REF_M * 4 ? 1 : 0);
    if (halyardLevel > 0.004 && this.halyardRate > 0) {
      this.halyardDue -= dt * this.halyardRate;
      // Poisson rather than a metronome: they do not knock in time.
      let guard = 0;
      while (this.halyardDue <= 0 && guard++ < 8) {
        this._tap();
        this.halyardDue += -Math.log(1 - Math.random());
      }
    }

    // ---- rain ----------------------------------------------------------------
    const mm = clamp(s.precipitationMm != null ? s.precipitationMm : 0, 0, 20);
    const hard = mm <= RAIN_MM[0] ? 0
      : clamp((mm - RAIN_MM[0]) / (RAIN_MM[1] - RAIN_MM[0]), 0, 1);
    at(this.rainGain.gain,
      RAIN_GAIN[0] + (RAIN_GAIN[1] - RAIN_GAIN[0]) * Math.pow(hard, 0.6), 0.8);
    at(this.rainFilter.frequency,
      RAIN_HP_HZ[0] + (RAIN_HP_HZ[1] - RAIN_HP_HZ[0]) * hard, 0.8);
    at(this.dropGain.gain, 0.05 * hard, 0.8);
    if (hard > 0.01) {
      this.dropDue -= dt * RAIN_DROPS_HZ * hard;
      let guard = 0;
      while (this.dropDue <= 0 && guard++ < 12) {
        this._drop();
        this.dropDue += -Math.log(1 - Math.random());
      }
    }

    // ---- gulls ---------------------------------------------------------------
    // Near the water, sparsely, and quiet in the dark.
    const nearWater = 1 / (1 + range / GULL_REF_M);
    const day = s.dayFactor != null ? clamp(s.dayFactor, 0, 1) : 1;
    const gullLevel = clamp(nearWater * day, 0, 1);
    if (gullLevel > 0.08) {
      const every = GULL_EVERY_S[1] + (GULL_EVERY_S[0] - GULL_EVERY_S[1]) * gullLevel;
      this.gullDue -= dt;
      if (this.gullDue <= 0) {
        this._gull(gullLevel);
        // Poisson again. They do not call to a clock.
        this.gullDue = every * (0.4 + -Math.log(1 - Math.random()));
      }
    }

    // ---- engine ------------------------------------------------------------
    const b = s.boat;
    if (!b) {
      at(this.engineGain.gain, 0, 0.25);
      this.revs += (IDLE_RPM - this.revs) * (1 - Math.exp(-dt / 1.0));
      return;
    }
    // Revs lead the hull. The throttle sets where they want to be, the load
    // through the hump drags them back down, and they get there in a third of a
    // second while the boat itself takes twelve.
    const wanted = IDLE_RPM + b.throttle * (MAX_RPM - IDLE_RPM);
    const hump = clamp(b.speed / (b.maxSpeed * 0.82), 0, 1);
    const sag = LOAD_SAG_RPM * b.throttle * hump * (1 - b.planing);
    this.revs += ((wanted - sag) - this.revs) * (1 - Math.exp(-dt / REV_TAU));

    const fire = this.revs * FIRINGS_PER_REV / 60;
    at(this.fire.frequency, fire, 0.06);
    // The wander is a fraction of the revs, so it stays proportional.
    for (const h of this.hunt) at(h.depth.gain, fire * h.fraction, 0.06);

    const open = clamp((this.revs - IDLE_RPM) / (MAX_RPM - IDLE_RPM), 0, 1);
    // Coming onto plane lifts the leg and the exhaust with it, so the muffling
    // lets go and the bark comes out. Throttle alone does a little of this.
    const lift = clamp(0.35 * open + 0.65 * b.planing, 0, 1);
    at(this.engineFilter.frequency, DROWNED_HZ + (OPEN_HZ - DROWNED_HZ) * lift, 0.1);
    at(this.engineGain.gain,
      ENGINE_GAIN[0] + (ENGINE_GAIN[1] - ENGINE_GAIN[0]) * open, 0.1);
  }
}
