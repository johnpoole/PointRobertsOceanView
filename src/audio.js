// Sound, synthesised rather than sampled. Two voices:
//
//   water  - always on, filtered noise driven by the real sea state and how far
//            away the water actually is at the current tide.
//   engine - boat mode only, a two-stroke outboard: one bang per firing, into
//            fixed resonances, at a rate that follows engine revs rather than
//            boat speed.
//
// Nothing is loaded from disk. Both voices are a handful of oscillators and a
// noise buffer, which costs nothing in payload and, more to the point, lets the
// sound follow state the app already computes instead of looping a clip.
//
// Browsers will not start audio until the page has been interacted with, so the
// graph is not built until the first click or keypress. Before that it is
// silent, deliberately: there is no way to make noise sooner.

const STORE_KEY = "oceanview.sound";

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
// Two motors here to pick between. Add ?motor=bright to the address to get the
// second one. When one is chosen the other goes.
//
//   firings   per crank revolution. A twin fires twice, a single once, and it
//             sets the pitch: rpm/30 against rpm/60, an octave apart.
//   sharpness how narrow the bang is. The pulse fills about ln(2)/k of a cycle.
//   drive     makes back the energy a narrow pulse loses against a full
//             waveform, so the motor is not buried under the surf.
//   ring      where it rings, how long it rings, how loud. Q is pi*f*decay.
//   crank     mechanical buzz at the firing rate and its first two harmonics,
//             each with its own level and phase.
//   hiss      broadband engine clatter, continuous, at unit level.
//   chuff     noise gated by the pulse — a puff of gas with each bang.
//   wash      prop wash under the boat. Its level wanders between floor and 1
//             at gurgleHz, which is what bubbles sound like from above.
//   drown     lowpass in hertz with the leg in the water, and lifted out on
//             plane. The exhaust exits through the prop hub, under water.
//   squash    tanh drive. Nothing above zero leaves it undistorted.
//   gain      overall, at idle and wide open.
const MOTORS = {
  deep: {
    firings: 1, sharpness: 20, drive: 10,
    ring: [
      { f: 72, decay: 0.035, gain: 1.00 },
      { f: 138, decay: 0.025, gain: 0.58 },
      { f: 285, decay: 0.016, gain: 0.26 },
    ],
    crank: [
      { level: 0.25, phase: 0 },
      { level: 0.16, phase: 0.4 },
      { level: 0.08, phase: 1.1 },
    ],
    hiss: { f: 570, q: 1.4, level: 0.11 },
    chuff: 0,
    wash: { f: 96, q: 0.65, floor: 0.30, gurgleHz: 18 },
    mix: { ring: [0.74, 0.96], crank: [0.17, 0.39], wash: [0.15, 0.35] },
    drown: [900, 3200], squash: 1.45, gain: [0.09, 0.32],
  },
  bright: {
    firings: 2, sharpness: 10, drive: 15,
    ring: [
      { f: 190, decay: 0.0151, gain: 1.00 },
      { f: 430, decay: 0.0052, gain: 0.55 },
      { f: 1150, decay: 0.0014, gain: 0.28 },
    ],
    crank: null, hiss: null,
    chuff: 0.9,
    wash: null,
    mix: { ring: [1, 1], crank: [0, 0], wash: [0, 0] },
    drown: [900, 3200], squash: 0, gain: [0.05, 0.21],
  },
};

const params = new URLSearchParams(window.location.search);
const MOTOR = MOTORS[params.get("motor")] || MOTORS.deep;

// The revs the mix is written against: full brightness by 3250, which is where
// a 4.5 is working hard.
const MIX_FLOOR_RPM = 850;
const MIX_SPAN_RPM = 2400;

// Small engines never hold their revs. Two slow wanders and a slow random one,
// as a fraction of the firing rate.
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

// Soft clip, the way a real exhaust runs out of room. A waveshaper only sees
// -1..1, so the signal is scaled down by RANGE going in and the curve undoes it.
const SQUASH_RANGE = 3;
function squashCurve(drive, n = 1024) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * u * SQUASH_RANGE);
  }
  return curve;
}

// A resonator that dies away in `decay` seconds is a bandpass of Q = pi f decay.
function ringQ(f, decay) { return Math.PI * f * decay; }

// White noise comes out of a filter far quieter than it went in, by an amount
// that depends on how narrow the filter is. The buffer is uniform noise, so its
// variance is 1/3 spread flat over half the sample rate, and what survives a
// filter passing B hertz is sqrt(B/3 / (SR/2)). Undoing that is what lets the
// levels below be the levels they say they are.
const bandWidthHz = (f, q) => Math.PI * f / (2 * q);
const lowWidthHz = (f) => Math.PI * f / 2;
function noiseGain(widthHz, sampleRate) {
  return Math.sqrt((sampleRate / 2) * 3 / widthHz);
}
// The gurgle is a slow wander, and three standard deviations covers it.
const GURGLE_SIGMA = 3;

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

    // One breaker at a time, at the real wave period, so a long swell sounds
    // like a long swell rather than hiss.
    this.swellLfo = ctx.createOscillator();
    this.swellLfo.type = "sine";
    this.swellLfo.frequency.value = 0.2;
    this.swellDepth = ctx.createGain();
    this.swellDepth.gain.value = 0;
    this.swellLfo.connect(this.swellDepth).connect(this.surfGain.gain);

    // ---- engine ------------------------------------------------------------
    const m = MOTOR;
    const noise = () => {
      const n = ctx.createBufferSource();
      n.buffer = buf;
      n.loop = true;
      n.start();
      return n;
    };
    const idleFire = IDLE_RPM * m.firings / 60;

    // The exhaust, under water, and the level. Everything ends up here.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = m.drown[0];
    this.engineFilter.Q.value = 0.7;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;

    // Soft clip before the exhaust, or straight through if the motor wants none.
    let sum = this.engineFilter;
    if (m.squash > 0) {
      const trim = ctx.createGain();
      trim.gain.value = 1 / SQUASH_RANGE;
      const shaper = ctx.createWaveShaper();
      shaper.curve = squashCurve(m.squash);
      shaper.oversample = "4x";
      trim.connect(shaper).connect(this.engineFilter);
      sum = trim;
    }
    this.engineFilter.connect(this.engineGain).connect(this.master);

    // Saw -> waveshaper is the pulse train. One bang per firing.
    this.fire = ctx.createOscillator();
    this.fire.type = "sawtooth";
    this.fire.frequency.value = idleFire;
    this.pulse = ctx.createWaveShaper();
    this.pulse.curve = pulseCurve(m.sharpness);
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
    this.ringGain = ctx.createGain();
    this.ringGain.gain.value = m.mix.ring[0];
    this.ringGain.connect(sum);
    for (const r of m.ring) {
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = r.f;
      band.Q.value = ringQ(r.f, r.decay);
      const g = ctx.createGain();
      g.gain.value = r.gain * m.drive;
      this.pulse.connect(band).connect(g).connect(this.ringGain);

      // A puff of gas with each bang, gated by the pulse, rung by the same bank.
      if (m.chuff > 0) {
        const gate = ctx.createGain();
        gate.gain.value = 0;             // driven entirely by the pulse
        const level = ctx.createGain();
        level.gain.value = m.chuff;
        this.pulse.connect(level).connect(gate.gain);
        noise().connect(gate).connect(band);
      }
    }

    // Mechanical: the crank buzzing at the firing rate, plus steady clatter.
    if (m.crank || m.hiss) {
      this.crankGain = ctx.createGain();
      this.crankGain.gain.value = m.mix.crank[0];
      this.crankGain.connect(sum);
      if (m.crank) {
        // One oscillator carrying all the harmonics at their own levels and
        // phases. Web Audio builds a waveform from cosine and sine terms, so a
        // harmonic of level A at phase p is A sin p on one and A cos p on the
        // other.
        const real = new Float32Array(m.crank.length + 1);
        const imag = new Float32Array(m.crank.length + 1);
        m.crank.forEach((h, i) => {
          real[i + 1] = h.level * Math.sin(h.phase);
          imag[i + 1] = h.level * Math.cos(h.phase);
        });
        this.crankOsc = ctx.createOscillator();
        this.crankOsc.setPeriodicWave(ctx.createPeriodicWave(real, imag,
          { disableNormalization: true }));
        this.crankOsc.frequency.value = idleFire;
        this.crankOsc.connect(this.crankGain);
        this.crankOsc.start();
      }
      if (m.hiss) {
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = m.hiss.f;
        bp.Q.value = m.hiss.q;
        const g = ctx.createGain();
        g.gain.value = m.hiss.level
          * noiseGain(bandWidthHz(m.hiss.f, m.hiss.q), ctx.sampleRate);
        noise().connect(bp).connect(g).connect(this.crankGain);
      }
    }

    // Prop wash, gurgling under the boat. The gurgle is slow random noise on
    // the level, which is what bubbles sound like from above.
    if (m.wash) {
      this.washGain = ctx.createGain();
      this.washGain.gain.value = m.mix.wash[0];
      this.washGain.connect(sum);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = m.wash.f;
      bp.Q.value = m.wash.q;
      // The level swings between floor and 1, so it sits at the middle and the
      // gurgle carries it half the distance either way.
      const unit = noiseGain(bandWidthHz(m.wash.f, m.wash.q), ctx.sampleRate);
      const mid = (m.wash.floor + 1) / 2;
      const swing = (1 - m.wash.floor) / 2;
      const body = ctx.createGain();
      body.gain.value = mid * unit;
      noise().connect(bp).connect(body).connect(this.washGain);

      const gurgle = ctx.createBiquadFilter();
      gurgle.type = "lowpass";
      gurgle.frequency.value = m.wash.gurgleHz;
      const depth = ctx.createGain();
      depth.gain.value = swing * unit
        * noiseGain(lowWidthHz(m.wash.gurgleHz), ctx.sampleRate) / GURGLE_SIGMA;
      noise().connect(gurgle).connect(depth).connect(body.gain);
    }

    this.surfNoise.start();
    this.swellLfo.start();
    if (this.enabled) ctx.resume();
    this._onChange(this.enabled);
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
    at(this.swellDepth.gain, level * 0.7, 0.4);
    const period = clamp(s.wavePeriodS != null ? s.wavePeriodS : 5, 2, 14);
    at(this.swellLfo.frequency, 1 / period, 0.5);

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

    const m = MOTOR;
    const fire = this.revs * m.firings / 60;
    at(this.fire.frequency, fire, 0.06);
    // The wander is a fraction of the revs, so it stays proportional.
    for (const h of this.hunt) at(h.depth.gain, fire * h.fraction, 0.06);
    if (this.crankOsc) at(this.crankOsc.frequency, fire, 0.06);

    const open = clamp((this.revs - IDLE_RPM) / (MAX_RPM - IDLE_RPM), 0, 1);
    // Coming onto plane lifts the leg and the exhaust with it, so the muffling
    // lets go and the bark comes out. Throttle alone does a little of this.
    const lift = clamp(0.35 * open + 0.65 * b.planing, 0, 1);
    at(this.engineFilter.frequency, m.drown[0] + (m.drown[1] - m.drown[0]) * lift, 0.1);
    at(this.engineGain.gain, m.gain[0] + (m.gain[1] - m.gain[0]) * open, 0.1);

    // The mix leans on the exhaust at idle and lets the mechanical and the wash
    // in as it works.
    const load = clamp((this.revs - MIX_FLOOR_RPM) / MIX_SPAN_RPM, 0, 1);
    const blend = (g, pair) => { if (g) at(g.gain, pair[0] + (pair[1] - pair[0]) * load, 0.1); };
    blend(this.ringGain, m.mix.ring);
    blend(this.crankGain, m.mix.crank);
    blend(this.washGain, m.mix.wash);
  }
}
