// Where to draw something whose position arrives every few seconds.
//
// It is drawn a little behind the feed, sliding between its last real
// positions, so it is never anywhere it was not. It used to be pulled toward
// each new position in about a second and then sit still until the next: a jet
// at 130 m/s jumped 780 m and held for five seconds.
//
// The price is the lag. With a position every 6 s the newest one is reached
// just as the next arrives, so nothing waits and nothing is guessed.

// How far behind the feed the drawing runs, in seconds. The poll is 6 s, a
// position is up to a second old when it is fetched and the answer takes a
// moment to come. Short of all three, it reaches the last position early and
// waits there.
export const LAG_S = 8;

const KEPT = 3;

// Take a new fix {t, x, y, z}. One no newer than the last is the same position
// sent again, and is not a fix.
export function addFix(fixes, fix) {
  const last = fixes[fixes.length - 1];
  if (last && fix.t <= last.t) return;
  fixes.push(fix);
  if (fixes.length > KEPT) fixes.shift();
}

// The place at time t: between the two fixes either side of it, at the first
// before them all, and at the last after them all. Never past the last.
export function placeAt(fixes, t) {
  const first = fixes[0], last = fixes[fixes.length - 1];
  if (t <= first.t) return { x: first.x, y: first.y, z: first.z };
  if (t >= last.t) return { x: last.x, y: last.y, z: last.z };
  let i = 1;
  while (fixes[i].t < t) i++;
  const a = fixes[i - 1], b = fixes[i];
  const k = (t - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
}
