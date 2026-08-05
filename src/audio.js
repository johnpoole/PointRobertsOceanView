// Sound, synthesised rather than sampled. Two voices:
//
//   water  - always on, filtered noise driven by the real sea state and how far
//            away the water actually is at the current tide.
//   engine - boat mode only, a single-cylinder two-stroke whose note follows
//            engine revs, not boat speed.
//
// Nothing is loaded from disk. Both voices are a handful of oscillators and a
// noise buffer, which costs nothing in payload and, more to the point, lets the
// sound follow state the app already computes instead of looping a clip.
//
// Browsers will not start audio until the page has been interacted with, so the
// graph is not built until the first click or keypress. Before that it is
// silent, deliberately: there is no way to make noise sooner.

const STORE_KEY = "oceanview.sound";

// A 4.5 hp outboard is a single-cylinder two-stroke, so it fires once per
// revolution and the firing rate in hertz is just rpm/60 — 18 Hz at idle, 87 at
// full throttle. The note we hear is the harmonics of that, which is why a
// sawtooth through a lowpass sounds right and a sine does not.
const IDLE_RPM = 1100;
const MAX_RPM = 5200;
// Revs sag as the hull pushes against its own bow wave, then pick up as it comes
// onto plane and the load falls away.
const LOAD_SAG_RPM = 700;
const REV_TAU = 0.35;      // s — revs answer the throttle far quicker than the hull

// How the water fades with range. Falls off as 1/(1 + d/REF), which keeps the
// beach loud and the strait audible from the bluff without going silent.
const WATER_REF_M = 70;

function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }

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
    this.fire = ctx.createOscillator();      // the firing frequency itself
    this.fire.type = "sawtooth";
    this.fire.frequency.value = IDLE_RPM / 60;
    this.buzz = ctx.createOscillator();      // an octave up, slightly out
    this.buzz.type = "sawtooth";
    this.buzz.frequency.value = IDLE_RPM / 30;
    this.buzz.detune.value = 14;
    this.buzzGain = ctx.createGain();
    this.buzzGain.gain.value = 0.35;

    this.combustion = ctx.createBufferSource();
    this.combustion.buffer = buf;
    this.combustion.loop = true;
    this.combustionGain = ctx.createGain();
    this.combustionGain.gain.value = 0.06;

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 700;
    this.engineFilter.Q.value = 4;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;

    this.fire.connect(this.engineFilter);
    this.buzz.connect(this.buzzGain).connect(this.engineFilter);
    this.combustion.connect(this.combustionGain).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);

    this.surfNoise.start();
    this.swellLfo.start();
    this.fire.start();
    this.buzz.start();
    this.combustion.start();
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

    const fire = this.revs / 60;
    at(this.fire.frequency, fire, 0.06);
    at(this.buzz.frequency, fire * 2, 0.06);
    const open = clamp((this.revs - IDLE_RPM) / (MAX_RPM - IDLE_RPM), 0, 1);
    at(this.engineFilter.frequency, 420 + 2600 * open, 0.1);
    at(this.engineGain.gain, 0.05 + 0.16 * open, 0.1);
  }
}
