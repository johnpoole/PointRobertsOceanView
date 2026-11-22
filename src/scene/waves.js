// The size of the sea, from the two figures the marine feed gives: a significant
// wave height and a period.
//
// The sea is drawn as three sine waves. PARTS gives each one's wavelength and
// amplitude as a share of the first. The ocean's shader and its CPU copy both
// build their sum from this list.
export const PARTS = [
  { len: 1.0, amp: 1.0 },
  { len: 0.65, amp: 0.7 },
  { len: 0.3, amp: 0.4 },
];

// A reported wave height is a significant height, which is four times the
// standard deviation of the surface. A sine of amplitude a has a variance of
// a*a/2, and the variances of the three add. So the three together stand
// 4 * sqrt(sum(amp^2) / 2) high for a first amplitude of one, which is 3.63.
//
// The first amplitude used to be half the reported height, as though the sea
// were one sine. That drew 0.54 m as 0.98 m.
const HEIGHT_PER_AMP = 4 * Math.sqrt(PARTS.reduce((sum, p) => sum + p.amp * p.amp, 0) / 2);

// The first wave's amplitude for a reported height, in metres.
export function ampFor(heightM) {
  return heightM / HEIGHT_PER_AMP;
}

// Deep water wavelength for a period: g T^2 / 2 pi. 2.95 s is 13.6 m.
export function lengthFor(periodS) {
  return (9.81 / (2 * Math.PI)) * periodS * periodS;
}

// How much of a wave a mesh can carry as a shape, nought to one. A mesh with
// points 47 m apart cannot hold a 14 m wave. It can only sample it at random,
// which heaves the surface in facets the size of the mesh. Below three points
// to a wavelength it carries none of it, and from six it carries it all. What
// the mesh does not carry is still lit as a wave, pixel by pixel.
export const CARRY_FROM = 3;
export const CARRY_FULL = 6;
export function carried(lenM, spacingM) {
  const t = Math.min(1, Math.max(0, (lenM / spacingM - CARRY_FROM) / (CARRY_FULL - CARRY_FROM)));
  return t * t * (3 - 2 * t);   // the shader's smoothstep
}
