// A camera on a script. Where it stands this second, and how it gets there.
//
// Two things here drive the camera without a hand on it: the novel's route and
// a recreation off the Sheriff's log. They want the same four things. A clock in
// seconds. An ease from wherever the camera was into the shot, because a cut
// loses where one place is from another. An arc round a subject, because a car
// arriving somewhere is a thing you watch from the side. And a way to find a
// perch that is not inside a wall or a fir.
//
// They were written twice and they grew the same bugs twice. Now they are one.
//
// Nothing here imports three. The caller passes in a raycaster and two vectors
// for the line of sight, which is the only part that needs it, and everything
// else is arithmetic on plain x/y/z.

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

// The first perch that can see the subject the whole way round the swing.
//
// A street has houses and fences down both sides and firs behind those. Guessing
// a height instead put the camera inside a wall on one street and inside a tree
// on the next, and put the novel's first chapter behind an office block. The
// perches are tried nearest and lowest first.
//
// Anything drawn in the scene counts as in the way except the caller's own
// group, which is why skip is passed. Only meshes: the scene carries sprites,
// lines and a sky that raycasting walks straight off the end of.
//
// ray, from and toward are a Raycaster and two Vector3 owned by the caller, so
// this file needs no three of its own and nothing is allocated per call.
export function clearView(centre, perches, spec, { scene, skip, ray, from, toward, clear = 2.5 }) {
  const aim = centre.y + (spec.aim == null ? 1.2 : spec.aim);
  const others = [];
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.geometry || !o.parent) return;
    for (let up = o; up; up = up.parent) if (up === skip) return;
    others.push(o);
  });
  for (const perch of perches) {
    let blocked = false;
    // Three looks across the arc: the start, the middle and the end of it.
    for (const step of [0, 0.5, 1]) {
      const at = arc(centre, { ...spec, ...perch }, step);
      from.set(at.eye.x, at.eye.y, at.eye.z);
      toward.set(centre.x - at.eye.x, aim - at.eye.y, centre.z - at.eye.z);
      const reach = toward.length();
      ray.set(from, toward.normalize());
      ray.far = reach - clear;          // do not count the ground under the car
      if (ray.intersectObjects(others, false).length) { blocked = true; break; }
    }
    if (!blocked) return perch;
  }
  // Nothing had a clear line, so take the one that looks over the most.
  return perches[perches.length - 1];
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
