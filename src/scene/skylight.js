// The Preetham daylight model, as arithmetic. Preetham, Shirley and Smits,
// "A Practical Analytic Model for Daylight", SIGGRAPH 1999.
//
// This file imports nothing. The sky shader needs the same numbers the fog
// needs, and a formula that lives in GLSL alone can only ever be checked by
// looking at a picture. So the coefficients and the zenith values are worked out
// here, once, and handed to the shader as uniforms. The test reads this file and
// checks them against the paper.
//
// The model takes one number for the state of the air — turbidity, the ratio of
// the whole vertical optical thickness to the molecular part alone. That is
// where the weather feed enters. Everything after it is geometry.

// Rayleigh optical depth of the clean atmosphere at 550 nm, sea level. Open-Meteo
// reports aerosol optical depth at that same wavelength, which is what lets the
// two divide.
export const RAYLEIGH_TAU_550 = 0.0973;

// Preetham turbidity is (molecular + haze) / molecular, so an aerosol depth of
// zero is a turbidity of one. Below about 1.8 and above about 10 the Perez
// coefficients were never fitted and the sky goes strange colours, so it is held
// between them. Ten is thick wildfire smoke, which the Fraser Valley sends down
// here most summers.
export function turbidityFromAerosol(aod) {
  if (aod == null || !Number.isFinite(aod) || aod < 0) return null;
  return Math.min(Math.max(1 + aod / RAYLEIGH_TAU_550, 1.8), 10);
}

// Perez coefficients A..E, each linear in turbidity. Preetham appendix A.2.
// Rows are [slope, intercept]; the three of them are luminance Y and the two
// chromaticities x and y.
const PEREZ_TERMS = {
  A: [[0.1787, -1.4630], [-0.0193, -0.2592], [-0.0167, -0.2608]],
  B: [[-0.3554, 0.4275], [-0.0665, 0.0008], [-0.0950, 0.0092]],
  C: [[-0.0227, 5.3251], [-0.0004, 0.2125], [-0.0079, 0.2102]],
  D: [[0.1206, -2.5771], [-0.0641, -0.8989], [-0.0441, -1.6537]],
  E: [[-0.0670, 0.3703], [-0.0033, 0.0452], [-0.0109, 0.0529]],
};

export function perezCoefficients(turbidity) {
  const out = {};
  for (const [name, rows] of Object.entries(PEREZ_TERMS)) {
    out[name] = rows.map(([slope, intercept]) => slope * turbidity + intercept);
  }
  return out;
}

// Zenith chromaticity, Preetham appendix A.2: a cubic in the sun's zenith angle
// whose own coefficients are a quadratic in turbidity.
const ZENITH_X = [
  [0.00166, -0.00375, 0.00209, 0.00000],
  [-0.02903, 0.06377, -0.03202, 0.00394],
  [0.11693, -0.21196, 0.06052, 0.25886],
];
const ZENITH_Y = [
  [0.00275, -0.00610, 0.00317, 0.00000],
  [-0.04214, 0.08970, -0.04153, 0.00516],
  [0.15346, -0.26756, 0.06670, 0.26688],
];

function zenithChroma(rows, turbidity, thetaS) {
  const t2 = thetaS * thetaS, t3 = t2 * thetaS;
  const cubic = (r) => r[0] * t3 + r[1] * t2 + r[2] * thetaS + r[3];
  return turbidity * turbidity * cubic(rows[0]) + turbidity * cubic(rows[1]) + cubic(rows[2]);
}

// Zenith luminance in kcd/m². Preetham appendix A.2. This is the term that makes
// the model dim itself as the sun goes down — a clear noon zenith is around
// 8 kcd/m² and the same sky at sunset is under 2 — so nothing else needs to
// darken the sky for dusk, and nothing else should.
export function zenithColour(turbidity, thetaS) {
  const chi = (4 / 9 - turbidity / 120) * (Math.PI - 2 * thetaS);
  const Yz = (4.0453 * turbidity - 4.9710) * Math.tan(chi) - 0.2155 * turbidity + 2.4192;
  return [Yz, zenithChroma(ZENITH_X, turbidity, thetaS), zenithChroma(ZENITH_Y, turbidity, thetaS)];
}

// The Perez sky function, for a view direction at angle theta off the zenith and
// gamma off the sun. All three channels at once.
export function perezF(p, cosTheta, gamma) {
  const ct = Math.max(cosTheta, 0.01);   // the formula runs away at the horizon
  const cg = Math.cos(gamma);
  return [0, 1, 2].map((i) =>
    (1 + p.A[i] * Math.exp(p.B[i] / ct)) *
    (1 + p.C[i] * Math.exp(p.D[i] * gamma) + p.E[i] * cg * cg));
}

// CIE xyY to linear sRGB, D65.
export function xyYToLinearRgb([Y, x, y]) {
  if (y <= 0) return [0, 0, 0];
  const X = (x / y) * Y;
  const Z = ((1 - x - y) / y) * Y;
  return [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.2040 * Y + 1.0570 * Z,
  ];
}

// Kasten and Young 1989. One atmosphere at the zenith and thirty-eight of them
// at the horizon, which is the whole reason a setting sun is red.
export function airmass(thetaS) {
  const zDeg = Math.min(thetaS * 180 / Math.PI, 90);
  return 1 / (Math.cos(zDeg * Math.PI / 180) + 0.50572 * Math.pow(96.07995 - zDeg, -1.6364));
}

// What is left of the sun's own light after the air has taken its share.
// Rayleigh goes as the fourth power of the wavelength, so the blue is stripped
// first. The haze is taken as grey, which is near enough for Mie at these
// particle sizes. Normalised to its brightest channel, because how bright the
// disk is drawn is a separate matter from what colour it has gone.
const CHANNEL_NM = [610, 550, 465];
export function sunTint(thetaS, turbidity) {
  const m = airmass(thetaS);
  const haze = (turbidity - 1) * RAYLEIGH_TAU_550;
  const t = CHANNEL_NM.map((nm) => {
    const tau = RAYLEIGH_TAU_550 * Math.pow(550 / nm, 4);
    return Math.exp(-(tau + haze) * m);
  });
  const peak = Math.max(...t);
  return peak > 0 ? t.map((v) => v / peak) : [0, 0, 0];
}

// Preetham is a daylight model and says nothing about a sun under the horizon.
// So the sun is held at the horizon for the colours and the whole sky is faded
// out across civil twilight instead, which is the six degrees the sun takes to
// go from set to dark.
//
// It does not fade to nothing. A twentieth of the day sky is left standing so
// the night keeps the shape of the day's gradient — a night sky is darkest
// overhead and least dark where the sun went down, and a flat dome is wrong.
export const NIGHT_FLOOR = 0.05;

export function twilight(sunElevationDeg) {
  const t = Math.min(Math.max((sunElevationDeg + 6) / 6, 0), 1);
  return NIGHT_FLOOR + (1 - NIGHT_FLOOR) * t;
}

// What the night sky is left standing at once the sun has gone: not black, and
// blue rather than grey.
export const NIGHT_SKY = [0.02, 0.03, 0.06];

// Everything the shader cannot work out per fragment — the coefficients, the
// zenith, the value that normalises the zenith back to itself, the colour the
// sun has gone and how far through twilight we are.
export function skyState(turbidity, sunElevationDeg) {
  const thetaS = Math.min((90 - sunElevationDeg) * Math.PI / 180, Math.PI / 2);
  const p = perezCoefficients(turbidity);
  const zenith = zenithColour(turbidity, thetaS);
  // Y(theta,gamma) = Yz * F(theta,gamma) / F(0,thetaS): the sky at the zenith
  // has to come back as the zenith value.
  const norm = perezF(p, 1, thetaS);
  return {
    turbidity,
    perez: p,
    zenith,
    norm,
    sun: sunTint(thetaS, turbidity),
    twilight: twilight(sunElevationDeg),
    exposure: exposureFor(p, zenith, norm, thetaS),
  };
}

// The eye adapts and a screen does not, so something has to say how bright to
// draw a sky given in real luminance. What it is pinned to matters more than
// anything else in this file.
//
// It was pinned to the zenith, and that was wrong, and the way it was wrong is
// worth keeping written down. At sunset the sky three degrees above the horizon
// is nearly twenty times the zenith. Expose for the zenith and the whole band
// runs off the top of the curve, red and green both stop at one, and red and
// green at one is yellow. The page looks west with a twenty-five degree field
// from eye height, so that band is the entire sky anybody sees — and every
// evening came out one flat yellow with no gradient in it at all.
//
// So it is pinned to the two of them together, the geometric mean of the zenith
// and the horizon toward the sun. Halfway in the logarithm is halfway between
// exposing for the dark part and exposing for the bright part, which is roughly
// what an eye does when it looks at a sunset.
export const EXPOSURE_TARGET = 0.8;

// Three degrees up: low enough to be the band, high enough not to sit inside
// the sun itself.
const HORIZON_EL = 3 * Math.PI / 180;

export function exposureFor(perez, zenith, norm, thetaS) {
  const F = perezF(perez, Math.sin(HORIZON_EL), Math.abs((Math.PI / 2 - thetaS) - HORIZON_EL));
  const horizon = zenith[0] * F[0] / norm[0];
  const ref = Math.sqrt(Math.max(zenith[0], 0.05) * Math.max(horizon, 0.05));
  return EXPOSURE_TARGET / ref;
}

// Preetham fitted his chromaticity for a sun down to about five degrees and it
// gives up below that: it hands back a flat yellow where a real sunset goes
// orange and then red. What the fit leaves out is that the light doing the
// scattering has itself come the long way in and been reddened on the way, and
// that is a quantity already worked out here for the sun's own disk. So the low
// sky is multiplied by it, hardest at the horizon and not at all overhead.
//
// BEAM_SHARE is how much of the light arriving from a patch of low sky came
// straight off the beam rather than bouncing about first. Near the horizon at
// sunset that is very nearly all of it, so it is one, and the falloff with
// height is linear rather than squared: squared kept the reddening in the last
// few degrees, where the sky is too bright to show it anyway, and left
// everything from ten degrees up the flat yellow it started as.
const BEAM_SHARE = 1.0;

export function beamReddening(state, dirY) {
  const slant = 1 - Math.min(Math.max(dirY, 0), 1);
  return state.sun.map((t) => 1 + (t - 1) * slant * BEAM_SHARE);
}

const LUMA = [0.2126, 0.7152, 0.0722];

// Reinhard on the luminance alone, with the colour carried through unchanged.
// Squeezing each channel on its own turns every bright sky white, and the sky
// beside a setting sun is the brightest thing in the frame and the least white.
export function toneMap(linear) {
  const lum = LUMA[0] * linear[0] + LUMA[1] * linear[1] + LUMA[2] * linear[2];
  if (lum <= 0) return [0, 0, 0];
  const scale = (lum / (1 + lum)) / lum;
  return linear.map((v) => Math.min(Math.max(v, 0) * scale, 1));
}

// Linear to sRGB, the same curve three puts on every lit material in the scene.
export function encodeSrgb(c) {
  return c.map((v) => {
    const x = Math.min(Math.max(v, 0), 1);
    return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  });
}

// The sun itself, which is added on top of the sky rather than being part of it.
//
// This was a quarter of the trouble the first version had. The glow was
// pow(cos, 12) and that is thirty degrees wide, added straight onto a sky that
// was already near the top of the range, so red and green both stopped at one
// over most of the western sky — and red and green at one is yellow. It is the
// sun's own light, so it is the sun's own colour, and it has no business
// brightening a third of the dome.
//
// Preetham already brightens the sky toward the sun; that is what the C and D
// terms are for. What is left for this is the disk and the halo around it.
// SUN_RADIUS is the real one, sixteen arcminutes.
export const SUN_COS_INNER = Math.cos(0.24 * Math.PI / 180);
export const SUN_COS_OUTER = Math.cos(0.30 * Math.PI / 180);
export const HALO_POWER = 1200;    // about three degrees wide
export const HALO_STRENGTH = 0.35;

function smoothstep(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

// dir and sunDir are unit vectors; sunDir is where the sun really is, which after
// it sets is under the horizon and behind the sea.
export function sunDisk(state, dir, sunDir, cloud = 0) {
  const s = Math.max(dir[0] * sunDir[0] + dir[1] * sunDir[1] + dir[2] * sunDir[2], 0);
  const amount = (smoothstep(SUN_COS_OUTER, SUN_COS_INNER, s) + Math.pow(s, HALO_POWER) * HALO_STRENGTH)
    * (1 - 0.85 * cloud) * state.twilight;
  return state.sun.map((t) => t * amount);
}

// One patch of sky, all the way through, in the same order the shader does it.
// dir and sunDir are unit vectors with y up. cloud is the low and middle cover
// that lids the sky; high is the thin cloud that catches the last of the sun.
export function skyColour(state, dir, sunSky, { cloud = 0, high = 0, sunDir = null } = {}) {
  const cosG = Math.min(Math.max(
    dir[0] * sunSky[0] + dir[1] * sunSky[1] + dir[2] * sunSky[2], -1), 1);
  const F = perezF(state.perez, dir[1], Math.acos(cosG));
  const Y = state.zenith[0] * F[0] / state.norm[0];
  const x = state.zenith[1] * F[1] / state.norm[1];
  const y = state.zenith[2] * F[2] / state.norm[2];

  // Preetham hands back the colour and the brightness apart from each other, and
  // they are kept apart to here, because it is the colour that knows the sky
  // beside a setting sun has no blue left in it at all.
  const unit = xyYToLinearRgb([1, x, y]);
  const red = beamReddening(state, dir[1]);
  let rgb = unit.map((v, i) => Math.max(v, 0) * Y * state.exposure * red[i]);

  // Cloud scatters every wavelength alike, so an overcast sky is the same sky
  // with the colour taken out of it and a little of the light with it.
  if (cloud > 0) {
    const lum = LUMA[0] * rgb[0] + LUMA[1] * rgb[1] + LUMA[2] * rgb[2];
    rgb = rgb.map((v) => v + (lum * 0.85 - v) * cloud);
  }

  // Not Preetham. High cloud stands above the shadow line and is lit from
  // beneath after the ground has gone dark, and that is the evening people stop
  // to look at. The model has no cloud in it at all, so this is the second of
  // the two hand-set terms here: a warm lift on the upper sky, scaled by how much
  // high cloud the feed reports and by how low the sun has got.
  if (high > 0) {
    const lift = high * Math.min(Math.max(dir[1] / 0.4, 0), 1);
    rgb = rgb.map((v, i) => v + (v * state.sun[i] * 1.7 - v) * lift);
  }

  // The night shows through where the day sky has gone, and not over the top of
  // what is still lit. Laying it flat across everything put blue into the band
  // by the sun and turned a quarter of an hour after sunset brown.
  const day = state.twilight;
  const lit = toneMap(rgb);
  const night = lit.map((v, i) => v * day + NIGHT_SKY[i] * (1 - day) * (1 - v));

  // The sun goes on last and only when it is asked for: the fog wants the sky it
  // fades into and not the disk hanging in it.
  const disk = sunDir ? sunDisk(state, dir, sunDir, cloud) : null;
  return encodeSrgb(disk ? night.map((v, i) => v + disk[i]) : night);
}
