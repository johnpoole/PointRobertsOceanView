// Remove the southeast quadrant from triangle geometry in the cabin's frame.
// Split crossing triangles at both edges; dropping vertices alone leaves faces
// bridging the notch. The interpolation preserves the existing roof pitches.
export function cutRoofNotch(positions, notchX, notchZ) {
  const out = [];
  const clip = (poly, axis, edge, below) => {
    const result = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const aIn = below ? a[axis] <= edge : a[axis] >= edge;
      const bIn = below ? b[axis] <= edge : b[axis] >= edge;
      if (aIn) result.push(a);
      if (aIn !== bIn) {
        const t = (edge - a[axis]) / (b[axis] - a[axis]);
        result.push(a.map((v, k) => v + t * (b[k] - v)));
      }
    }
    return result;
  };
  const append = (poly) => {
    for (let i = 1; i + 1 < poly.length; i++) {
      const [a, b, c] = [poly[0], poly[i], poly[i + 1]];
      const ab = b.map((v, k) => v - a[k]);
      const ac = c.map((v, k) => v - a[k]);
      const area = Math.hypot(ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]);
      if (area > 1e-10) out.push(...a, ...b, ...c);
    }
  };
  for (let i = 0; i < positions.length; i += 9) {
    const tri = [0, 3, 6].map((j) => Array.from(positions.slice(i + j, i + j + 3)));
    append(clip(tri, 0, notchX, true));
    // The east portion is retained only north of the notch. A triangle wholly
    // on the X boundary belongs to the first piece and must not be doubled.
    if (tri.some((p) => p[0] > notchX)) {
      append(clip(clip(tri, 0, notchX, false), 2, notchZ, true));
    }
  }
  return new Float32Array(out);
}

// A closed upper storey with the same southeast cut. Clipping the old box's
// faces alone would leave its two new wall faces open. This six-edge outline
// supplies those walls as well as the notched top and bottom surfaces.
export function notchedStorey(halfW, halfL, bottom, height, notchX, notchZ) {
  const outline = [[-halfW, -halfL], [-halfW, halfL], [notchX, halfL],
                   [notchX, notchZ], [halfW, notchZ], [halfW, -halfL]];
  const low = outline.map(([x, z]) => [x, bottom, z]);
  const high = outline.map(([x, z]) => [x, bottom + height, z]);
  const out = [];
  const tri = (a, b, c) => out.push(...a, ...b, ...c);
  // This L-shaped polygon is visible from its northwest corner, so the fan
  // stays entirely on the retained side of the cut.
  for (let i = 1; i + 1 < outline.length; i++) {
    tri(high[0], high[i], high[i + 1]);
    tri(low[0], low[i + 1], low[i]);
  }
  for (let i = 0; i < outline.length; i++) {
    const j = (i + 1) % outline.length;
    tri(low[i], low[j], high[j]);
    tri(low[i], high[j], high[i]);
  }
  return new Float32Array(out);
}
