// An overview map, drawn flat rather than with a second camera looking down.
// From the ground you cannot tell one road from another, and a top-down render
// of the world has the same problem — it is the same dark terrain seen from
// further away. A line map does what a map is for.
//
// The peninsula never moves, so the roads and the shoreline are drawn once into
// an offscreen canvas and blitted each frame with only the marker on top. That
// keeps a 40 000-point drawing off the per-frame path.

import { toWorld } from "./geo.js";

const BASE_PX = 1400;      // resolution the static map is drawn at
const MARGIN_M = 120;      // breathing room around the outermost feature

// Thin, and by class, so the hierarchy reads at a glance.
const STROKE = {
  secondary: [2.6, "#e8dfc8"], tertiary: [2.2, "#e8dfc8"],
  residential: [1.7, "#c9d3dc"], unclassified: [1.7, "#c9d3dc"],
  service: [1.0, "#8fa0ad"], track: [0.9, "#8fa0ad"],
  footway: [0.7, "#6f8391"], path: [0.7, "#6f8391"],
  cycleway: [0.8, "#6f8391"], bridleway: [0.7, "#6f8391"], steps: [0.7, "#6f8391"],
};
const STROKE_DEFAULT = [1.2, "#8fa0ad"];

export class OverviewMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.base = null;
    this.bounds = null;
    this.landmarks = [];
  }

  get visible() { return !this.canvas.classList.contains("hidden"); }

  toggle() { this.canvas.classList.toggle("hidden"); }

  // data is the baked OSM features. Everything is projected once here.
  build(data) {
    const lines = [];
    for (const r of data.roads) lines.push({ pts: r.coords, kind: r.kind });
    for (const c of data.coastline) lines.push({ pts: c.coords, kind: "coast" });

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const l of lines) {
      l.world = l.pts.map(([lat, lon]) => toWorld(lat, lon, 0));
      for (const w of l.world) {
        if (w.x < minX) minX = w.x; if (w.x > maxX) maxX = w.x;
        if (w.z < minZ) minZ = w.z; if (w.z > maxZ) maxZ = w.z;
      }
    }
    if (!isFinite(minX)) return;
    minX -= MARGIN_M; maxX += MARGIN_M; minZ -= MARGIN_M; maxZ += MARGIN_M;
    // Square it off so the map is not stretched in one direction.
    const span = Math.max(maxX - minX, maxZ - minZ);
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    this.bounds = { x0: cx - span / 2, z0: cz - span / 2, span };

    const base = document.createElement("canvas");
    base.width = base.height = BASE_PX;
    const g = base.getContext("2d");
    const px = (x) => ((x - this.bounds.x0) / span) * BASE_PX;
    const pz = (z) => ((z - this.bounds.z0) / span) * BASE_PX;

    g.lineCap = "round";
    g.lineJoin = "round";
    for (const l of lines) {
      const [w, colour] = l.kind === "coast" ? [1.6, "#cbb98f"] : (STROKE[l.kind] || STROKE_DEFAULT);
      g.lineWidth = w;
      g.strokeStyle = colour;
      g.beginPath();
      l.world.forEach((p, i) => (i ? g.lineTo(px(p.x), pz(p.z)) : g.moveTo(px(p.x), pz(p.z))));
      g.stroke();
    }

    this.landmarks = (data.landmarks || []).map((lm) => {
      const w = toWorld(lm.lat, lm.lon, 0);
      return { name: lm.name, x: w.x, z: w.z };
    });
    this.base = base;
  }

  // Where you are, and which way you are pointing.
  update(x, z, yaw) {
    if (!this.base || !this.visible) return;
    const c = this.canvas, ctx = this.ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = c.clientWidth;
    if (c.width !== size * dpr) { c.width = c.height = Math.round(size * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.base, 0, 0, size, size);

    const { x0, z0, span } = this.bounds;
    const toPx = (wx, wz) => [((wx - x0) / span) * size, ((wz - z0) / span) * size];

    ctx.font = "9px ui-monospace, Menlo, Consolas, monospace";
    ctx.fillStyle = "rgba(255,206,84,0.95)";
    ctx.textAlign = "center";
    for (const lm of this.landmarks) {
      const [mx, my] = toPx(lm.x, lm.z);
      if (mx < 0 || mx > size || my < 0 || my > size) continue;
      ctx.beginPath();
      ctx.arc(mx, my, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(lm.name, mx, my - 5);
    }

    // The marker: a wedge pointing the way you face.
    const [mx, my] = toPx(x, z);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(-yaw);              // yaw grows counter-clockwise; canvas y is down
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fillStyle = "#ff7a6b";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(8,16,24,0.9)";
    ctx.stroke();
    ctx.restore();
  }
}
