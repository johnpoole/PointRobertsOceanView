// How a hole is played, as a place to be at each moment of it.
//
// A group does not slide down the fairway at a constant crawl: they stand on the
// tee, walk to their ball, stand over it, walk again, and gather on the green.
// Each player keeps their own line down the hole and their own ball, so they
// spread out through the middle of it and come back together at the end.
//
// The tee time and the four players are the club's; this rhythm is not. It is a
// depiction of how the fifteen minutes are spent, and nothing in the sheet says
// where anybody is standing.
//
// Keyframes are (time through the hole, distance down it, metres off the line).
// Where two in a row hold the same place, the player is standing still over the
// ball.
const PLAY = [
  { t: 0.00, along: 0.02, off: 0 },
  { t: 0.09, along: 0.02, off: 0 },   // waiting on the tee
  { t: 0.26, along: 0.33, off: 1 },   // out to the first ball
  { t: 0.34, along: 0.33, off: 1 },   // standing over it
  { t: 0.50, along: 0.62, off: 1 },
  { t: 0.58, along: 0.62, off: 1 },
  { t: 0.72, along: 0.85, off: 1 },
  { t: 0.79, along: 0.85, off: 1 },
  { t: 0.88, along: 0.97, off: 0 },   // onto the green, together again
  { t: 1.00, along: 1.00, off: 0 },
];

// How far off the centre line each player's own ball lies, in metres, and how
// much further or shorter they hit it. Fixed per player rather than random, so
// the same group walks the same way every time it is looked at.
const PLAYER_LINE = [-13, 7, -5, 15];
// Where each stands when the group is together, on the tee and on the green:
// metres off the line, a pace and a half apart. They were all at nought, which
// drew four players as one figure flickering between four shirts for a fifth
// of every hole. In the same order across as their lines, so nobody walks
// through anybody on the way out to a ball.
const PLAYER_STAND = [-2.1, 0.7, -0.7, 2.1];
const PLAYER_REACH = [0.04, -0.03, 0.06, -0.05];

// Where one player stands at this moment of their hole.
export function playing(fraction, player) {
  const t = Math.min(Math.max(fraction, 0), 1);
  let i = 1;
  while (i < PLAY.length - 1 && PLAY[i].t < t) i++;
  const a = PLAY[i - 1], b = PLAY[i];
  const span = Math.max(b.t - a.t, 1e-6);
  let k = (t - a.t) / span;
  // Ease in and out of every walk, so they set off and pull up rather than
  // snapping from standing to walking.
  k = k * k * (3 - 2 * k);
  const reach = PLAYER_REACH[player % PLAYER_REACH.length];
  const lineOff = PLAYER_LINE[player % PLAYER_LINE.length];
  const alongA = a.along + (a.off ? reach : 0);
  const alongB = b.along + (b.off ? reach : 0);
  // off runs from nought, gathered, to one, each at their own ball. Gathered is
  // not one spot: four people on a tee stand beside each other.
  const spread = a.off + (b.off - a.off) * k;
  const stand = PLAYER_STAND[player % PLAYER_STAND.length];
  return {
    along: alongA + (alongB - alongA) * k,
    off: spread * lineOff + (1 - spread) * stand,
  };
}
