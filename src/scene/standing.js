// How much of a figure's pose is the walk, from nought (standing) to one.
//
// A figure's legs are turned by the ground it has covered. When it stops it
// used to hold whatever frame of the walk it stopped on: a golfer over the
// ball with one foot in the air. It now eases to a standing pose when the
// ground stops moving under it, and back into the walk when it sets off.
//
// weight is where it is now, advanced is whether it covered any ground since
// the last look, and dt is the seconds since then.
export const EASE_S = 0.35;

export function walkWeight(weight, advanced, dt) {
  const step = dt / EASE_S;
  return advanced ? Math.min(1, weight + step) : Math.max(0, weight - step);
}

// Ground covered that counts as moving, in metres. A figure held in place by
// arithmetic can drift by less than this and is still standing.
export const MOVED_M = 1e-4;
