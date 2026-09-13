// The 2017 walkthrough (23–34 s): a paved head landing and a level connection
// from the final concrete flight to the cabin entrance. Landing depth is an
// estimate; tread placement/count/levels remain the owner's stair controls.
export function stairAccessPlan({ foot, bearing, steps, going, rise, width }, entryEdge) {
  const b = bearing * Math.PI / 180, run = steps * going;
  const top = foot[1] + (steps - 1) * rise, headDepth = 1.30;
  const point = (along, across, y = foot[1]) => [
    foot[0] + Math.sin(b) * along + Math.cos(b) * across, y,
    foot[2] - Math.cos(b) * along + Math.sin(b) * across,
  ];
  const head = [point(run, -width / 2, top), point(run + headDepth, -width / 2, top),
    point(run + headDepth, width / 2, top), point(run, width / 2, top)];
  if (entryEdge && entryEdge.some(p => Math.abs(p[1] - foot[1]) > 1e-6)) {
    throw new Error('Stair foot and cabin entry landing must share a level');
  }
  const bottom = entryEdge ? [entryEdge[0], point(0, -width / 2),
    point(0, width / 2), entryEdge[1]] : null;
  return { head, bottom, point, run, top, headDepth, width };
}
