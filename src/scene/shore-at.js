// A place a distance s along a shore that is kept as a point every stepM
// metres, each with the way the coast runs (tx, tz) and the way out to sea
// (nx, nz).
//
// Between two points it is between them. It used to be whichever point was
// nearer, so a pod swimming at 2.2 m/s held still for twenty seconds and then
// jumped 50 m, and further where the shore bends, because the way out to sea
// jumped with it.
export function shoreAt(shore, s, stepM) {
  if (shore.length === 1) return shore[0];
  const f = Math.min(shore.length - 1, Math.max(0, s / stepM));
  const i = Math.min(shore.length - 2, Math.floor(f));
  const k = f - i;
  const a = shore[i], b = shore[i + 1];
  const mix = (p, q) => p + (q - p) * k;
  // The two directions are turned from one to the other and kept at length one.
  const unit = (x, z) => {
    const len = Math.hypot(x, z);
    return len > 1e-9 ? [x / len, z / len] : [a.tx, a.tz];
  };
  const [tx, tz] = unit(mix(a.tx, b.tx), mix(a.tz, b.tz));
  const [nx, nz] = unit(mix(a.nx, b.nx), mix(a.nz, b.nz));
  return { x: mix(a.x, b.x), z: mix(a.z, b.z), tx, tz, nx, nz, s: mix(a.s, b.s) };
}
