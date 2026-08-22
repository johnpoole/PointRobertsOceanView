// The sky, checked against the paper and against what a sunset does.
//
// Run:
//     node src/scene/test-sky.mjs
//
// Plain asserts and a non-zero exit, the same as the rest of the tests here.
//
// A sky model is the easiest thing in this project to get wrong and never find
// out about, because whatever it draws is a plausible blue smear and the only
// way to look at it is to raster a frame, which takes minutes on this machine.
// So the terms are checked against the closed forms Preetham gives, and then the
// whole thing is checked against the handful of things everybody already knows
// about the sky: it is blue overhead at noon, it is not grey when the sun goes
// down, smoke makes it redder, overcast takes the colour out of it, and it gets
// dark afterwards.
//
// The project has no package.json, so node reads a .js file as CommonJS and an
// import statement inside one is a syntax error. skylight.js is read and handed
// to node as a data URL, which is the same trick the other tests here use. It
// imports nothing itself, so there is no graph to rewrite.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, "skylight.js"), "utf8");
const S = await import(
  "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"));

let failures = 0;
function ok(cond, what) {
  if (cond) return;
  failures++;
  console.error("FAIL " + what);
}
function near(got, want, tol, what) {
  ok(Math.abs(got - want) <= tol, `${what}: ${got} is not within ${tol} of ${want}`);
}

// A world direction from a compass azimuth and an elevation, the same axes the
// scene uses: +X east, +Y up, +Z south.
function dirOf(azDeg, elDeg) {
  const az = azDeg * Math.PI / 180, el = elDeg * Math.PI / 180, h = Math.cos(el);
  return [Math.sin(az) * h, Math.sin(el), -Math.cos(az) * h];
}
const WEST = 270, EAST = 90;
const warmth = ([r, , b]) => r - b;         // how far off neutral, toward the red
const spread = (c) => Math.max(...c) - Math.min(...c);

// ---- turbidity out of the aerosol reading -----------------------------------
// Preetham turbidity is (molecular + haze) / molecular. One Rayleigh depth of
// haze is therefore exactly two.
near(S.turbidityFromAerosol(S.RAYLEIGH_TAU_550), 2, 1e-9, "one Rayleigh depth of haze is turbidity 2");
near(S.turbidityFromAerosol(0), 1.8, 1e-9, "clean air is held at the bottom of the fitted range");
near(S.turbidityFromAerosol(5), 10, 1e-9, "thick smoke is held at the top of the fitted range");
ok(S.turbidityFromAerosol(null) === null, "no aerosol reading gives no turbidity");
ok(S.turbidityFromAerosol(NaN) === null, "a broken aerosol reading gives no turbidity");
// The reading Open-Meteo gave for this point on a clear August day.
const clearDay = S.turbidityFromAerosol(0.13);
ok(clearDay > 2.2 && clearDay < 2.5, `a clear coastal day is a low turbidity: ${clearDay}`);

// ---- the terms, each against Preetham ---------------------------------------
// The coefficients are linear in turbidity, appendix A.2. Two of them by hand.
const p = S.perezCoefficients(4);
near(p.A[0], 0.1787 * 4 - 1.4630, 1e-12, "Perez A for luminance");
near(p.D[2], -0.0441 * 4 - 1.6537, 1e-12, "Perez D for the y chromaticity");

// Zenith luminance, appendix A.2, worked by hand at turbidity 4 and a sun 30
// degrees off the zenith.
{
  const T = 4, thetaS = 30 * Math.PI / 180;
  const chi = (4 / 9 - T / 120) * (Math.PI - 2 * thetaS);
  const want = (4.0453 * T - 4.9710) * Math.tan(chi) - 0.2155 * T + 2.4192;
  near(S.zenithColour(T, thetaS)[0], want, 1e-12, "zenith luminance");
}

// The Perez function normalises the zenith back to itself: Y at the zenith has
// to come out as Yz and no other value, or the whole sky is scaled wrong.
for (const elev of [70, 30, 5, 0]) {
  const st = S.skyState(3, elev);
  const F = S.perezF(st.perez, 1, (90 - elev) * Math.PI / 180);
  for (let i = 0; i < 3; i++) {
    near(F[i] / st.norm[i], 1, 1e-12, `zenith normalises to itself at ${elev} deg, channel ${i}`);
  }
}

// Kasten and Young: one atmosphere overhead, thirty-eight at the horizon.
near(S.airmass(0), 1, 0.001, "one airmass at the zenith");
ok(S.airmass(Math.PI / 2) > 35 && S.airmass(Math.PI / 2) < 40,
   `about thirty-eight airmasses at the horizon: ${S.airmass(Math.PI / 2)}`);

// The sun reddens as it goes down, and it is the blue that goes first.
{
  let lastBlue = 1;
  for (const elev of [60, 30, 15, 5, 0]) {
    const tint = S.skyState(clearDay, elev).sun;
    ok(tint[0] >= tint[1] && tint[1] >= tint[2], `sun at ${elev} deg: red over green over blue`);
    ok(tint[2] < lastBlue, `sun at ${elev} deg: less blue left than higher up`);
    lastBlue = tint[2];
  }
  ok(lastBlue < 0.05, `a sun on the horizon has almost no blue left: ${lastBlue}`);
}

// The model dims itself as the sun goes down. Nothing else should be darkening
// the daytime sky, so this term has to do it.
{
  const noon = S.skyState(clearDay, 57).zenith[0];
  const set = S.skyState(clearDay, 0).zenith[0];
  ok(noon > 3 * set, `a noon zenith is well over three times a sunset one: ${noon} against ${set}`);
}

// ---- the sky itself ---------------------------------------------------------
// Noon: blue overhead, and the horizon paler than the zenith.
{
  const st = S.skyState(clearDay, 57), sun = dirOf(180, 57);
  const zen = S.skyColour(st, [0, 1, 0], sun);
  const hor = S.skyColour(st, dirOf(WEST, 2), sun);
  ok(zen[2] > zen[0] + 0.15, `noon zenith is blue: ${zen.map((v) => v.toFixed(2))}`);
  ok(hor.reduce((a, b) => a + b) > zen.reduce((a, b) => a + b),
     "noon horizon is paler than the zenith");
}

// Sunset, which is the whole point of this. The sky by the sun is warm and it is
// not grey, and the sky opposite is cooler than it.
{
  const st = S.skyState(clearDay, 0), sun = dirOf(WEST, 0);
  const atSun = S.skyColour(st, dirOf(WEST, 2), sun);
  const opposite = S.skyColour(st, dirOf(EAST, 45), sun);
  ok(warmth(atSun) > 0.5, `sunset by the sun is warm: ${atSun.map((v) => v.toFixed(2))}`);
  ok(spread(atSun) > 0.5, `sunset by the sun is not grey: spread ${spread(atSun).toFixed(2)}`);
  ok(warmth(atSun) > warmth(opposite), "the sky by the setting sun is warmer than the sky opposite");
  ok(opposite[2] > atSun[2], "the sky opposite a setting sun keeps more blue than the sky by it");
}

// The old sky had no colour in it at any hour, which is what this replaces. So:
// at some point in the evening the sky by the sun has to be strongly coloured,
// and at noon it must not be.
{
  const evening = Math.max(...[10, 5, 2, 0].map((e) =>
    warmth(S.skyColour(S.skyState(clearDay, e), dirOf(WEST, 2), dirOf(WEST, e)))));
  const noon = warmth(S.skyColour(S.skyState(clearDay, 57), dirOf(WEST, 2), dirOf(180, 57)));
  ok(evening > 0.4, `the evening sky takes real colour: ${evening.toFixed(2)}`);
  ok(noon < 0.1, `the midday sky does not: ${noon.toFixed(2)}`);
}

// Haze reddens it. More aerosol, less blue by the sun, every step of the way.
{
  let lastWarm = -1;
  for (const aod of [0.05, 0.13, 0.3, 0.6, 1.0]) {
    const T = S.turbidityFromAerosol(aod);
    const st = S.skyState(T, 2);
    const c = S.skyColour(st, dirOf(WEST, 10), dirOf(WEST, 2));
    ok(warmth(c) > lastWarm, `aerosol ${aod} makes the low sky warmer than the step before`);
    lastWarm = warmth(c);
  }
}

// Cloud in layers, which is the thing one total cover cannot say.
{
  const st = S.skyState(clearDay, 2), sun = dirOf(WEST, 2);
  const where = dirOf(WEST, 25);
  const clear = S.skyColour(st, where, sun);
  const lidded = S.skyColour(st, where, sun, { cloud: 1 });
  const cirrus = S.skyColour(st, where, sun, { high: 0.7 });
  ok(spread(lidded) < 0.03, `overcast takes the colour out: spread ${spread(lidded).toFixed(3)}`);
  ok(warmth(cirrus) > warmth(clear) + 0.1,
     `high cloud over a low sun warms it: ${warmth(cirrus).toFixed(2)} against ${warmth(clear).toFixed(2)}`);
  // The same cirrus at midday must not set the sky on fire.
  const noon = S.skyState(clearDay, 57);
  const dry = S.skyColour(noon, where, dirOf(180, 57));
  const wet = S.skyColour(noon, where, dirOf(180, 57), { high: 0.7 });
  ok(warmth(wet) - warmth(dry) < 0.1, "high cloud at midday barely warms anything");
}

// And then it gets dark. Monotonically, all the way down through civil twilight,
// and not to nothing: the night keeps the shape of the day's gradient.
{
  const sun = dirOf(WEST, 0), up = dirOf(WEST, 30);
  const lumAt = (elev) => {
    const st = S.skyState(clearDay, Math.max(elev, 0));
    st.twilight = S.twilight(elev);
    return S.skyColour(st, up, sun).reduce((a, b) => a + b) / 3;
  };
  let last = 2;
  for (const elev of [2, 0, -2, -4, -6]) {
    const lum = lumAt(elev);
    ok(lum < last, `sun at ${elev} deg is darker than the step before it`);
    last = lum;
  }
  // Civil twilight is where it stops. Past six degrees down it is night and it
  // gets no darker, because there is nothing below night.
  near(lumAt(-10), last, 1e-12, "past civil twilight the sky stops darkening");
  ok(last > 0.02, `night is not pure black: ${last.toFixed(3)}`);
  const st = S.skyState(clearDay, 0);
  st.twilight = S.twilight(-10);
  const low = S.skyColour(st, dirOf(WEST, 2), sun);
  const high = S.skyColour(st, [0, 1, 0], sun);
  ok(low.reduce((a, b) => a + b) > high.reduce((a, b) => a + b),
     "a night sky is least dark where the sun went down");
}

// Nothing anywhere may leave the range a screen can show.
{
  for (const elev of [80, 40, 10, 2, 0, -3, -6]) {
    const st = S.skyState(clearDay, Math.max(elev, 0));
    st.twilight = S.twilight(elev);
    for (const az of [0, 90, 180, 270]) {
      for (const el of [0, 2, 20, 45, 89]) {
        for (const opts of [{}, { cloud: 1 }, { high: 1 }, { cloud: 0.5, high: 0.8 }]) {
          const c = S.skyColour(st, dirOf(az, el), dirOf(WEST, Math.max(elev, 0)), opts);
          ok(c.every((v) => Number.isFinite(v) && v >= 0 && v <= 1),
             `sun ${elev} az ${az} el ${el}: ${c} is off the screen`);
        }
      }
    }
  }
}

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("sky ok");
