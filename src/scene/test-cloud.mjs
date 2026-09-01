// The cloud field, checked for the one thing that cannot be seen by looking.
//
// Run:
//     node src/scene/test-cloud.mjs
//
// Plain asserts and a non-zero exit, the same as the rest of the tests here.
//
// A shader cannot be read from the processor and this machine rasters a frame in
// minutes, so the only way to find out how much of the sky a threshold covers
// was to deploy it and look. That was done four times and got it wrong four
// times: the field is not as wide as it looks like it ought to be, the threshold
// sat a third of the way up it, and the sky came out nearly clear when the feed
// said a third covered.
//
// So the field is written out again here and measured. What is checked is the
// only thing that matters and the only thing guessing got wrong — that when the
// feed says a third of the sky is under cloud, a third of it comes out under
// cloud.
//
// THIS IS A COPY. The functions below are the GLSL in sky.js written in
// JavaScript, and if that shader changes this has to change with it. There is no
// way to share them: one runs on the card and the other cannot get at it.
//
// Every step is forced to 32-bit. The hash runs its products up into the
// thousands, and what fract() hands back there depends on how wide the float is.
const f = Math.fround;
const fract = (x) => f(x - Math.floor(x));

function chash(px, py) {
  let x = fract(f(px * 127.31)), y = fract(f(py * 311.7));
  const d = f(f(x * f(y + 41.73)) + f(y * f(x + 41.73)));
  x = f(x + d); y = f(y + d);
  return fract(f(f(x * y) * 2.17));
}

function cnoise(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py);
  let fx = f(px - ix), fy = f(py - iy);
  fx = f(fx * fx * f(3 - 2 * fx));
  fy = f(fy * fy * f(3 - 2 * fy));
  const a = chash(ix, iy), b = chash(ix + 1, iy);
  const c = chash(ix, iy + 1), d = chash(ix + 1, iy + 1);
  const lo = f(a + fx * (b - a)), hi = f(c + fx * (d - c));
  return f(lo + fy * f(hi - lo));
}

const smoothstep = (e0, e1, x) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

function cfbm(wx, wy, coarsest, h, t) {
  let v = 0, norm = 0, cell = coarsest;
  for (let i = 0; i < 8; i++) {
    const stands = smoothstep(0.0012, 0.005, (cell * h) / (t * t));
    const fits = smoothstep(2.0, 0.6, cell / t);
    const w = stands * fits;
    v += cnoise(wx / cell, wy / cell) * w;
    norm += w;
    cell *= 0.5;
  }
  return norm > 0 ? v / norm : 0.5;
}

const EARTH_R = 6371000;
function cloudAt(dx, dy, dz, h) {
  const t = Math.sqrt(EARTH_R * EARTH_R * dy * dy + 2 * EARTH_R * h + h * h) - EARTH_R * dy;
  return [dx * t, dz * t, Math.max(Math.hypot(dx * t, dz * t), h)];
}

// The one in sky.js, and the whole point of this file.
const cover = (fraction) => {
  const c = Math.min(Math.max(fraction, 0.005), 0.995);
  return 0.465 - 0.0476 * Math.log(c / (1 - c));
};

const SQUASH = 0.7;   // the downwind squash in sky.js
const LAYERS = [["high cloud", 64000, 9000], ["the deck", 32000, 1500]];

// The half of the sky the house looks at: west, from the horizon up to sixty.
function field(coarsest, h) {
  const out = [];
  for (let ai = 0; ai < 90; ai++) {
    const az = (200 + (ai / 89) * 140) * Math.PI / 180;
    for (let ei = 0; ei < 90; ei++) {
      const el = (0.4 + (ei / 89) * 60) * Math.PI / 180;
      const ch = Math.cos(el);
      const [px, py, t] = cloudAt(Math.sin(az) * ch, Math.sin(el), -Math.cos(az) * ch, h);
      out.push(cfbm(px, py * SQUASH, coarsest, h, t));
    }
  }
  return out;
}

let failures = 0;
function ok(cond, what) {
  if (cond) return;
  failures++;
  console.error("FAIL " + what);
}

for (const [name, coarsest, h] of LAYERS) {
  const a = field(coarsest, h);
  const covered = (thr) => a.filter((v) => v > thr).length / a.length;

  // What the feed says is under cloud is what comes out under cloud. A tenth
  // either way: nobody can see a tenth, and the threshold is a straight line
  // through a curve that is only nearly straight.
  for (const want of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const got = covered(cover(want));
    ok(Math.abs(got - want) < 0.10,
       `${name}: the feed says ${(want * 100).toFixed(0)}% and ` +
       `${(got * 100).toFixed(0)}% comes out covered`);
  }

  // A clear sky is clear and a shut one is shut. Neither end may be a haze of
  // half-cloud, which is what a threshold in the middle of the field gives.
  ok(covered(cover(0)) < 0.06, `${name}: nothing said is nearly nothing drawn`);
  ok(covered(cover(1)) > 0.94, `${name}: overcast is overcast`);

  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  const sd = Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length);
  // The thickness ramp in sky.js runs over a tenth. If the field were much
  // wider than that every cloud would be all rim and no body, which is what it
  // was, and which is invisible against a bright sky.
  ok(sd > 0.05 && sd < 0.12,
     `${name}: the field is ${sd.toFixed(3)} wide, and the ramps in sky.js ` +
     `are cut for a field about eight hundredths wide`);

  console.log(`ok   ${name}: mean ${mean.toFixed(3)}, ${sd.toFixed(3)} wide, ` +
              `cover ` + [0.1, 0.5, 0.9].map(
                (c) => `${c}->${covered(cover(c)).toFixed(2)}`).join(" "));
}

console.log(failures ? `\n${failures} failed` : "\ncloud ok");
process.exit(failures ? 1 : 0);
