// Cut a height field below modeled walking surfaces. Polygons and ceilings use
// the structure's local metres. A grid diagonal of full-depth clearance makes
// every vertex of a terrain triangle crossing the surface obey its ceiling;
// clipping only at the polygon edge lets interpolation lift the ground back in.
export function groundClearance(surfaces, gridDiagonal, fade = 0.6) {
  const regions = surfaces.map(({ polygon, ceiling }) => ({
    polygon, ceiling,
    minX: Math.min(...polygon.map(p => p[0])) - gridDiagonal - fade,
    maxX: Math.max(...polygon.map(p => p[0])) + gridDiagonal + fade,
    minZ: Math.min(...polygon.map(p => p[1])) - gridDiagonal - fade,
    maxZ: Math.max(...polygon.map(p => p[1])) + gridDiagonal + fade,
  }));
  return (x, z, height) => {
    let cut = height;
    for (const r of regions) {
      if (height <= r.ceiling || x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
      let inside = false, distance2 = Infinity;
      for (let i = 0, j = r.polygon.length - 1; i < r.polygon.length; j = i++) {
        const [ax, az] = r.polygon[j], [bx, bz] = r.polygon[i];
        const dx = bx - ax, dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
        distance2 = Math.min(distance2, (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2);
        if ((az > z) !== (bz > z) && x < ax + (z - az) * dx / dz) inside = !inside;
      }
      const distance = inside ? 0 : Math.sqrt(distance2);
      if (distance >= gridDiagonal + fade) continue;
      const blend = Math.max(0, (distance - gridDiagonal) / fade);
      cut = Math.min(cut, r.ceiling + (height - r.ceiling) * blend);
    }
    return cut;
  };
}
