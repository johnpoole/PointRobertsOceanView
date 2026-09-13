import assert from 'node:assert/strict';
import { stairAccessPlan } from './stair-access-plan.js';
import { groundClearance } from './ground-clearance.js';

const spec = { foot: [0, 10.45, 0], bearing: 74, steps: 19, going: 0.254, rise: 0.1674, width: 1.2 };
const p = stairAccessPlan(spec, [[-2, 10.45, -0.8], [-2.2, 10.45, 0.2]]);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
close(distance(p.bottom[1], p.bottom[2]), spec.width);
close(p.top, 13.4632);
close(p.run, 4.826);
close(distance(p.head[0], p.head[3]), spec.width);
// The head begins at the last tread's far edge, not its nose: no 254 mm gap.
close(distance(spec.foot, p.point(p.run, 0)), spec.steps * spec.going);
assert.ok(p.bottom.every(v => v[1] === spec.foot[1]));
assert.ok(p.head.every(v => v[1] === p.top));
assert.throws(() => stairAccessPlan(spec, [[-2, 8.55, -1], [-2, 8.55, 1]]), /share a level/);
const cut = groundClearance([p.bottom, p.head].map(poly => ({
  polygon: poly.map(v => [v[0], v[2]]), ceiling: poly[0][1] - 0.28,
})), 0.343);
for (const poly of [p.bottom, p.head]) {
  for (const a of poly) {
    close(cut(a[0], a[2], 25), a[1] - 0.28);
    close(cut(a[0], a[2], 3), 3); // never raise existing ground
  }
}
close(cut(100, 100, 25), 25);
console.log('Stair access passed: full-width, level landings; exact last-tread join; local cut-only clearance.');
