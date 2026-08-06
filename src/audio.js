// Sound, synthesised rather than sampled. Two voices:
//
//   water  - always on, filtered noise driven by the real sea state and how far
//            away the water actually is at the current tide.
//   engine - boat mode only, a two-cylinder two-stroke: one bang per firing,
//            into fixed resonances, at a rate that follows engine revs rather
//            than boat speed.
//
// Nothing is loaded from disk. Both voices are a handful of oscillators and a
// noise buffer, which costs nothing in payload and, more to the point, lets the
// sound follow state the app already computes instead of looping a clip.
//
// Browsers will not start audio until the page has been interacted with, so the
// graph is not built until the first click or keypress. Before that it is
// silent, deliberately: there is no way to make noise sooner.

const STORE_KEY = "oceanview.sound";

// The Evinrude 4.5 is a two-cylinder two-stroke, 5.28 cubic inches, and the two
// fire 180 degrees apart. Two firings a revolution, so the rate in hertz is
// rpm/30 — 37 Hz at idle, 160 at full throttle.
const FIRINGS_PER_REV = 2;
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
// Sharpness sets how narrow the bang is. The pulse occupies about ln(2)/k of
// each cycle, so 10 gives 7 percent — a crack at idle that smears into a buzz
// as the firings crowd together.
const PULSE_SHARPNESS = 10;
// Where the motor rings, in hertz, with how sharply and how loud. Measured off
// nothing — these are the resonances of a small two-stroke and its leg, low
// thump, mid bark, and the tinny top that says aluminium.
const RESONANCES = [
  { f: 190, q: 9, gain: 1.00 },
  { f: 430, q: 7, gain: 0.55 },
  { f: 1150, q: 5, gain: 0.28 },
];
// The exhaust goes out through the prop hub, under water. That is what takes
// the edge off and makes it burble instead of crack, and it opens up as the
// leg comes closer to the surface on plane.
const EXHAUST_DROWNED_HZ = 900;
const EXHAUST_OPEN_HZ = 3200;
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
    // Saw -> waveshaper is the pulse train. One bang per firing.
    this.fire = ctx.createOscillator();
    this.fire.type = "sawtooth";
    this.fire.frequency.value = IDLE_RPM * FIRINGS_PER_REV / 60;
    this.pulse = ctx.createWaveShaper();
    this.pulse.curve = pulseCurve(PULSE_SHARPNESS);
    this.pulse.oversample = "4x";
    this.fire.connect(this.pulse);

    // Each bang also throws a puff of exhaust gas, so the same pulse gates
    // noise. This is most of what makes it read as an engine and not a buzzer.
    this.chuff = ctx.createBufferSource();
    this.chuff.buffer = buf;
    this.chuff.loop = true;
    this.chuffGate = ctx.createGain();
    this.chuffGate.gain.value = 0;             // driven entirely by the pulse
    this.chuffLevel = ctx.createGain();
    this.chuffLevel.gain.value = 0.9;
    this.pulse.connect(this.chuffLevel).connect(this.chuffGate.gain);
    this.chuff.connect(this.chuffGate);

    // The exhaust, under water. Everything passes through this.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = EXHAUST_DROWNED_HZ;
    this.engineFilter.Q.value = 0.7;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;

    // The bangs ring the motor. Fixed frequencies, so the motor keeps its own
    // voice as the revs climb.
    this.resonators = [];
    for (const r of RESONANCES) {
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = r.f;
      band.Q.value = r.q;
      const g = ctx.createGain();
      g.gain.value = r.gain;
      this.pulse.connect(band).connect(g).connect(this.engineFilter);
      this.chuffGate.connect(band);
      this.resonators.push(band);
    }
    this.engineFilter.connect(this.engineGain).connect(this.master);

    this.surfNoise.start();
    this.swellLfo.start();
    this.fire.start();
    this.chuff.start();
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

    const fire = this.revs * FIRINGS_PER_REV / 60;
    at(this.fire.frequency, fire, 0.06);
    const open = clamp((this.revs - IDLE_RPM) / (MAX_RPM - IDLE_RPM), 0, 1);
    // Coming onto plane lifts the leg and the exhaust with it, so the muffling
    // lets go and the bark comes out. Throttle alone does a little of this.
    const lift = clamp(0.35 * open + 0.65 * b.planing, 0, 1);
    at(this.engineFilter.frequency,
      EXHAUST_DROWNED_HZ + (EXHAUST_OPEN_HZ - EXHAUST_DROWNED_HZ) * lift, 0.1);
    at(this.engineGain.gain, 0.05 + 0.16 * open, 0.1);
  }
}
