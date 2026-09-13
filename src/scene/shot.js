// A camera on a script. Where it stands this second, and how it gets there.
//
// The novel's route drives the camera without a hand on it. It wants an ease
// from wherever the camera was into the shot, because a cut loses where one
// place is from another, and an arc round a subject for the one chapter that
// follows a chase.
//
// Nothing here imports three. It is arithmetic on plain x/y/z.

// Smoothstep, clamped at both ends, because a beat can overrun by a frame.
export function ease(k) {
  const t = Math.min(Math.max(k, 0), 1);
  return t * t * (3 - 2 * t);
}

// Straight line between two marks, clamped the same way.
export function lerp(a, b, k) {
  const t = Math.min(Math.max(k, 0), 1);
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y == null ? 0 : a.y + ((b.y == null ? 0 : b.y) - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

// Where the camera stands on an arc round a subject, k of the way through the
// swing. centre carries the ground under the subject in y.
//
// spec:
//   from    the bearing it starts at, degrees
//   sweep   how far round it goes, degrees. Signed.
//   radius  how far out
//   height  how far above the ground under the subject
//   aim     how far above that ground the lens points. Chest, not boots.
export function arc(centre, spec, k) {
  const turn = (spec.from + spec.sweep * Math.min(Math.max(k, 0), 1))
    * Math.PI / 180;
  return {
    eye: {
      x: centre.x + Math.cos(turn) * spec.radius,
      y: centre.y + spec.height,
      z: centre.z + Math.sin(turn) * spec.radius,
    },
    aim: { x: centre.x, y: centre.y + (spec.aim == null ? 1.2 : spec.aim), z: centre.z },
  };
}

// The move into a shot. Holds where the camera was when the shot started and
// eases from there to wherever the shot wants it, over seconds.
//
// A scripted camera is not a dragged one, so the caller lifts the polar stop
// before it runs. With the stop in place OrbitControls reads a near-level view
// as an illegal angle and swings the camera up and back until it is legal, and
// half of these shots are somebody standing on a flat looking along it.
export class Move {
  constructor(seconds) {
    this.seconds = seconds;
    this.from = null;
  }

  // Where the camera is now is where the move starts. Called when the shot
  // starts, or on the first frame if the shot did not know then.
  mark(camera, controls) {
    this.from = { eye: camera.position.clone(), aim: controls.target.clone() };
  }

  // Put the camera on the pose, gone seconds into the move. Past seconds it
  // holds the pose exactly and the shot itself does the moving.
  to(camera, controls, pose, gone) {
    if (!this.from) this.mark(camera, controls);
    const k = ease(this.seconds > 0 ? gone / this.seconds : 1);
    const eye = lerp(this.from.eye, pose.eye, k);
    const aim = lerp(this.from.aim, pose.aim, k);
    camera.position.set(eye.x, eye.y, eye.z);
    controls.target.set(aim.x, aim.y, aim.z);
    controls.update();
  }
}
