// South concrete stairs, constrained by the August 2026 owner photographs.
// Anchors/step counts are model estimates; flights meet their landing levels.
export function southStairPlan({ halfW, halfL, lowerFloor, upperFloor, southEnd, southOutEast }) {
  const lower = { x: -3, z: 8.15, width: 1.15, steps: 18, going: 0.30, bottom: 5.58 };
  lower.x = southEnd - (lower.steps - 0.5) * lower.going;
  lower.rise = (lowerFloor - lower.bottom) / lower.steps;
  const upper = { x: halfW + 1.15 / 2, width: 1.15, steps: 10,
    foot: halfL + southOutEast, head: halfL + 0.91 };
  upper.going = (upper.foot - upper.head) / upper.steps;
  upper.rise = (upperFloor - lowerFloor) / upper.steps;
  const left = upper.x - upper.width / 2, right = upper.x + upper.width / 2;
  const landing = [
    [southEnd, upper.foot - 1.1], [left, upper.foot - 1.1],
    [left, upper.foot], [right, upper.foot], [right, 9], [southEnd, 9],
  ];
  const topLanding = [[halfW, halfL], [right, halfL], [right, upper.head], [halfW, upper.head]];
  return { lower, upper, landing, topLanding, lowerFloor, upperFloor };
}

// May 2025 north photo: a landing beside the wall, then a westward descent.
// Width/run are estimates; joins and storey levels are shared constraints.
export function northStairPlan({ halfW, halfL, lowerFloor, upperFloor }) {
  const width = 0.91, going = 0.28, steps = 9;
  const head = -halfW + 1.20, foot = head - steps * going;
  const z = -halfL - width / 2;
  const rectangle = (a, b) => [[a, -halfL], [b, -halfL], [b, -halfL - width], [a, -halfL - width]];
  return { width, going, steps, head, foot, z, rise: (upperFloor - lowerFloor) / steps,
    top: rectangle(head, halfW), bottom: rectangle(foot - width, foot),
    lowerFloor, upperFloor };
}
