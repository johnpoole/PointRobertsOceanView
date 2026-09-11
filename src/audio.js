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
// Three slow sines at rates with no common multiple. Their sum wanders forever
// instead of repeating, so sets build and there are lulls between them.
const SWELL_RATIOS = [1, 0.61, 0.37];

// What the ear hears break on a beach is not the wind chop the station counts.
// A 2.5 second period is a wash, not a beat, so the audible rhythm is held to
// this range however short the reading is.
const SWELL_PERIOD_S = [7, 17];

// And a short-period sea barely pulses at all: the depth of the rhythm follows
// how long the swell is, from a flat wash to distinct breakers.
const SWELL_DEPTH = [0.18, 0.85];

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

    // The rhythm of the water. One sine at the wave period was a metronome: with
    // the station reporting a two and a half second chop it ticked twice a
    // second, forever, which is the one thing the sea never does.
    //
    // Three sines instead, at rates that share no common multiple, summed. The
    // envelope never repeats, sets build and fade, and there are lulls — which
    // is what a beach actually sounds like.
    this.swellLfos = [];
    this.swellDepths = [];
    for (const ratio of SWELL_RATIOS) {
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.1 * ratio;
      const depth = ctx.createGain();
      depth.gain.value = 0;
      lfo.connect(depth).connect(this.surfGain.gain);
      lfo.start();
      this.swellLfos.push({ lfo, ratio });
      this.swellDepths.push(depth);
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

  // s: { waveHeightM, wavePeriodS, waterDistanceM, listenerHeightM,
  //      boat: { throttle, speed, planing, maxSpeed } | null }
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

    // The reading is the wind chop. What breaks on a beach is slower than that,
    // so it is stretched into a rhythm an ear reads as water rather than as a
    // tick, and the longer the swell the more it is a beat rather than a wash.
    const reading = clamp(s.wavePeriodS != null ? s.wavePeriodS : 5, 2, 20);
    const longness = clamp((reading - 2) / 10, 0, 1);
    const period = SWELL_PERIOD_S[0] + (SWELL_PERIOD_S[1] - SWELL_PERIOD_S[0]) * longness;
    const depth = SWELL_DEPTH[0] + (SWELL_DEPTH[1] - SWELL_DEPTH[0]) * longness;
    for (let i = 0; i < this.swellLfos.length; i++) {
      at(this.swellLfos[i].lfo.frequency, this.swellLfos[i].ratio / period, 0.8);
      // The first carries the set, the others take less and less.
      at(this.swellDepths[i].gain, level * depth * [0.55, 0.3, 0.15][i], 0.6);
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
